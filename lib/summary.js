import { h as fetchJson, t as Config, v as readResponseBytes } from "./config.js";
import { isHiraAppEnabled } from "./apps/runtime.js";
import { c as canSendResolverForward, i as replyPlainText, l as resolveEventForwardIdentity, o as replyText } from "./message.js";
import { r as hostnameOf } from "./url.js";
import karin, { common, segment } from "node-karin";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import dns from "node:dns/promises";
import net from "node:net";
//#region src/summary/urlSafety.ts
const maxRedirects = 5;
const maxPageBytes = 2 * 1024 * 1024;
const pageTimeoutMs = 2e4;
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ipv4ToNumber = (address) => address.split(".").reduce((total, part) => total * 256 + Number(part), 0);
const isBlockedIpv4 = (address) => {
	const value = ipv4ToNumber(address);
	return [
		["0.0.0.0", 8],
		["10.0.0.0", 8],
		["100.64.0.0", 10],
		["127.0.0.0", 8],
		["169.254.0.0", 16],
		["172.16.0.0", 12],
		["192.0.0.0", 24],
		["192.0.2.0", 24],
		["192.168.0.0", 16],
		["198.18.0.0", 15],
		["198.51.100.0", 24],
		["203.0.113.0", 24],
		["224.0.0.0", 4],
		["240.0.0.0", 4]
	].some(([base, prefix]) => {
		const size = 2 ** (32 - prefix);
		return value >= ipv4ToNumber(base) && value < ipv4ToNumber(base) + size;
	});
};
const expandIpv6 = (address) => {
	const halves = address.toLowerCase().split("%")[0].split("::");
	if (halves.length > 2) return void 0;
	const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
	const tail = halves[1] ? halves[1].split(":").filter(Boolean) : [];
	const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
	if (missing < 0 || halves.length === 1 && head.length !== 8) return void 0;
	const parts = [
		...head,
		...Array.from({ length: missing }, () => "0"),
		...tail
	];
	if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return void 0;
	return parts.map((part) => Number.parseInt(part, 16));
};
const isBlockedIpv6 = (address) => {
	const parts = expandIpv6(address);
	if (!parts) return true;
	if (parts.slice(0, 7).every((part) => part === 0) && (parts[7] === 0 || parts[7] === 1)) return true;
	const first = parts[0];
	if ((first & 65024) === 64512) return true;
	if ((first & 65472) === 65152) return true;
	if (parts[0] === 8193 && parts[1] === 3512) return true;
	if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 65535) return isBlockedIpv4(`${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`);
	return false;
};
const isBlockedAddress = (address) => {
	const family = net.isIP(address);
	if (family === 4) return isBlockedIpv4(address);
	if (family === 6) return isBlockedIpv6(address);
	return true;
};
const validateHostname = (hostname) => {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "metadata" || normalized === "metadata.google.internal" || normalized.endsWith(".internal") || normalized.endsWith(".local")) throw new Error("网页地址指向受限主机");
};
const validatePublicUrl = async (input) => {
	let url;
	try {
		url = new URL(input);
	} catch {
		throw new Error("网页地址无效");
	}
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("网页地址只允许 http 或 https");
	if (url.username || url.password) throw new Error("网页地址不能包含账号密码");
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	validateHostname(hostname);
	if (isBlockedAddress(hostname)) throw new Error("网页地址指向受限地址");
	if (net.isIP(hostname) === 0) {
		let records;
		try {
			records = await dns.lookup(hostname, {
				all: true,
				verbatim: true
			});
		} catch {
			throw new Error("网页地址无法解析");
		}
		if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) throw new Error("网页地址解析到了受限地址");
	}
	return url;
};
const isRedirect = (status) => status >= 300 && status < 400;
const isAllowedPageContent = (response) => {
	const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
	if (!contentType) return true;
	return contentType === "text/html" || contentType === "application/xhtml+xml" || contentType === "text/plain" || contentType.startsWith("text/");
};
const fetchPublicPageText = async (input) => {
	let current = (await validatePublicUrl(input)).toString();
	for (let count = 0; count <= maxRedirects; count++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), pageTimeoutMs);
		try {
			const response = await fetch(current, {
				redirect: "manual",
				headers: { "User-Agent": userAgent },
				signal: controller.signal
			});
			if (isRedirect(response.status)) {
				const location = response.headers.get("location");
				if (!location) throw new Error(`网页重定向缺少目标地址（HTTP ${response.status}）`);
				current = (await validatePublicUrl(new URL(location, current).toString())).toString();
				await response.body?.cancel();
				continue;
			}
			if (!response.ok) throw new Error(`网页请求失败：HTTP ${response.status}`);
			if (!isAllowedPageContent(response)) throw new Error("目标地址不是可总结的文本网页");
			return (await readResponseBytes(response, maxPageBytes)).toString("utf8");
		} finally {
			clearTimeout(timeout);
		}
	}
	throw new Error("网页重定向次数超过限制");
};
//#endregion
//#region src/summary/service.ts
/**
* 网页总结 prompt（R constants/constant.js SUMMARY_PROMPT 的结构化版本：
* 标题 + 摘要 + 带表情的关键段落，输出固定中文）。
*/
const summaryPrompt = `# Role: Web Content Summarization Assistant

## Profile
- language: 中文
- description: 一个专门用于网页内容摘要的 AI 助手，能提取关键点、总结文章，并给出复杂主题的简洁概览。

## Skills
1. 精通自然语言理解和摘要技术。
2. 能从文章、博客、报告等网页内容里提取关键信息。
3. 能总结短篇和长篇内容，并适应不同写作风格与语调。

## Rules
1. 确保摘要捕捉网页的主要思想和关键点。
2. 摘要简洁、清晰、准确，避免不必要的细节。
3. 根据原文的复杂度和长度调整摘要的详细程度。
4. 保持原文的上下文和意图，不添加个人解释。
5. 输出内容必须为中文。

## Workflows
1. 分析网页的结构和主要部分。
2. 识别并提取关键点、论点或信息。
3. 第一行输出标题，格式固定为："标题: {title}"。
4. 然后输出一段包含最重要细节的简洁摘要。
5. 接着输出"关键段落"，逐条列出关键信息点，每条前带一个表情符号。
6. 审查摘要的准确性和完整性，不要在摘要里复述当前网页的 URL。`;
/** 常见自动总结域名的中文名（R constants/constant.js SUMMARY_CONTENT_ESTIMATOR_PATTERNS）。 */
const summarySourceNames = [
	["mp.weixin.qq.com", "微信文章"],
	["bilibili.com", "哔哩哔哩专栏"],
	["arxiv.org", "ArXiv论文"],
	["sspai.com", "少数派"],
	["zhihu.com", "知乎"],
	["chinadaily.com.cn", "ChinaDaily"],
	["github.com", "Github"],
	["v2ex.com", "V2EX"]
];
const describeSummarySource = (hostname) => {
	const host = hostname.toLowerCase();
	const hit = summarySourceNames.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
	return hit ? hit[1] : "网页";
};
/** 域名是否命中自动总结列表（`github.com` 同时覆盖 `www.github.com`）。 */
const isAutoSummaryHost = (hostname, domains) => {
	const host = hostname.toLowerCase();
	return domains.some((raw) => {
		const domain = raw.trim().toLowerCase();
		return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
	});
};
const stripHtml = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
const rateWindowMs = 5 * 6e4;
const rateLimit = 3;
const maxConcurrent = 2;
/** 限流状态最多保留的请求人条数，避免 Map 只增不减 */
const maxRateStates = 500;
/** R utils/common.js retryFetch 默认重试 3 次、间隔 1s。 */
const fetchRetries = 3;
const retryDelayMs = 1e3;
const retryableErrorPattern = /HTTP (?:408|429|5\d\d)|fetch failed|aborted|timed out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i;
const rateStates = /* @__PURE__ */ new Map();
let activeRequests = 0;
/** 清掉窗口外、已经没有任何有效时间戳的条目 */
const pruneExpiredRateStates = (now) => {
	for (const [key, state] of rateStates) if (state.timestamps.every((timestamp) => now - timestamp >= rateWindowMs)) rateStates.delete(key);
};
/** 条目数超上限时删掉最久未活跃的，保证 Map 不会无限增长 */
const enforceRateStateLimit = () => {
	if (rateStates.size <= maxRateStates) return;
	const oldestFirst = [...rateStates.entries()].sort((left, right) => {
		return (left[1].timestamps[left[1].timestamps.length - 1] ?? 0) - (right[1].timestamps[right[1].timestamps.length - 1] ?? 0);
	});
	for (const [key] of oldestFirst.slice(0, rateStates.size - maxRateStates)) rateStates.delete(key);
};
const acquireSummarySlot = (requesterKey) => {
	const now = Date.now();
	pruneExpiredRateStates(now);
	const state = rateStates.get(requesterKey) || { timestamps: [] };
	state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < rateWindowMs);
	if (state.timestamps.length >= rateLimit) throw new Error("网页总结请求过于频繁，请稍后再试");
	if (activeRequests >= maxConcurrent) throw new Error("当前网页总结任务较多，请稍后再试");
	state.timestamps.push(now);
	rateStates.set(requesterKey, state);
	enforceRateStateLimit();
	activeRequests += 1;
	return () => {
		activeRequests = Math.max(0, activeRequests - 1);
	};
};
const readWebPageText = async (url) => {
	let lastError = /* @__PURE__ */ new Error("没有读取到可总结的网页正文");
	for (let attempt = 0; attempt <= fetchRetries; attempt++) {
		try {
			const text = stripHtml(await fetchPublicPageText(url)).slice(0, Config.ai.maxInputChars);
			if (!text) throw new Error("没有读取到可总结的网页正文");
			return text;
		} catch (error) {
			lastError = error;
			if (!(error instanceof Error && retryableErrorPattern.test(error.message)) || attempt === fetchRetries) throw error;
		}
		await setTimeout$1(retryDelayMs);
	}
	throw lastError;
};
const summarizeUrl = async (url, requesterKey = "admin") => {
	if (!Config.ai.summaryEnabled) throw new Error("网页总结未开启");
	if (!Config.ai.apiKey.trim()) throw new Error("未配置 AI API Key，无法总结");
	const release = acquireSummarySlot(requesterKey);
	try {
		const text = await readWebPageText(url);
		const summary = (await fetchJson(`${Config.ai.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
			timeoutMs: 6e4,
			method: "POST",
			headers: {
				Authorization: `Bearer ${Config.ai.apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: Config.ai.model,
				messages: [{
					role: "system",
					content: summaryPrompt
				}, {
					role: "user",
					content: `链接：${url}\n\n正文：\n${text}`
				}],
				temperature: .2
			})
		})).choices?.[0]?.message?.content?.trim();
		if (!summary) throw new Error("AI 接口没有返回总结");
		return {
			model: Config.ai.model,
			charCount: text.length,
			readingMinutes: Math.max(1, Math.round(text.length / 500)),
			content: summary
		};
	} finally {
		release();
	}
};
//#endregion
//#region src/apps/summary.ts
/** 显式命令：#总结一下 <链接>（链接后允许跟多余文字，按第一条 http(s) 链接处理）。 */
const summaryCommandReg = /^#?总结一下/i;
const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
const trailingPunctuation = /[，。！？、；;,.!?)\]}>》」】]+$/;
/**
* 自动总结入口：消息里带链接就进来，域名再按 `ai.autoSummaryDomains` 实时判定
* （karin 的命令正则在模块加载时固化，把域名写进正则会让改配置后不生效）。
* R tools.js 用 linkShareSummary 规则做同样的事。
*/
const autoSummaryReg = /https?:\/\//i;
const requestUrls = (message) => (message.match(urlPattern) ?? []).map((url) => url.replace(trailingPunctuation, "")).filter((url) => {
	try {
		const parsed = new URL(url);
		return ["http:", "https:"].includes(parsed.protocol);
	} catch {
		return false;
	}
});
/**
* R query.js 的 makeForwardMsg：总结结果收进一条聊天记录。
* 适配器不支持合并转发时退回纯文本。
*/
const sendSummaryForward = async (e, lines, title) => {
	if (canSendResolverForward(e)) {
		const identity = resolveEventForwardIdentity(e, title);
		try {
			await e.bot.sendForwardMsg(e.contact, common.makeForward(lines.map((line) => [segment.text(line)]), identity.id, identity.name), {
				source: title,
				summary: "查看网页总结",
				prompt: "查看网页总结",
				news: [{ text: "点击查看完整总结" }]
			});
			return;
		} catch {}
	}
	await replyPlainText(e, lines.join("\n\n"));
};
const requesterKey = (e) => String(e.userId || e.selfId);
const runSummary = async (e, url) => {
	try {
		if (!Config.ai.summaryEnabled) throw new Error("网页总结未开启，请先在配置中启用");
		if (!Config.ai.apiKey.trim()) throw new Error("未配置 AI API Key，无法总结");
		await replyText(e, `识别：${describeSummarySource(hostnameOf(url) || "")}，正在为您总结，请稍等...`);
		const result = await summarizeUrl(url, requesterKey(e));
		await sendSummaryForward(e, [
			`「Hira × ${result.model}」联合为您总结内容：`,
			result.content,
			`原文约 ${result.charCount} 字，预计阅读 ${result.readingMinutes} 分钟。`
		], "网页总结");
	} catch (error) {
		await replyPlainText(e, `总结失败：${error instanceof Error ? error.message : String(error)}`);
	}
};
const summaryHandler = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	const message = e.msg.trim();
	if (!summaryCommandReg.test(message)) return next?.();
	const url = requestUrls(message.replace(summaryCommandReg, ""))[0];
	if (!url) {
		if (!message.startsWith("#")) return next?.();
		await replyPlainText(e, "链接格式无效，请发送 http/https 链接。例：#总结一下 https://example.com/article");
		return true;
	}
	await runSummary(e, url);
	return true;
};
const summaryAutoHandler = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.ai.summaryEnabled) return next?.();
	const message = e.msg.trim();
	if (summaryCommandReg.test(message)) return next?.();
	const url = requestUrls(message).find((candidate) => isAutoSummaryHost(hostnameOf(candidate) || "", Config.ai.autoSummaryDomains));
	if (!url) return next?.();
	await runSummary(e, url);
	return true;
};
const summary = karin.command(summaryCommandReg, summaryHandler, {
	name: "Hira-AI总结",
	perm: "admin"
});
const summaryAuto = karin.command(autoSummaryReg, summaryAutoHandler, {
	name: "Hira-AI自动总结",
	priority: 950
});
//#endregion
export { summaryCommandReg as a, summaryAutoHandler as i, summary as n, summaryHandler as o, summaryAuto as r, autoSummaryReg as t };

//# sourceMappingURL=summary.js.map