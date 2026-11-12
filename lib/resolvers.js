import { t as Config } from "./config.js";
import { isHiraAppEnabled } from "./apps/runtime.js";
import { m as selectBestImageUrl, u as dedupeImageUrls } from "./cardRender.js";
import { a as replyResolvedPost, d as fetchResolverText, f as resolveResolverRedirectUrl, u as fetchResolverJson } from "./message.js";
import { n as extractShareCardMeta, r as hostnameOf, t as extractFirstUrl } from "./url.js";
import karin, { logger } from "node-karin";
import crypto from "node:crypto";
// src/resolvers/matcher.ts
/**
* 平台域名唯一数据源：匹配规则与命令层正则都从这里派生。
* 新增平台只需在 `ResolverPlatform` 与这里各加一项，不再有三处重复列表。
*/
const PLATFORM_DOMAINS = {
	bilibili: [
		"bilibili.com",
		"b23.tv",
		"bili2233.cn"
	],
	douyin: [
		"douyin.com",
		"iesdouyin.com",
		"webcast.amemv.com"
	],
	kuaishou: ["kuaishou.com", "chenzhongtech.com"],
	xiaohongshu: [
		"xiaohongshu.com",
		"xhslink.com",
		"xhslink.cn"
	],
	weibo: ["weibo.com", "weibo.cn"],
	tieba: ["tieba.baidu.com"],
	xiaoheihe: ["xiaoheihe.cn"],
	general: [
		"ixigua.com",
		"pipix.com",
		"pipigx.com",
		"xsj.qq.com",
		"okjike.com",
		"acfun.cn"
	]
};
const RESOLVER_DOMAIN_PATTERN = Object.values(PLATFORM_DOMAINS).flat().map((domain) => domain.replace(/\./g, "\\.")).join("|");
/** 精确域名或子域名命中：`b23.tv` 不会误配 `evil-b23.tv`。 */
const matchesDomain = (hostname, platform) => PLATFORM_DOMAINS[platform].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
const rules = [
	{
		platform: "bilibili",
		displayName: "哔哩哔哩",
		test: (_url, hostname) => matchesDomain(hostname, "bilibili")
	},
	{
		platform: "douyin",
		displayName: "抖音",
		test: (_url, hostname) => matchesDomain(hostname, "douyin")
	},
	{
		platform: "kuaishou",
		displayName: "快手",
		test: (_url, hostname) => matchesDomain(hostname, "kuaishou")
	},
	{
		platform: "xiaohongshu",
		displayName: "小红书",
		test: (_url, hostname) => matchesDomain(hostname, "xiaohongshu")
	},
	{
		platform: "weibo",
		displayName: "微博",
		test: (_url, hostname) => matchesDomain(hostname, "weibo")
	},
	{
		platform: "tieba",
		displayName: "贴吧",
		test: (url, hostname) => matchesDomain(hostname, "tieba") && /\/p\/\d+/i.test(url)
	},
	{
		platform: "xiaoheihe",
		displayName: "小黑盒",
		test: (_url, hostname) => matchesDomain(hostname, "xiaoheihe")
	},
	{
		platform: "general",
		displayName: "通用解析",
		test: (_url, hostname) => matchesDomain(hostname, "general")
	}
];
const matchResolver = (url) => {
	const hostname = hostnameOf(url);
	if (!hostname) return void 0;
	const rule = rules.find((item) => item.test(url, hostname));
	if (!rule) return void 0;
	return {
		platform: rule.platform,
		displayName: rule.displayName,
		url
	};
};
// src/resolvers/resolverLog.ts
const sensitiveKeyPattern = /cookie|authorization|token|secret|session|auth|skey|p_skey|clientkey|apikey|api_key/i;
const valueText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
/** 失败原因常直接来自上游错误或卡片 URL，必须擦掉 query 里的 skey/token 类参数后才能落日志。 */
const redactSecrets = (value) => valueText(value).replace(/([?&](?:skey|p_skey|access_token|token|key|sign|code|ticket)=)[^&\s]+/gi, "$1***");
const safeHost = (url) => {
	if (!url) return void 0;
	try {
		return new URL(url).host;
	} catch {
		return;
	}
};
const safeExtraEntries = (extra) => Object.entries(extra || {}).filter(([key]) => !sensitiveKeyPattern.test(key)).map(([key, value]) => `extra.${key}=${redactSecrets(value)}`);
const buildResolverStageLog = (options) => {
	const parts = [
		`[resolver:${options.platform}]`,
		`stage=${options.stage}`,
		`ok=${options.ok}`
	];
	if (options.reason) parts.push(`reason=${redactSecrets(options.reason)}`);
	const host = safeHost(options.url);
	if (host) parts.push(`urlHost=${host}`);
	if (options.cookie !== void 0) parts.push(`cookie=${options.cookie.trim() ? "present" : "empty"}`);
	parts.push(...safeExtraEntries(options.extra));
	return parts.join(" ");
};
const logResolverStage = (options, logger$1 = logger) => {
	const diagnostics = Config.resolver.diagnostics;
	if (diagnostics.stageLogsEnabled === false) return;
	if (options.ok && diagnostics.verboseLogsEnabled === false) return;
	const line = buildResolverStageLog(options);
	if (options.ok) {
		logger$1.debug?.(line);
		return;
	}
	logger$1.warn?.(line);
};
// src/resolvers/bilibili.ts
const failure$7 = (reason) => ({
	platform: "bilibili",
	displayName: "哔哩哔哩",
	ok: false,
	reason
});
const asObject$7 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const stringArray = (value) => {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && Boolean(item.trim())) : [];
};
const bilibiliUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BILIBILI_VIDEO_INFO = "https://api.bilibili.com/x/web-interface/view";
const BILIBILI_PLAY_URL = "https://api.bilibili.com/x/player/playurl";
const BILIBILI_ONLINE = "https://api.bilibili.com/x/player/online/total";
const BILIBILI_EP_INFO = "https://api.bilibili.com/pgc/view/web/season";
const BILIBILI_SEASON_SECTION = "https://api.bilibili.com/pgc/web/season/section";
const BILIBILI_BANGUMI_PLAY_URL = "https://api.bilibili.com/pgc/player/web/playurl";
const BILIBILI_ARTICLE_INFO = "https://api.bilibili.com/x/article/viewinfo";
const BILIBILI_LIVE_INFO = "https://api.live.bilibili.com/room/v1/Room/get_info";
const BILIBILI_OPUS_DETAIL = "https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail";
const bvidPattern = /BV[0-9A-Za-z]{10}/i;
const extractBvid = (url) => {
	return url.match(bvidPattern)?.[0];
};
/** `video/av170001` 形式的旧 av 号: view 接口支持 `aid=` 入参, 返回体里带 bvid。 */
const extractBilibiliAid = (url) => {
	try {
		return new URL(url).pathname.match(/\/video\/av(\d+)/i)?.[1];
	} catch {
		return url.match(/\/video\/av(\d+)/i)?.[1];
	}
};
/** `?p=2` 分P：B站 view 接口按 bvid 返回默认分P，cid 决定实际拉取哪一P。 */
const extractBilibiliPage = (url) => {
	try {
		const page = Number(new URL(url).searchParams.get("p"));
		return Number.isInteger(page) && page > 0 ? page : 1;
	} catch {
		return 1;
	}
};
const isBilibiliShortUrl = (url) => {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		return hostname === "b23.tv" || hostname === "bili2233.cn" || hostname.endsWith(".b23.tv") || hostname.endsWith(".bili2233.cn");
	} catch {
		return false;
	}
};
/**
* 链接形态分派。顺序即优先级: 直播号是纯数字, 若放在最后会被 `/video/...` 之类的宽松规则截走,
* 因此先判 live/read/opus 等专用路径, 再落到普通视频。
*/
const classifyBilibiliUrl = (url) => {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	const hostname = parsed.hostname.toLowerCase();
	const path = parsed.pathname;
	if (hostname === "live.bilibili.com" || hostname.endsWith(".live.bilibili.com")) {
		const roomId = path.match(/^\/(?:blanc\/)?(\d+)/)?.[1];
		return roomId ? {
			kind: "live",
			roomId
		} : void 0;
	}
	const epId = path.match(/\/bangumi\/play\/ep(\d+)/i)?.[1];
	if (epId) return {
		kind: "bangumi",
		epId
	};
	const seasonId = path.match(/\/bangumi\/play\/ss(\d+)/i)?.[1];
	if (seasonId) return {
		kind: "bangumi",
		seasonId
	};
	const cvid = path.match(/\/read\/cv(\d+)/i)?.[1] || (path.includes("/read/mobile") ? parsed.searchParams.get("id") : void 0);
	if (cvid && /^\d+$/.test(cvid)) return {
		kind: "article",
		cvid
	};
	const dynamicId = hostname === "t.bilibili.com" ? path.match(/^\/(\d+)/)?.[1] : path.match(/\/(?:opus|dynamic)\/(\d+)/)?.[1];
	if (dynamicId) return {
		kind: "dynamic",
		dynamicId
	};
	const bvid = extractBvid(url);
	if (bvid) return {
		kind: "video",
		bvid,
		page: extractBilibiliPage(url)
	};
	const aid = extractBilibiliAid(url);
	if (aid) return {
		kind: "video",
		aid,
		page: extractBilibiliPage(url)
	};
};
const bilibiliCookieHeader = (cookie) => {
	const value = cookie.trim();
	if (!value) return void 0;
	return /SESSDATA\s*=/i.test(value) ? value : `SESSDATA=${value}`;
};
const formatStat = (label, value) => {
	return typeof value === "number" && Number.isFinite(value) ? `${label}：${value}` : "";
};
const formatStats = (stat) => [
	formatStat("播放", stat?.view),
	formatStat("点赞", stat?.like),
	formatStat("硬币", stat?.coin),
	formatStat("收藏", stat?.favorite),
	formatStat("分享", stat?.share),
	formatStat("弹幕", stat?.danmaku),
	formatStat("评论", stat?.reply)
].filter(Boolean).join(" | ");
const mediaFallbackMessage = "视频资源暂不可用，已降级为封面和原链接。";
const appendDescription = (result, message) => ({
	...result,
	description: [result.description, message].filter(Boolean).join("\n")
});
const validCodecPreferences = /* @__PURE__ */ new Set([
	"auto",
	"av1",
	"hevc",
	"avc"
]);
const normalizeNumber$1 = (value, fallback) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeCodecPreference = (value) => {
	const codec = String(value || "auto");
	return validCodecPreferences.has(codec) ? codec : "auto";
};
const codecFamily = (codecs) => {
	const value = codecs.toLowerCase();
	if (value.includes("av01") || value.includes("av1")) return "av1";
	if (value.includes("hev1") || value.includes("hvc1") || value.includes("hevc")) return "hevc";
	if (value.includes("avc1") || value.includes("avc")) return "avc";
	return "unknown";
};
/**
* 编码优先级表与 R 插件一致: 指定编码排第一, 其余按 av1 > hevc > avc 降级。
* auto 时 av1 最优先(体积最小), 只有在接口真的下发 AV1 流时才可能命中。
*/
const codecRanks = {
	auto: {
		av1: 0,
		hevc: 1,
		avc: 2,
		unknown: 3
	},
	av1: {
		av1: 0,
		hevc: 1,
		avc: 2,
		unknown: 3
	},
	hevc: {
		av1: 1,
		hevc: 0,
		avc: 2,
		unknown: 3
	},
	avc: {
		av1: 1,
		hevc: 2,
		avc: 0,
		unknown: 3
	}
};
const codecPreferenceRank = (codecs, preference) => {
	return codecRanks[preference][codecFamily(codecs)] ?? 3;
};
const slowCdnHostPatterns = [
	".mcdn.bilivideo.cn",
	"mountaintoys.cn",
	".szbdyd.com"
];
const fastCdnHostPatterns = [
	/^cn-[a-z]+-[a-z]+-\d+-\d+\.bilivideo\.com$/,
	/^upos-sz-mirror.*\.bilivideo\.com$/,
	/^upos-hz-mirror.*\.bilivideo\.com$/
];
const hostOf = (url) => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "";
	}
};
const replaceBilibiliP2PUrl = (url) => {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (/upos-sz-mirror08[ch]\.bilivideo\.com/.test(host) || /upos-hz-mirrorakam\.akamaized\.net/.test(host)) parsed.host = "upos-sz-mirrorhwo1.bilivideo.com";
		else if (/upos-sz-estgoss\.bilivideo\.com/.test(host) || /upos-sz-mirrorali(?:ov|b)?\.bilivideo\.com/.test(host)) parsed.host = "upos-sz-mirroralio1.bilivideo.com";
		else if (host.endsWith(".mcdn.bilivideo.cn") || /cn(?:-[a-z]+){2}(?:-\d{2}){2}\.bilivideo\.com/.test(host)) parsed.host = "upos-sz-mirrorcoso1.bilivideo.com";
		else if (host.endsWith(".szbdyd.com")) {
			const source = parsed.searchParams.get("xy_usource");
			if (!source) return url;
			parsed.host = source;
		} else return url;
		return parsed.toString();
	} catch {
		return url;
	}
};
/**
* 直链节点选择: 快速 CDN 原样使用, 慢速 CDN 优先从 backupUrl 里挑, 都慢才改写为源站镜像。
* 只在 resolve 阶段做 URL 级替换, 不触碰媒体内容。
*/
const selectBilibiliCdnUrl = (baseUrl, backupUrls = []) => {
	if (!baseUrl) return baseUrl;
	const host = hostOf(baseUrl);
	if (!host) return baseUrl;
	const isSlow = slowCdnHostPatterns.some((pattern) => host.includes(pattern));
	if (fastCdnHostPatterns.some((pattern) => pattern.test(host)) || !isSlow) return baseUrl;
	const fastBackup = backupUrls.find((url) => fastCdnHostPatterns.some((pattern) => pattern.test(hostOf(url))));
	if (fastBackup) return fastBackup;
	const healthyBackup = backupUrls.find((url) => {
		const backupHost = hostOf(url);
		return Boolean(backupHost) && !slowCdnHostPatterns.some((pattern) => backupHost.includes(pattern));
	});
	if (healthyBackup) return healthyBackup;
	return replaceBilibiliP2PUrl(baseUrl) || baseUrl;
};
const streamUrlOf = (value) => {
	const item = asObject$7(value);
	if (!item) return void 0;
	const primary = [
		item.url,
		item.baseUrl,
		item.base_url
	].find((candidate) => typeof candidate === "string" && Boolean(candidate));
	const backups = stringArray(item.backupUrl ?? item.backup_url);
	if (!primary) return backups.length > 0 ? selectBilibiliCdnUrl(backups[0], backups.slice(1)) : void 0;
	return selectBilibiliCdnUrl(primary, backups);
};
/** playurl 响应里普通视频走 `data`, 番剧走 `result`, 两者结构一致。 */
const playUrlRoot = (payload) => {
	const root = asObject$7(payload);
	return asObject$7(root?.data) ?? asObject$7(root?.result);
};
const selectBilibiliDurl = (payload) => {
	const data = playUrlRoot(payload);
	const durl = Array.isArray(data?.durl) ? data.durl : [];
	return streamUrlOf(durl[0]);
};
const selectBestBilibiliStream = (streams, codecPreference = "auto", maxQuality) => {
	const preference = normalizeCodecPreference(codecPreference);
	const candidates = streams.map((stream) => {
		const item = asObject$7(stream);
		return {
			id: Number(item?.id ?? item?.quality ?? 0),
			bandwidth: Number(item?.bandwidth ?? 0),
			codecs: String(item?.codecs || ""),
			url: streamUrlOf(item)
		};
	}).filter((item) => Boolean(item.url));
	const quality = Number(maxQuality);
	const qualityCandidates = Number.isFinite(quality) && quality > 0 ? candidates.filter((item) => item.id <= quality) : candidates;
	return (qualityCandidates.length > 0 ? qualityCandidates : candidates).sort((left, right) => codecPreferenceRank(left.codecs, preference) - codecPreferenceRank(right.codecs, preference) || right.id - left.id || left.bandwidth - right.bandwidth)[0];
};
const selectBilibiliDash = (payload, codecPreference, maxQuality) => {
	const data = playUrlRoot(payload);
	const dash = asObject$7(data?.dash);
	const videos = Array.isArray(dash?.video) ? dash.video : [];
	const audios = Array.isArray(dash?.audio) ? dash.audio : [];
	const video = selectBestBilibiliStream(videos, codecPreference, maxQuality);
	const audio = selectBestBilibiliStream(audios, "auto");
	return video ? {
		videoUrl: video.url,
		audioUrl: audio?.url
	} : void 0;
};
/**
* fnval 是二进制标志位: 16=DASH, 2048=AV1, 1024=8K, 128=4K, 64=HDR, 512=杜比视界。
* 只请求 16 时 AV1 流根本不会出现在候选里, `codec: 'av1'` 因此永远选不中。
*/
const calculateBilibiliFnval = (quality) => {
	const qn = Math.trunc(normalizeNumber$1(quality, 112));
	let fnval = 2064;
	let fourk = 0;
	if (qn === 127) {
		fnval |= 1024;
		fourk = 1;
	} else if (qn === 126) {
		fnval |= 512;
		fourk = 1;
	} else if (qn === 125) {
		fnval |= 64;
		fourk = 1;
	} else if (qn === 120) {
		fnval |= 128;
		fourk = 1;
	}
	return {
		fnval,
		fourk
	};
};
const createBilibiliPlayUrl = (bvid, cid, quality = 112) => {
	const { fnval, fourk } = calculateBilibiliFnval(quality);
	const url = new URL(BILIBILI_PLAY_URL);
	url.searchParams.set("bvid", bvid);
	url.searchParams.set("cid", String(cid));
	url.searchParams.set("qn", String(Math.trunc(normalizeNumber$1(quality, 112))));
	url.searchParams.set("fnval", String(fnval));
	url.searchParams.set("fnver", "0");
	url.searchParams.set("fourk", String(fourk));
	return url.toString();
};
const createBilibiliBangumiPlayUrl = (epId, cid, quality = 112) => {
	const { fnval, fourk } = calculateBilibiliFnval(quality);
	const url = new URL(BILIBILI_BANGUMI_PLAY_URL);
	url.searchParams.set("ep_id", epId);
	url.searchParams.set("cid", String(cid));
	url.searchParams.set("qn", String(Math.trunc(normalizeNumber$1(quality, 112))));
	url.searchParams.set("fnval", String(fnval));
	url.searchParams.set("fnver", "0");
	url.searchParams.set("fourk", String(fourk));
	return url.toString();
};
/** 充电专属/付费内容只下发试看片段, is_preview=1 时不能当完整视频发。 */
const isPreviewOnlyPayload = (payload) => {
	const data = playUrlRoot(payload);
	return Number(data?.is_preview ?? 0) === 1 || Number(data?.preview ?? 0) === 1;
};
const permissionDeniedMessage = "该内容为大会员/充电专属，当前 Cookie 没有播放权限，仅返回视频信息。";
const previewOnlyMessage = "当前账号仅能获取试看片段（UP主充电专属/付费内容），已按试看发送。";
/** 试看/付费内容在 playurl 里会以 is_preview=1 或 -10403 表现出来, 不能当完整视频发。 */
const inaccessibleMessage = (payload) => {
	const code = Number(asObject$7(payload)?.code);
	return code === -10403 || code === -403 ? permissionDeniedMessage : mediaFallbackMessage;
};
const fetchOnlineTotal = async (bvid, cid, headers) => {
	try {
		const payload = await fetchResolverJson(`${BILIBILI_ONLINE}?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`, { headers });
		const data = asObject$7(asObject$7(payload)?.data);
		const total = Number(data?.total);
		const count = Number(data?.count);
		if (!Number.isFinite(total)) return void 0;
		return `当前视频有 ${total} 人在观看，其中 ${Number.isFinite(count) ? count : 0} 人在网页端观看`;
	} catch {
		return;
	}
};
const fallbackFromMediaFailure = (result, reason, url) => {
	logResolverStage({
		platform: "bilibili",
		stage: "media",
		ok: false,
		reason: reason instanceof Error ? reason.message : String(reason),
		url,
		extra: { fallback: "cover-link-only" }
	});
	logResolverStage({
		platform: "bilibili",
		stage: "fallback",
		ok: true,
		url: result.pageUrl,
		extra: { source: "cover-link-only" }
	});
	return appendDescription(result, mediaFallbackMessage);
};
const normalizeBilibiliVideoInfo = (pageUrl, payload) => {
	const root = asObject$7(payload);
	const data = asObject$7(root?.data);
	if (Number(root?.code) !== 0 || !data) return failure$7(String(root?.message || "B站接口返回异常"));
	const stat = asObject$7(data.stat);
	const desc = String(data.desc || "").trim();
	const coverUrl = typeof data.pic === "string" && data.pic.trim() ? data.pic.trim() : void 0;
	const owner = asObject$7(data.owner);
	const authorAvatar = typeof owner?.face === "string" && owner.face.trim() ? owner.face.trim() : void 0;
	const tag = typeof data.tname === "string" && data.tname.trim() ? data.tname.trim() : void 0;
	const contentBlocks = [desc ? {
		type: "text",
		text: desc
	} : void 0, coverUrl ? {
		type: "image",
		url: coverUrl
	} : void 0].filter((item) => Boolean(item));
	const description = [desc, formatStats(stat)].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
	const bvid = String(data.bvid || extractBvid(pageUrl) || "");
	const aid = Number(data.aid) > 0 ? String(data.aid) : extractBilibiliAid(pageUrl);
	const canonicalUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : pageUrl;
	return {
		platform: "bilibili",
		displayName: "哔哩哔哩",
		title: String(data.title || "B站视频"),
		description,
		author: typeof owner?.name === "string" ? owner.name : void 0,
		pageUrl: canonicalUrl,
		videos: [],
		images: coverUrl ? [coverUrl] : [],
		extras: {
			coverUrl,
			authorAvatar,
			tags: tag ? [tag] : [],
			contentBlocks,
			...data.pubdate ? { createdAt: data.pubdate } : {}
		}
	};
};
const expandShortUrl$2 = async (url) => {
	if (!isBilibiliShortUrl(url)) return url;
	try {
		return await resolveResolverRedirectUrl(url);
	} catch {
		return url;
	}
};
const resolveBilibiliVideo = async (target, url, cookie) => {
	const headers = {
		"User-Agent": bilibiliUserAgent,
		Referer: "https://www.bilibili.com/"
	};
	if (cookie) headers.Cookie = cookie;
	const viewUrl = target.bvid ? `${BILIBILI_VIDEO_INFO}?bvid=${encodeURIComponent(target.bvid)}` : `${BILIBILI_VIDEO_INFO}?aid=${encodeURIComponent(String(target.aid))}`;
	const payload = await fetchResolverJson(viewUrl, { headers });
	const result = normalizeBilibiliVideoInfo(url, payload);
	if ("ok" in result) return result;
	const data = asObject$7(asObject$7(payload)?.data);
	const bvid = String(data?.bvid || target.bvid || "");
	if (!bvid) return result;
	const requestedPage = target.page;
	const pages = Array.isArray(data?.pages) ? data.pages : [];
	const pageEntry = asObject$7(pages[requestedPage - 1]);
	const cid = pageEntry?.cid ?? data?.cid;
	const duration = Number(pageEntry?.duration ?? data?.duration ?? 0);
	const resolverConfig = Config.resolver;
	const bilibiliConfig = resolverConfig.bilibili;
	const maxDuration = normalizeNumber$1(bilibiliConfig?.maxVideoDurationSeconds ?? resolverConfig.maxVideoDurationSeconds, 480);
	if (maxDuration > 0 && duration > maxDuration) return {
		...result,
		description: [result.description, `视频时长 ${duration} 秒，超过当前下载上限 ${maxDuration} 秒，仅返回视频信息。`].filter(Boolean).join("\n")
	};
	if (!cid) return result;
	const basePageUrl = result.pageUrl || url;
	const pageUrl = requestedPage > 1 && !/[?&]p=\d+/.test(basePageUrl) ? `${basePageUrl}${basePageUrl.includes("?") ? "&" : "?"}p=${requestedPage}` : basePageUrl;
	const mediaHeaders = {
		...headers,
		Referer: pageUrl
	};
	const quality = normalizeNumber$1(bilibiliConfig?.quality, 112);
	const codec = normalizeCodecPreference(bilibiliConfig?.codec);
	const playUrl = createBilibiliPlayUrl(bvid, String(cid), quality);
	let playPayload;
	try {
		playPayload = await fetchResolverJson(playUrl, { headers: mediaHeaders });
	} catch (error) {
		return fallbackFromMediaFailure(result, error, playUrl);
	}
	const dash = selectBilibiliDash(playPayload, codec, quality);
	const progressiveUrl = dash ? void 0 : selectBilibiliDurl(playPayload);
	if (!dash && !progressiveUrl) {
		logResolverStage({
			platform: "bilibili",
			stage: "media",
			ok: false,
			reason: String(asObject$7(playPayload)?.message || "no playable stream"),
			url: playUrl
		});
		return appendDescription(result, inaccessibleMessage(playPayload));
	}
	const videos = dash ? [{
		url: dash.videoUrl,
		...dash.audioUrl ? { audioUrl: dash.audioUrl } : {}
	}] : [{ url: progressiveUrl }];
	const online = await fetchOnlineTotal(bvid, cid, mediaHeaders);
	let resolved = {
		...result,
		videos,
		description: [result.description, online].filter(Boolean).join("\n")
	};
	if (isPreviewOnlyPayload(playPayload)) resolved = appendDescription(resolved, previewOnlyMessage);
	return resolved;
};
const loadBangumiEpisode = async (epId, headers) => {
	const payload = await fetchResolverJson(`${BILIBILI_EP_INFO}?ep_id=${encodeURIComponent(epId)}`, { headers });
	const root = asObject$7(payload);
	if (Number(root?.code) !== 0) return void 0;
	const season = asObject$7(root?.result);
	if (!season) return void 0;
	const episodes = (Array.isArray(season.episodes) ? season.episodes : []).map((item) => asObject$7(item)).filter((item) => Boolean(item));
	return {
		season,
		episode: episodes.find((item) => String(item.ep_id) === String(epId)) || episodes[0],
		episodes
	};
};
const resolveBilibiliBangumi = async (target, url, cookie) => {
	const headers = {
		"User-Agent": bilibiliUserAgent,
		Referer: "https://www.bilibili.com/"
	};
	if (cookie) headers.Cookie = cookie;
	let epId = target.epId;
	if (!epId && target.seasonId) try {
		const sectionPayload = await fetchResolverJson(`${BILIBILI_SEASON_SECTION}?season_id=${encodeURIComponent(target.seasonId)}`, { headers });
		const mainSection = asObject$7(asObject$7(asObject$7(sectionPayload)?.result)?.main_section);
		const firstEpisode = asObject$7(Array.isArray(mainSection?.episodes) ? mainSection?.episodes[0] : void 0);
		epId = firstEpisode?.ep_id ? String(firstEpisode.ep_id) : void 0;
	} catch (error) {
		return failure$7(`番剧信息获取失败：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!epId) return failure$7("无法识别番剧 EP 号");
	let loaded;
	try {
		loaded = await loadBangumiEpisode(epId, headers);
	} catch (error) {
		return failure$7(`番剧信息获取失败：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!loaded) return failure$7("番剧接口未返回剧集信息");
	const { season, episode } = loaded;
	const coverUrl = typeof season.cover === "string" && season.cover.trim() ? season.cover.trim() : void 0;
	const typeName = String(season.type_name || "番剧");
	const seasonTitle = String(season.title || "B站番剧");
	const episodeTitle = [episode?.title, episode?.long_title].filter(Boolean).join(" ");
	const rating = asObject$7(season.rating);
	const seasonStat = asObject$7(season.stat);
	const description = [
		episodeTitle ? `🎬 剧集：${episodeTitle}` : "",
		rating?.score ? `🎯 评分：${rating.score} / ${rating.count ?? "-"}` : "",
		asObject$7(season.new_ep)?.desc ? `📺 ${asObject$7(season.new_ep)?.desc}` : "",
		formatStats({
			view: seasonStat?.views,
			danmaku: seasonStat?.danmakus,
			like: seasonStat?.likes,
			coin: seasonStat?.coins,
			favorite: seasonStat?.favorites ?? seasonStat?.favorite
		})
	].filter(Boolean).join("\n");
	const contentBlocks = [episodeTitle ? {
		type: "text",
		text: episodeTitle
	} : void 0, coverUrl ? {
		type: "image",
		url: coverUrl
	} : void 0].filter((item) => Boolean(item));
	const base = {
		platform: "bilibili",
		displayName: `哔哩哔哩${typeName}`,
		title: episodeTitle ? `${seasonTitle} ｜ ${episodeTitle}` : seasonTitle,
		description,
		pageUrl: url,
		videos: [],
		images: coverUrl ? [coverUrl] : [],
		extras: {
			coverUrl,
			tags: typeName ? [typeName] : [],
			contentBlocks
		}
	};
	const bilibiliConfig = Config.resolver.bilibili;
	const maxDuration = normalizeNumber$1(bilibiliConfig?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds, 480);
	const durationSeconds = Number(episode?.duration) > 0 ? Math.trunc(Number(episode?.duration) / 1e3) : 0;
	if (maxDuration > 0 && durationSeconds > maxDuration) return appendDescription(base, `剧集时长 ${durationSeconds} 秒，超过当前下载上限 ${maxDuration} 秒，仅返回番剧信息。`);
	const cid = episode?.cid;
	if (!cid) return base;
	const quality = normalizeNumber$1(bilibiliConfig?.quality, 112);
	const codec = normalizeCodecPreference(bilibiliConfig?.codec);
	const playUrl = createBilibiliBangumiPlayUrl(epId, String(cid), quality);
	let playPayload;
	try {
		playPayload = await fetchResolverJson(playUrl, { headers });
	} catch (error) {
		return fallbackFromMediaFailure(base, error, playUrl);
	}
	const dash = selectBilibiliDash(playPayload, codec, quality);
	const progressiveUrl = dash ? void 0 : selectBilibiliDurl(playPayload);
	if (!dash && !progressiveUrl) {
		logResolverStage({
			platform: "bilibili",
			stage: "media",
			ok: false,
			reason: String(asObject$7(playPayload)?.message || "no playable bangumi stream"),
			url: playUrl
		});
		return appendDescription(base, inaccessibleMessage(playPayload));
	}
	const resolved = {
		...base,
		videos: dash ? [{
			url: dash.videoUrl,
			...dash.audioUrl ? { audioUrl: dash.audioUrl } : {}
		}] : [{ url: progressiveUrl }]
	};
	return isPreviewOnlyPayload(playPayload) ? appendDescription(resolved, previewOnlyMessage) : resolved;
};
const resolveBilibiliLive = async (roomId) => {
	const payload = await fetchResolverJson(`${BILIBILI_LIVE_INFO}?room_id=${encodeURIComponent(roomId)}`, { headers: {
		"User-Agent": bilibiliUserAgent,
		Referer: `https://live.bilibili.com/${roomId}`
	} });
	const root = asObject$7(payload);
	const data = asObject$7(root?.data);
	if (Number(root?.code) !== 0 || !data) return failure$7(String(root?.message || "直播间信息获取失败"));
	const coverUrl = [data.user_cover, data.keyframe].filter((item) => typeof item === "string" && Boolean(item.trim()));
	const online = Number(data.online);
	const areaName = [data.parent_area_name, data.area_name].filter(Boolean).join("-");
	const description = [
		typeof data.description === "string" && data.description.trim() ? `📝 简述：${data.description.trim()}` : "",
		typeof data.tags === "string" && data.tags.trim() ? `🔖 标签：${data.tags.trim()}` : "",
		areaName ? `📍 分区：${areaName}` : "",
		typeof data.live_time === "string" && data.live_time.trim() ? `⏰ 直播时间：${data.live_time.trim()}` : "",
		Number.isFinite(online) ? `🏄 在线人数：${online}` : "",
		`📺 播放页：https://www.bilibili.com/blackboard/live/live-activity-player.html?enterTheRoom=0&cid=${roomId}`
	].filter(Boolean).join("\n");
	return {
		platform: "bilibili",
		displayName: "哔哩哔哩直播",
		title: String(data.title || "B站直播间"),
		description,
		pageUrl: `https://live.bilibili.com/${roomId}`,
		videos: [],
		images: coverUrl,
		extras: {
			coverUrl: coverUrl[0],
			contentBlocks: [{
				type: "text",
				text: String(data.title || "B站直播间")
			}, ...coverUrl.map((url) => ({
				type: "image",
				url
			}))]
		}
	};
};
const decodeHtmlEntities = (text) => text.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'").replace(/&amp;/gi, "&");
const textFromNodes = (nodes) => {
	if (!Array.isArray(nodes)) return "";
	let text = "";
	for (const node of nodes) {
		const item = asObject$7(node);
		if (!item) continue;
		const word = asObject$7(item.word);
		if (typeof word?.words === "string") text += word.words;
		const rich = asObject$7(item.rich);
		if (rich) {
			if (typeof rich.text === "string" && rich.text) text += rich.text;
			else if (typeof rich.name === "string" && rich.name) text += `@${rich.name}`;
		}
	}
	return decodeHtmlEntities(text);
};
const resolveBilibiliDynamic = async (dynamicId, cookie) => {
	const cookieHeader = bilibiliCookieHeader(cookie);
	if (!cookieHeader) return failure$7("解析 B站动态需要配置 B站 Cookie（SESSDATA）");
	const url = new URL(BILIBILI_OPUS_DETAIL);
	url.searchParams.set("id", dynamicId);
	url.searchParams.set("features", "onlyfansVote,onlyfansAssetsV2,decorationCard,htmlNewStyle,ugcDelete,editable,opusPrivateVisible,tribeeEdit,avatarAutoTheme,avatarTypeOpus");
	let payload;
	try {
		payload = await fetchResolverJson(url.toString(), { headers: {
			"User-Agent": bilibiliUserAgent,
			Referer: `https://t.bilibili.com/${dynamicId}`,
			Cookie: cookieHeader
		} });
	} catch (error) {
		return failure$7(`动态接口请求失败：${error instanceof Error ? error.message : String(error)}`);
	}
	const root = asObject$7(payload);
	const item = asObject$7(asObject$7(root?.data)?.item);
	if (Number(root?.code) !== 0 || !item) return failure$7(String(root?.message || "动态接口返回异常"));
	const blocks = [];
	const images = [];
	let title = "";
	for (const rawModule of Array.isArray(item.modules) ? item.modules : []) {
		const module = asObject$7(rawModule);
		if (!module) continue;
		const moduleType = String(module.module_type || "");
		if (moduleType === "MODULE_TYPE_TITLE") {
			const moduleTitle = asObject$7(module.module_title);
			if (typeof moduleTitle?.text === "string") title = decodeHtmlEntities(moduleTitle.text);
			continue;
		}
		if (moduleType === "MODULE_TYPE_TOPIC") {
			const topic = asObject$7(module.module_topic);
			if (typeof topic?.name === "string") blocks.push({
				type: "text",
				text: `🏷️ 话题：${decodeHtmlEntities(topic.name)}`
			});
			continue;
		}
		if (moduleType === "MODULE_TYPE_TOP") {
			const display = asObject$7(asObject$7(module.module_top)?.display);
			for (const pic of Array.isArray(asObject$7(display?.album)?.pics) ? asObject$7(display?.album)?.pics : []) {
				const picUrl = asObject$7(pic)?.url;
				if (typeof picUrl === "string" && picUrl) {
					images.push(picUrl);
					blocks.push({
						type: "image",
						url: picUrl
					});
				}
			}
			continue;
		}
		if (moduleType !== "MODULE_TYPE_CONTENT") continue;
		const paragraphs = Array.isArray(asObject$7(module.module_content)?.paragraphs) ? asObject$7(module.module_content)?.paragraphs : [];
		for (const rawParagraph of paragraphs) {
			const paragraph = asObject$7(rawParagraph);
			if (!paragraph) continue;
			const paraType = Number(paragraph.para_type);
			if (paraType === 1 || paraType === 4) {
				const text = textFromNodes(asObject$7(paragraph.text)?.nodes);
				if (text.trim()) blocks.push({
					type: "text",
					text: paraType === 4 ? `「${text}」` : text
				});
			} else if (paraType === 2) {
				const pics = Array.isArray(asObject$7(paragraph.pic)?.pics) ? asObject$7(paragraph.pic)?.pics : [];
				for (const pic of pics) {
					const picUrl = asObject$7(pic)?.url;
					if (typeof picUrl === "string" && picUrl) {
						images.push(picUrl);
						blocks.push({
							type: "image",
							url: picUrl
						});
					}
				}
			} else if (paraType === 3) blocks.push({
				type: "text",
				text: "---"
			});
			else if (paraType === 5) {
				const items = Array.isArray(asObject$7(paragraph.list)?.items) ? asObject$7(paragraph.list)?.items : [];
				for (const listItem of items) {
					const text = textFromNodes(asObject$7(listItem)?.nodes);
					if (text.trim()) blocks.push({
						type: "text",
						text: `• ${text}`
					});
				}
			}
		}
	}
	if (blocks.length === 0 && images.length === 0) return failure$7("动态内容为空");
	const authorModule = (Array.isArray(item.modules) ? item.modules : []).map((rawModule) => asObject$7(rawModule)).find((module) => module?.module_type === "MODULE_TYPE_AUTHOR");
	const author = asObject$7(authorModule?.module_author);
	const textBlocks = blocks.filter((block) => block.type === "text");
	return {
		platform: "bilibili",
		displayName: "哔哩哔哩动态",
		title: title || "哔哩哔哩动态",
		description: textBlocks.map((block) => block.text).join("\n"),
		author: typeof author?.name === "string" ? author.name : void 0,
		pageUrl: `https://t.bilibili.com/${dynamicId}`,
		videos: [],
		images,
		extras: {
			coverUrl: images[0],
			contentBlocks: blocks
		}
	};
};
const resolveBilibiliArticle = async (cvid, cookie) => {
	const headers = {
		"User-Agent": bilibiliUserAgent,
		Referer: "https://www.bilibili.com/"
	};
	if (cookie) headers.Cookie = cookie;
	let payload;
	try {
		payload = await fetchResolverJson(`${BILIBILI_ARTICLE_INFO}?id=${encodeURIComponent(cvid)}`, { headers });
	} catch (error) {
		return failure$7(`专栏接口请求失败：${error instanceof Error ? error.message : String(error)}`);
	}
	const root = asObject$7(payload);
	const data = asObject$7(root?.data);
	if (Number(root?.code) !== 0 || !data) return failure$7(String(root?.message || "专栏接口返回异常"));
	const images = stringArray(data.origin_image_urls);
	const coverUrl = typeof data.banner_url === "string" && data.banner_url.trim() ? data.banner_url.trim() : void 0;
	const title = String(data.title || "B站专栏");
	return {
		platform: "bilibili",
		displayName: "哔哩哔哩专栏",
		title,
		description: [formatStats({
			view: asObject$7(data.stats)?.view,
			favorite: asObject$7(data.stats)?.favorite,
			like: asObject$7(data.stats)?.like,
			reply: asObject$7(data.stats)?.reply
		})].filter(Boolean).join("\n"),
		author: typeof data.author_name === "string" ? data.author_name : void 0,
		pageUrl: `https://www.bilibili.com/read/cv${cvid}`,
		videos: [],
		images: images.length > 0 ? images : coverUrl ? [coverUrl] : [],
		extras: {
			coverUrl: coverUrl || images[0],
			contentBlocks: [{
				type: "text",
				text: title
			}, ...(images.length > 0 ? images : coverUrl ? [coverUrl] : []).map((url) => ({
				type: "image",
				url
			}))]
		}
	};
};
const resolveBilibili = async (url, cookie = "") => {
	let finalUrl = url;
	try {
		finalUrl = await expandShortUrl$2(url);
	} catch {
		finalUrl = url;
	}
	const target = classifyBilibiliUrl(finalUrl);
	if (!target) {
		const bvid = extractBvid(finalUrl);
		if (!bvid) return failure$7("无法识别 BVID");
		return resolveBilibiliVideo({
			kind: "video",
			bvid,
			page: extractBilibiliPage(finalUrl)
		}, finalUrl, cookie);
	}
	if (target.kind === "live") return resolveBilibiliLive(target.roomId);
	if (target.kind === "article") return resolveBilibiliArticle(target.cvid, cookie);
	if (target.kind === "dynamic") return resolveBilibiliDynamic(target.dynamicId, cookie);
	if (target.kind === "bangumi") return resolveBilibiliBangumi(target, finalUrl, cookie);
	return resolveBilibiliVideo(target, finalUrl, cookie);
};
// src/resolvers/acfun.ts
/**
* AcFun 原生解析：R utils/acfun.js 的 parseUrl。
* 稿件页带 `?quickViewId=videoInfo_new&ajaxpipe=1` 会返回包含
* `window.pageInfo = window.videoInfo = {...}` 的片段，其中已有 ac 号、标题、作者、
* 简介和播放信息，无需登录；下载/合并由发送侧负责，这里只登记直链。
*/
const asObject$6 = (value) => typeof value === "object" && value !== null ? value : void 0;
const firstString$5 = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
};
const firstNumber$2 = (...values) => {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
	}
};
/** `ac12345` / `https://www.acfun.cn/v/ac12345` / `?ac=12345` 都归一成数字稿件号。 */
const extractAcfunId = (url) => url.match(/\/v\/ac(\d+)/i)?.[1] || url.match(/[?&]ac=(\d+)/i)?.[1] || url.match(/\bac(\d{4,})\b/i)?.[1];
/** 页面脚本里的 JSON 带双重转义，先还原 `\\\\"` 再还原 `\\"`，顺序反过来会破坏内容。 */
const extractAcfunVideoInfo = (text) => {
	const start = text.indexOf("window.pageInfo = window.videoInfo =");
	if (start < 0) return void 0;
	const tail = text.slice(start + 36);
	const end = tail.indexOf("<\/script>");
	const raw = (end >= 0 ? tail.slice(0, end) : tail).trim();
	if (!raw) return void 0;
	const unescapedOnce = (value) => value.replace(/\\\\"/g, "\\\"").replace(/\\"/g, "\"");
	let candidate = raw;
	for (let attempt = 0; attempt < 3; attempt++) try {
		return JSON.parse(candidate);
	} catch {
		const next = unescapedOnce(candidate);
		if (next === candidate) return void 0;
		candidate = next;
	}
};
const representationUrls = (info) => {
	const current = asObject$6(info.currentVideoInfo);
	const ksPlayRaw = firstString$5(current?.ksPlayJson);
	if (!ksPlayRaw) return [];
	try {
		const ksPlay = JSON.parse(ksPlayRaw);
		return (Array.isArray(ksPlay.adaptationSet) ? ksPlay.adaptationSet : []).flatMap((set) => {
			const representations = asObject$6(set)?.representation;
			return (Array.isArray(representations) ? representations : []).map((item) => firstString$5(asObject$6(item)?.url)).filter(Boolean);
		});
	} catch {
		return [];
	}
};
/**
* 只登记可直接下载发送的 mp4 直链。
* AcFun 的 ksPlayJson representation 一律是 m3u8（HLS 分片清单），发送侧没有 HLS 合并能力，
* 把 playlist 当媒体下载只会发出不可播放的"视频"（评审 B2）。仅有 m3u8 时不给 videos，由文案提示。
*/
const streamUrls = (info) => {
	const streams = Array.isArray(info.currentVideoInfo?.streams) ? info.currentVideoInfo.streams : [];
	const mp4 = [];
	for (const stream of streams) {
		const playUrls = asObject$6(stream)?.playUrls;
		const list = Array.isArray(playUrls) ? playUrls : [];
		for (const play of list) {
			const url = firstString$5(asObject$6(play)?.url, asObject$6(play)?.playUrl);
			if (url && /\.mp4(?:$|[?#])/i.test(url)) mp4.push(url);
		}
	}
	return mp4;
};
const failure$6 = (reason) => ({
	platform: "general",
	displayName: "AcFun",
	ok: false,
	reason
});
const normalizeAcfunVideo = (url, info) => {
	const video = asObject$6(info);
	if (!video) return failure$6("AcFun 页面没有 videoInfo 数据");
	const id = firstString$5(video.dougaId);
	const title = firstString$5(video.title) || (id ? `ac${id}` : "AcFun 视频");
	const author = asObject$6(video.user);
	const cover = firstString$5(video.cover, video.coverUrl, video.cover_url, video.image, asObject$6(video.currentVideoInfo)?.cover, asObject$6(video.currentVideoInfo)?.coverUrl);
	const stats = [
		["播放", firstNumber$2(video.viewCount, video.views)],
		["点赞", firstNumber$2(video.likeCount, video.likes)],
		["弹幕", firstNumber$2(video.danmakuCount, video.danmakuCountShow)],
		["评论", firstNumber$2(video.commentCount, video.comments)],
		["收藏", firstNumber$2(video.stowCount, video.collectCount)]
	].filter((entry) => entry[1] !== void 0);
	const videos = streamUrls(video);
	const hlsOnly = videos.length === 0 && representationUrls(video).length > 0;
	const description = [
		firstString$5(video.description),
		stats.length > 0 ? stats.map(([label, value]) => `${label} ${value}`).join(" · ") : "",
		hlsOnly ? "AcFun 仅返回 m3u8 播放列表，暂不支持发送内嵌视频，可点击原链接观看。" : ""
	].filter(Boolean).join("\n");
	const contentBlocks = [{
		type: "text",
		text: `ac${id || ""} ${title}`.trim()
	}, ...cover ? [{
		type: "image",
		url: cover
	}] : []];
	const videoDescription = firstString$5(video.description);
	if (videoDescription) contentBlocks.push({
		type: "text",
		text: videoDescription
	});
	const createdAt = firstNumber$2(video.createTime, video.createTimeMillis);
	const pageUrl = id ? `https://www.acfun.cn/v/ac${id}` : url;
	return {
		platform: "general",
		displayName: "AcFun",
		title,
		description,
		author: firstString$5(author?.name),
		pageUrl,
		videos: videos.map((videoUrl) => ({ url: videoUrl })),
		images: cover ? [cover] : [],
		extras: {
			coverUrl: cover,
			authorAvatar: firstString$5(author?.avatar, author?.avatarUrl),
			contentBlocks,
			tags: ["AcFun"],
			...createdAt ? { createdAt } : {}
		}
	};
};
const resolveAcfun = async (url) => {
	const id = extractAcfunId(url);
	if (!id) return failure$6("无法识别 AcFun 稿件号");
	try {
		const html = await fetchResolverText(`https://www.acfun.cn/v/ac${id}?quickViewId=videoInfo_new&ajaxpipe=1`, { headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Referer: `https://www.acfun.cn/v/ac${id}`
		} });
		const info = extractAcfunVideoInfo(html);
		if (!info) return failure$6("AcFun 页面未找到 videoInfo");
		return normalizeAcfunVideo(url, info);
	} catch (error) {
		return failure$6(error instanceof Error ? error.message : String(error));
	}
};
// src/resolvers/pipixia.ts
/**
* 皮皮虾原生解析：R utils/pipixia-scraper.js + tools.js 2904-2976。
* 页面 `RENDER_DATA` 里同时有无水印视频（评论 item 的 video_high）、作者、互动数据和评论，
* 拿不到或无视频时由调用方降级到第三方通用接口。
*/
const asObject$5 = (value) => typeof value === "object" && value !== null ? value : void 0;
const firstString$4 = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
};
const firstNumber$1 = (...values) => {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
	}
};
const urlListFirst = (value) => {
	const list = Array.isArray(asObject$5(value)?.url_list) ? asObject$5(value)?.url_list : [];
	return firstString$4(asObject$5(list[0])?.url);
};
const extractPipixiaItemId = (url) => url.match(/item\/(\d+)/)?.[1];
const extractPipixiaRenderData = (html) => {
	const match = html.match(/<script id="RENDER_DATA" type="application\/json">([\s\S]+?)<\/script>/);
	if (!match?.[1]) return void 0;
	try {
		return JSON.parse(decodeURIComponent(match[1]));
	} catch {
		return;
	}
};
const formatCommentTime$1 = (seconds) => {
	const value = firstNumber$1(seconds);
	if (value === void 0) return void 0;
	const date = /* @__PURE__ */ new Date(value * 1e3);
	if (Number.isNaN(date.getTime())) return void 0;
	return date.toLocaleString("zh-CN");
};
const commentBlocksFrom = (cells) => {
	return (Array.isArray(cells) ? cells : []).flatMap((cell) => {
		const comment = asObject$5(asObject$5(cell)?.comment_info);
		const text = firstString$4(comment?.text);
		if (!comment || !text) return [];
		const block = {
			author: firstString$4(comment.user?.name, comment.user?.nickname) || "匿名用户",
			text,
			images: []
		};
		const likeCount = firstNumber$1(comment.digg_count);
		if (likeCount !== void 0) block.likeCount = likeCount;
		const replyCount = firstNumber$1(comment.reply_count);
		if (replyCount !== void 0) block.replyCount = replyCount;
		const time = formatCommentTime$1(comment.create_time);
		if (time) block.time = time;
		return [block];
	});
};
/** 评论 item 的 video_high 才是无水印源；主 item 的 origin_video_download/video_download 是带水印降级。 */
const watermarkFreeVideo = (cells, item) => {
	const list = Array.isArray(cells) ? cells : [];
	for (const cell of list) {
		const video = asObject$5(asObject$5(asObject$5(cell)?.comment_info)?.item)?.video;
		const url = urlListFirst(video?.video_high);
		if (url) return url;
	}
	return firstString$4(urlListFirst(item.video?.origin_video_download), urlListFirst(item.video?.video_download));
};
const failure$5 = (reason) => ({
	platform: "general",
	displayName: "皮皮虾",
	ok: false,
	reason
});
const normalizePipixiaRenderData = (pageUrl, data) => {
	const root = asObject$5(data);
	const item = asObject$5(root?.ppxItemDetail?.item);
	if (!item) return failure$5("皮皮虾页面缺少 item 数据");
	const cells = asObject$5(root?.ppxCellComment)?.cell_comments;
	const videoUrl = watermarkFreeVideo(cells, item);
	if (!videoUrl) return failure$5("皮皮虾页面没有可用的视频直链");
	const author = asObject$5(item.author);
	const share = asObject$5(item.share);
	const inviter = firstString$4(root?.ppxUserDetail?.user?.name);
	let title = firstString$4(share?.title) || "皮皮虾视频";
	if (inviter && title.includes("的这个内容太有意思了")) title = `这个内容太有意思了，${inviter}分享给你，快点开看看！`;
	const stats = asObject$5(item.stats);
	const statsLine = [
		stats?.like_count !== void 0 ? `👍${stats.like_count}` : "",
		stats?.comment_count !== void 0 ? `💬${stats.comment_count}` : "",
		stats?.share_count !== void 0 ? `🔄${stats.share_count}` : "",
		stats?.play_count !== void 0 ? `👁️${stats.play_count}` : ""
	].filter(Boolean).join(" ");
	const cover = urlListFirst(item.cover);
	const description = [inviter ? `分享人：${inviter}` : "", statsLine ? `📊 数据：${statsLine}` : ""].filter(Boolean).join("\n");
	const contentBlocks = [];
	if (cover) contentBlocks.push({
		type: "image",
		url: cover
	});
	if (statsLine) contentBlocks.push({
		type: "text",
		text: `📊 数据：${statsLine}`
	});
	return {
		platform: "general",
		displayName: "皮皮虾",
		title,
		description,
		author: firstString$4(author?.name),
		pageUrl,
		videos: [{ url: videoUrl }],
		images: cover ? [cover] : [],
		extras: {
			coverUrl: cover,
			authorAvatar: urlListFirst(author?.avatar),
			contentBlocks,
			commentBlocks: commentBlocksFrom(cells)
		}
	};
};
const resolvePipixia = async (url) => {
	try {
		const finalUrl = url.includes("/s/") ? await resolveResolverRedirectUrl(url) : url;
		const itemId = extractPipixiaItemId(finalUrl);
		if (!itemId) return failure$5("无法从皮皮虾链接中提取 item_id");
		const html = await fetchResolverText(`https://h5.pipix.com/item/${itemId}`, { headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
		} });
		const data = extractPipixiaRenderData(html);
		if (!data) return failure$5("皮皮虾页面未找到 RENDER_DATA");
		return normalizePipixiaRenderData(url, data);
	} catch (error) {
		return failure$5(error instanceof Error ? error.message : String(error));
	}
};
// src/resolvers/general.ts
const failure$4 = (displayName, reason, platform = "general") => ({
	platform,
	displayName,
	ok: false,
	reason
});
const asObject$4 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const stringValues = (value) => {
	if (typeof value === "string" && value.trim()) return [value.trim()];
	if (Array.isArray(value)) return value.flatMap(stringValues);
	const item = asObject$4(value);
	if (!item) return [];
	return [
		item.url,
		item.src,
		item.href,
		item.playUrl,
		item.play_url,
		item.urlList,
		item.url_list,
		item.originUrl,
		item.origin_url,
		item.original,
		item.large
	].flatMap(stringValues);
};
const firstString$3 = (...values) => {
	for (const value of values) {
		const text = stringValues(value)[0];
		if (text) return text;
	}
};
const uniqueStrings = (values) => {
	const seen = /* @__PURE__ */ new Set();
	return values.filter((value) => {
		if (seen.has(value)) return false;
		seen.add(value);
		return true;
	});
};
const isLikelyVideoUrl = (url) => {
	const normalized = url.toLowerCase();
	return !(/\.(?:mp3|m4a|aac|flac|wav|ogg)(?:[?#]|$)/.test(normalized) || normalized.includes("ies-music") || normalized.includes("/music/"));
};
const normalizeGeneralApiResponse = (displayName, payload, options = {}) => {
	const platform = options.platform || "general";
	const root = asObject$4(payload);
	if (!root) return failure$4(displayName, "empty response", platform);
	const code = root.code;
	if ([
		-2,
		-1,
		400,
		404,
		500
	].includes(Number(code))) return failure$4(displayName, `api failed: ${String(code)}`, platform);
	const data = asObject$4(root.data);
	if (!data) return failure$4(displayName, "empty data", platform);
	const authorObject = asObject$4(data.author);
	const userObject = asObject$4(data.user);
	const title = firstString$3(data.title, data.name);
	const description = firstString$3(data.desc, data.description, data.content, data.text, data.summary);
	const author = firstString$3(data.author, authorObject?.name, authorObject?.nickname, data.authorName, data.author_name, data.nickname, data.userName, data.user_name, userObject?.name, userObject?.nickname);
	const authorAvatar = firstString$3(data.avatar, data.authorAvatar, data.author_avatar, authorObject?.avatar, authorObject?.face, userObject?.avatar, userObject?.face);
	const coverCandidates = [
		data.cover,
		data.coverUrl,
		data.cover_url,
		data.pic,
		data.picture,
		data.thumbnail,
		data.thumb
	].flatMap(stringValues);
	const rawImages = coverCandidates.concat(stringValues(data.images), stringValues(data.imageUrl), stringValues(data.image_url), stringValues(data.pics), stringValues(data.picUrls), stringValues(data.pic_urls), stringValues(data.imgurl));
	const images = dedupeImageUrls(rawImages);
	const coverUrl = dedupeImageUrls(coverCandidates)[0] || images[0];
	const videos = uniqueStrings([
		...stringValues(data.url),
		...stringValues(data.playAddr),
		...stringValues(data.play_addr),
		...stringValues(data.videoUrl),
		...stringValues(data.video_url),
		...stringValues(data.video)
	]).filter(isLikelyVideoUrl);
	if (videos.length === 0 && images.length === 0) return failure$4(displayName, "no media found", platform);
	const contentText = description || title;
	const contentBlocks = [contentText ? {
		type: "text",
		text: contentText
	} : void 0, ...images.map((url) => ({
		type: "image",
		url
	}))].filter((item) => Boolean(item));
	return {
		platform,
		displayName,
		title: title || description || displayName,
		description,
		author,
		pageUrl: options.pageUrl,
		videos: videos.map((url) => ({ url })),
		images,
		extras: {
			coverUrl,
			...authorAvatar ? { authorAvatar } : {},
			contentBlocks
		}
	};
};
const defaultFetchJson = async (requestUrl) => fetchResolverJson(requestUrl);
const isFetchJson = (value) => typeof value === "function";
const resolveByGeneralApis = async (displayName, url, apiTemplates, optionsOrFetchJson = {}, fetchJsonOverride) => {
	const options = isFetchJson(optionsOrFetchJson) ? {} : optionsOrFetchJson;
	const fetchJson = isFetchJson(optionsOrFetchJson) ? optionsOrFetchJson : fetchJsonOverride || defaultFetchJson;
	let lastFailure = failure$4(displayName, "no api configured", options.platform);
	for (const template of apiTemplates) {
		const requestUrl = template.replace("{url}", encodeURIComponent(url));
		try {
			const result = normalizeGeneralApiResponse(displayName, await fetchJson(requestUrl), options);
			if (!("ok" in result)) return result;
			lastFailure = result;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			let endpointHost = "unknown";
			try {
				endpointHost = new URL(requestUrl).host;
			} catch {}
			lastFailure = failure$4(displayName, `api request failed (${endpointHost}): ${reason}`, options.platform);
		}
	}
	return lastFailure;
};
const isHost = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);
/**
* 西瓜短链（v.ixigua.com/xxx）先跟一次跳转拿到数字视频 id，再统一成 `www.ixigua.com/<id>`；
* R 插件在 controller 阶段就还原短链，否则第三方接口拿到的短链经常 404。
*/
const normalizeXiguaUrl = async (url, expand) => {
	const hostname = hostnameOf(url) || "";
	if (!isHost(hostname, "ixigua.com")) return url;
	let target = url;
	if (hostname.startsWith("v.")) try {
		target = await expand(url);
	} catch {
		target = url;
	}
	const id = target.match(/ixigua\.com\/(\d+)/)?.[1] || target.match(/\/video\/(\d+)/)?.[1];
	return id ? `https://www.ixigua.com/${id}` : target;
};
/** 域名决定展示名：通用平台此前一律显示「通用解析」，和 R 插件的「识别：西瓜」不符。 */
const generalPlatformOf = (url) => {
	const hostname = hostnameOf(url) || "";
	if (isHost(hostname, "pipix.com")) return {
		displayName: "皮皮虾",
		resolveNative: resolvePipixia
	};
	if (isHost(hostname, "acfun.cn")) return {
		displayName: "AcFun",
		resolveNative: resolveAcfun
	};
	if (isHost(hostname, "ixigua.com")) return { displayName: "西瓜" };
	if (isHost(hostname, "pipigx.com")) return { displayName: "皮皮搞笑" };
	if (isHost(hostname, "xsj.qq.com")) return { displayName: "QQ小世界" };
	if (isHost(hostname, "okjike.com")) return { displayName: "即刻" };
	return { displayName: "通用解析" };
};
/**
* 通用平台入口：先走原生解析（皮皮虾无水印视频/评论、AcFun 稿件详情），
* 失败或平台没有原生实现时降级到第三方接口轮换。
*/
const resolveGeneral = async (url, apiTemplates, deps = {}) => {
	const platform = generalPlatformOf(url);
	if (platform.resolveNative) {
		const native = await platform.resolveNative(url).catch(() => failure$4(platform.displayName, "原生解析失败"));
		if (!("ok" in native)) return native;
	}
	const expand = deps.expandShortUrl ?? resolveResolverRedirectUrl;
	const targetUrl = await normalizeXiguaUrl(url, expand);
	return resolveByGeneralApis(platform.displayName, targetUrl, apiTemplates, {
		platform: "general",
		pageUrl: targetUrl
	});
};
// src/resolvers/douyin.ts
const failure$3 = (reason) => ({
	platform: "douyin",
	displayName: "抖音",
	ok: false,
	reason
});
const asObject$3 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const firstUrl = (value) => {
	if (typeof value === "string" && value.trim()) return value;
	if (!Array.isArray(value)) return void 0;
	return value.find((item) => typeof item === "string" && item.trim().length > 0);
};
const firstVideoUrl = (value) => {
	if (typeof value === "string" && value.trim() && isLikelyVideoUrl(value)) return value;
	if (!Array.isArray(value)) return void 0;
	return value.find((item) => typeof item === "string" && item.trim().length > 0 && isLikelyVideoUrl(item));
};
const pushUnique$4 = (items, value) => {
	const url = firstUrl(value);
	if (url && !items.includes(url)) items.push(url);
};
const pushVideo = (items, url, audioUrl) => {
	if (!url) return;
	const existing = items.find((item) => item.url === url);
	if (!existing) {
		items.push({
			url,
			...audioUrl ? { audioUrl } : {}
		});
		return;
	}
	if (audioUrl && !existing.audioUrl) existing.audioUrl = audioUrl;
};
const validDouyinQualities = /* @__PURE__ */ new Set([
	"adapt",
	"540p",
	"720p",
	"1080p",
	"2k",
	"4k"
]);
const douyinQualityPriority = [
	"4k",
	"2k",
	"1080p",
	"720p",
	"540p"
];
const isFixedDouyinQuality = (value) => {
	return douyinQualityPriority.includes(value);
};
const normalizeQuality = (value) => {
	const quality = String(value || "1080p").toLowerCase();
	return validDouyinQualities.has(quality) ? quality : "1080p";
};
const normalizeNumber = (value, fallback) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};
const normalizeBytes = (value) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
/**
* 抖音 `video.duration` 一般是毫秒, 但动图/部分接口会给秒。
* 小于 1000 的值按秒处理, 避免 <1s 片段被当成上千秒的长视频而误判超限。
*/
const douyinDurationSeconds = (value) => {
	const raw = normalizeNumber(value, 0);
	if (raw <= 0) return 0;
	return raw < 1e3 ? Math.round(raw) : Math.trunc(raw / 1e3);
};
const douyinQualityFromGear = (gearName) => {
	const gear = String(gearName || "").toLowerCase();
	if (gear.includes("lowest_4") || gear.includes("2160") || gear.includes("4k")) return "4k";
	if (gear.includes("1440") || gear.includes("2k")) return "2k";
	if (gear.includes("1080")) return "1080p";
	if (gear.includes("720")) return "720p";
	if (gear.includes("540")) return "540p";
	return "540p";
};
const createDouyinPlayUrl = (uri, quality) => {
	if (typeof uri !== "string" || !uri.trim()) return void 0;
	const ratio = quality === "adapt" ? "1080p" : quality;
	const url = new URL("https://aweme.snssdk.com/aweme/v1/play/");
	url.searchParams.set("video_id", uri);
	url.searchParams.set("ratio", ratio);
	url.searchParams.set("line", "0");
	return url.toString();
};
const firstPlayAddrVideoUrl = (value, quality) => {
	const playAddr = asObject$3(value);
	return firstVideoUrl(playAddr?.url_list) || createDouyinPlayUrl(playAddr?.uri, quality);
};
const selectDouyinBitRateUrl = (bitRates, quality) => {
	if (!Array.isArray(bitRates)) return void 0;
	const mp4Videos = bitRates.map((item) => asObject$3(item)).filter((item) => Boolean(item)).filter((item) => String(item.format || "").toLowerCase() !== "dash");
	if (mp4Videos.length === 0) return void 0;
	const videosByQuality = /* @__PURE__ */ new Map();
	for (const item of mp4Videos) {
		const level = douyinQualityFromGear(item.gear_name);
		const group = videosByQuality.get(level) || [];
		group.push(item);
		videosByQuality.set(level, group);
	}
	for (const group of videosByQuality.values()) group.sort((a, b) => normalizeBytes(b.play_addr?.data_size) - normalizeBytes(a.play_addr?.data_size));
	if (quality === "adapt") {
		const sizeLimitBytes = 104857600;
		for (const level of douyinQualityPriority) {
			const item = videosByQuality.get(level)?.find((video) => {
				const size = normalizeBytes(video.play_addr?.data_size);
				return size === 0 || size <= sizeLimitBytes;
			});
			const url = firstPlayAddrVideoUrl(item?.play_addr, quality);
			if (url) return url;
		}
		const smallest = mp4Videos.reduce((current, item) => {
			const currentSize = normalizeBytes(current.play_addr?.data_size);
			const itemSize = normalizeBytes(item.play_addr?.data_size);
			if (currentSize === 0) return item;
			if (itemSize === 0) return current;
			return itemSize < currentSize ? item : current;
		}, mp4Videos[0]);
		return firstPlayAddrVideoUrl(smallest.play_addr, quality);
	}
	const targetIndex = douyinQualityPriority.indexOf(quality);
	const targetLevels = isFixedDouyinQuality(quality) ? [
		quality,
		...douyinQualityPriority.slice(targetIndex + 1),
		...douyinQualityPriority.slice(0, targetIndex).reverse()
	] : douyinQualityPriority;
	for (const level of targetLevels) {
		const url = firstPlayAddrVideoUrl(videosByQuality.get(level)?.[0]?.play_addr, quality);
		if (url) return url;
	}
	return firstPlayAddrVideoUrl(mp4Videos[0].play_addr, quality);
};
const selectDouyinVideoUrl = (video, quality) => {
	return selectDouyinBitRateUrl(video.bit_rate, quality) || firstPlayAddrVideoUrl(video.play_addr, quality) || firstPlayAddrVideoUrl(video.play_addr_h264, quality) || firstPlayAddrVideoUrl(video.download_addr, quality);
};
const createDouyinDetailUrl = (awemeId) => {
	const url = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
	url.searchParams.set("device_platform", "webapp");
	url.searchParams.set("aid", "6383");
	url.searchParams.set("channel", "channel_pc_web");
	url.searchParams.set("aweme_id", awemeId);
	url.searchParams.set("pc_client_type", "1");
	url.searchParams.set("version_code", "190500");
	url.searchParams.set("version_name", "19.5.0");
	url.searchParams.set("cookie_enabled", "true");
	url.searchParams.set("screen_width", "1344");
	url.searchParams.set("screen_height", "756");
	url.searchParams.set("browser_language", "zh-CN");
	url.searchParams.set("browser_platform", "Win32");
	url.searchParams.set("browser_name", "Firefox");
	url.searchParams.set("browser_version", "118.0");
	url.searchParams.set("browser_online", "true");
	url.searchParams.set("engine_name", "Gecko");
	url.searchParams.set("engine_version", "109.0");
	url.searchParams.set("os_name", "Windows");
	url.searchParams.set("os_version", "10");
	url.searchParams.set("cpu_core_num", "16");
	url.searchParams.set("platform", "PC");
	return url.toString();
};
const extractDouyinAwemeId = (url) => {
	try {
		const parsed = new URL(url);
		return parsed.searchParams.get("modal_id") || parsed.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || parsed.pathname.match(/\/share\/(?:video|slides)\/(\d+)/)?.[1];
	} catch {
		return;
	}
};
/**
* 直播间识别: `live.douyin.com/<web_rid>` 走网页 enter 接口,
* `webcast.amemv.com` 的 reflow 链接走客户端接口;两者都不能当普通作品解析。
*/
const classifyDouyinUrl = (url) => {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return { kind: "work" };
	}
	const hostname = parsed.hostname.toLowerCase();
	if (hostname === "webcast.amemv.com") {
		const roomId = parsed.pathname.match(/\/webcast\/reflow\/(\d+)/)?.[1];
		if (roomId) return {
			kind: "live",
			roomId,
			via: "reflow"
		};
	}
	if (hostname === "live.douyin.com" || hostname.endsWith(".live.douyin.com")) {
		const roomId = parsed.pathname.match(/^\/(\d+)/)?.[1];
		if (roomId) return {
			kind: "live",
			roomId,
			via: "enter"
		};
	}
	const liveRoomId = parsed.pathname.match(/\/live\/(\d+)/)?.[1];
	if (liveRoomId) return {
		kind: "live",
		roomId: liveRoomId,
		via: "enter"
	};
	return {
		kind: "work",
		awemeId: extractDouyinAwemeId(url)
	};
};
/**
* reflow 接口要求 `verifyFp` 设备指纹: 36 位随机串, 第 9/14/19/24 位是下划线, 第 15 位固定 4。
* 与 R `utils/tiktok.js` 的 genVerifyFp 同构。
*/
const createDouyinVerifyFp = () => {
	const base = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	const slots = new Array(36).fill("");
	for (const index of [
		8,
		13,
		18,
		23
	]) slots[index] = "_";
	slots[14] = "4";
	for (let index = 0; index < 36; index += 1) {
		if (slots[index]) continue;
		let pick = Math.floor(Math.random() * 62);
		if (index === 19) pick = 3 & pick | 8;
		slots[index] = base[pick];
	}
	return `verify_${Date.now().toString(36)}_${slots.join("")}`;
};
const createDouyinLiveUrl = (roomId, via, msToken = "") => {
	if (via === "reflow") {
		const reflow = new URL("https://webcast.amemv.com/webcast/room/reflow/info/");
		reflow.searchParams.set("type_id", "0");
		reflow.searchParams.set("live_id", "1");
		reflow.searchParams.set("sec_user_id", "");
		reflow.searchParams.set("version_code", "99.99.99");
		reflow.searchParams.set("app_id", "1128");
		reflow.searchParams.set("room_id", roomId);
		reflow.searchParams.set("verifyFp", createDouyinVerifyFp());
		if (msToken) reflow.searchParams.set("msToken", msToken);
		return reflow.toString();
	}
	const url = new URL("https://live.douyin.com/webcast/room/web/enter/");
	url.searchParams.set("device_platform", "webapp");
	url.searchParams.set("aid", "6383");
	url.searchParams.set("channel", "channel_pc_web");
	url.searchParams.set("pc_client_type", "1");
	url.searchParams.set("version_code", "190500");
	url.searchParams.set("version_name", "19.5.0");
	url.searchParams.set("cookie_enabled", "true");
	url.searchParams.set("screen_width", "1920");
	url.searchParams.set("screen_height", "1080");
	url.searchParams.set("browser_language", "zh-CN");
	url.searchParams.set("browser_platform", "Win32");
	url.searchParams.set("browser_name", "Firefox");
	url.searchParams.set("browser_version", "124.0");
	url.searchParams.set("browser_online", "true");
	url.searchParams.set("engine_name", "Gecko");
	url.searchParams.set("engine_version", "122.0.0.0");
	url.searchParams.set("os_name", "Windows");
	url.searchParams.set("os_version", "10");
	url.searchParams.set("cpu_core_num", "12");
	url.searchParams.set("device_memory", "8");
	url.searchParams.set("platform", "PC");
	url.searchParams.set("web_rid", roomId);
	return url.toString();
};
/**
* 在任意快照结构里找 `aweme_detail` 对象.
* 真实页面形状不固定(`__NEXT_DATA__` 是 props.pageProps.aweme_detail,
* universal 快照是 __DEFAULT_SCOPE__['webapp.video-detail'].aweme_detail),
* 因此按键名深搜;只认这一个键,避免误命中别的同名结构以外的数据.
* 深度上限 6 与数组前 40 项是硬边界:快照来自外部页面,恶意构造的超深/超宽 JSON
* 会在递归里打爆调用栈或拖长解析,超出边界的快照直接放弃.
*/
const findAwemeDetail = (node, depth = 0) => {
	if (depth > 6) return void 0;
	if (Array.isArray(node)) {
		for (const item of node.slice(0, 40)) {
			const found = findAwemeDetail(item, depth + 1);
			if (found) return found;
		}
		return;
	}
	const record = asObject$3(node);
	if (!record) return void 0;
	const direct = asObject$3(record.aweme_detail);
	if (direct) return direct;
	for (const value of Object.values(record)) {
		if (typeof value !== "object" || value === null) continue;
		const found = findAwemeDetail(value, depth + 1);
		if (found) return found;
	}
};
/** 图集的 BGM: `music.play_url` 优先取直链, 只留 `uri` 时也登记, 由发送侧按需处理。 */
const douyinMusicUrl = (music) => {
	const playUrl = asObject$3(asObject$3(music)?.play_url);
	if (!playUrl) return void 0;
	return firstUrl(playUrl.url_list) || (typeof playUrl.uri === "string" && playUrl.uri.trim() ? playUrl.uri : void 0);
};
const normalizeDouyinDetail = (pageUrl, payload, options = {}) => {
	const root = asObject$3(payload);
	const detail = findAwemeDetail(root);
	if (!detail) return failure$3("抖音接口返回异常");
	const images = [];
	const videos = [];
	const quality = normalizeQuality(options.quality);
	const maxVideoDurationSeconds = normalizeNumber(options.maxVideoDurationSeconds, 0);
	let limitMessage = "";
	const imageItems = Array.isArray(detail.images) ? detail.images : [];
	const video = asObject$3(detail.video);
	const author = asObject$3(detail.author);
	if (imageItems.length > 0) {
		const bgmUrl = detail.is_use_music === false || Number(asObject$3(detail.image_album_music_info)?.volume) === 0 ? void 0 : douyinMusicUrl(detail.music);
		for (const rawImage of imageItems) {
			const image = asObject$3(rawImage);
			if (!image) continue;
			const clipUrl = selectDouyinVideoUrl(asObject$3(image.video) || {}, quality);
			if (clipUrl) {
				pushVideo(videos, clipUrl, bgmUrl);
				continue;
			}
			pushUnique$4(images, image.url_list);
		}
		pushUnique$4(images, asObject$3(video?.cover)?.url_list);
	} else if (video) {
		pushUnique$4(images, asObject$3(video.cover)?.url_list);
		pushUnique$4(images, asObject$3(video.origin_cover)?.url_list);
		const durationSeconds = douyinDurationSeconds(video.duration);
		if (maxVideoDurationSeconds > 0 && durationSeconds > maxVideoDurationSeconds) limitMessage = `视频时长 ${durationSeconds} 秒，超过当前下载上限 ${maxVideoDurationSeconds} 秒，仅返回视频信息。`;
		else pushVideo(videos, selectDouyinVideoUrl(video, quality));
	}
	if (images.length === 0 && videos.length === 0) return failure$3("未找到抖音媒体资源");
	const desc = typeof detail.desc === "string" ? detail.desc : "";
	const coverUrl = images[0];
	const authorAvatar = firstUrl(asObject$3(author?.avatar_thumb)?.url_list);
	return {
		platform: "douyin",
		displayName: "抖音",
		title: desc || "抖音作品",
		description: [desc, limitMessage].filter(Boolean).join("\n"),
		author: author?.nickname,
		pageUrl,
		videos,
		images,
		extras: {
			coverUrl,
			...authorAvatar ? { authorAvatar } : {}
		}
	};
};
/**
* 从 marker 之后第一个 `{` 起做括号深度扫描,返回配平的 JSON 对象串.
* `aweme_detail` 里必然有嵌套对象(bit_rate/play_addr 等),固定长度或非贪婪正则
* 都只能截到内层 `}`,因此必须按深度计数;字符串内的括号与转义引号不算结构.
*/
const extractBalancedJson = (text, marker) => {
	const markerIndex = text.indexOf(marker);
	if (markerIndex < 0) return void 0;
	const start = text.indexOf("{", markerIndex + marker.length);
	if (start < 0) return void 0;
	let depth = 0;
	let inString = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (char === "\\") index += 1;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return text.slice(start, index + 1);
		}
	}
};
/**
* SSR 免 Cookie 兜底:无 Cookie 或官方接口失败时,抓分享页 HTML 内嵌的
* `aweme_detail` / `__NEXT_DATA__` 快照,能解出媒体即返回,不抛错.
* options 透传给 normalizeDouyinDetail,否则 SSR 路径会绕过时长上限与画质配置.
*/
const normalizeDouyinSsrHtml = (pageUrl, html, options = {}) => {
	if (!html || html.length < 200) return failure$3("抖音页面快照为空");
	const candidates = [];
	const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]{200,}?)<\/script>/i)?.[1];
	if (nextData) candidates.push(nextData);
	const universal = html.match(/<script[^>]*>self\.__UNIVERSAL_DATA_FOR_REHYDRATION__\s*=\s*([\s\S]{500,}?)<\/script>/i)?.[1];
	if (universal) candidates.push(universal);
	const awemeInline = extractBalancedJson(html, "\"aweme_detail\"");
	if (awemeInline) candidates.push(`{"aweme_detail":${awemeInline}}`);
	for (const raw of candidates) try {
		const result = normalizeDouyinDetail(pageUrl, JSON.parse(raw), options);
		if (!("ok" in result)) return result;
	} catch {}
	return failure$3("抖音页面快照未找到可用媒体");
};
const expandShortUrl$1 = async (url) => {
	if (!url.includes("v.douyin.com")) return url;
	return resolveResolverRedirectUrl(url);
};
const resolveDouyinLive = async (target, url, cookie, ssrHeaders) => {
	const headers = {
		...ssrHeaders,
		...cookie ? { Cookie: cookie } : {}
	};
	const msToken = cookie.match(/(?:^|;\s*)ttwid=([^;]+)/)?.[1] || "";
	let payload;
	try {
		payload = await fetchResolverJson(createDouyinLiveUrl(target.roomId, target.via, msToken), { headers });
	} catch (error) {
		logResolverStage({
			platform: "douyin",
			stage: "api",
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
			url
		});
		return failure$3("直播间信息获取失败，请检查链接或稍后重试");
	}
	const data = asObject$3(asObject$3(payload)?.data);
	const room = target.via === "reflow" ? asObject$3(data?.room) : asObject$3(Array.isArray(data?.data) ? data?.data[0] : void 0);
	if (!room) {
		logResolverStage({
			platform: "douyin",
			stage: "normalize",
			ok: false,
			reason: "live room data missing",
			url
		});
		return failure$3("直播间信息为空，可能未开播或链接已失效");
	}
	const coverList = asObject$3(room.cover)?.url_list;
	const coverUrl = Array.isArray(coverList) ? coverList.filter((item) => typeof item === "string" && Boolean(item.trim())).pop() : void 0;
	const owner = asObject$3(room.owner);
	const onlineText = typeof room.user_count_str === "string" && room.user_count_str.trim() ? room.user_count_str.trim() : Number.isFinite(Number(room.user_count)) && Number(room.user_count) > 0 ? String(Number(room.user_count)) : void 0;
	const statusText = Number(room.status) === 2 ? "正在直播" : "未开播";
	const description = [
		typeof room.title === "string" && room.title.trim() ? `📝 标题：${room.title.trim()}` : "",
		onlineText ? `🏄 在线人数：${onlineText}人正在观看` : "",
		`📺 状态：${statusText}`
	].filter(Boolean).join("\n");
	return {
		platform: "douyin",
		displayName: "抖音直播",
		title: String(room.title || "抖音直播间"),
		description,
		author: typeof owner?.nickname === "string" ? owner.nickname : void 0,
		pageUrl: url,
		videos: [],
		images: coverUrl ? [coverUrl] : [],
		extras: { coverUrl }
	};
};
const resolveDouyin = async (url, cookie, generalApis) => {
	let finalUrl = url;
	try {
		finalUrl = await expandShortUrl$1(url);
	} catch {
		finalUrl = url;
	}
	const normalizeOptions = {
		quality: normalizeQuality(Config.resolver.douyin?.quality),
		maxVideoDurationSeconds: Config.resolver.douyin?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds
	};
	const ssrHeaders = {
		"Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
		Referer: "https://www.douyin.com/"
	};
	const target = classifyDouyinUrl(finalUrl);
	if (target.kind === "live") return resolveDouyinLive(target, finalUrl, cookie, ssrHeaders);
	const awemeId = target.awemeId;
	if (cookie && awemeId) try {
		const headers = {
			...ssrHeaders,
			Cookie: cookie
		};
		const requestUrl = createDouyinDetailUrl(awemeId);
		const result = normalizeDouyinDetail(finalUrl, await fetchResolverJson(requestUrl, { headers }), normalizeOptions);
		if (!("ok" in result)) {
			logResolverStage({
				platform: "douyin",
				stage: "api",
				ok: true,
				url: finalUrl,
				extra: { source: "web-detail" }
			});
			return result;
		}
		logResolverStage({
			platform: "douyin",
			stage: "normalize",
			ok: false,
			reason: result.reason,
			url: finalUrl
		});
	} catch (error) {
		logResolverStage({
			platform: "douyin",
			stage: "api",
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
			url: finalUrl,
			extra: { fallback: "general-api" }
		});
	}
	try {
		const html = await fetchResolverText(finalUrl, {
			maxBytes: 3e6,
			headers: ssrHeaders
		});
		const ssr = normalizeDouyinSsrHtml(finalUrl, html, normalizeOptions);
		if (!("ok" in ssr)) {
			logResolverStage({
				platform: "douyin",
				stage: "api",
				ok: true,
				url: finalUrl,
				extra: { source: "ssr-html" }
			});
			return ssr;
		}
		logResolverStage({
			platform: "douyin",
			stage: "normalize",
			ok: false,
			reason: ssr.reason,
			url: finalUrl,
			extra: { fallback: "general-api" }
		});
	} catch (error) {
		logResolverStage({
			platform: "douyin",
			stage: "api",
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
			url: finalUrl,
			extra: { fallback: "general-api" }
		});
	}
	logResolverStage({
		platform: "douyin",
		stage: "fallback",
		ok: true,
		url: finalUrl,
		extra: { source: "general-api" }
	});
	return resolveByGeneralApis("抖音", finalUrl, generalApis);
};
// src/resolvers/kkkCompat.ts
const kkkDomains = [
	"douyin.com",
	"iesdouyin.com",
	"bilibili.com",
	"b23.tv",
	"bili2233.cn",
	"kuaishou.com",
	"xiaohongshu.com",
	"xhslink.com"
];
const shouldSkipForKkkCompat = (url, kkkCompat) => {
	if (!kkkCompat) return false;
	const hostname = hostnameOf(url);
	if (!hostname) return false;
	return kkkDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
};
[...kkkDomains];
// src/resolvers/kuaishou.ts
const extractKuaishouVideoId = (url) => {
	try {
		const parsed = new URL(url);
		return parsed.pathname.match(/\/short-video\/([^/?]+)/)?.[1] || parsed.pathname.match(/\/fw\/(?:photo|long-video)\/([^/?]+)/)?.[1];
	} catch {
		return;
	}
};
const normalizeKuaishouUrl = async (url, expandUrl = async (input) => input) => {
	const expanded = url.includes("v.kuaishou.com") ? await expandUrl(url) : url;
	const id = extractKuaishouVideoId(expanded);
	return id ? `https://www.kuaishou.com/short-video/${id}` : void 0;
};
const resolveKuaishou = async (url, generalApis) => {
	const normalized = await normalizeKuaishouUrl(url, async (input) => {
		return resolveResolverRedirectUrl(input);
	});
	if (!normalized) return {
		platform: "kuaishou",
		displayName: "快手",
		ok: false,
		reason: "无法识别快手视频 ID"
	};
	return resolveByGeneralApis("快手", normalized, generalApis, {
		platform: "kuaishou",
		pageUrl: normalized
	});
};
// src/resolvers/tieba.ts
const stripHtml$2 = (html) => html.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const imgTagRegExp = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/g;
const imagesFromHtml = (html) => [...html.matchAll(imgTagRegExp)].map((match) => match[1]);
const firstString$2 = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
};
const firstNumber = (...values) => {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
	}
};
const pushUnique$3 = (items, value) => {
	const text = firstString$2(value);
	if (text && !items.includes(text)) items.push(text);
};
const htmlContentBlocks = (html) => {
	const blocks = [];
	let cursor = 0;
	for (const match of html.matchAll(imgTagRegExp)) {
		const index = match.index ?? cursor;
		const text = stripHtml$2(html.slice(cursor, index));
		if (text) blocks.push({
			type: "text",
			text
		});
		if (match[1]) blocks.push({
			type: "image",
			url: match[1]
		});
		cursor = index + match[0].length;
	}
	const rest = stripHtml$2(html.slice(cursor));
	if (rest) blocks.push({
		type: "text",
		text: rest
	});
	return blocks;
};
const dedupeContentBlocks = (blocks) => {
	const seenImages = /* @__PURE__ */ new Set();
	return blocks.filter((block) => {
		if (block.type === "text") return Boolean(block.text);
		if (seenImages.has(block.url)) return false;
		seenImages.add(block.url);
		return true;
	});
};
const appendImageBlocks = (blocks, images) => {
	const known = new Set(blocks.filter((block) => block.type === "image").map((block) => block.url));
	for (const image of images) {
		const url = firstString$2(image);
		if (url && !known.has(url)) {
			blocks.push({
				type: "image",
				url
			});
			known.add(url);
		}
	}
	return blocks;
};
const postAuthorName = (post) => firstString$2(post?.author?.name, post?.author?.nickname, post?.author?.user_name, post?.user?.name, post?.user?.nickname, post?.user_name, post?.username, post?.name) || "匿名用户";
const postFloor = (post) => firstNumber(post?.floor, post?.floor_no, post?.floorNum, post?.floor_num, post?.post_no, post?.postNo, post?.index);
const postLocation = (post) => firstString$2(post?.location, post?.ip_location, post?.ipLocation, post?.ip);
const postTime = (post) => firstString$2(post?.time, post?.create_time, post?.created_at, post?.createAt, post?.date);
const postReplyTo = (post) => firstString$2(post?.replyTo, post?.reply_to, post?.quote_user_name, post?.quoteUserName, post?.reply_user?.name, post?.replyUser?.name);
const forumName = (root, top) => firstString$2(root.forum?.name, root.forum_name, root.thread?.forum?.name, root.thread?.forum_name, top?.forum?.name, top?.forum_name);
/** 贴吧接口没有统一的点赞/回复字段名，按已知别名逐个探测；缺失就不填，避免渲染成 0。 */
const postLikeCount = (post) => firstNumber(post?.like_count, post?.likeCount, post?.agree, post?.agree_num, post?.up, post?.digg_count);
const postReplyCount = (post) => firstNumber(post?.reply_count, post?.replyCount, post?.reply_num, post?.comment_count);
/** R 插件把楼主以外的楼层全部发出；这里保留上限 30 层防止长贴刷屏。 */
const MAX_TIEBA_FLOORS = 30;
const postImages = (post) => {
	const images = [];
	if (!post) return images;
	for (const image of imagesFromHtml(firstString$2(post.content) || "")) pushUnique$3(images, image);
	for (const image of Array.isArray(post.images) ? post.images : []) pushUnique$3(images, image);
	for (const image of Array.isArray(post.imgs) ? post.imgs : []) pushUnique$3(images, image);
	return images;
};
const contentItemImage = (item) => firstString$2(item.cdn_src, item.src, item.url, item.image, item.origin_src, item.originSrc);
const contentItemVideo = (item) => firstString$2(item.link, item.video, item.video_url, item.videoUrl);
const failure$2 = (reason) => ({
	platform: "tieba",
	displayName: "贴吧",
	ok: false,
	reason
});
const normalizeTiebaPost = (url, payload) => {
	const root = payload;
	const thread = root.thread;
	if (!thread) return failure$2("贴吧接口返回异常");
	const rootObject = root;
	const threadObject = thread;
	const posts = root.posts ?? [];
	const images = [
		...imagesFromHtml(thread.content || ""),
		...thread.images ?? [],
		...posts.flatMap((post) => postImages(post))
	].filter(Boolean);
	const floors = posts.slice(0, MAX_TIEBA_FLOORS);
	const comments = floors.slice(0, 10).map((post) => {
		const author = postAuthorName(post);
		const text = stripHtml$2(post.content || "");
		return text ? `${author}：${text}` : "";
	}).filter(Boolean);
	const contentBlocks = dedupeContentBlocks(appendImageBlocks(htmlContentBlocks(thread.content || ""), thread.images ?? []));
	const commentBlocks = floors.map((post) => ({
		author: postAuthorName(post),
		replyTo: postReplyTo(post),
		floor: postFloor(post),
		location: postLocation(post),
		time: postTime(post),
		text: stripHtml$2(post.content || ""),
		images: postImages(post),
		likeCount: postLikeCount(post),
		replyCount: postReplyCount(post)
	})).filter((comment) => comment.text || comment.images.length > 0);
	const dedupedImages = [...new Set(images)];
	const tag = forumName(rootObject, threadObject);
	return {
		platform: "tieba",
		displayName: "贴吧",
		title: thread.title || "贴吧帖子",
		author: thread.author?.name,
		description: [stripHtml$2(thread.content || ""), comments.length > 0 ? `热门回复\n${comments.join("\n")}` : ""].filter(Boolean).join("\n\n"),
		pageUrl: url,
		videos: [],
		images: dedupedImages,
		extras: {
			coverUrl: dedupedImages[0],
			tags: tag ? [tag] : [],
			contentBlocks,
			commentBlocks
		}
	};
};
const normalizeHibiTiebaPost = (url, payload) => {
	const root = payload;
	const posts = root.post_list ?? [];
	const top = posts[0];
	if (!top) return failure$2("贴吧接口返回异常");
	const rootObject = root;
	const images = [];
	const videos = [];
	const normalizeContent = (content = []) => {
		const texts = [];
		for (const item of content) {
			if (item.text) texts.push(item.text);
			pushUnique$3(images, contentItemImage(item));
			pushUnique$3(videos, contentItemVideo(item));
		}
		return texts.join("\n");
	};
	const normalizeBlocks = (content = []) => {
		const blocks = [];
		for (const item of content) {
			if (item.text) blocks.push({
				type: "text",
				text: item.text
			});
			const image = contentItemImage(item);
			if (image) blocks.push({
				type: "image",
				url: image
			});
		}
		return dedupeContentBlocks(blocks);
	};
	const hibiPostImages = (post) => {
		const urls = [];
		for (const item of Array.isArray(post.content) ? post.content : []) pushUnique$3(urls, contentItemImage(item));
		return urls;
	};
	const topText = normalizeContent(top.content);
	const floors = posts.slice(1, 31);
	const comments = floors.slice(0, 10).map((post) => normalizeContent(post.content)).filter(Boolean);
	const contentBlocks = normalizeBlocks(top.content);
	const commentBlocks = floors.map((post) => ({
		author: postAuthorName(post),
		replyTo: postReplyTo(post),
		floor: postFloor(post),
		location: postLocation(post),
		time: postTime(post),
		text: (post.content ?? []).map((item) => item.text).filter(Boolean).join("\n"),
		images: hibiPostImages(post),
		likeCount: postLikeCount(post),
		replyCount: postReplyCount(post)
	})).filter((comment) => comment.text || comment.images.length > 0);
	const tag = forumName(rootObject, top);
	return {
		platform: "tieba",
		displayName: "贴吧",
		title: top.title || "贴吧帖子",
		author: top.author?.name,
		description: [topText, comments.length > 0 ? `热门回复\n${comments.join("\n")}` : ""].filter(Boolean).join("\n\n"),
		pageUrl: url,
		videos: videos.map((url) => ({ url })),
		images,
		extras: {
			coverUrl: images[0],
			tags: tag ? [tag] : [],
			contentBlocks,
			commentBlocks
		}
	};
};
const threadIdFromUrl = (url) => {
	return new URL(url).pathname.match(/\/p\/([A-Za-z0-9]+)/)?.[1];
};
const tiebaApiUrls = (tid) => [`http://0d00.us.kg:8080/api/tieba/post_detail?tid=${encodeURIComponent(tid)}`, `https://api.obfs.dev/api/tieba/post?tid=${encodeURIComponent(tid)}`];
const normalizeTiebaShareCard = (url, shareMeta) => {
	if (!shareMeta) return void 0;
	const title = shareMeta.title || "贴吧帖子";
	const description = shareMeta.desc || "";
	const preview = shareMeta.preview;
	if (!shareMeta.title && !description && !preview) return void 0;
	const contentBlocks = [description ? {
		type: "text",
		text: description
	} : void 0, preview ? {
		type: "image",
		url: preview
	} : void 0].filter(Boolean);
	return {
		platform: "tieba",
		displayName: "贴吧",
		title,
		description,
		pageUrl: shareMeta.jumpUrl || url,
		videos: [],
		images: preview ? [preview] : [],
		extras: {
			coverUrl: preview,
			tags: shareMeta.tag ? [shareMeta.tag] : [],
			contentBlocks
		}
	};
};
const resolveTieba = async (url, generalApis, shareMeta) => {
	const tid = threadIdFromUrl(url);
	if (tid) {
		for (const api of tiebaApiUrls(tid)) try {
			const data = await fetchResolverJson(api);
			if (data.post_list) {
				const hibiResult = normalizeHibiTiebaPost(url, data);
				if (!("ok" in hibiResult)) return hibiResult;
			}
			const result = normalizeTiebaPost(url, data);
			if (!("ok" in result)) return result;
		} catch {}
		try {
			const html = await fetchResolverText(url);
			return {
				platform: "tieba",
				displayName: "贴吧",
				title: stripHtml$2(html.match(/<title>(.*?)<\/title>/i)?.[1] || "贴吧帖子"),
				pageUrl: url,
				videos: [],
				images: imagesFromHtml(html).slice(0, 9)
			};
		} catch {}
	}
	const shareResult = normalizeTiebaShareCard(url, shareMeta);
	if (shareResult) return shareResult;
	return resolveByGeneralApis("贴吧", url, generalApis);
};
// src/resolvers/weibo.ts
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const base62Encode = (value) => {
	if (value === 0) return "0";
	let number = value;
	let result = "";
	while (number > 0) {
		result = alphabet[number % 62] + result;
		number = Math.floor(number / 62);
	}
	return result;
};
const mid2id = (mid) => {
	const reversed = mid.toString().split("").reverse().join("");
	const size = Math.ceil(reversed.length / 7);
	const chunks = [];
	for (let i = 0; i < size; i++) {
		const slice = reversed.slice(i * 7, (i + 1) * 7).split("").reverse().join("");
		let encoded = base62Encode(Number.parseInt(slice, 10));
		if (i < size - 1 && encoded.length < 4) encoded = "0".repeat(4 - encoded.length) + encoded;
		chunks.push(encoded);
	}
	return chunks.reverse().join("");
};
const extractWeiboId = (input) => {
	let parsed;
	try {
		parsed = new URL(input);
	} catch {
		return;
	}
	const path = parsed.pathname;
	const hostname = parsed.hostname.toLowerCase();
	if (hostname === "m.weibo.cn" || hostname.endsWith(".m.weibo.cn")) return path.match(/\/(?:detail|status)\/([A-Za-z0-9]+)/)?.[1] || path.match(/\/[A-Za-z0-9]+\/([A-Za-z0-9]+)/)?.[1];
	const mid = parsed.searchParams.get("mid");
	if (hostname === "weibo.com" || hostname.endsWith(".weibo.com")) {
		if (path.includes("/tv/show") && mid) return /^\d+$/.test(mid) ? mid2id(mid) : mid;
		return path.match(/\/[A-Za-z0-9]+\/([A-Za-z0-9]+)/)?.[1];
	}
};
const stripHtml$1 = (text) => text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").trim();
const asObject$2 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const firstString$1 = (...values) => {
	for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
};
const pushUnique$2 = (items, value) => {
	const url = firstString$1(value);
	if (url && !items.includes(url)) items.push(url);
};
const statusText = (status) => {
	if (!status) return "";
	return stripHtml$1(firstString$1(status.longTextContent, status.long_text?.longTextContent, status.longText?.longTextContent, status.text) || "");
};
const weiboPicUrls = (status) => {
	const images = [];
	if (!status) return images;
	for (const pic of Array.isArray(status.pics) ? status.pics : []) pushUnique$2(images, pic?.large?.url || pic?.largest?.url || pic?.bmiddle?.url || pic?.url);
	const picInfos = asObject$2(status.pic_infos);
	for (const pic of Object.values(picInfos || {})) {
		const item = asObject$2(pic);
		pushUnique$2(images, item?.largest?.url || item?.large?.url || item?.bmiddle?.url || item?.thumbnail?.url);
	}
	return images;
};
const weiboCoverUrl = (status) => {
	if (!status) return void 0;
	const pageInfo = asObject$2(status.page_info);
	const mediaInfo = asObject$2(pageInfo?.media_info);
	return firstString$1(pageInfo?.page_pic?.url, pageInfo?.pic_info?.pic_big?.url, pageInfo?.pic_info?.pic_middle?.url, mediaInfo?.cover_image, mediaInfo?.cover_image_phone, mediaInfo?.poster, mediaInfo?.image);
};
const weiboVideoUrl = (status) => {
	if (!status) return void 0;
	const pageInfo = asObject$2(status.page_info);
	const media = asObject$2(pageInfo?.media_info);
	const videoUrls = asObject$2(pageInfo?.urls);
	return firstString$1(media?.stream_url_hd, media?.stream_url, media?.mp4_hd_url, media?.mp4_sd_url, videoUrls?.mp4_720p_mp4, videoUrls?.mp4_hd_mp4, videoUrls?.mp4_ld_mp4);
};
const weiboAuthorAvatar = (status) => firstString$1(status.user?.avatar_hd, status.user?.avatar_large, status.user?.profile_image_url);
const weiboStatusRequestId = (status, fallback) => firstString$1(status.idstr, typeof status.id === "number" ? String(status.id) : status.id, typeof status.mid === "number" ? String(status.mid) : status.mid, fallback) || fallback;
const parseJsonObjectFrom = (text, start) => {
	const open = text.indexOf("{", start);
	if (open < 0) return void 0;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = open; index < text.length; index++) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") depth--;
		if (depth === 0) try {
			return JSON.parse(text.slice(open, index + 1));
		} catch {
			return;
		}
	}
};
const extractWeiboStatusFromDetailHtml = (html) => {
	const statusKey = html.search(/"status"\s*:/);
	if (statusKey < 0) return void 0;
	const colon = html.indexOf(":", statusKey);
	return parseJsonObjectFrom(html, colon + 1);
};
/** 微博评论接口的 like_count / total_number 常是字符串或缺失，统一成数字，缺失返回 undefined 让渲染层跳过。 */
const commentCount = (value) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
};
const formatCommentTime = (value) => {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return void 0;
	const date = new Date(text);
	if (Number.isNaN(date.getTime())) return text;
	const pad = (part) => String(part).padStart(2, "0");
	return `${String(date.getFullYear()).slice(2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
/** R 插件取 hotflow 前 20 条并展示点赞数、时间和来源；这里同样保留三条元数据，交给发送侧渲染。 */
const normalizeWeiboComments = (payload) => {
	return (payload.data?.data ?? []).slice(0, 20).flatMap((comment) => {
		const text = stripHtml$1(String(comment.text || ""));
		if (!text) return [];
		const block = {
			author: comment.user?.screen_name || "匿名用户",
			text,
			images: []
		};
		const likeCount = commentCount(comment.like_count);
		if (likeCount !== void 0) block.likeCount = likeCount;
		const replyCount = commentCount(comment.total_number);
		if (replyCount !== void 0) block.replyCount = replyCount;
		const time = formatCommentTime(comment.created_at);
		if (time) block.time = time;
		const source = firstString$1(comment.source);
		if (source) block.location = source;
		return [block];
	});
};
/** 卡片摘要里最多列 10 条评论；完整 20 条仍通过 commentBlocks 由发送侧单独转发。 */
const MAX_INLINE_COMMENT_LINES = 10;
const weiboCommentLines = (comments) => comments.slice(0, MAX_INLINE_COMMENT_LINES).map((comment) => {
	const like = comment.likeCount ? ` (👍${comment.likeCount})` : "";
	return `${comment.author}：${comment.text}${like}`;
});
const normalizeWeiboStatus = (url, status, comments = []) => {
	const retweetedStatus = asObject$2(status.retweeted_status);
	const pics = [...weiboPicUrls(status), ...weiboPicUrls(retweetedStatus)];
	const coverUrl = weiboCoverUrl(status) || weiboCoverUrl(retweetedStatus);
	if (coverUrl) pushUnique$2(pics, coverUrl);
	const pageUrl = status.bid ? `https://weibo.com/${status.user?.id || ""}/${status.bid}` : url;
	const video = weiboVideoUrl(status) || weiboVideoUrl(retweetedStatus);
	const text = statusText(status);
	const statusTitle = firstString$1(status.status_title) || "";
	const retweetedText = statusText(retweetedStatus);
	const retweetedAuthor = retweetedStatus?.user?.screen_name;
	const retweetedLine = retweetedStatus ? `转发 @${retweetedAuthor || "原微博"}${retweetedText ? `：${retweetedText}` : ""}` : "";
	const description = [
		text,
		statusTitle,
		retweetedLine,
		[status.source, status.region_name].filter(Boolean).join("	"),
		comments.length > 0 ? `热门评论\n${weiboCommentLines(comments).join("\n")}` : ""
	].filter(Boolean).join("\n\n");
	const extras = {
		contentBlocks: [
			text ? {
				type: "text",
				text
			} : void 0,
			statusTitle && statusTitle !== text ? {
				type: "text",
				text: statusTitle
			} : void 0,
			retweetedLine ? {
				type: "text",
				text: retweetedLine
			} : void 0,
			...pics.map((url) => ({
				type: "image",
				url
			}))
		].filter(Boolean),
		commentBlocks: comments
	};
	if (coverUrl) extras.coverUrl = coverUrl;
	const authorAvatar = weiboAuthorAvatar(status);
	if (authorAvatar) extras.authorAvatar = authorAvatar;
	if (status.region_name) extras.location = String(status.region_name);
	if (status.created_at) extras.createdAt = status.created_at;
	if (retweetedStatus) extras.tags = ["转发"];
	return {
		platform: "weibo",
		displayName: "微博",
		title: statusTitle || text.slice(0, 60),
		description,
		author: status.user?.screen_name,
		pageUrl,
		videos: video ? [{ url: video }] : [],
		images: pics,
		extras
	};
};
const enrichWeiboLongText = async (id, status, headers) => {
	if (!status.isLongText || status.longTextContent || status.longText?.longTextContent || status.long_text?.longTextContent) return status;
	try {
		const longTextContent = (await fetchResolverJson(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`, { headers: {
			...headers,
			"X-Requested-With": "XMLHttpRequest"
		} })).data?.longTextContent;
		return longTextContent ? {
			...status,
			longTextContent
		} : status;
	} catch {
		return status;
	}
};
const voteImagePattern = /https?:\/\/wx\d\.sinaimg\.cn\/[a-z0-9]+\/[^"'\s]+?\.jpg/gi;
/** 投票帖正文没有图片，只有桌面版页面的 HTML 里才有选项图；R 插件同样从这里兜底。 */
const extractWeiboVoteImages = (html) => {
	const images = [];
	for (const match of html.matchAll(voteImagePattern)) {
		const url = match[0];
		if (!/\/(?:bmiddle|large|mw2000|orj\d*)\//.test(url)) continue;
		const normalized = url.replace(/\/bmiddle\//, "/large/").replace(/\/mw2000\//, "/large/").replace(/\/orj\d*\//, "/large/");
		if (!images.includes(normalized)) images.push(normalized);
		if (images.length >= 10) break;
	}
	return images;
};
/** 桌面版页面拿不到时再退回 ajax 接口，只从返回的 JSON 文本里捞 sinaimg 大图。 */
const fetchWeiboVoteImages = async (uid, id, headers) => {
	if (uid) try {
		const html = await fetchResolverText(`https://weibo.com/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`, { headers });
		const images = extractWeiboVoteImages(html);
		if (images.length > 0) return images;
	} catch {}
	try {
		const payload = await fetchResolverJson(`https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(id)}`, { headers });
		return extractWeiboVoteImages(JSON.stringify(payload).replace(/\\\//g, "/"));
	} catch {
		return [];
	}
};
const resolveWeibo = async (url, cookie = "") => {
	const id = extractWeiboId(url);
	if (!id) return {
		platform: "weibo",
		displayName: "微博",
		ok: false,
		reason: "无法识别微博 ID"
	};
	const headers = { Referer: "https://weibo.com/" };
	if (cookie) headers.Cookie = cookie;
	try {
		let status;
		try {
			const html = await fetchResolverText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers });
			status = extractWeiboStatusFromDetailHtml(html);
		} catch {
			status = void 0;
		}
		if (!status) status = (await fetchResolverJson(`https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`, { headers: {
			...headers,
			"X-Requested-With": "XMLHttpRequest"
		} })).data;
		if (!status) throw new Error("微博接口没有返回数据");
		const requestId = weiboStatusRequestId(status, id);
		status = await enrichWeiboLongText(requestId, status, headers);
		let comments = [];
		try {
			const commentData = await fetchResolverJson(`https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(requestId)}&mid=${encodeURIComponent(requestId)}&max_id_type=0`, { headers: {
				...headers,
				"X-Requested-With": "XMLHttpRequest"
			} });
			comments = normalizeWeiboComments(commentData);
		} catch {
			comments = [];
		}
		const result = normalizeWeiboStatus(url, status, comments);
		if (result.images.length === 0 && result.videos.length === 0) {
			const uid = String(status.user?.id || status.user?.idstr || "");
			const voteImages = await fetchWeiboVoteImages(uid, requestId, headers);
			if (voteImages.length > 0) {
				result.images = voteImages;
				result.extras = {
					...result.extras,
					contentBlocks: [...result.extras?.contentBlocks ?? [], ...voteImages.map((image) => ({
						type: "image",
						url: image
					}))]
				};
			}
		}
		return result;
	} catch {
		try {
			const html = await fetchResolverText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers });
			const title = stripHtml$1(html.match(/<title>(.*?)<\/title>/i)?.[1] || "");
			if (title && title !== "微博") return {
				platform: "weibo",
				displayName: "微博",
				title,
				pageUrl: url,
				videos: [],
				images: []
			};
		} catch {}
		return {
			platform: "weibo",
			displayName: "微博",
			ok: false,
			reason: cookie ? "微博页面和接口都没有返回内容，Cookie 可能已失效" : "微博页面和接口都没有返回内容，可尝试配置 resolver.cookies.weibo"
		};
	}
};
// src/resolvers/xiaoheihe.ts
const salt = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
const apiUrls = {
	bbs: "https://api.xiaoheihe.cn/bbs/app/link/tree",
	pc: "https://api.xiaoheihe.cn/game/get_game_detail",
	console: "https://api.xiaoheihe.cn/game/console/get_game_detail",
	mobile: "https://api.xiaoheihe.cn/game/mobile/get_game_detail"
};
const apiPaths = {
	bbs: "bbs/app/link/tree",
	pc: "game/get_game_detail",
	console: "game/console/get_game_detail",
	mobile: "game/mobile/get_game_detail"
};
const md5 = (data) => crypto.createHash("md5").update(data).digest("hex");
const da = (value) => 128 & value ? 255 & (value << 1 ^ 27) : value << 1;
const ba = (value) => da(value) ^ value;
const na = (value) => ba(da(value));
const fa = (value) => na(ba(da(value)));
const ua = (value) => fa(value) ^ na(value) ^ ba(value);
const za = (value, key, length) => {
	let result = "";
	const slice = key.slice(0, length);
	for (const char of value) result += slice[char.charCodeAt(0) % slice.length];
	return result;
};
const wa = (value, key) => {
	let result = "";
	for (const char of value) result += key[char.charCodeAt(0) % key.length];
	return result;
};
const interleave = (items) => {
	let result = "";
	const max = Math.max(...items.map((item) => item.length));
	for (let i = 0; i < max; i++) for (const item of items) if (i < item.length) result += item[i];
	return result;
};
const buildHkey = (path, timestamp, nonce) => {
	const normalizedPath = `/${path.split("/").filter(Boolean).join("/")}/`;
	const seed = interleave([
		za(String(timestamp), salt, -2),
		wa(normalizedPath, salt),
		wa(nonce, salt)
	]).slice(0, 20);
	const hash = md5(seed);
	const chars = hash.slice(-6).split("").map((char) => char.charCodeAt(0));
	const mixed = [
		ua(chars[0]) ^ fa(chars[1]) ^ na(chars[2]) ^ ba(chars[3]),
		ba(chars[0]) ^ ua(chars[1]) ^ fa(chars[2]) ^ na(chars[3]),
		na(chars[0]) ^ ba(chars[1]) ^ ua(chars[2]) ^ fa(chars[3]),
		fa(chars[0]) ^ na(chars[1]) ^ ba(chars[2]) ^ ua(chars[3]),
		chars[4],
		chars[5]
	];
	const suffix = String(mixed.reduce((sum, value) => sum + value, 0) % 100).padStart(2, "0");
	return `${za(hash.substring(0, 5), salt, -4)}${suffix}`;
};
const queryParam = (url, key) => url.searchParams.get(key) || void 0;
const extractXiaoheiheTarget = (input) => {
	let url;
	try {
		url = new URL(input);
	} catch {
		return;
	}
	const path = url.pathname;
	const shareGameType = queryParam(url, "game_type");
	const shareAppId = queryParam(url, "appid");
	if (shareAppId && (shareGameType === "pc" || shareGameType === "console" || shareGameType === "mobile")) return {
		type: shareGameType,
		id: shareAppId
	};
	const shareLinkId = queryParam(url, "link_id");
	if (shareLinkId) return {
		type: "bbs",
		id: shareLinkId
	};
	const bbs = path.match(/\/(?:app\/)?bbs\/link\/([a-zA-Z0-9]+)/);
	if (bbs?.[1]) return {
		type: "bbs",
		id: bbs[1]
	};
	const game = path.match(/\/(?:app\/topic\/)?game\/(pc|console|mobile)\/([a-zA-Z0-9]+)/);
	if (game?.[1] && game[2]) return {
		type: game[1],
		id: game[2]
	};
};
const buildXiaoheiheApiRequest = (type, id, options = {}) => {
	const timestamp = options.timestamp ?? Math.trunc(Date.now() / 1e3);
	const nonce = options.nonce ?? md5(`${timestamp}${Math.random()}`).toUpperCase();
	const path = apiPaths[type];
	const baseParams = {
		os_type: "web",
		version: "999.0.4",
		hkey: buildHkey(path, timestamp + 1, nonce),
		_time: timestamp,
		nonce
	};
	if (type === "bbs") return {
		url: apiUrls.bbs,
		params: {
			...baseParams,
			link_id: id,
			limit: 20,
			web_version: "2.5",
			x_client_type: "web",
			x_app: "heybox_website",
			x_os_type: "Android"
		}
	};
	return {
		url: apiUrls[type],
		params: {
			...baseParams,
			[type === "pc" ? "steam_appid" : "appid"]: id
		}
	};
};
const optimizeXiaoheiheImageUrl = (url) => {
	if (!url) return url;
	return url.includes("?") && !url.endsWith("\\") ? `${url}\\` : url;
};
const asObject$1 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const stripHtml = (html) => {
	return html.replace(/<a[^>]*?href="([^"]*?)"[^>]*?>(.*?)<\/a>/g, (_match, href, text) => {
		const cleanText = text.replace(/<[^>]+>/g, "").trim();
		const cleanHref = normalizeHeyboxHref(href.replace(/\\/g, ""));
		if (!cleanText) return "";
		return cleanHref.startsWith("http") ? `『${cleanText}』 (${cleanHref})` : `『${cleanText}』`;
	}).replace(/<span[^>]*?data-emoji="([^"]*?)"[^>]*?>.*?<\/span>/g, (_match, emoji) => `[${emoji}]`).replace(/<\/p>|<\/h[1-6]>|<\/blockquote>|<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
};
const normalizeHeyboxHref = (href) => {
	const cleanHref = href.replace(/\\/g, "");
	try {
		const match = decodeURIComponent(cleanHref).match(/heybox:\/\/({.*})/);
		if (!match?.[1]) return cleanHref;
		const data = JSON.parse(match[1]);
		if (data.protocol_type === "openUser" && data.user_id) return `https://www.xiaoheihe.cn/app/user/profile/${data.user_id}`;
		if (data.protocol_type === "openGameDetail" && data.app_id) return `https://www.xiaoheihe.cn/app/topic/game/${data.game_type || "pc"}/${data.app_id}`;
		if (data.protocol_type === "openLink" && data.link?.linkid) return `https://www.xiaoheihe.cn/app/bbs/link/${data.link.linkid}`;
	} catch {
		return cleanHref;
	}
	return cleanHref;
};
const pushUnique$1 = (items, value) => {
	const clean = optimizeXiaoheiheImageUrl(value);
	if (clean && !items.includes(clean)) items.push(clean);
};
const pushTextBlock = (blocks, text) => {
	const clean = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
	if (clean) blocks.push({
		type: "text",
		text: clean
	});
};
const pushImageBlock = (blocks, images, url) => {
	const clean = optimizeXiaoheiheImageUrl(url);
	if (!clean) return;
	blocks.push({
		type: "image",
		url: clean
	});
	if (!images.includes(clean)) images.push(clean);
};
const extractIframeUrl = (iframe) => {
	const src = iframe.match(/src="([^"]+)"/)?.[1]?.replace(/\\/g, "");
	if (!src) return void 0;
	return src.startsWith("//") ? `https:${src}` : src;
};
const renderGameCard = (blocks, images, gameId, cards) => {
	const card = cards[gameId];
	if (!card) {
		pushTextBlock(blocks, `相关游戏：https://www.xiaoheihe.cn/app/topic/game/pc/${gameId}`);
		return;
	}
	if (card.cover) pushImageBlock(blocks, images, card.cover);
	const lines = [`🎮 ${card.name || "相关游戏"}`];
	lines.push(`🌟 评分: ${card.score || "暂无评分"}${card.scoreComment ? ` (${card.scoreComment}人)` : ""}`);
	lines.push(`💰 价格: ${card.price || "暂无价格"}`);
	pushTextBlock(blocks, lines.join("\n"));
};
const parseHtmlBlocks = (html, images, cards = {}) => {
	const blocks = [];
	const parts = html.split(/(<img\b[^>]*>|<iframe\b[\s\S]*?<\/iframe>)/gi).filter(Boolean);
	let textBuffer = "";
	for (const part of parts) {
		if (/^<img\b/i.test(part)) {
			pushTextBlock(blocks, stripHtml(textBuffer));
			textBuffer = "";
			const gameId = part.match(/data-gameid="(\d+)"/)?.[1];
			const imageUrl = part.match(/data-original="([^"]+)"/)?.[1] || part.match(/src="([^"]+)"/)?.[1];
			if (gameId) renderGameCard(blocks, images, gameId, cards);
			else pushImageBlock(blocks, images, imageUrl);
			continue;
		}
		if (/^<iframe\b/i.test(part)) {
			pushTextBlock(blocks, stripHtml(textBuffer));
			textBuffer = "";
			const iframeUrl = extractIframeUrl(part);
			if (iframeUrl) pushTextBlock(blocks, `(${iframeUrl})`);
			continue;
		}
		textBuffer += part;
	}
	pushTextBlock(blocks, stripHtml(textBuffer));
	return blocks;
};
const parseTextEntities = (linkText, cards = {}) => {
	const texts = [];
	const images = [];
	const blocks = [];
	if (typeof linkText !== "string" || !/^\s*[\[{]/.test(linkText)) return {
		texts,
		images,
		blocks
	};
	try {
		const entities = JSON.parse(linkText);
		const list = Array.isArray(entities) ? entities : [entities];
		for (const entity of list) {
			if (!entity || typeof entity !== "object") continue;
			if (entity.type === "text" && entity.text) {
				const text = String(entity.text).trim();
				if (text) {
					texts.push(text);
					blocks.push({
						type: "text",
						text
					});
				}
			}
			if (entity.type === "img" && entity.url) pushImageBlock(blocks, images, String(entity.url));
			if (entity.type === "html" && entity.text) {
				const html = String(entity.text);
				const htmlBlocks = parseHtmlBlocks(html, images, cards);
				blocks.push(...htmlBlocks);
				const textOnly = htmlBlocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
				if (textOnly) texts.push(textOnly);
			}
		}
	} catch {
		return {
			texts,
			images,
			blocks
		};
	}
	return {
		texts,
		images,
		blocks
	};
};
const commentNumber = (value) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
};
const normalizeComment = (comment) => {
	const user = comment.user?.username || "匿名用户";
	const location = comment.ip_location ? ` · ${comment.ip_location}` : "";
	const text = stripHtml(String(comment.text || ""));
	return `${comment.floor_num ? `${comment.floor_num}楼 ` : ""}${user}${location}\n${text}`.trim();
};
const normalizeCommentBlock = (comment) => {
	const text = stripHtml(String(comment.text || ""));
	if (!text) return void 0;
	const images = [];
	for (const image of Array.isArray(comment.imgs) ? comment.imgs : []) pushUnique$1(images, image?.url);
	const block = {
		author: comment.user?.username || "匿名用户",
		replyTo: comment.replyuser?.username,
		floor: typeof comment.floor_num === "number" ? comment.floor_num : void 0,
		location: comment.ip_location || void 0,
		time: comment.create_at ? String(comment.create_at) : void 0,
		text,
		images
	};
	const likeCount = commentNumber(comment.up) ?? commentNumber(comment.like_count) ?? commentNumber(comment.like_num);
	if (likeCount !== void 0) block.likeCount = likeCount;
	const replyCount = commentNumber(comment.reply_num) ?? commentNumber(comment.sub_comment_num) ?? commentNumber(comment.comment_num);
	if (replyCount !== void 0) block.replyCount = replyCount;
	return block;
};
const failure$1 = (reason) => ({
	platform: "xiaoheihe",
	displayName: "小黑盒",
	ok: false,
	reason
});
const normalizeXiaoheihePost = (pageUrl, payload, gameCards = {}) => {
	const root = asObject$1(payload);
	const result = asObject$1(root?.result);
	const link = asObject$1(result?.link);
	if (root?.status !== "ok" || !link) return failure$1("小黑盒 API 返回异常");
	const images = [];
	pushUnique$1(images, link.thumb);
	pushUnique$1(images, link.video_thumb);
	const textEntities = parseTextEntities(link.text, gameCards);
	for (const image of textEntities.images) pushUnique$1(images, image);
	const hashtags = objectList(link.hashtags).map((tag) => firstString(tag.name)).filter((tag) => Boolean(tag));
	const contentTags = objectList(link.content_tags).map((tag) => firstString(tag.text)).filter((tag) => Boolean(tag));
	const tags = hashtags.length > 0 ? hashtags : contentTags;
	const flatComments = objectList(result?.comments).flatMap((thread) => objectList(thread.comment));
	flatComments.sort((a, b) => {
		return (commentNumber(a.floor_num) ?? 0) - (commentNumber(b.floor_num) ?? 0);
	});
	const comments = [];
	const commentBlocks = [];
	for (const comment of flatComments.slice(0, 50)) {
		if (comments.length < 10) {
			const normalized = normalizeComment(comment);
			if (normalized) comments.push(normalized);
		}
		const commentBlock = normalizeCommentBlock(comment);
		if (commentBlock) commentBlocks.push(commentBlock);
		for (const image of objectList(comment.imgs)) pushUnique$1(images, firstString(image.url));
	}
	const descriptionParts = [
		link.description,
		tags.length > 0 ? tags.slice(0, 10).map((tag) => `#${tag}`).join(" ") : "",
		...textEntities.texts,
		comments.length > 0 ? `热门评论\n${comments.join("\n\n")}` : ""
	].map((part) => String(part || "").trim()).filter(Boolean);
	return {
		platform: "xiaoheihe",
		displayName: "小黑盒帖子",
		title: link.title || "小黑盒帖子",
		description: descriptionParts.join("\n\n"),
		author: link.user?.username,
		pageUrl,
		videos: link.has_video === 1 && link.video_url ? [{ url: String(link.video_url) }] : [],
		images,
		extras: {
			contentBlocks: textEntities.blocks,
			commentBlocks,
			tags,
			coverUrl: optimizeXiaoheiheImageUrl(link.thumb || link.video_thumb),
			authorAvatar: optimizeXiaoheiheImageUrl(link.user?.avatar || link.user?.avatar_url),
			location: link.ip_location || link.location,
			createdAt: link.create_at ? String(link.create_at) : void 0
		}
	};
};
const firstString = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
};
const objectList = (value) => {
	return (Array.isArray(value) ? value : []).map(asObject$1).filter((item) => Boolean(item));
};
const menuValue = (game, menuType) => {
	const menu = objectList(game.menu_v2);
	return firstString(menu.find((item) => item.type === menuType)?.value);
};
const gameDataValue = (list, desc) => {
	const item = objectList(list).find((entry) => entry.desc === desc);
	return firstString(item?.value, item?.text);
};
/**
* `price` 是对象（`{ current, initial, discount, lowest_price }`），直接插值就是 `[object Object]`；
* PC 取 `price.current`，主机取首个地区价，字符串/数字价格是旧接口残留，保留兼容。
*/
const gamePriceText = (game, type) => {
	const price = asObject$1(game.price);
	const current = firstString(price?.current, game.current_price);
	if (type === "pc" && current && current !== "0") return `¥${current}`;
	const region = Array.isArray(game.region_prices) ? asObject$1(game.region_prices[0]) : void 0;
	const regionAmount = firstString(region?.final_amount);
	if (regionAmount) return `${regionAmount} (${firstString(region?.region_name) || "地区"})`;
	if (current) return type === "pc" ? `¥${current}` : current;
	if (typeof game.price === "string" || typeof game.price === "number") return String(game.price);
};
/** 帖子正文里 `data-gameid` 的内嵌游戏卡 id（去重，最多 3 个，避免一条帖子打 9 次接口）。 */
const extractXiaoheiheGameIds = (linkText) => {
	if (typeof linkText !== "string" || !/^\s*[\[{]/.test(linkText)) return [];
	try {
		const entities = JSON.parse(linkText);
		const list = Array.isArray(entities) ? entities : [entities];
		const ids = [];
		for (const entity of list) {
			const item = asObject$1(entity);
			if (!item || item.type !== "html" || typeof item.text !== "string") continue;
			for (const match of item.text.matchAll(/data-gameid="(\d+)"/g)) {
				if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
				if (ids.length >= 3) return ids;
			}
		}
		return ids;
	} catch {
		return [];
	}
};
const buildXiaoheiheGameCard = (payload, type) => {
	const root = asObject$1(payload);
	if (root?.status !== "ok") return void 0;
	const result = asObject$1(root.result);
	const game = asObject$1(result?.game) ?? asObject$1(result?.detail) ?? result;
	if (!game) return void 0;
	const commentStats = asObject$1(game.comment_stats);
	const card = {
		name: firstString(game.name, game.game_name, game.title),
		score: firstString(game.score, game.rating, game.heybox_score),
		scoreComment: commentNumber(commentStats?.score_comment),
		price: gamePriceText(game, type),
		cover: optimizeXiaoheiheImageUrl(firstString(game.image, game.cover, game.header_image, game.icon))
	};
	return card.name || card.score ? card : void 0;
};
const gamePriceLines = (game, type) => {
	const lines = [];
	const price = asObject$1(game.price);
	if (type === "pc" && price) {
		const current = firstString(price.current);
		const initial = firstString(price.initial);
		if (current && current !== initial) lines.push(`• 当前价格: ¥${current} (原价: ¥${initial}, -${firstString(price.discount) || 0}%)`);
		else if (current) lines.push(`• 当前价格: ¥${current}`);
		const lowest = firstString(price.lowest_price);
		if (lowest) lines.push(`• 史低价格: ¥${lowest} (-${firstString(price.lowest_discount) || 0}%)`);
		const deadline = firstString(price.deadline_date);
		if (deadline) lines.push(`• 优惠截止: ${deadline}`);
		const heyboxPrice = asObject$1(game.heybox_price);
		const coin = Number(heyboxPrice?.cost_coin);
		if (Number.isFinite(coin) && coin > 0) {
			lines.push(`• 小黑盒商城: ${coin / 1e3} 盒币`);
			const discount = Number(heyboxPrice?.discount);
			if (Number.isFinite(discount) && discount > 0) lines.push(`  (折扣: -${discount}%, 原价: ${Number(heyboxPrice?.original_coin) / 1e3} 盒币)`);
		}
	}
	const regions = objectList(game.region_prices);
	if (type === "console" && regions.length > 0) {
		const regionLines = regions.map((region) => {
			const finalAmount = firstString(region?.final_amount) || "-";
			const initialAmount = firstString(region?.initial_amount);
			let line = `${firstString(region?.region_name) || "地区"}: `;
			line += initialAmount && initialAmount !== finalAmount ? `${finalAmount} (原价: ${initialAmount}, -${firstString(region?.discount) || 0}%)` : finalAmount;
			const lowest = firstString(region?.lowest_price);
			if (lowest && lowest !== finalAmount) line += ` / 史低: ${lowest}`;
			return line;
		});
		lines.push(`🌐 地区价格:\n  ${regionLines.join("\n  ")}`);
	}
	return lines;
};
const gameCommunityLines = (game) => {
	const lines = [];
	const score = firstString(game.score, game.rating, game.heybox_score);
	const commentStats = asObject$1(game.comment_stats);
	if (score) lines.push(`• 小黑盒评分: ${score} (${firstString(commentStats?.score_comment) || 0}人评价)`);
	const star5 = Number(commentStats?.star_5);
	if (Number.isFinite(star5) && star5 > 0) lines.push(`• 玩家好评率: ${(star5 / 100).toLocaleString("en-US", { style: "percent" })}`);
	const radar = asObject$1(game.multidimensional_score_radar);
	const dimensions = objectList(radar?.dimension_list);
	if (dimensions.length > 0) {
		lines.push("• 多维度评分:");
		for (const dimension of dimensions) lines.push(`  - ${firstString(dimension.dimension_name) || "维度"}: ${firstString(dimension.score) || "-"}`);
	}
	const tags = (objectList(game.common_tags).length > 0 ? objectList(game.common_tags) : objectList(game.hot_tags)).map((tag) => firstString(tag.desc)).filter(Boolean).map((tag) => `#${tag}`);
	if (tags.length > 0) lines.push(`• 热门标签: ${tags.join(" ")}`);
	const userGameData = asObject$1(game.user_num)?.game_data;
	for (const [desc, suffix] of [
		["小黑盒玩家数", ""],
		["平均游戏时间", ""],
		["当前在线", "人"],
		["昨日峰值在线", "人"]
	]) {
		const value = gameDataValue(userGameData, desc);
		if (value) lines.push(`• ${desc}: ${value}${suffix}`);
	}
	for (const desc of ["热门排名", "关注数"]) {
		const value = gameDataValue(game.game_data, desc);
		if (value) lines.push(`• ${desc}: ${value}`);
	}
	return lines;
};
const gameSteamDeckLine = (game) => {
	const steamTag = objectList(game.common_tags).find((tag) => tag.type === "steam_aggre");
	const deck = objectList(steamTag?.detail_list).find((item) => item.name === "支持Steam Deck");
	return firstString(deck?.desc);
};
const normalizeXiaoheiheGame = (pageUrl, type, payload) => {
	const root = asObject$1(payload);
	const result = asObject$1(root?.result);
	const game = asObject$1(result?.game) ?? asObject$1(result?.detail) ?? result;
	if (root?.status !== "ok" || !game) return failure$1("小黑盒游戏 API 返回异常");
	const images = [];
	const videos = [];
	const contentBlocks = [];
	const name = firstString(game.name, game.game_name, game.title) || "小黑盒游戏";
	const nameEn = firstString(game.name_en);
	const cover = firstString(game.image, game.cover, game.header_image, game.icon);
	if (cover) pushUnique$1(images, cover);
	const score = firstString(game.score, game.rating, game.heybox_score);
	const commentStats = asObject$1(game.comment_stats);
	const priceText = gamePriceText(game, type);
	const platforms = Array.isArray(game.platforms) ? game.platforms.map((item) => firstString(item)).filter(Boolean).join(" / ") : firstString(game.platform, type === "pc" ? "PC" : void 0);
	const description = [
		firstString(game.desc, game.description, game.intro),
		nameEn ? `英文名：${nameEn}` : "",
		score !== void 0 ? `评分：${score} (${firstString(commentStats?.score_comment) || 0}人评价)` : "",
		priceText !== void 0 ? `价格：${priceText}` : "",
		platforms ? `平台：${platforms}` : ""
	].filter(Boolean).join("\n");
	const gameInfo = [];
	gameInfo.push(`• 中文名: ${name}`);
	if (nameEn) gameInfo.push(`• 英文名: ${nameEn}`);
	const releaseDate = menuValue(game, "release_date");
	if (releaseDate) gameInfo.push(`• 发行日期: ${releaseDate}`);
	const developer = menuValue(game, "developer");
	if (developer) gameInfo.push(`• 开发商: ${developer}`);
	const publisher = menuValue(game, "publisher");
	const publishers = publisher ? publisher.split("/").map((item) => item.trim()).filter(Boolean) : (Array.isArray(game.publishers) ? game.publishers : []).map((item) => firstString(item?.value)).filter(Boolean);
	if (publishers.length > 0) gameInfo.push(`• 发行商: ${publishers.join(", ")}`);
	if (platforms) gameInfo.push(`• 支持平台: ${platforms}`);
	const qqGroup = menuValue(game, "qq");
	if (qqGroup) gameInfo.push(`• QQ交流群: ${qqGroup}`);
	pushTextBlock(contentBlocks, `--- ✨ 游戏信息 ✨ ---\n${gameInfo.join("\n")}`);
	const awards = objectList(game.game_award);
	if (awards.length > 0) {
		const awardLines = awards.map((award) => {
			return `• ${firstString(award.detail_name) || "奖项"}${award.desc ? ` (${award.desc})` : ""}`;
		});
		pushTextBlock(contentBlocks, `--- 🏆 游戏奖项 🏆 ---\n${awardLines.join("\n")}`);
	}
	const priceLines = gamePriceLines(game, type);
	if (priceLines.length > 0) pushTextBlock(contentBlocks, `--- 💰 价格信息 💰 ---\n${priceLines.join("\n")}`);
	const communityLines = gameCommunityLines(game);
	if (communityLines.length > 0) pushTextBlock(contentBlocks, `--- 🌟 社区评价 🌟 ---\n${communityLines.join("\n")}`);
	const steamDeck = gameSteamDeckLine(game);
	if (steamDeck) pushTextBlock(contentBlocks, `--- 🎮 兼容性信息 🎮 ---\n• Steam Deck: ${steamDeck}`);
	const dlc = menuValue(game, "dlc");
	if (dlc) pushTextBlock(contentBlocks, `--- 🧩 DLCs信息 🧩 ---\n• ${dlc} (点击原链接查看详情)`);
	const about = firstString(game.about_the_game);
	if (about) pushTextBlock(contentBlocks, `--- 📖 游戏简介 📖 ---\n${stripHtml(about)}`);
	const screenshots = objectList(game.screenshots);
	const shotImages = screenshots.filter((item) => item.type === "image").map((item) => optimizeXiaoheiheImageUrl(firstString(item.url, item.thumbnail))).filter((image) => Boolean(image));
	if (shotImages.length > 0) {
		pushTextBlock(contentBlocks, "--- 🖼️ 游戏截图 🖼️ ---");
		for (const image of shotImages) pushImageBlock(contentBlocks, images, image);
	}
	const movie = screenshots.find((item) => item.type === "movie" && item.url);
	if (movie?.url) videos.push(String(movie.url));
	return {
		platform: "xiaoheihe",
		displayName: "小黑盒游戏",
		title: name,
		description,
		pageUrl,
		videos: videos.map((url) => ({ url })),
		images,
		extras: {
			coverUrl: cover,
			contentBlocks,
			tags: nameEn ? [nameEn] : []
		}
	};
};
const toQueryString = (params) => {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) search.set(key, String(value));
	return search.toString();
};
const fetchXiaoheiheGameCard = async (gameId, cookie) => {
	return (await Promise.all([
		"pc",
		"console",
		"mobile"
	].map(async (type) => {
		try {
			const request = buildXiaoheiheApiRequest(type, gameId);
			const payload = await fetchResolverJson(`${request.url}?${toQueryString(request.params)}`, { headers: { Cookie: cookie } });
			return buildXiaoheiheGameCard(payload, type);
		} catch {
			return;
		}
	}))).find((card) => Boolean(card));
};
const resolveXiaoheihe = async (url, cookie = "") => {
	if (!cookie) return failure$1("需要在 resolver.yaml 配置 xiaoheihe Cookie");
	const target = extractXiaoheiheTarget(url);
	if (!target) return failure$1("无法识别小黑盒链接类型");
	const request = buildXiaoheiheApiRequest(target.type, target.id);
	const payload = await fetchResolverJson(`${request.url}?${toQueryString(request.params)}`, { headers: { Cookie: cookie } });
	if (target.type !== "bbs") return normalizeXiaoheiheGame(url, target.type, payload);
	const link = asObject$1(asObject$1(asObject$1(payload)?.result)?.link);
	const gameCards = {};
	await Promise.all(extractXiaoheiheGameIds(link?.text).map(async (gameId) => {
		const card = await fetchXiaoheiheGameCard(gameId, cookie);
		if (card) gameCards[gameId] = card;
	}));
	return normalizeXiaoheihePost(url, payload, gameCards);
};
// src/resolvers/xiaohongshu.ts
const failure = (reason) => ({
	platform: "xiaohongshu",
	displayName: "小红书",
	ok: false,
	reason
});
const asObject = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const pushUnique = (items, value) => {
	if (typeof value === "string" && value.trim() && !items.includes(value)) items.push(value);
};
const pushUniqueMany = (items, value) => {
	if (Array.isArray(value)) {
		for (const item of value) pushUnique(items, item);
		return;
	}
	pushUnique(items, value);
};
const compactString = (value) => typeof value === "string" ? value.trim() : "";
const bestImageUrl = (image) => {
	return selectBestImageUrl([
		compactString(image.urlDefault),
		compactString(image.url),
		compactString(image.urlPre)
	]);
};
const xiaohongshuTags = (note) => {
	const tags = [];
	for (const tag of Array.isArray(note.tagList) ? note.tagList : []) {
		const value = compactString(tag?.name || tag?.tagName);
		if (value && !tags.includes(value)) tags.push(value);
	}
	return tags;
};
const extractXiaohongshuNoteId = (url) => {
	try {
		return new URL(url).pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/)?.[1];
	} catch {
		return;
	}
};
const looksLikeNote = (value) => {
	const note = asObject(value);
	if (!note) return false;
	return Boolean(note.title || note.desc || note.imageList || note.video);
};
const selectFromNoteDetailMap = (value, noteId) => {
	const noteDetailMap = asObject(value);
	if (!noteDetailMap) return void 0;
	const firstDetail = (noteId ? asObject(noteDetailMap[noteId]) : void 0) ?? asObject(Object.values(noteDetailMap)[0]);
	return asObject(firstDetail?.note) ?? firstDetail;
};
const selectNote = (payload, noteId) => {
	const root = asObject(payload);
	const noteContainer = asObject(root?.note);
	return selectFromNoteDetailMap(root?.noteDetailMap, noteId) ?? selectFromNoteDetailMap(root?.state?.note?.noteDetailMap, noteId) ?? selectFromNoteDetailMap(noteContainer?.noteDetailMap, noteId) ?? (looksLikeNote(noteContainer) ? noteContainer : void 0);
};
const normalizeXiaohongshuNote = (pageUrl, payload) => {
	const note = selectNote(payload, extractXiaohongshuNoteId(pageUrl));
	if (!note) return failure("小红书页面数据异常");
	const images = [];
	const videos = [];
	for (const image of Array.isArray(note.imageList) ? note.imageList : []) {
		const imageObject = asObject(image);
		if (imageObject) pushUnique(images, bestImageUrl(imageObject));
	}
	const normalizedImages = dedupeImageUrls(images);
	images.splice(0, images.length, ...normalizedImages);
	const stream = asObject(note.video?.media?.stream);
	for (const item of Array.isArray(stream?.h264) ? stream.h264 : []) {
		pushUniqueMany(videos, item?.backupUrls);
		pushUniqueMany(videos, item?.backupUrl);
		pushUnique(videos, item?.masterUrl);
	}
	for (const item of Array.isArray(stream?.h265) ? stream.h265 : []) {
		pushUniqueMany(videos, item?.backupUrls);
		pushUniqueMany(videos, item?.backupUrl);
		pushUnique(videos, item?.masterUrl);
	}
	if (images.length === 0 && videos.length === 0) return failure("未找到小红书媒体资源");
	const videoFallback = (compactString(note.type).toLowerCase() === "video" || Boolean(note.video)) && videos.length === 0 && images.length > 0 ? "视频资源暂不可用，已降级为封面和原链接。" : "";
	const description = [String(note.desc || ""), videoFallback].filter(Boolean).join("\n");
	const contentBlocks = [description.trim() ? {
		type: "text",
		text: description
	} : void 0, ...images.map((url) => ({
		type: "image",
		url
	}))].filter(Boolean);
	const tags = xiaohongshuTags(note);
	const authorAvatar = compactString(note.user?.avatar || note.user?.image || note.user?.imageUrl);
	return {
		platform: "xiaohongshu",
		displayName: "小红书笔记",
		title: String(note.title || "小红书笔记"),
		description,
		author: note.user?.nickname,
		pageUrl,
		videos: videos.map((url) => ({ url })),
		images,
		extras: {
			coverUrl: images[0],
			contentBlocks,
			tags,
			authorAvatar: authorAvatar || void 0,
			createdAt: note.time || note.createTime
		}
	};
};
const parseEmbeddedJson = (html) => {
	for (const pattern of [/<script[^>]+id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/i, /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/i]) {
		const raw = html.match(pattern)?.[1]?.trim();
		if (!raw) continue;
		try {
			return JSON.parse(raw.replace(/undefined/g, "null"));
		} catch {
			continue;
		}
	}
};
const expandShortUrl = async (url) => {
	if (!url.includes("xhslink.com")) return url;
	return resolveResolverRedirectUrl(url);
};
const resolveXiaohongshu = async (url, cookie = "") => {
	logResolverStage({
		platform: "xiaohongshu",
		stage: "cookie",
		ok: Boolean(cookie),
		cookie
	});
	if (!cookie) return failure("需要在 resolver.yaml 配置 xiaohongshu Cookie");
	let finalUrl = url;
	try {
		finalUrl = await expandShortUrl(url);
		logResolverStage({
			platform: "xiaohongshu",
			stage: "prepare",
			ok: true,
			url: finalUrl
		});
	} catch {
		finalUrl = url;
		logResolverStage({
			platform: "xiaohongshu",
			stage: "prepare",
			ok: false,
			reason: "short url expand failed",
			url
		});
	}
	if (!extractXiaohongshuNoteId(finalUrl)) {
		logResolverStage({
			platform: "xiaohongshu",
			stage: "match",
			ok: false,
			reason: "missing note id",
			url: finalUrl
		});
		return failure("无法识别小红书笔记 ID");
	}
	const html = await fetchResolverText(finalUrl, { headers: {
		Cookie: cookie,
		Referer: "https://www.xiaohongshu.com/"
	} });
	logResolverStage({
		platform: "xiaohongshu",
		stage: "api",
		ok: true,
		url: finalUrl,
		cookie,
		extra: { source: "web-html" }
	});
	const state = parseEmbeddedJson(html);
	if (!state) {
		logResolverStage({
			platform: "xiaohongshu",
			stage: "normalize",
			ok: false,
			reason: "embedded state missing",
			url: finalUrl
		});
		return failure("小红书页面数据异常");
	}
	const result = normalizeXiaohongshuNote(finalUrl, state);
	logResolverStage({
		platform: "xiaohongshu",
		stage: "normalize",
		ok: !("ok" in result),
		reason: "ok" in result ? result.reason : void 0,
		url: finalUrl
	});
	return result;
};
// src/resolvers/controller.ts
const isPlatformEnabled = (platform) => Config.resolver.platforms[platform] !== false;
const resolveMatched = async (url, message = "") => {
	const match = matchResolver(url);
	if (!match) return {
		platform: "general",
		displayName: "通用解析",
		ok: false,
		reason: "暂不支持该链接"
	};
	const config = Config.resolver;
	const shareMeta = extractShareCardMeta(message);
	if (match.platform === "bilibili") return resolveBilibili(url, config.cookies.bilibili);
	if (match.platform === "douyin") return resolveDouyin(url, config.cookies.douyin, config.generalApis);
	if (match.platform === "weibo") return resolveWeibo(url, config.cookies.weibo);
	if (match.platform === "tieba") return resolveTieba(url, config.generalApis, shareMeta);
	if (match.platform === "xiaoheihe") return resolveXiaoheihe(url, config.cookies.xiaoheihe);
	if (match.platform === "xiaohongshu") return resolveXiaohongshu(url, config.cookies.xiaohongshu);
	if (match.platform === "kuaishou") return resolveKuaishou(url, config.generalApis);
	return resolveGeneral(url, config.generalApis);
};
const handleResolverMessage = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.resolver.enabled) return next?.();
	const url = extractFirstUrl(e.msg);
	if (!url) return next?.();
	if (shouldSkipForKkkCompat(url, Config.resolver.kkkCompat)) return next?.();
	const match = matchResolver(url);
	if (!match) return next?.();
	if (!isPlatformEnabled(match.platform)) {
		logResolverStage({
			platform: match.platform,
			stage: "match",
			ok: false,
			reason: "platform disabled",
			url
		});
		return next?.();
	}
	logResolverStage({
		platform: match.platform,
		stage: "match",
		ok: true,
		url
	});
	const result = await resolveMatched(url, e.msg).catch((error) => ({
		platform: match.platform,
		displayName: match.displayName,
		ok: false,
		reason: error instanceof Error ? error.message : String(error)
	}));
	logResolverStage({
		platform: match.platform,
		stage: "normalize",
		ok: !("ok" in result),
		reason: "ok" in result ? result.reason : void 0,
		url
	});
	await replyResolvedPost(e, result);
	logResolverStage({
		platform: match.platform,
		stage: "send",
		ok: true,
		url
	});
	return true;
};
// src/apps/resolvers.ts
const jsonCardPrefixPattern = String.raw`\s*(?:\{\s*"|\[\s*[{"]|\[json:)`;
/**
* 命令层只做廉价预筛：消息里出现链接本身即可，是否由 Hira 处理交给 controller 的
* `extractFirstUrl` + `matchResolver` 决定，避免这里维护第二份平台域名表。
* JSON 卡片需要额外出现可解析域名，避免吞掉其它插件分享的音乐卡片。
* 裸 BV/AcFun 编号（无链接纯文本分享）也放行，由 controller 的裸 ID 补全承接；
* 字符集与 `expandBareShareId` 保持一致，预筛放过但补全不出的组合不存在。
*/
const bareShareIdPattern = String.raw`(?<![0-9A-Za-z])(?:BV[1-9A-HJ-NP-Za-km-z]{10}(?![0-9A-Za-z])(?!\.\w{1,4}\b)|ac\d{6,}(?![0-9A-Za-z]))`;
const resolverReg = new RegExp(String.raw`^(?:${jsonCardPrefixPattern}[\s\S]*https?:\/\/[^\s"'<>]*(?:${RESOLVER_DOMAIN_PATTERN})|(?!${jsonCardPrefixPattern})[\s\S]*(?:https?:\/\/[^\s"'<>]+|${bareShareIdPattern}))`, "i");
const resolvers = karin.command(resolverReg, handleResolverMessage, { name: "Hira-多平台解析" });
export { resolvers as n, resolverReg as t };

//# sourceMappingURL=resolvers.js.map