import { n as isHiraAppEnabled, r as Config } from "./runtime.js";
import { m as selectBestImageUrl, u as dedupeImageUrls } from "./cardRender.js";
import { a as replyResolvedPost } from "./message.js";
import { n as fetchText, t as fetchJson } from "./http.js";
import { n as downloadFile, t as runFfmpeg } from "./ffmpeg.js";
import { n as createTempFilePath } from "./temp.js";
import karin, { logger } from "node-karin";
import crypto from "node:crypto";
//#region src/resolvers/resolverLog.ts
const sensitiveKeyPattern = /cookie|authorization|token|secret|session|auth/i;
const valueText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const safeHost = (url) => {
	if (!url) return void 0;
	try {
		return new URL(url).host;
	} catch {
		return;
	}
};
const safeExtraEntries = (extra) => Object.entries(extra || {}).filter(([key]) => !sensitiveKeyPattern.test(key)).map(([key, value]) => `extra.${key}=${valueText(value)}`);
const buildResolverStageLog = (options) => {
	const parts = [
		`[resolver:${options.platform}]`,
		`stage=${options.stage}`,
		`ok=${options.ok}`
	];
	if (options.reason) parts.push(`reason=${valueText(options.reason)}`);
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
//#endregion
//#region src/resolvers/bilibili.ts
const failure$5 = (reason) => ({
	platform: "bilibili",
	displayName: "哔哩哔哩",
	ok: false,
	reason
});
const asObject$5 = (value) => {
	return typeof value === "object" && value !== null ? value : void 0;
};
const bvidPattern = /BV[0-9A-Za-z]{10}/i;
const extractBvid = (url) => {
	return url.match(bvidPattern)?.[0];
};
const formatStat = (label, value) => {
	return typeof value === "number" ? `${label}：${value}` : "";
};
const getMediaUrl = (value) => {
	const item = asObject$5(value);
	const url = item?.url || item?.baseUrl || item?.base_url || item?.backupUrl?.[0] || item?.backup_url?.[0];
	return typeof url === "string" && url ? url : void 0;
};
const mediaFallbackMessage = "视频资源暂不可用，已降级为封面和原链接。";
const appendDescription = (result, message) => ({
	...result,
	description: [result.description, message].filter(Boolean).join("\n")
});
const validCodecPreferences = new Set([
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
const codecPreferenceRank = (codecs, preference) => {
	if (preference === "auto") {
		const family = codecFamily(codecs);
		if (family === "hevc") return 0;
		if (family === "av1") return 1;
		if (family === "avc") return 2;
		return 3;
	}
	return codecFamily(codecs) === preference ? 0 : 1;
};
const selectBilibiliDurl = (payload) => {
	const root = asObject$5(payload);
	const data = asObject$5(root?.data);
	if (Number(root?.code) !== 0 || !data) return void 0;
	return getMediaUrl((Array.isArray(data.durl) ? data.durl : [])[0]);
};
const selectBestBilibiliStream = (streams, codecPreference = "auto", maxQuality) => {
	const preference = normalizeCodecPreference(codecPreference);
	const candidates = streams.map((stream) => {
		const item = asObject$5(stream);
		return {
			id: Number(item?.id ?? item?.quality ?? 0),
			bandwidth: Number(item?.bandwidth ?? 0),
			codecs: String(item?.codecs || ""),
			url: getMediaUrl(item)
		};
	}).filter((item) => Boolean(item.url));
	const quality = Number(maxQuality);
	const qualityCandidates = Number.isFinite(quality) && quality > 0 ? candidates.filter((item) => item.id <= quality) : candidates;
	return (qualityCandidates.length > 0 ? qualityCandidates : candidates).sort((left, right) => codecPreferenceRank(left.codecs, preference) - codecPreferenceRank(right.codecs, preference) || right.id - left.id || left.bandwidth - right.bandwidth)[0];
};
const selectBilibiliDash = (payload, codecPreference, maxQuality) => {
	const dash = asObject$5(asObject$5(asObject$5(payload)?.data)?.dash);
	const videos = Array.isArray(dash?.video) ? dash.video : [];
	const audios = Array.isArray(dash?.audio) ? dash.audio : [];
	const video = selectBestBilibiliStream(videos, codecPreference, maxQuality);
	const audio = selectBestBilibiliStream(audios, "auto");
	return video && audio ? {
		videoUrl: video.url,
		audioUrl: audio.url
	} : void 0;
};
const createBilibiliPlayUrl = (bvid, cid, quality = 64) => {
	const url = new URL("https://api.bilibili.com/x/player/playurl");
	url.searchParams.set("bvid", bvid);
	url.searchParams.set("cid", String(cid));
	url.searchParams.set("qn", String(Math.trunc(normalizeNumber$1(quality, 64))));
	url.searchParams.set("fnval", "16");
	url.searchParams.set("fnver", "0");
	url.searchParams.set("fourk", "1");
	return url.toString();
};
const resolveDashVideo = async (media, headers) => {
	const timeoutMs = Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1e3;
	const videoInput = createTempFilePath("bilibili", "m4s");
	const audioInput = createTempFilePath("bilibili", "m4s");
	const output = createTempFilePath("bilibili", "mp4");
	await Promise.all([downloadFile({
		url: media.videoUrl,
		output: videoInput,
		headers,
		timeoutMs
	}), downloadFile({
		url: media.audioUrl,
		output: audioInput,
		headers,
		timeoutMs
	})]);
	return runFfmpeg({
		format: "merge",
		videoInput,
		audioInput,
		output
	});
};
const resolveProgressiveVideo = async (url, headers) => {
	const timeoutMs = Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1e3;
	const rawVideo = await downloadFile({
		url,
		output: createTempFilePath("bilibili", "mp4"),
		headers,
		timeoutMs
	});
	try {
		return await runFfmpeg({
			input: rawVideo,
			output: createTempFilePath("bilibili", "mp4"),
			format: "qq-video"
		});
	} catch {
		return rawVideo;
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
	const root = asObject$5(payload);
	const data = asObject$5(root?.data);
	if (Number(root?.code) !== 0 || !data) return failure$5(String(root?.message || "B站接口返回异常"));
	const stat = asObject$5(data.stat);
	const desc = String(data.desc || "").trim();
	const coverUrl = typeof data.pic === "string" && data.pic.trim() ? data.pic.trim() : void 0;
	const owner = asObject$5(data.owner);
	const authorAvatar = typeof owner?.face === "string" && owner.face.trim() ? owner.face.trim() : void 0;
	const tag = typeof data.tname === "string" && data.tname.trim() ? data.tname.trim() : void 0;
	const contentBlocks = [desc ? {
		type: "text",
		text: desc
	} : void 0, coverUrl ? {
		type: "image",
		url: coverUrl
	} : void 0].filter((item) => Boolean(item));
	const description = [desc, stat ? [
		formatStat("播放", stat.view),
		formatStat("点赞", stat.like),
		formatStat("评论", stat.reply)
	].filter(Boolean).join(" | ") : ""].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
	const bvid = String(data.bvid || extractBvid(pageUrl) || "");
	return {
		platform: "bilibili",
		displayName: "哔哩哔哩",
		title: String(data.title || "B站视频"),
		description,
		author: typeof owner?.name === "string" ? owner.name : void 0,
		pageUrl: bvid ? `https://www.bilibili.com/video/${bvid}` : pageUrl,
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
	const parsed = new URL(url);
	if (parsed.hostname !== "b23.tv" && parsed.hostname !== "bili2233.cn") return url;
	return (await fetch(url, { redirect: "follow" })).url || url;
};
const resolveBilibili = async (url, cookie = "") => {
	let finalUrl = url;
	try {
		finalUrl = await expandShortUrl$2(url);
	} catch {
		finalUrl = url;
	}
	const bvid = extractBvid(finalUrl);
	if (!bvid) return failure$5("无法识别 BVID");
	const headers = { Referer: "https://www.bilibili.com/" };
	if (cookie) headers.Cookie = cookie;
	const payload = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers });
	const result = normalizeBilibiliVideoInfo(finalUrl, payload);
	if ("ok" in result) return result;
	const data = asObject$5(asObject$5(payload)?.data);
	const cid = data?.cid;
	const duration = Number(data?.duration ?? 0);
	const resolverConfig = Config.resolver;
	const bilibiliConfig = resolverConfig.bilibili;
	const maxDuration = normalizeNumber$1(bilibiliConfig?.maxVideoDurationSeconds ?? resolverConfig.maxVideoDurationSeconds, 480);
	if (maxDuration > 0 && duration > maxDuration) return {
		...result,
		description: [result.description, `视频时长 ${duration} 秒，超过当前下载上限 ${maxDuration} 秒，仅返回视频信息。`].filter(Boolean).join("\n")
	};
	if (!cid) return result;
	const pageUrl = result.pageUrl || finalUrl;
	const mediaHeaders = {
		...headers,
		Referer: pageUrl
	};
	const quality = normalizeNumber$1(bilibiliConfig?.quality, 64);
	const codec = normalizeCodecPreference(bilibiliConfig?.codec);
	const playUrl = createBilibiliPlayUrl(bvid, String(cid), quality);
	let playPayload;
	try {
		playPayload = await fetchJson(playUrl, { headers: mediaHeaders });
	} catch (error) {
		return fallbackFromMediaFailure(result, error, playUrl);
	}
	const dash = selectBilibiliDash(playPayload, codec, quality);
	if (!dash) {
		const durl = selectBilibiliDurl(playPayload);
		if (!durl) return result;
		try {
			const video = await resolveProgressiveVideo(durl, mediaHeaders);
			return {
				...result,
				videos: [video]
			};
		} catch (error) {
			return fallbackFromMediaFailure(result, error, durl);
		}
	}
	try {
		const video = await resolveDashVideo(dash, mediaHeaders);
		return {
			...result,
			videos: [video]
		};
	} catch (error) {
		return fallbackFromMediaFailure(result, error, dash.videoUrl);
	}
};
//#endregion
//#region src/resolvers/general.ts
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
const firstString$2 = (...values) => {
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
	const title = firstString$2(data.title, data.name);
	const description = firstString$2(data.desc, data.description, data.content, data.text, data.summary);
	const author = firstString$2(data.author, authorObject?.name, authorObject?.nickname, data.authorName, data.author_name, data.nickname, data.userName, data.user_name, userObject?.name, userObject?.nickname);
	const authorAvatar = firstString$2(data.avatar, data.authorAvatar, data.author_avatar, authorObject?.avatar, authorObject?.face, userObject?.avatar, userObject?.face);
	const coverCandidates = [
		data.cover,
		data.coverUrl,
		data.cover_url,
		data.pic,
		data.picture,
		data.thumbnail,
		data.thumb
	].flatMap(stringValues);
	const images = dedupeImageUrls(coverCandidates.concat(stringValues(data.images), stringValues(data.imageUrl), stringValues(data.image_url), stringValues(data.pics), stringValues(data.picUrls), stringValues(data.pic_urls), stringValues(data.imgurl)));
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
		videos,
		images,
		extras: {
			coverUrl,
			...authorAvatar ? { authorAvatar } : {},
			contentBlocks
		}
	};
};
const defaultFetchJson = async (requestUrl) => {
	return (await fetch(requestUrl)).json();
};
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
			lastFailure = failure$4(displayName, error instanceof Error ? error.message : String(error), options.platform);
		}
	}
	return lastFailure;
};
//#endregion
//#region src/resolvers/douyin.ts
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
const pushUniqueVideo = (items, value) => {
	const url = firstVideoUrl(value);
	if (url && !items.includes(url)) items.push(url);
};
const validDouyinQualities = new Set([
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
		const sizeLimitBytes = 100 * 1024 * 1024;
		for (const level of douyinQualityPriority) {
			const item = videosByQuality.get(level)?.find((video) => {
				const size = normalizeBytes(video.play_addr?.data_size);
				return size === 0 || size <= sizeLimitBytes;
			});
			const url = firstPlayAddrVideoUrl(item?.play_addr, quality);
			if (url) return url;
		}
		return firstPlayAddrVideoUrl(mp4Videos.reduce((current, item) => {
			const currentSize = normalizeBytes(current.play_addr?.data_size);
			const itemSize = normalizeBytes(item.play_addr?.data_size);
			if (currentSize === 0) return item;
			if (itemSize === 0) return current;
			return itemSize < currentSize ? item : current;
		}, mp4Videos[0]).play_addr, quality);
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
const normalizeDouyinDetail = (pageUrl, payload, options = {}) => {
	const root = asObject$3(payload);
	const detail = asObject$3(root?.aweme_detail) ?? asObject$3(root?.data?.aweme_detail);
	if (!detail) return failure$3("抖音接口返回异常");
	const images = [];
	const videos = [];
	const quality = normalizeQuality(options.quality);
	const maxVideoDurationSeconds = normalizeNumber(options.maxVideoDurationSeconds, 0);
	let limitMessage = "";
	for (const image of Array.isArray(detail.images) ? detail.images : []) {
		pushUnique$4(images, image?.url_list);
		const imageVideo = asObject$3(image?.video);
		if (imageVideo) pushUniqueVideo(videos, selectDouyinVideoUrl(imageVideo, quality));
	}
	const video = asObject$3(detail.video);
	if (video) {
		pushUnique$4(images, video.cover?.url_list);
		pushUnique$4(images, video.origin_cover?.url_list);
		const durationMs = normalizeNumber(video.duration, 0);
		const durationSeconds = durationMs > 1e3 ? Math.trunc(durationMs / 1e3) : durationMs;
		if (maxVideoDurationSeconds > 0 && durationSeconds > maxVideoDurationSeconds) limitMessage = `视频时长 ${durationSeconds} 秒，超过当前下载上限 ${maxVideoDurationSeconds} 秒，仅返回视频信息。`;
		else pushUniqueVideo(videos, selectDouyinVideoUrl(video, quality));
	}
	if (images.length === 0 && videos.length === 0) return failure$3("未找到抖音媒体资源");
	return {
		platform: "douyin",
		displayName: "抖音",
		title: String(detail.desc || "抖音作品"),
		description: [String(detail.desc || ""), limitMessage].filter(Boolean).join("\n"),
		author: detail.author?.nickname,
		pageUrl,
		videos,
		images
	};
};
const expandShortUrl$1 = async (url) => {
	if (!url.includes("v.douyin.com")) return url;
	return (await fetch(url, { redirect: "follow" })).url || url;
};
const downloadDouyinVideos = async (result, headers) => {
	if (result.videos.length === 0) return result;
	const timeoutMs = Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1e3;
	const videos = [];
	let failedDownloads = 0;
	for (const videoUrl of result.videos) try {
		const rawVideo = await downloadFile({
			url: videoUrl,
			output: createTempFilePath("douyin", "mp4"),
			headers,
			timeoutMs
		});
		try {
			videos.push(await runFfmpeg({
				input: rawVideo,
				output: createTempFilePath("douyin", "mp4"),
				format: "qq-video"
			}));
		} catch {
			videos.push(rawVideo);
		}
	} catch {
		failedDownloads += 1;
		logResolverStage({
			platform: "douyin",
			stage: "media",
			ok: false,
			reason: "video download failed",
			url: videoUrl,
			extra: { fallback: "cover-link-only" }
		});
	}
	if (failedDownloads === 0) return {
		...result,
		videos
	};
	const downloadMessage = videos.length > 0 ? "部分视频下载失败，已跳过不可用视频。" : "视频下载失败，已仅返回作品信息。";
	logResolverStage({
		platform: "douyin",
		stage: "fallback",
		ok: true,
		url: result.pageUrl,
		extra: { source: videos.length > 0 ? "partial-video-download" : "cover-link-only" }
	});
	return {
		...result,
		videos,
		description: [result.description, downloadMessage].filter(Boolean).join("\n")
	};
};
const resolveDouyin = async (url, cookie, generalApis) => {
	let finalUrl = url;
	try {
		finalUrl = await expandShortUrl$1(url);
	} catch {
		finalUrl = url;
	}
	const awemeId = extractDouyinAwemeId(finalUrl);
	if (cookie && awemeId) try {
		const douyinConfig = Config.resolver.douyin;
		const headers = {
			"Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
			Referer: "https://www.douyin.com/",
			Cookie: cookie
		};
		const requestUrl = createDouyinDetailUrl(awemeId);
		const result = normalizeDouyinDetail(finalUrl, await fetchJson(requestUrl, { headers }), {
			quality: normalizeQuality(douyinConfig?.quality),
			maxVideoDurationSeconds: douyinConfig?.maxVideoDurationSeconds ?? Config.resolver.maxVideoDurationSeconds
		});
		if (!("ok" in result)) {
			logResolverStage({
				platform: "douyin",
				stage: "api",
				ok: true,
				url: finalUrl,
				extra: { source: "web-detail" }
			});
			return downloadDouyinVideos(result, headers);
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
	logResolverStage({
		platform: "douyin",
		stage: "fallback",
		ok: true,
		url: finalUrl,
		extra: { source: "general-api" }
	});
	return resolveByGeneralApis("抖音", finalUrl, generalApis);
};
//#endregion
//#region src/resolvers/url.ts
const trailingPunctuation = /[，。！？、；;,.!?]+$/;
const normalizeSharedUrl = (url) => {
	return url.replaceAll("\\/", "/").replace(/^https:(?!\/\/)\//, "https://").replace(/^http:(?!\/\/)\//, "http://").replace(trailingPunctuation, "");
};
const parseJsonObjectFrom$1 = (text, start) => {
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
const stringField = (value) => typeof value === "string" && value ? value : void 0;
const extractShareCardMeta = (message) => {
	const marker = message.indexOf("[json:");
	const news = parseJsonObjectFrom$1(message, marker >= 0 ? marker + 6 : 0)?.meta?.news;
	if (!news || typeof news !== "object") return void 0;
	const jumpUrl = stringField(news.jumpUrl || news.url);
	const meta = {
		jumpUrl: jumpUrl ? normalizeSharedUrl(jumpUrl) : void 0,
		title: stringField(news.title),
		desc: stringField(news.desc),
		preview: stringField(news.preview),
		tag: stringField(news.tag)
	};
	return Object.values(meta).some(Boolean) ? meta : void 0;
};
const extractFirstUrl = (message) => {
	const shareMeta = extractShareCardMeta(message);
	if (shareMeta?.jumpUrl) return shareMeta.jumpUrl;
	return normalizeSharedUrl(message).match(/https?:\/\/[^\s"'<>]+/)?.[0]?.replace(trailingPunctuation, "");
};
const hostnameOf = (url) => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return;
	}
};
//#endregion
//#region src/resolvers/kkkCompat.ts
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
//#endregion
//#region src/resolvers/kuaishou.ts
const extractKuaishouVideoId = (url) => {
	try {
		const parsed = new URL(url);
		return parsed.pathname.match(/\/short-video\/([^/?]+)/)?.[1] || parsed.pathname.match(/\/fw\/(?:photo|long-video)\/([^/?]+)/)?.[1];
	} catch {
		return;
	}
};
const normalizeKuaishouUrl = async (url, expandUrl = async (input) => input) => {
	const id = extractKuaishouVideoId(url.includes("v.kuaishou.com") ? await expandUrl(url) : url);
	return id ? `https://www.kuaishou.com/short-video/${id}` : void 0;
};
const resolveKuaishou = async (url, generalApis) => {
	const normalized = await normalizeKuaishouUrl(url, async (input) => {
		return (await fetch(input, { redirect: "follow" })).url || input;
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
//#endregion
//#region src/resolvers/matcher.ts
const rules = [
	{
		platform: "bilibili",
		displayName: "哔哩哔哩",
		test: (_url, hostname) => [
			"bilibili.com",
			"b23.tv",
			"bili2233.cn"
		].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
	},
	{
		platform: "douyin",
		displayName: "抖音",
		test: (_url, hostname) => ["douyin.com", "iesdouyin.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
	},
	{
		platform: "kuaishou",
		displayName: "快手",
		test: (_url, hostname) => ["kuaishou.com", "chenzhongtech.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
	},
	{
		platform: "xiaohongshu",
		displayName: "小红书",
		test: (_url, hostname) => ["xiaohongshu.com", "xhslink.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
	},
	{
		platform: "weibo",
		displayName: "微博",
		test: (_url, hostname) => hostname === "weibo.com" || hostname.endsWith(".weibo.com")
	},
	{
		platform: "tieba",
		displayName: "贴吧",
		test: (url, hostname) => hostname === "tieba.baidu.com" && /\/p\/\d+/i.test(url)
	},
	{
		platform: "xiaoheihe",
		displayName: "小黑盒",
		test: (_url, hostname) => hostname === "xiaoheihe.cn" || hostname.endsWith(".xiaoheihe.cn")
	},
	{
		platform: "general",
		displayName: "通用解析",
		test: (_url, hostname) => [
			"ixigua.com",
			"pipix.com",
			"pipigx.com",
			"xsj.qq.com",
			"okjike.com"
		].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
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
//#endregion
//#region src/resolvers/tieba.ts
const stripHtml$2 = (html) => html.replace(/<img[^>]+src="([^"]+)"[^>]*>/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const imgTagRegExp = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/g;
const imagesFromHtml = (html) => [...html.matchAll(imgTagRegExp)].map((match) => match[1]);
const firstString$1 = (...values) => {
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
	const text = firstString$1(value);
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
		const url = firstString$1(image);
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
const postAuthorName = (post) => firstString$1(post?.author?.name, post?.author?.nickname, post?.author?.user_name, post?.user?.name, post?.user?.nickname, post?.user_name, post?.username, post?.name) || "匿名用户";
const postFloor = (post) => firstNumber(post?.floor, post?.floor_no, post?.floorNum, post?.floor_num, post?.post_no, post?.postNo, post?.index);
const postLocation = (post) => firstString$1(post?.location, post?.ip_location, post?.ipLocation, post?.ip);
const postTime = (post) => firstString$1(post?.time, post?.create_time, post?.created_at, post?.createAt, post?.date);
const postReplyTo = (post) => firstString$1(post?.replyTo, post?.reply_to, post?.quote_user_name, post?.quoteUserName, post?.reply_user?.name, post?.replyUser?.name);
const forumName = (root, top) => firstString$1(root.forum?.name, root.forum_name, root.thread?.forum?.name, root.thread?.forum_name, top?.forum?.name, top?.forum_name);
const postImages = (post) => {
	const images = [];
	if (!post) return images;
	for (const image of imagesFromHtml(firstString$1(post.content) || "")) pushUnique$3(images, image);
	for (const image of Array.isArray(post.images) ? post.images : []) pushUnique$3(images, image);
	for (const image of Array.isArray(post.imgs) ? post.imgs : []) pushUnique$3(images, image);
	return images;
};
const contentItemImage = (item) => firstString$1(item.cdn_src, item.src, item.url, item.image, item.origin_src, item.originSrc);
const contentItemVideo = (item) => firstString$1(item.link, item.video, item.video_url, item.videoUrl);
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
	const comments = posts.slice(0, 5).map((post) => {
		const author = postAuthorName(post);
		const text = stripHtml$2(post.content || "");
		return text ? `${author}：${text}` : "";
	}).filter(Boolean);
	const contentBlocks = dedupeContentBlocks(appendImageBlocks(htmlContentBlocks(thread.content || ""), thread.images ?? []));
	const commentBlocks = posts.slice(0, 5).map((post) => ({
		author: postAuthorName(post),
		replyTo: postReplyTo(post),
		floor: postFloor(post),
		location: postLocation(post),
		time: postTime(post),
		text: stripHtml$2(post.content || ""),
		images: postImages(post)
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
	const comments = posts.slice(1, 6).map((post) => normalizeContent(post.content)).filter(Boolean);
	const contentBlocks = normalizeBlocks(top.content);
	const commentBlocks = posts.slice(1, 6).map((post) => ({
		author: postAuthorName(post),
		replyTo: postReplyTo(post),
		floor: postFloor(post),
		location: postLocation(post),
		time: postTime(post),
		text: (post.content ?? []).map((item) => item.text).filter(Boolean).join("\n"),
		images: hibiPostImages(post)
	})).filter((comment) => comment.text || comment.images.length > 0);
	const tag = forumName(rootObject, top);
	return {
		platform: "tieba",
		displayName: "贴吧",
		title: top.title || "贴吧帖子",
		author: top.author?.name,
		description: [topText, comments.length > 0 ? `热门回复\n${comments.join("\n")}` : ""].filter(Boolean).join("\n\n"),
		pageUrl: url,
		videos,
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
			const data = await fetchJson(api);
			if (data.post_list) {
				const hibiResult = normalizeHibiTiebaPost(url, data);
				if (!("ok" in hibiResult)) return hibiResult;
			}
			const result = normalizeTiebaPost(url, data);
			if (!("ok" in result)) return result;
		} catch {}
		try {
			const html = await fetchText(url);
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
//#endregion
//#region src/resolvers/weibo.ts
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
const firstString = (...values) => {
	for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
};
const pushUnique$2 = (items, value) => {
	const url = firstString(value);
	if (url && !items.includes(url)) items.push(url);
};
const statusText = (status) => {
	if (!status) return "";
	return stripHtml$1(firstString(status.longTextContent, status.long_text?.longTextContent, status.longText?.longTextContent, status.text) || "");
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
	return firstString(pageInfo?.page_pic?.url, pageInfo?.pic_info?.pic_big?.url, pageInfo?.pic_info?.pic_middle?.url, mediaInfo?.cover_image, mediaInfo?.cover_image_phone, mediaInfo?.poster, mediaInfo?.image);
};
const weiboVideoUrl = (status) => {
	if (!status) return void 0;
	const pageInfo = asObject$2(status.page_info);
	const media = asObject$2(pageInfo?.media_info);
	const videoUrls = asObject$2(pageInfo?.urls);
	return firstString(media?.stream_url_hd, media?.stream_url, media?.mp4_hd_url, media?.mp4_sd_url, videoUrls?.mp4_720p_mp4, videoUrls?.mp4_hd_mp4, videoUrls?.mp4_ld_mp4);
};
const weiboAuthorAvatar = (status) => firstString(status.user?.avatar_hd, status.user?.avatar_large, status.user?.profile_image_url);
const weiboStatusRequestId = (status, fallback) => firstString(status.idstr, typeof status.id === "number" ? String(status.id) : status.id, typeof status.mid === "number" ? String(status.mid) : status.mid, fallback) || fallback;
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
	return parseJsonObjectFrom(html, html.indexOf(":", statusKey) + 1);
};
const normalizeWeiboComments = (payload) => {
	return (payload.data?.data ?? []).slice(0, 5).map((comment) => {
		const user = comment.user?.screen_name || "匿名用户";
		const text = stripHtml$1(comment.text || "");
		return text ? `${user}：${text}` : "";
	}).filter(Boolean);
};
const weiboCommentBlocks = (comments) => comments.map((comment) => {
	const separator = comment.indexOf("：");
	if (separator <= 0) return {
		author: "匿名用户",
		text: comment,
		images: []
	};
	return {
		author: comment.slice(0, separator),
		text: comment.slice(separator + 1),
		images: []
	};
}).filter((comment) => comment.text);
const normalizeWeiboStatus = (url, status, comments = []) => {
	const retweetedStatus = asObject$2(status.retweeted_status);
	const pics = [...weiboPicUrls(status), ...weiboPicUrls(retweetedStatus)];
	const coverUrl = weiboCoverUrl(status) || weiboCoverUrl(retweetedStatus);
	if (coverUrl) pushUnique$2(pics, coverUrl);
	const pageUrl = status.bid ? `https://weibo.com/${status.user?.id || ""}/${status.bid}` : url;
	const video = weiboVideoUrl(status) || weiboVideoUrl(retweetedStatus);
	const text = statusText(status);
	const retweetedText = statusText(retweetedStatus);
	const retweetedAuthor = retweetedStatus?.user?.screen_name;
	const retweetedLine = retweetedStatus ? `转发 @${retweetedAuthor || "原微博"}${retweetedText ? `：${retweetedText}` : ""}` : "";
	const description = [
		text,
		retweetedLine,
		[status.source, status.region_name].filter(Boolean).join("	"),
		comments.length > 0 ? `热门评论\n${comments.join("\n")}` : ""
	].filter(Boolean).join("\n\n");
	const extras = {
		contentBlocks: [
			text ? {
				type: "text",
				text
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
		commentBlocks: weiboCommentBlocks(comments)
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
		title: text.slice(0, 60),
		description,
		author: status.user?.screen_name,
		pageUrl,
		videos: video ? [video] : [],
		images: pics,
		extras
	};
};
const enrichWeiboLongText = async (id, status, headers) => {
	if (!status.isLongText || status.longTextContent || status.longText?.longTextContent || status.long_text?.longTextContent) return status;
	try {
		const longTextContent = (await fetchJson(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`, { headers: {
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
			status = extractWeiboStatusFromDetailHtml(await fetchText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers }));
		} catch {
			status = void 0;
		}
		if (!status) status = (await fetchJson(`https://m.weibo.cn/statuses/show?id=${encodeURIComponent(id)}`, { headers: {
			...headers,
			"X-Requested-With": "XMLHttpRequest"
		} })).data;
		if (!status) throw new Error("empty api data");
		const requestId = weiboStatusRequestId(status, id);
		status = await enrichWeiboLongText(requestId, status, headers);
		let comments = [];
		try {
			comments = normalizeWeiboComments(await fetchJson(`https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(requestId)}&mid=${encodeURIComponent(requestId)}&max_id_type=0`, { headers: {
				...headers,
				"X-Requested-With": "XMLHttpRequest"
			} }));
		} catch {
			comments = [];
		}
		return normalizeWeiboStatus(url, status, comments);
	} catch {
		return {
			platform: "weibo",
			displayName: "微博",
			title: stripHtml$1((await fetchText(`https://m.weibo.cn/detail/${encodeURIComponent(id)}`, { headers })).match(/<title>(.*?)<\/title>/i)?.[1] || "微博"),
			pageUrl: url,
			videos: [],
			images: []
		};
	}
};
//#endregion
//#region src/resolvers/xiaoheihe.ts
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
	const hash = md5(interleave([
		za(String(timestamp), salt, -2),
		wa(normalizedPath, salt),
		wa(nonce, salt)
	]).slice(0, 20));
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
const parseHtmlBlocks = (html, images) => {
	const blocks = [];
	const parts = html.split(/(<img\b[^>]*>|<iframe\b[\s\S]*?<\/iframe>)/gi).filter(Boolean);
	let textBuffer = "";
	for (const part of parts) {
		if (/^<img\b/i.test(part)) {
			pushTextBlock(blocks, stripHtml(textBuffer));
			textBuffer = "";
			const gameId = part.match(/data-gameid="(\d+)"/)?.[1];
			const imageUrl = part.match(/data-original="([^"]+)"/)?.[1] || part.match(/src="([^"]+)"/)?.[1];
			if (gameId) pushTextBlock(blocks, `相关游戏：https://www.xiaoheihe.cn/app/topic/game/pc/${gameId}`);
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
const parseTextEntities = (linkText) => {
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
				const htmlBlocks = parseHtmlBlocks(String(entity.text), images);
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
	for (const image of comment.imgs ?? []) pushUnique$1(images, image.url);
	return {
		author: comment.user?.username || "匿名用户",
		replyTo: comment.replyuser?.username,
		floor: typeof comment.floor_num === "number" ? comment.floor_num : void 0,
		location: comment.ip_location || void 0,
		time: comment.create_at ? String(comment.create_at) : void 0,
		text,
		images
	};
};
const failure$1 = (reason) => ({
	platform: "xiaoheihe",
	displayName: "小黑盒",
	ok: false,
	reason
});
const normalizeXiaoheihePost = (pageUrl, payload) => {
	const root = asObject$1(payload);
	const result = asObject$1(root?.result);
	const link = asObject$1(result?.link);
	if (root?.status !== "ok" || !link) return failure$1("小黑盒 API 返回异常");
	const images = [];
	pushUnique$1(images, link.thumb);
	pushUnique$1(images, link.video_thumb);
	const textEntities = parseTextEntities(link.text);
	for (const image of textEntities.images) pushUnique$1(images, image);
	const tags = Array.isArray(link.hashtags) ? link.hashtags.map((tag) => tag.name).filter(Boolean) : Array.isArray(link.content_tags) ? link.content_tags.map((tag) => tag.text).filter(Boolean) : [];
	const comments = [];
	const commentBlocks = [];
	const commentThreads = Array.isArray(result?.comments) ? result.comments : [];
	if (commentThreads.length > 0) for (const thread of commentThreads.slice(0, 5)) {
		const threadComments = Array.isArray(thread.comment) ? thread.comment : [];
		for (const comment of threadComments.slice(0, 2)) {
			const normalized = normalizeComment(comment);
			if (normalized) comments.push(normalized);
			const commentBlock = normalizeCommentBlock(comment);
			if (commentBlock && commentBlocks.length < 50) commentBlocks.push(commentBlock);
			for (const image of comment.imgs ?? []) pushUnique$1(images, image.url);
		}
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
		videos: link.has_video === 1 && link.video_url ? [link.video_url] : [],
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
const normalizeXiaoheiheGame = (pageUrl, type, payload) => {
	const root = asObject$1(payload);
	const result = asObject$1(root?.result);
	const game = asObject$1(result?.game) ?? asObject$1(result?.detail) ?? result;
	if (root?.status !== "ok" || !game) return failure$1("小黑盒游戏 API 返回异常");
	const name = game.name || game.game_name || game.title || "小黑盒游戏";
	const score = game.score ?? game.rating ?? game.heybox_score;
	const price = game.price ?? game.current_price;
	const platforms = Array.isArray(game.platforms) ? game.platforms.join(" / ") : game.platform || (type === "pc" ? "PC" : type);
	const description = [
		game.desc || game.description || game.intro,
		score !== void 0 ? `评分：${score}` : "",
		price !== void 0 ? `价格：${price}` : "",
		platforms ? `平台：${platforms}` : ""
	].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
	return {
		platform: "xiaoheihe",
		displayName: "小黑盒游戏",
		title: String(name),
		description,
		pageUrl,
		videos: [],
		images: [game.cover || game.image || game.header_image || game.icon].filter(Boolean)
	};
};
const toQueryString = (params) => {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) search.set(key, String(value));
	return search.toString();
};
const resolveXiaoheihe = async (url, cookie = "") => {
	if (!cookie) return failure$1("需要在 resolver.yaml 配置 xiaoheihe Cookie");
	const target = extractXiaoheiheTarget(url);
	if (!target) return failure$1("无法识别小黑盒链接类型");
	const request = buildXiaoheiheApiRequest(target.type, target.id);
	const payload = await fetchJson(`${request.url}?${toQueryString(request.params)}`, { headers: { Cookie: cookie } });
	if (target.type !== "bbs") return normalizeXiaoheiheGame(url, target.type, payload);
	return normalizeXiaoheihePost(url, payload);
};
//#endregion
//#region src/resolvers/xiaohongshu.ts
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
		videos,
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
	return (await fetch(url, { redirect: "follow" })).url || url;
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
	const html = await fetchText(finalUrl, { headers: {
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
//#endregion
//#region src/resolvers/controller.ts
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
	return resolveByGeneralApis(match.displayName, url, config.generalApis, {
		platform: "general",
		pageUrl: url
	});
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
//#endregion
//#region src/apps/resolvers.ts
const resolverDomainPattern = [
	"bilibili\\.com",
	"b23\\.tv",
	"bili2233\\.cn",
	"douyin\\.com",
	"iesdouyin\\.com",
	"kuaishou\\.com",
	"chenzhongtech\\.com",
	"xiaohongshu\\.com",
	"xhslink\\.com",
	"weibo\\.com",
	"tieba\\.baidu\\.com",
	"xiaoheihe\\.cn",
	"ixigua\\.com",
	"pipix\\.com",
	"pipigx\\.com",
	"xsj\\.qq\\.com",
	"okjike\\.com"
].join("|");
const jsonCardPrefixPattern = String.raw`\s*(?:\{\s*"|\[\s*[{"]|\[json:)`;
const resolverReg = new RegExp(String.raw`^(?:${jsonCardPrefixPattern}[\s\S]*https?:\/\/[^\s"'<>]*?(?:${resolverDomainPattern})|(?!${jsonCardPrefixPattern})[\s\S]*https?:\/\/[^\s"'<>]+)`, "i");
const resolvers = karin.command(resolverReg, handleResolverMessage, {
	name: "Hira-多平台解析",
	priority: Config.resolver.priority
});
//#endregion
export { resolvers as n, resolverReg as t };

//# sourceMappingURL=resolvers.js.map