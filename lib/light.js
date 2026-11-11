import { h as fetchJson, t as Config } from "./config.js";
import { isHiraAppEnabled } from "./apps/runtime.js";
import { c as canSendResolverForward, i as replyPlainText, l as resolveEventForwardIdentity, t as replyImage } from "./message.js";
import karin, { common, segment } from "node-karin";
//#region src/light/commandParser.ts
/** `#医药查询` / `#推荐软件` 允许空关键词（R query.js 原样请求全部）。 */
const parseLightCommand = (message) => {
	const msg = message.trim();
	if (/^#?cat$/i.test(msg)) return { type: "cat" };
	if (/^#?买家秀$/.test(msg)) return { type: "buyerShow" };
	if (/^#?累了$/.test(msg)) return { type: "tired" };
	const medicine = msg.match(/^#?医药查询(?:\s+([\s\S]*))?$/);
	if (medicine) return {
		type: "medicine",
		keyword: (medicine[1] ?? "").trim()
	};
	const software = msg.match(/^#?推荐软件(?:\s+([\s\S]*))?$/);
	if (software) return {
		type: "software",
		keyword: (software[1] ?? "").trim()
	};
	return { type: "none" };
};
/** 与 parseLightCommand 同口径，供 karin.command 匹配（裸命令也是有效命令）。 */
const lightCommandReg = /^#?(?:cat|买家秀|累了|医药查询(?:\s+[\s\S]+)?|推荐软件(?:\s+[\s\S]+)?)$/i;
//#endregion
//#region src/light/service.ts
/** 各图源字段名不同：suyanw 是 `imgurl`、imgapi 是 `imgurls`，thecatapi 是 `[{url}]`。 */
const imageUrlKeys = [
	"imgurls",
	"imgurl",
	"images",
	"urls",
	"url",
	"image",
	"pic"
];
const containerKeys = [
	"data",
	"result",
	"list"
];
const collectImageUrls = (payload) => {
	if (typeof payload === "string") return /^https?:\/\//i.test(payload.trim()) ? [payload.trim()] : [];
	if (Array.isArray(payload)) return payload.flatMap((item) => collectImageUrls(item));
	if (!payload || typeof payload !== "object") return [];
	const record = payload;
	for (const key of [...imageUrlKeys, ...containerKeys]) {
		if (!(key in record)) continue;
		const urls = collectImageUrls(record[key]);
		if (urls.length > 0) return urls;
	}
	return [];
};
const stripHtml = (value) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
/** 接口返回的 JSON 是外部输入，统一收窄成对象后再取字段。 */
const asRecord = (value) => value !== null && typeof value === "object" ? value : {};
/** 上游列表结构不一：`{data: []}`、`{data: {list: []}}`、`{list: []}` 都认。 */
const extractList = (payload) => {
	const root = asRecord(payload);
	const data = root.data ?? root.result ?? root.list;
	if (Array.isArray(data)) return data;
	const nested = asRecord(data).list;
	return Array.isArray(nested) ? nested : [];
};
/** 并发拉取多个图源，失败源自动跳过（R cospro 原样合并 2 个 cos 接口）。 */
const fetchImagesFrom = async (apis) => {
	const settled = await Promise.allSettled(apis.map((api) => fetchJson(api)));
	return [...new Set(settled.flatMap((result) => result.status === "fulfilled" ? collectImageUrls(result.value) : []))];
};
const fetchFirstImage = async (apis, title) => {
	for (const api of apis) try {
		const url = collectImageUrls(await fetchJson(api))[0];
		if (url) return {
			type: "image",
			title,
			url
		};
	} catch {}
	throw new Error(`${title}接口暂时不可用`);
};
/** 各图源用的张数参数名不一致（shibe 是 count、thecatapi 是 limit），按需要张数改写才能真正拿到多张。 */
const applyImageLimit = (api, limit) => {
	try {
		const url = new URL(api);
		if (url.searchParams.has("count")) url.searchParams.set("count", String(limit));
		else if (url.searchParams.has("limit")) url.searchParams.set("limit", String(limit));
		return url.toString();
	} catch {
		return api;
	}
};
/** 猫图多张并发：各配置源并发拉取，去重后按需要张数截断，失败源自动跳过。 */
const getCatImages = async (limit = 10) => {
	return (await fetchImagesFrom(Config.light.catApis.map((api) => applyImageLimit(api, limit)))).slice(0, limit);
};
const getBuyerShowImage = () => fetchFirstImage(Config.light.buyerShowApis, "买家秀");
/** imgapi 的图片地址可能带空格/CJK, 适配器取图前先编码; 纯 ASCII 地址原样保留避免二次编码. */
const encodeImageUrl = (url) => /[\s\u0080-\uffff]/.test(url) ? encodeURI(url) : url;
/** 累了：imgapi 的 cos/cos2 返回 `{imgurls: []}`，两张接口全部取回后合并。 */
const getTiredImages = async () => {
	const urls = await fetchImagesFrom(Config.light.tiredApis);
	if (urls.length === 0) throw new Error("累了接口暂时不可用");
	return urls.slice(0, 9).map(encodeImageUrl);
};
const tiredPrompt = "哪天克火掉一定是在这个群里面...";
const normalizeListText = (payload, emptyText) => {
	const lines = extractList(payload).slice(0, 5).map((item, index) => {
		const obj = asRecord(item);
		const title = String(obj.title ?? obj.name ?? obj.goodsName ?? obj.softName ?? `结果 ${index + 1}`);
		const desc = stripHtml(String(obj.introduction ?? obj.desc ?? obj.description ?? obj.content ?? ""));
		const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? "");
		return [
			`${index + 1}. ${title}`,
			desc,
			url
		].filter(Boolean).join("\n");
	});
	return lines.length ? lines.join("\n\n") : emptyText;
};
/** dayi 医药源条目：标题 - 副标题 + 简介（R query.js doctor 原样，含 secondTitle）。 */
const dayiEntryLines = (list) => list.map((item) => {
	const obj = asRecord(item);
	const title = stripHtml(String(obj.title ?? ""));
	const secondTitle = stripHtml(String(obj.secondTitle ?? ""));
	const intro = stripHtml(String(obj.introduction ?? ""));
	return [`📌 ${[title, secondTitle].filter(Boolean).join(" - ") || "未知药品"}`, intro ? `📝 简介：${intro}` : ""].filter(Boolean).join("\n");
});
const softwareItemTitle = (item) => {
	const obj = asRecord(item);
	return stripHtml(String(obj.title ?? obj.name ?? obj.softName ?? obj.goodsName ?? "未知软件"));
};
/** R query.js 的转发文案：`推荐软件：${title}` + `地址：${url}`。 */
const softwareEntryLines = (items) => items.map((item) => {
	const obj = asRecord(item);
	const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? "");
	return [`推荐软件：${softwareItemTitle(item)}`, url ? `地址：${url}` : ""].filter(Boolean).join("\n");
});
/** dayi 是唯一证书链损坏的源（UNABLE_TO_VERIFY_LEAF_SIGNATURE），只有它关闭校验，其余源保持严格校验。 */
const needsInsecureTls = (url) => {
	try {
		return new URL(url).hostname === "server.dayi.org.cn";
	} catch {
		return false;
	}
};
const queryMedicine = async (keyword) => {
	const query = keyword.trim();
	if (!query) return {
		type: "text",
		title: "医药查询",
		text: "请提供关键词，例如：#医药查询 感冒"
	};
	const url = Config.light.medicineApi.replace("{keyword}", encodeURIComponent(query));
	const payload = await fetchJson(url, needsInsecureTls(url) ? { insecure: true } : {});
	const list = asRecord(payload).list;
	if (Array.isArray(list) && list.length > 0) {
		const lines = dayiEntryLines(list);
		return {
			type: "forward",
			title: "医药查询",
			prompt: `查询到 ${lines.length} 条医药信息`,
			lines
		};
	}
	return {
		type: "text",
		title: "医药查询",
		text: (Array.isArray(list) ? "" : normalizeListText(payload, "")) || "未找到相关医药信息"
	};
};
const softwareSources = ["https://www.ghxi.com/ghapi?type=query&n=pc", "https://www.ghxi.com/ghapi?type=query&n=and"];
const fetchSoftwareSources = async () => {
	const merged = (await Promise.allSettled(softwareSources.map((url) => fetchJson(url)))).flatMap((result) => result.status === "fulfilled" ? extractList(result.value) : []);
	const seen = /* @__PURE__ */ new Set();
	return merged.filter((item) => {
		const key = softwareItemTitle(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};
const filterSoftware = (items, needle) => items.filter((item) => {
	const obj = asRecord(item);
	return [
		obj.title,
		obj.name,
		obj.softName
	].some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
});
const querySoftware = async (keyword) => {
	const needle = keyword.trim().toLowerCase();
	const configured = Config.light.softwareApi.trim();
	if (configured) {
		const items = extractList(await fetchJson(configured.replace("{keyword}", encodeURIComponent(keyword.trim()))));
		if (!needle) {
			const lines = softwareEntryLines(items);
			return lines.length ? {
				type: "forward",
				title: "推荐软件",
				prompt: `共 ${lines.length} 条软件推荐`,
				lines
			} : {
				type: "text",
				title: "推荐软件",
				text: "未找到相关软件"
			};
		}
		return {
			type: "text",
			title: "推荐软件",
			text: normalizeListText({ list: filterSoftware(items, needle) }, `未找到与「${keyword.trim()}」相关的软件`)
		};
	}
	const deduped = await fetchSoftwareSources();
	if (!needle) {
		const lines = softwareEntryLines(deduped);
		return lines.length ? {
			type: "forward",
			title: "推荐软件",
			prompt: `共 ${lines.length} 条软件推荐`,
			lines
		} : {
			type: "text",
			title: "推荐软件",
			text: "未找到相关软件"
		};
	}
	const matched = filterSoftware(deduped, needle);
	if (matched.length) return {
		type: "text",
		title: "推荐软件",
		text: normalizeListText({ list: matched }, "未找到相关软件")
	};
	if (!deduped.length) return {
		type: "text",
		title: "推荐软件",
		text: "未找到相关软件"
	};
	return {
		type: "text",
		title: "推荐软件",
		text: [`未找到与「${keyword.trim()}」相关的软件，以下是最近更新：`, normalizeListText({ list: deduped.slice(0, 5) }, "")].filter(Boolean).join("\n")
	};
};
//#endregion
//#region src/apps/light.ts
const CAT_COUNT = 10;
/**
* R query.js 用 `makeForwardMsg` 合并转发：多图/多条结果都收在一条聊天记录里。
* 适配器不支持转发或转发失败时，退回调用方给的兜底发送。
*/
const sendForward = async (e, messages, options) => {
	if (canSendResolverForward(e)) {
		const identity = resolveEventForwardIdentity(e, options.title);
		try {
			await e.bot.sendForwardMsg(e.contact, common.makeForward(messages, identity.id, identity.name), {
				source: options.title,
				summary: options.prompt,
				prompt: options.prompt,
				news: [{ text: "点击查看完整内容" }]
			});
			return;
		} catch {}
	}
	await options.fallback();
};
const sendImagesForward = async (e, urls, title) => {
	await sendForward(e, urls.map((url) => [segment.image(url)]), {
		title,
		prompt: `查看 ${urls.length} 张图片`,
		fallback: async () => {
			for (const url of urls) await replyImage(e, url);
		}
	});
};
const lightHandler = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.light.enabled) return next?.();
	const command = parseLightCommand(e.msg);
	if (command.type === "none") return next?.();
	try {
		if (command.type === "cat") {
			const urls = await getCatImages(CAT_COUNT);
			if (urls.length === 0) throw new Error("猫图接口暂时不可用");
			await replyPlainText(e, "涩图也不看了，就看猫是吧");
			await sendImagesForward(e, urls, "猫图");
			return true;
		}
		if (command.type === "tired") {
			const urls = await getTiredImages();
			await replyPlainText(e, tiredPrompt);
			await sendImagesForward(e, urls, "累了");
			return true;
		}
		if (command.type === "buyerShow") {
			const result = await getBuyerShowImage();
			if (result.type === "image") await replyImage(e, result.url, result.title);
			return true;
		}
		const result = command.type === "medicine" ? await queryMedicine(command.keyword) : await querySoftware(command.keyword);
		if (result.type === "forward") {
			const { title, prompt, lines } = result;
			await sendForward(e, lines.map((line) => [segment.text(line)]), {
				title,
				prompt,
				fallback: async () => replyPlainText(e, lines.join("\n\n"))
			});
		} else if (result.type === "image") await replyImage(e, result.url, result.title);
		else await replyPlainText(e, `${result.title}\n${result.text}`);
	} catch (error) {
		await replyPlainText(e, error instanceof Error ? error.message : String(error));
	}
	return true;
};
const light = karin.command(lightCommandReg, lightHandler, { name: "Hira-轻量命令" });
//#endregion
export { lightHandler as n, light as t };

//# sourceMappingURL=light.js.map