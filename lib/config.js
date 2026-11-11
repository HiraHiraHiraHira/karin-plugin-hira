import { t as Root } from "./root.js";
import { createRequire } from "node:module";
import { copyConfigSync, logger, requireFileSync } from "node-karin";
import fs from "node:fs";
import path from "node:path";
import { karinPathBase } from "node-karin/root";
import YAML from "yaml";
import { createHash } from "node:crypto";
import axios from "axios";
//#region \0rolldown/runtime.js
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
//#region src/services/http.ts
const defaultRequestHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
const buildHeaders = (options) => ({
	...options.defaultHeaders === false ? {} : defaultRequestHeaders,
	...options.headers
});
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const isAbortLike = (error) => {
	if (!error || typeof error !== "object") return false;
	const { name, code } = error;
	return name === "AbortError" || name === "CanceledError" || code === "ERR_CANCELED";
};
const toAxiosProxy = (proxy) => {
	let parsed;
	try {
		parsed = new URL(proxy);
	} catch {
		throw new Error("代理地址无效");
	}
	if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("代理只支持 http 或 https 地址");
	return {
		protocol: parsed.protocol.slice(0, -1),
		host: parsed.hostname,
		port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
		...parsed.username || parsed.password ? { auth: {
			username: decodeURIComponent(parsed.username),
			password: decodeURIComponent(parsed.password)
		} } : {}
	};
};
const headersFromAxios = (value) => {
	const headers = new Headers();
	for (const [key, item] of Object.entries(value)) {
		if (item === void 0 || item === null) continue;
		headers.set(key, Array.isArray(item) ? item.join(", ") : String(item));
	}
	return headers;
};
const requestViaProxy = async (url, options) => {
	const response = await axios.request({
		url,
		method: options.method || "GET",
		data: options.body,
		headers: buildHeaders(options),
		timeout: options.timeoutMs ?? 15e3,
		proxy: toAxiosProxy(options.proxy.trim()),
		responseType: "arraybuffer",
		maxContentLength: options.maxBytes ?? -1,
		maxBodyLength: options.maxBytes ?? -1,
		maxRedirects: options.maxRedirects ?? (options.redirect === "manual" ? 0 : 5),
		signal: options.signal,
		validateStatus: () => true
	}).catch((error) => {
		if (isAbortLike(error)) throw error;
		throw new Error(`网络请求失败：${errorMessage(error)}`);
	});
	const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || "");
	if (options.maxBytes !== void 0 && data.byteLength > options.maxBytes) throw new Error(`响应超过 ${options.maxBytes} 字节限制`);
	return new Response(data, {
		status: response.status,
		statusText: response.statusText,
		headers: headersFromAxios(response.headers)
	});
};
const createAbortSignal = (timeoutMs, external) => {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const onExternalAbort = () => controller.abort();
	if (external) if (external.aborted) controller.abort();
	else external.addEventListener("abort", onExternalAbort, { once: true });
	return {
		signal: controller.signal,
		didTimeout: () => timedOut,
		cleanup: () => {
			clearTimeout(timer);
			external?.removeEventListener("abort", onExternalAbort);
		}
	};
};
const fetchResponseOnce = async (url, options = {}) => {
	if (options.insecure && options.proxy?.trim()) throw new Error("insecure 请求不支持代理，请二选一");
	if (options.proxy?.trim()) return requestViaProxy(url, options);
	if (options.insecure) {
		const response = await axios.request({
			url,
			method: options.method || "GET",
			data: options.body,
			headers: buildHeaders(options),
			timeout: options.timeoutMs ?? 15e3,
			responseType: "arraybuffer",
			maxContentLength: options.maxBytes ?? -1,
			maxRedirects: options.maxRedirects ?? (options.redirect === "manual" ? 0 : 5),
			signal: options.signal,
			validateStatus: () => true,
			httpsAgent: new (__require("node:https")).Agent({ rejectUnauthorized: false })
		});
		const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || "");
		if (options.maxBytes !== void 0 && data.byteLength > options.maxBytes) throw new Error(`响应超过 ${options.maxBytes} 字节限制`);
		return new Response(data, {
			status: response.status,
			statusText: response.statusText,
			headers: headersFromAxios(response.headers)
		});
	}
	const timeoutMs = options.timeoutMs ?? 15e3;
	const { signal, didTimeout, cleanup } = createAbortSignal(timeoutMs, options.signal);
	let response;
	try {
		response = await fetch(url, {
			method: options.method,
			body: options.body,
			headers: buildHeaders(options),
			redirect: options.redirect,
			signal
		});
	} catch (error) {
		if (didTimeout()) throw new Error(`请求超时（${timeoutMs} ms）`);
		if (isAbortLike(error)) throw error;
		throw new Error(`网络请求失败：${errorMessage(error)}`);
	} finally {
		cleanup();
	}
	const contentLength = Number(response.headers.get("content-length"));
	if (options.maxBytes !== void 0 && Number.isFinite(contentLength) && contentLength > options.maxBytes) {
		await response.body?.cancel();
		throw new Error(`响应超过 ${options.maxBytes} 字节限制`);
	}
	return response;
};
const httpRetryAttempts = 3;
const retryableStatus = (status) => status >= 500;
const sleepWithBackoff = (baseDelay, attempt) => {
	const ms = baseDelay * 2 ** attempt;
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
};
/**
* fetch 只把网络层失败抛成 TypeError/AbortError, 其余(如体积超限、insecure+proxy 冲突)都是
* 确定性错误, 重试只会放大问题. axios 的失败带 code, 单独识别.
*/
const isRetryableNetworkError = (error) => {
	if (!error || typeof error !== "object") return false;
	const { code, name } = error;
	if (typeof code === "string" && /^(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNABORTED|UND_ERR_)/.test(code)) return true;
	if (error instanceof Error && /^(?:网络请求失败：|请求超时（)/.test(error.message)) return true;
	return name === "TypeError" || name === "AbortError" || name === "FetchError";
};
/**
* 网络错误和 5xx 做 3 次指数退避重试; 4xx/业务体超限等确定性失败立即抛出.
*/
const fetchResponse = async (url, options = {}) => {
	const delay = Math.max(0, options.retryDelayMs ?? 200);
	for (let attempt = 0;; attempt++) {
		try {
			const response = await fetchResponseOnce(url, options);
			if (!retryableStatus(response.status) || attempt >= httpRetryAttempts - 1) return response;
			try {
				await response.body?.cancel();
			} catch {}
		} catch (error) {
			if (options.signal?.aborted || !isRetryableNetworkError(error) || attempt >= httpRetryAttempts - 1) throw error;
		}
		await sleepWithBackoff(delay, attempt);
	}
};
const readResponseBytes = async (response, maxBytes) => {
	const contentLength = Number(response.headers.get("content-length"));
	if (maxBytes !== void 0 && Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel();
		throw new Error(`响应超过 ${maxBytes} 字节限制`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (maxBytes !== void 0 && bytes.byteLength > maxBytes) throw new Error(`响应超过 ${maxBytes} 字节限制`);
	return bytes;
};
const assertOk = (response) => {
	if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
};
const fetchJson = async (url, options = {}) => {
	const response = await fetchResponse(url, options);
	assertOk(response);
	const text = (await readResponseBytes(response, options.maxBytes)).toString("utf8");
	try {
		return JSON.parse(text);
	} catch {
		const preview = text.slice(0, 60).replace(/\s+/g, " ");
		throw new Error(`接口返回的不是 JSON（HTTP ${response.status}，开头：${preview}）`);
	}
};
const fetchText = async (url, options = {}) => {
	const response = await fetchResponse(url, options);
	assertOk(response);
	return (await readResponseBytes(response, options.maxBytes)).toString("utf8");
};
const resolveRedirectUrl = async (url, options = {}) => {
	let current = url;
	const maxRedirects = options.maxRedirects ?? 5;
	for (let count = 0; count <= maxRedirects; count++) {
		const response = await fetchResponse(current, {
			...options,
			redirect: "manual",
			maxRedirects: 0
		});
		if (response.status < 300 || response.status >= 400) {
			assertOk(response);
			return current;
		}
		const location = response.headers.get("location");
		if (!location) throw new Error(`HTTP ${response.status} 重定向缺少 Location`);
		current = new URL(location, current).toString();
	}
	throw new Error("重定向次数超过限制");
};
//#endregion
//#region src/music/providers/helpers.ts
const formatArtists = (artists) => {
	const clean = artists.map((artist) => artist.trim()).filter(Boolean);
	return clean.length > 0 ? clean.join(" / ") : "未知歌手";
};
const normalizeDuration = (value) => {
	if (value === void 0) return void 0;
	if (typeof value === "number") return value > 1e4 ? Math.round(value / 1e3) : Math.round(value);
	const parts = value.split(":").map((part) => Number(part));
	if (parts.some((part) => Number.isNaN(part))) return void 0;
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
};
const requirePlayableUrl = (url) => {
	if (!url?.trim()) throw new Error("没有拿到可播放的音频链接，稍后再试或换个音乐源");
	return url;
};
/**
* 轻量校验直链能不能播：只看响应头，不下载音频。
* 网易云 `song/media/outer/url` 对会员/版权受限的歌会跳到 404 页面（text/html），
* 直接发出去就是一张点得出、点不动的卡。
*/
const isPlayableAudioUrl = async (url) => {
	if (!url?.trim()) return false;
	try {
		const response = await fetchResponse(url, {
			method: "HEAD",
			timeoutMs: 8e3
		});
		const contentType = (response.headers.get("content-type") || "").toLowerCase();
		return response.ok && (contentType.startsWith("audio/") || contentType.includes("octet-stream"));
	} catch {
		return false;
	}
};
/** 统一 provider 报错文案: 源名 + 原因, 避免把底层英文错误直接甩给用户. */
const providerError = (label, reason) => {
	const message = reason instanceof Error ? reason.message : String(reason);
	return new Error(message.startsWith(`${label}：`) ? message : `${label}：${message}`);
};
//#endregion
//#region src/music/providers/bilibili.ts
const bvPattern = /\bBV[1-9A-HJ-NP-Za-km-z]{10}\b/;
/** 搜索结果里的 param/uri 字段常带额外前缀，视频链接里的 BV 号偶尔使用旧字符集，这里做宽松提取。 */
const extractBvFromText = (value) => {
	if (!value) return void 0;
	return value.match(bvPattern)?.[0] || value.match(/BV[0-9A-Za-z]{10}/)?.[0];
};
const bilibiliAppHeaders = { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; MI 9 Build/SKQ1.211230.001)" };
/**
* B站 Android 客户端的公开 appkey/secret（小飞等插件写死在源码里的就是这一对）。
* 内置为默认值，装上就能用；要换成自己的写 music.bilibili.appKey/appSecret 或
* HIRA_BILIBILI_APP_KEY / HIRA_BILIBILI_APP_SECRET 即可覆盖。
*/
const defaultBilibiliAppKey = "1d8b6e7d45233436";
const defaultBilibiliAppSecret = "560c52ccd288fed045859ed18bffd973";
const bilibiliMirrorHost = "https://upos-sz-mirrorhw.bilivideo.com/";
const ipHostPattern = /^https?:\/\/\d+\.\d+\.\d+\.\d+\//;
/**
* 小飞的做法：优先挑 IP 型直链（CDN 直连，不吃 DNS/鉴权），
* 再把 host 统一换成 bilivideo 镜像域名，否则协议端/QQ 那边经常拉不到或很快失效。
*/
const toPlayableBilibiliUrl = (url, backups = []) => {
	if (!url) return url;
	return ([url, ...backups].find((item) => item && ipHostPattern.test(item)) ?? url).replace(ipHostPattern, bilibiliMirrorHost);
};
const stripHtml = (value) => (value ?? "").replace(/<[^>]+>/g, "").trim();
const normalizeCover = (url) => {
	if (!url) return void 0;
	return url.startsWith("//") ? `https:${url}` : url;
};
const signedBilibiliAppUrl = (url, params, appSecret) => {
	const param = Object.entries(params).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
	return `${url}?${param}&sign=${createHash("md5").update(`${param}${appSecret}`).digest("hex")}`;
};
const bilibiliAppParams = (appKey, extra) => ({
	access_key: "",
	appkey: appKey,
	build: 7210300,
	buvid: "XU973E09237CC101E74F6E24CCF3DE3300D0B",
	c_locale: "zh_CN",
	channel: "xiaomi",
	disable_rcmd: 0,
	fnval: 16,
	fnver: 0,
	fourk: 1,
	is_dolby: 0,
	is_h265: 0,
	is_proj: 1,
	live_extra: "",
	mobi_app: "android",
	mobile_access_key: "",
	platform: "android",
	playurl_type: 1,
	protocol: 1,
	qn: 64,
	s_locale: "zh_CN",
	statistics: "%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D",
	sys_ver: 31,
	ts: Math.floor(Date.now() / 1e3),
	video_type: 0,
	...extra
});
const getItemBvid = (item) => {
	return item.share?.video?.bvid || extractBvFromText(item.param) || extractBvFromText(item.uri);
};
/** 部分 CDN 回源返回纯 IP 主机头, QQ 语音/播放器无法直连; 换成云崽同款 upos 镜像域名. */
const normalizeBilibiliAudioUrl = (url) => url.replace(/^https?:\/\/\d+\.\d+\.\d+\.\d+\/\/?/, "https://upos-sz-mirrorhw.bilivideo.com/");
const selectBilibiliAudio = (payload) => {
	const selected = (payload.data?.dash?.audio ?? []).map((item) => ({
		id: item.id ?? 0,
		url: item.baseUrl || item.base_url || item.backupUrl?.[0] || item.backup_url?.[0] || "",
		backups: [...item.backupUrl ?? [], ...item.backup_url ?? []]
	})).filter((item) => item.url).sort((a, b) => b.id - a.id)[0];
	if (selected) return {
		id: selected.id,
		url: toPlayableBilibiliUrl(selected.url, selected.backups)
	};
	const durl = payload.data?.durl?.find((item) => item.url || item.backup_url?.length);
	const durlUrl = durl?.url || durl?.backup_url?.[0];
	if (!durlUrl) return void 0;
	return {
		id: 0,
		url: normalizeBilibiliAudioUrl(durlUrl)
	};
};
var BilibiliMusicProvider = class {
	source = "bilibili";
	cookie;
	appKey;
	appSecret;
	requestJson;
	constructor(options = {}) {
		this.cookie = options.cookie ?? "";
		this.appKey = options.appKey?.trim() || process.env.HIRA_BILIBILI_APP_KEY?.trim() || "1d8b6e7d45233436";
		this.appSecret = options.appSecret?.trim() || process.env.HIRA_BILIBILI_APP_SECRET?.trim() || "560c52ccd288fed045859ed18bffd973";
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	signedAppUrl(url, extra) {
		if (!this.appKey || !this.appSecret) throw new Error("哔哩哔哩：未配置 App 凭据。请在配置面板填写 music.bilibili.appKey/appSecret，或设置环境变量 HIRA_BILIBILI_APP_KEY/HIRA_BILIBILI_APP_SECRET（不内置公共 appKey）");
		return signedBilibiliAppUrl(url, bilibiliAppParams(this.appKey, extra), this.appSecret);
	}
	requestOptions(referer) {
		return { headers: {
			...bilibiliAppHeaders,
			...referer ? { Referer: referer } : {},
			...this.cookie ? { Cookie: this.cookie } : {}
		} };
	}
	async search(keyword, page, pageSize) {
		const url = this.signedAppUrl("https://app.bilibili.com/x/v2/search/type", {
			keyword: encodeURIComponent(keyword),
			type: 10,
			pn: page,
			ps: pageSize
		});
		let data;
		try {
			data = await this.requestJson(url, this.requestOptions());
		} catch (error) {
			throw providerError("哔哩哔哩", error);
		}
		return (data.data?.items ?? []).map((item) => {
			const bvid = getItemBvid(item);
			if (!bvid) return void 0;
			const author = stripHtml(item.author);
			return {
				id: bvid,
				source: "bilibili",
				title: stripHtml(item.title) || "B站视频音频",
				artists: author ? [author] : [],
				durationSeconds: normalizeDuration(item.duration),
				coverUrl: normalizeCover(item.cover),
				pageUrl: item.share?.video?.short_link || `https://www.bilibili.com/video/${bvid}`,
				raw: item
			};
		}).filter((item) => Boolean(item));
	}
	async resolveVideoInfo(item) {
		const raw = item.raw;
		if (raw?.aid && raw?.cid) return raw;
		const bvid = item.id.match(bvPattern)?.[0] || item.pageUrl.match(bvPattern)?.[0];
		if (!bvid) return {};
		return (await this.requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, this.requestOptions(`https://www.bilibili.com/video/${bvid}`))).data ?? {};
	}
	async getPlayable(item) {
		const info = await this.resolveVideoInfo(item);
		if (!info.aid || !info.cid) throw new Error("哔哩哔哩：无法解析该视频（缺少 aid/cid），请使用 音乐 <B站链接> 或重新搜索");
		const playUrl = this.signedAppUrl("https://api.bilibili.com/x/tv/playurl", {
			cid: info.cid,
			object_id: info.aid
		});
		const audio = selectBilibiliAudio(await this.requestJson(playUrl, { defaultHeaders: false }));
		if (!audio) throw new Error("哔哩哔哩：未返回可用音频流（可尝试配置 music.cookies.bilibili 或稍后重试）");
		return {
			item,
			audioUrl: audio.url,
			quality: String(audio.id)
		};
	}
	async fromLink(url) {
		const bvid = extractBvFromText(url);
		if (!bvid) throw new Error("哔哩哔哩：未在链接中识别到 BV 号，请使用 BV 号链接或可在浏览器打开的 b23.tv 短链");
		const data = await this.requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, this.requestOptions(`https://www.bilibili.com/video/${bvid}`));
		if (!data.data?.aid || !data.data?.cid) throw new Error("哔哩哔哩：视频信息不完整（缺少 aid/cid），可能已失效或需要配置 music.cookies.bilibili");
		return {
			id: bvid,
			source: "bilibili",
			title: data.data?.title || "B站视频音频",
			artists: data.data?.owner?.name ? [data.data.owner.name] : ["哔哩哔哩"],
			coverUrl: data.data?.pic,
			durationSeconds: data.data?.duration,
			pageUrl: `https://www.bilibili.com/video/${bvid}`,
			raw: {
				...data.data,
				aid: data.data?.aid,
				cid: data.data?.cid
			}
		};
	}
};
//#endregion
//#region src/config/defaults.ts
const defaultConfig = {
	app: {
		enabled: true,
		helpCommand: "#Hira帮助",
		replyPrefix: "Hira",
		statusCommand: "#Hira状态"
	},
	music: {
		enabled: true,
		defaultSource: "qq",
		listModeDefault: false,
		pageSize: 20,
		sessionTtlSeconds: 180,
		voiceEnabled: true,
		highQuality: false,
		card: {
			channels: [
				"platform",
				"oidb",
				"ark",
				"music"
			],
			textFallback: true,
			platform: {
				enabled: true,
				types: {
					qq: "",
					netease: "163",
					kuwo: "",
					kugou: "",
					bilibili: ""
				}
			},
			ark: {
				apiUrl: "https://apii.xianyuw.cn/api/v1/qq-musicArk",
				key: "",
				timeoutMs: 3e3,
				retries: 0,
				attachCover: false,
				formats: {
					qq: "qq",
					netease: "netease",
					kuwo: "",
					kugou: "kugou",
					bilibili: "bilibili"
				}
			},
			oidb: { enabled: true },
			music: { enabled: true },
			breaker: {
				failThreshold: 3,
				cooldownSeconds: 600
			}
		},
		bilibili: {
			appKey: defaultBilibiliAppKey,
			appSecret: defaultBilibiliAppSecret
		},
		cookies: {
			netease: "",
			qq: "",
			kuwo: "",
			kugou: "",
			bilibili: ""
		},
		api: {
			neteaseBaseUrl: "https://music.163.com/api",
			qqTempApi: "https://www.hhlqilongzhu.cn/api/dg_QQmusicflac.php?msg={keyword}&n={index}&type=json",
			aggregatorUrl: "https://music.txqq.pro/",
			aggregatorEnabled: true
		}
	},
	resolver: {
		enabled: true,
		kkkCompat: true,
		commentsEnabled: true,
		maxVideoDurationSeconds: 480,
		platforms: {
			bilibili: true,
			douyin: true,
			kuaishou: true,
			weibo: true,
			tieba: true,
			xiaoheihe: true,
			xiaohongshu: true,
			general: true
		},
		sending: {
			contentForwardEnabled: true,
			videoFailureFallbackEnabled: true
		},
		media: {
			dedupeImages: true,
			filterLowQualityImages: true,
			inlinePreviewCover: true
		},
		diagnostics: {
			stageLogsEnabled: true,
			verboseLogsEnabled: true
		},
		bilibili: {
			maxVideoDurationSeconds: 480,
			quality: 112,
			codec: "auto"
		},
		douyin: {
			maxVideoDurationSeconds: 480,
			quality: "1080p"
		},
		proxy: "",
		cookies: {
			weibo: "",
			xiaoheihe: "",
			douyin: "",
			xiaohongshu: "",
			bilibili: ""
		},
		generalApis: [
			"http://47.99.158.118/video-crack/v2/parse?content={url}",
			"https://api.jkyai.top/API/jhspjx.php?url={url}",
			"https://api.yujn.cn/api/pipixia.php?url={url}",
			"https://api.bugpk.com/api/pipixia?url={url}"
		]
	},
	runtime: {
		tempRoot: "",
		cleanupEnabled: true,
		cleanupMaxAgeMinutes: 120,
		ffmpegPath: "ffmpeg",
		downloadTimeoutSeconds: 60,
		maxVideoFileSizeBytes: 200 * 1024 * 1024,
		maxAudioFileSizeBytes: 100 * 1024 * 1024,
		maxPreviewCoverBytes: 10 * 1024 * 1024,
		maxTempBytes: 2 * 1024 * 1024 * 1024
	},
	light: {
		enabled: true,
		catApis: ["https://shibe.online/api/cats?count=1", "https://api.thecatapi.com/v1/images/search?limit=1"],
		buyerShowApis: ["https://api.suyanw.cn/api/tbmjx.php?return=json"],
		tiredApis: ["https://imgapi.cn/cos2.php?return=jsonpro", "https://imgapi.cn/cos.php?return=jsonpro"],
		medicineApi: "https://server.dayi.org.cn/api/search?keyword={keyword}&pageNo=1&pageSize=10",
		softwareApi: ""
	},
	translate: {
		enabled: true,
		deeplxApi: "",
		tencentApi: "https://transmart.qq.com/api/imt",
		timeoutSeconds: 15
	},
	ai: {
		summaryEnabled: false,
		apiBaseUrl: "https://api.openai.com/v1",
		apiKey: "",
		model: "gpt-4.1-mini",
		maxInputChars: 5e4,
		autoSummaryDomains: [
			"mp.weixin.qq.com",
			"arxiv.org",
			"sspai.com",
			"chinadaily.com.cn",
			"zhihu.com",
			"github.com",
			"v2ex.com"
		]
	}
};
//#endregion
//#region src/config/index.ts
const fallbackConfigDir = path.join(karinPathBase, Root.pluginName, "config");
const configRootDir = process.env.HIRA_CONFIG_ROOT?.trim() || fallbackConfigDir;
const defaultConfigDir = path.join(Root.pluginPath, "config", "default_config");
const clone = (value) => {
	if (Array.isArray(value)) return value.map((item) => clone(item));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
	return value;
};
/** 按文件 mtimeMs + size 缓存已解析的 YAML，命中时跳过读盘和解析，改文件后立即失效 */
const configCache = /* @__PURE__ */ new Map();
const merge = (base, override) => {
	const result = clone(base);
	for (const [key, value] of Object.entries(override || {})) {
		const baseValue = result[key];
		if (value && typeof value === "object" && !Array.isArray(value) && baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) result[key] = merge(baseValue, value);
		else if (value !== void 0) result[key] = clone(value);
	}
	return result;
};
const legacyTranslateApi = "https://api.interpreter.caiyunai.com/v1/translator";
const legacyLightApis = ["https://api.vvhan.com/api/tao", "https://api.vvhan.com/api/wallpaper/views"];
/**
* 升级迁移 (评审 R1): 旧版本 yaml 里的默认值会覆盖新 defaultConfig (merge 旧值优先),
* 而这些地址已下线或协议已变更, 不迁移会让升级用户"开箱必失败".
* 只替换"恰好等于旧默认值"的项, 用户自定义值保持不动; 不写盘, 下次 WebUI 保存自然落新值.
*/
const migrateLegacyDefaults = (name, config) => {
	if (name === "translate") {
		const translate = config;
		if (translate.tencentApi.trim() === legacyTranslateApi) translate.tencentApi = defaultConfig.translate.tencentApi;
	}
	if (name === "light") {
		const light = config;
		if (light.buyerShowApis.length === 1 && light.buyerShowApis[0] === legacyLightApis[0]) light.buyerShowApis = [...defaultConfig.light.buyerShowApis];
		if (light.tiredApis.length === 1 && light.tiredApis[0] === legacyLightApis[1]) light.tiredApis = [...defaultConfig.light.tiredApis];
	}
	return config;
};
const readConfig = (name) => {
	const fallback = defaultConfig[name];
	try {
		const file = path.join(configRootDir, `${name}.yaml`);
		if (!fs.existsSync(file)) {
			configCache.delete(name);
			return fallback;
		}
		let stat;
		try {
			stat = fs.statSync(file);
		} catch {
			stat = void 0;
		}
		const cached = stat ? configCache.get(name) : void 0;
		if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return migrateLegacyDefaults(name, merge(fallback, cached.parsed));
		const parsed = requireFileSync(file, { force: true });
		if (stat) configCache.set(name, {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			parsed
		});
		return migrateLegacyDefaults(name, merge(fallback, parsed));
	} catch (error) {
		logger.warn(`[karin-plugin-hira] 读取配置 ${name}.yaml 失败，使用默认配置: ${error}`);
		return fallback;
	}
};
const atomicWrite = (file, content) => {
	const temporaryFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		const descriptor = fs.openSync(temporaryFile, "w");
		try {
			fs.writeFileSync(descriptor, content, "utf8");
			fs.fsyncSync(descriptor);
		} finally {
			fs.closeSync(descriptor);
		}
		try {
			fs.renameSync(temporaryFile, file);
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "EPERM")) {
				fs.rmSync(file, { force: true });
				fs.renameSync(temporaryFile, file);
			} else throw error;
		}
	} finally {
		fs.rmSync(temporaryFile, { force: true });
	}
};
const writeConfig = (name, value) => {
	fs.mkdirSync(configRootDir, { recursive: true });
	const file = path.join(configRootDir, `${name}.yaml`);
	const normalized = clone(value);
	atomicWrite(file, YAML.stringify(normalized));
};
const readAllConfig = () => ({
	app: readConfig("app"),
	music: readConfig("music"),
	resolver: readConfig("resolver"),
	runtime: readConfig("runtime"),
	light: readConfig("light"),
	translate: readConfig("translate"),
	ai: readConfig("ai")
});
const saveAllConfig = (config) => {
	for (const name of Object.keys(defaultConfig)) writeConfig(name, conformToDefaults(defaultConfig[name], config[name]));
};
/** 以默认值为 schema 重建配置，丢掉旧版本遗留的键，避免已删除的配置项在保存时复活。 */
const conformToDefaults = (schema, value) => {
	if (Array.isArray(schema)) return Array.isArray(value) ? value : schema;
	if (!schema || typeof schema !== "object") {
		if (typeof schema === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
		return value === void 0 || typeof value !== typeof schema ? schema : value;
	}
	const source = value && typeof value === "object" ? value : {};
	const result = {};
	for (const [key, item] of Object.entries(schema)) result[key] = conformToDefaults(item, source[key]);
	return result;
};
const saveConfigModule = (name, value) => {
	writeConfig(name, conformToDefaults(defaultConfig[name], value));
};
const initConfig = () => {
	try {
		copyConfigSync(defaultConfigDir, configRootDir);
	} catch (error) {
		logger.warn(`[karin-plugin-hira] 初始化配置失败: ${error}`);
	}
};
const updateMusicCookie = (source, cookie) => {
	const current = readConfig("music");
	writeConfig("music", {
		...current,
		cookies: {
			...current.cookies,
			[source]: cookie
		}
	});
};
const Config = {
	get app() {
		return readConfig("app");
	},
	get music() {
		return readConfig("music");
	},
	get resolver() {
		return readConfig("resolver");
	},
	get runtime() {
		return readConfig("runtime");
	},
	get light() {
		return readConfig("light");
	},
	get translate() {
		return readConfig("translate");
	},
	get ai() {
		return readConfig("ai");
	}
};
//#endregion
export { fetchText as _, saveConfigModule as a, toAxiosProxy as b, BilibiliMusicProvider as c, isPlayableAudioUrl as d, normalizeDuration as f, fetchResponse as g, fetchJson as h, saveAllConfig as i, extractBvFromText as l, requirePlayableUrl as m, initConfig as n, updateMusicCookie as o, providerError as p, readAllConfig as r, defaultConfig as s, Config as t, formatArtists as u, readResponseBytes as v, resolveRedirectUrl as y };

//# sourceMappingURL=config.js.map