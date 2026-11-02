import { _ as resolveRedirectUrl, g as readResponseBytes, h as fetchText, l as formatArtists, m as fetchResponse, p as fetchJson, t as Config } from "./config.js";
import { a as buildResolverPreviewCardHtml, c as logCardRenderFailure, d as dedupeRichContentBlocks, f as imageQuality, i as buildResolverCardHtml, l as renderCardImage, p as isUsableImageUrl, r as buildMusicListCardHtml, t as buildErrorCardHtml, u as dedupeImageUrls } from "./cardRender.js";
import { common, logger, segment } from "node-karin";
import * as fs$1 from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
// src/services/musicCard.ts
const cardChannels = [
	"platform",
	"ark",
	"music"
];
const arkRequiredFields = [
	"app",
	"meta",
	"prompt",
	"view"
];
const recentLimit = 20;
const causeLimit = 120;
const arkMaxBytes = 262144;
const breakers = /* @__PURE__ */ new Map();
const stats = {
	platform: {
		ok: 0,
		fail: 0,
		skip: 0
	},
	ark: {
		ok: 0,
		fail: 0,
		skip: 0
	},
	music: {
		ok: 0,
		fail: 0,
		skip: 0
	}
};
const recent = [];
const now = () => Date.now();
/**
* `Config.music.card` 是 getter，每次访问都会重读 YAML（fs 读 + parse + merge）。
* 一次点歌要判断多个通道，所以入口快照一次往下传，别再各读各的。
*/
const cardConfig = () => Config.music.card;
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const trimCause = (cause) => cause.replace(/\s+/g, " ").trim().slice(0, causeLimit);
const isCardChannel = (value) => cardChannels.includes(String(value));
/** 配置里的通道顺序，非法或为空时回落成只走 music */
const cardChannelOrder = (card = cardConfig()) => {
	const configured = card.channels;
	const order = (Array.isArray(configured) ? configured : []).filter(isCardChannel);
	return order.length ? order : ["music"];
};
/**
* 熔断只作用于可观测通道（ark）。platform / music 是哑通道，协议端静默丢弃元素时插件无从感知，
* 所以它们只做异常计数，不参与熔断。
*/
const breakerState = (channel) => {
	const current = breakers.get(channel);
	if (current) return current;
	const created = {
		failures: 0,
		blockedUntil: 0
	};
	breakers.set(channel, created);
	return created;
};
const channelBlocked = (channel, card = cardConfig()) => {
	if (channel !== "ark") return false;
	const state = breakerState(channel);
	const { failThreshold, cooldownSeconds } = card.breaker;
	if (state.failures < Math.max(1, failThreshold)) return false;
	if (now() < state.blockedUntil) return true;
	state.failures = 0;
	state.blockedUntil = 0;
	state.lastCause = void 0;
	logger.info("[Hira-卡片] 通道=ark 熔断冷却结束，恢复尝试");
	return false;
};
const pushRecent = (record) => {
	recent.unshift(record);
	if (recent.length > recentLimit) recent.length = recentLimit;
};
const recordSuccess = (channel, ms, title) => {
	const state = breakerState(channel);
	state.failures = 0;
	state.blockedUntil = 0;
	state.lastCause = void 0;
	stats[channel].ok += 1;
	pushRecent({
		at: now(),
		channel,
		ok: true,
		ms,
		title
	});
	logger.info(`[Hira-卡片] 通道=${channel} 结果=ok 耗时=${ms}ms 曲目=${title}`);
};
const recordFailure = (channel, cause, ms, title, card) => {
	const trimmed = trimCause(cause);
	stats[channel].fail += 1;
	pushRecent({
		at: now(),
		channel,
		ok: false,
		ms,
		title,
		cause: trimmed
	});
	logger.warn(`[Hira-卡片] 通道=${channel} 结果=fail 耗时=${ms}ms 曲目=${title} cause=${trimmed}`);
	if (channel !== "ark") return;
	const state = breakerState(channel);
	state.failures += 1;
	state.lastCause = trimmed;
	const { failThreshold, cooldownSeconds } = card.breaker;
	if (state.failures >= Math.max(1, failThreshold)) {
		state.blockedUntil = now() + Math.max(10, cooldownSeconds) * 1e3;
		logger.warn(`[Hira-卡片] 通道=ark 连续失败 ${state.failures} 次，熔断 ${cooldownSeconds}s`);
	}
};
const recordSkip = (channel, title, reason, log = true) => {
	stats[channel].skip += 1;
	if (log) logger.info(`[Hira-卡片] 通道=${channel} 结果=skip 曲目=${title} 原因=${reason}`);
};
const musicText = (playable) => {
	const artists = formatArtists(playable.item.artists);
	return `${playable.item.title} - ${artists}\n${playable.item.pageUrl}`;
};
const arkFormat = (source, card) => {
	const value = card.ark.formats[source];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
};
const platformType = (source, card) => {
	const value = card.platform.types[source];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
};
const platformSkipReason = (playable, card) => {
	if (!card.platform.enabled) return "通道已关闭";
	if (!platformType(playable.item.source, card)) return `平台 ${playable.item.source} 无标准卡片 ID`;
	if (!String(playable.item.id ?? "").trim()) return "缺少歌曲 ID";
};
/** 纯数字 ID 转成数字，其余保持字符串（协议端两种都收） */
const toPlatformId = (id) => /^\d+$/.test(id) ? Number(id) : id;
const arkSkipReason = (playable, card) => {
	if (!card.ark.key.trim()) return "未配置 key";
	if (!arkFormat(playable.item.source, card)) return `平台 ${playable.item.source} 未配置 format`;
	if (!playable.audioUrl) return "缺少音频直链";
	if (!playable.item.coverUrl) return "缺少封面";
	if (channelBlocked("ark", card)) return "熔断中";
};
const isArkCard = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && arkRequiredFields.every((field) => field in value);
const requestArkCard = async (playable, card) => {
	const ark = card.ark;
	const format = arkFormat(playable.item.source, card);
	if (!format) throw new Error(`平台 ${playable.item.source} 未配置签名 format`);
	const url = new URL(ark.apiUrl);
	url.searchParams.set("key", ark.key.trim());
	url.searchParams.set("url", playable.audioUrl);
	url.searchParams.set("song", playable.item.title);
	url.searchParams.set("singer", formatArtists(playable.item.artists));
	url.searchParams.set("cover", playable.item.coverUrl || "");
	url.searchParams.set("jump", playable.item.pageUrl);
	url.searchParams.set("format", format);
	const attempts = Math.max(0, Math.floor(ark.retries)) + 1;
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) try {
		const payload = await fetchJson(url.toString(), {
			timeoutMs: Math.max(1e3, ark.timeoutMs),
			maxBytes: arkMaxBytes
		});
		if (payload?.code !== 200) throw new Error(`签名服务返回 code=${payload?.code ?? "none"}`);
		if (!isArkCard(payload.data)) throw new Error("签名服务返回的卡片结构不完整");
		return payload.data;
	} catch (error) {
		lastError = error;
		if (attempt < attempts) logger.warn(`[Hira-卡片] 通道=ark 第 ${attempt} 次请求失败，重试：${trimCause(errorMessage(error))}`);
	}
	throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
};
/** ark 通道：第三方签名服务换回签好的 ark，用 json 段原样发出（协议端不再签名） */
const sendArkCard = async (e, playable, card) => {
	const arkCard = await requestArkCard(playable, card);
	const elements = [];
	if (card.ark.attachCover && playable.item.coverUrl) elements.push(segment.image(playable.item.coverUrl));
	elements.push(segment.json(JSON.stringify(arkCard)));
	if (card.textFallback) elements.push(segment.text(musicText(playable)));
	await e.reply(elements);
};
/** platform 通道：标准平台卡片，身份由平台决定（网易云就是网易云），签名由协议端完成 */
const sendPlatformCard = async (e, playable, card) => {
	const type = platformType(playable.item.source, card);
	if (!type) throw new Error(`平台 ${playable.item.source} 无标准卡片 ID`);
	const platform = type;
	const id = toPlatformId(String(playable.item.id ?? "").trim());
	const elements = [segment.music(platform, id)];
	if (card.textFallback) elements.push(segment.text(musicText(playable)));
	await e.reply(elements);
};
/** music 通道：标准 music 段，签名由协议端内置服务完成（失败时静默丢元素） */
const sendMusicSegment = async (e, playable, card) => {
	const { item } = playable;
	const artists = formatArtists(item.artists);
	const elements = [
		item.coverUrl ? segment.image(item.coverUrl) : void 0,
		segment.customMusic(item.pageUrl, playable.audioUrl, item.title, artists, item.coverUrl || ""),
		card.textFallback ? segment.text(musicText(playable)) : void 0
	].filter(Boolean);
	await e.reply(elements);
};
const sendMusicCard = async (e, playable) => {
	const card = cardConfig();
	const title = playable.item.title;
	const failures = [];
	for (const channel of cardChannelOrder(card)) {
		if (channel === "music" && !card.music.enabled) {
			recordSkip("music", title, "通道已关闭");
			continue;
		}
		if (channel === "platform") {
			const reason = platformSkipReason(playable, card);
			if (reason) {
				recordSkip("platform", title, reason, reason !== "通道已关闭" && !reason.endsWith("无标准卡片 ID"));
				continue;
			}
		}
		if (channel === "ark") {
			const reason = arkSkipReason(playable, card);
			if (reason) {
				recordSkip("ark", title, reason, reason !== "未配置 key");
				continue;
			}
		}
		const start = now();
		try {
			if (channel === "platform") await sendPlatformCard(e, playable, card);
			else if (channel === "ark") await sendArkCard(e, playable, card);
			else await sendMusicSegment(e, playable, card);
			recordSuccess(channel, now() - start, title);
			return;
		} catch (error) {
			const cause = errorMessage(error);
			failures.push(`${channel}: ${trimCause(cause)}`);
			recordFailure(channel, cause, now() - start, title, card);
		}
	}
	logger.warn(`[Hira-卡片] 全部通道失败 曲目=${title} 详情=${failures.join(" | ") || "无可用通道"}`);
	await e.reply(musicText(playable));
};
const cardStatusSnapshot = () => {
	const card = cardConfig();
	const ark = breakerState("ark");
	return {
		order: cardChannelOrder(card),
		textFallback: card.textFallback,
		platformEnabled: card.platform.enabled,
		platformTypes: card.platform.types,
		musicEnabled: card.music.enabled,
		arkConfigured: Boolean(card.ark.key.trim()),
		arkApiUrl: card.ark.apiUrl,
		arkBlocked: channelBlocked("ark", card),
		arkFailures: ark.failures,
		arkLastCause: ark.lastCause,
		breaker: card.breaker,
		stats,
		recent
	};
};
// src/services/resolverHttp.ts
const withResolverProxy = (options = {}) => ({
	...options,
	proxy: Config.resolver.proxy.trim() || void 0
});
const fetchResolverJson = (url, options = {}) => fetchJson(url, withResolverProxy(options));
const fetchResolverText = (url, options = {}) => fetchText(url, withResolverProxy(options));
const fetchResolverResponse = (url, options = {}) => fetchResponse(url, withResolverProxy(options));
const resolveResolverRedirectUrl = (url, options = {}) => resolveRedirectUrl(url, withResolverProxy(options));
// src/services/previewCover.ts
const renderableUrlRegExp = /^(?:data:|base64:|file:)/i;
const coverReferer = {
	weibo: "https://weibo.com/",
	tieba: "https://tieba.baidu.com/"
};
const contentTypeFromUrl = (url) => {
	if (/\.png(?:[?#]|$)/i.test(url)) return "image/png";
	if (/\.webp(?:[?#]|$)/i.test(url)) return "image/webp";
	if (/\.gif(?:[?#]|$)/i.test(url)) return "image/gif";
	return "image/jpeg";
};
const headersFromInit = (headers) => {
	if (!headers) return void 0;
	if (headers instanceof Headers) return Object.fromEntries(headers.entries());
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return headers;
};
const defaultCoverFetcher = (url, init) => fetchResolverResponse(url, {
	headers: headersFromInit(init?.headers),
	signal: init?.signal ?? void 0,
	maxBytes: Config.runtime.maxPreviewCoverBytes
});
const coverFetchTimeoutMs = 8e3;
const inlinePreviewCover = async (post, fetcher = defaultCoverFetcher) => {
	const coverUrl = post.extras?.coverUrl || post.images[0];
	if (!coverUrl || renderableUrlRegExp.test(coverUrl)) return post;
	const referer = coverReferer[post.platform];
	if (!referer) return post;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), coverFetchTimeoutMs);
	try {
		const response = await fetcher(coverUrl, {
			signal: controller.signal,
			headers: {
				Referer: referer,
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
			}
		});
		if (!response.ok) return post;
		const headerContentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
		if (headerContentType && !headerContentType.startsWith("image/")) return post;
		const bytes = await readResponseBytes(response, Config.runtime.maxPreviewCoverBytes);
		const contentType = headerContentType || contentTypeFromUrl(coverUrl);
		return {
			...post,
			extras: {
				...post.extras,
				coverUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`
			}
		};
	} catch {
		return post;
	} finally {
		clearTimeout(timeout);
	}
};
// src/services/resolverForward.ts
const resolverForwardCopy = (post) => {
	return {
		xiaoheihe: {
			contentPrompt: "小黑盒帖子正文",
			commentPrompt: "小黑盒帖子评论",
			commentUnit: "评论"
		},
		xiaohongshu: {
			contentPrompt: "小红书笔记正文",
			commentPrompt: "小红书笔记评论",
			commentUnit: "评论"
		},
		weibo: {
			contentPrompt: "微博正文",
			commentPrompt: "微博评论",
			commentUnit: "评论"
		},
		tieba: {
			contentPrompt: "贴吧帖子正文",
			commentPrompt: "贴吧回复",
			commentUnit: "回复"
		}
	}[post.platform] || {
		contentPrompt: `${post.displayName}正文`,
		commentPrompt: `${post.displayName}评论`,
		commentUnit: "评论"
	};
};
const resolveEventForwardIdentity = (e, fallbackName) => {
	const event = e;
	const id = event.sender?.userId || event.sender?.user_id || event.userId || event.user_id || e.selfId || "";
	const name = event.sender?.card || event.sender?.nickname || (id ? String(id) : fallbackName);
	return {
		id: String(id),
		name
	};
};
const canSendResolverForward = (e) => typeof e.bot.sendForwardMsg === "function";
const buildFakeForwardNode = (message, userId, nickname) => ({
	type: "node",
	subType: "fake",
	userId,
	nickname,
	message
});
const richContentElements = (blocks, options) => dedupeRichContentBlocks(blocks, options).map((block) => block.type === "text" ? segment.text(block.text) : segment.image(block.url));
const buildResolverContentNodes = (e, post, blocks, options) => {
	const identity = resolveEventForwardIdentity(e, post.displayName);
	return [buildFakeForwardNode(richContentElements(blocks, options), identity.id, identity.name)];
};
const formatResolverCommentBlock = (comment) => {
	return [
		comment.replyTo ? `${comment.author} 回复 ${comment.replyTo}` : comment.author,
		[
			typeof comment.floor === "number" ? `${comment.floor}楼` : void 0,
			comment.location,
			comment.time
		].filter(Boolean).join(" · "),
		"",
		comment.text
	].filter((line, index) => line || index === 2).join("\n");
};
const buildResolverCommentNodes = (comments) => comments.map((comment) => buildFakeForwardNode([segment.text(formatResolverCommentBlock(comment)), ...dedupeImageUrls(comment.images).map((url) => segment.image(url))], "1", comment.author));
const sendResolverForward = async (e, post, nodes, prompt, summary) => {
	await e.bot.sendForwardMsg(e.contact, nodes, {
		source: post.displayName,
		summary,
		prompt,
		news: [{ text: "点击查看完整内容" }]
	});
};
// src/services/message.ts
const videoMessageLimitBytes = 104857600;
const resolverLongTextLength = 400;
const prefix = () => Config.app.replyPrefix;
const filenameFromPath = (file) => path.posix.basename(file.replace(/\\/g, "/")) || "video.mp4";
const toVideoMessageFile = (file) => {
	if (/^(?:https?:|base64:|file:)/i.test(file)) return file;
	return `file://${file.replace(/\\/g, "/")}`;
};
const formatFileSize = (bytes) => {
	const mb = bytes / 1024 / 1024;
	return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))}MB`;
};
const getLocalFileSize = (file) => {
	try {
		if (!fs$1.existsSync(file)) return void 0;
		const stats = fs$1.statSync(file);
		if (typeof stats.isFile === "function" && !stats.isFile()) return void 0;
		return stats.size;
	} catch {
		return;
	}
};
const errorText = (error) => {
	const parts = [];
	let current = error;
	for (let i = 0; i < 4 && current; i++) {
		if (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
			continue;
		}
		if (typeof current === "object") {
			try {
				parts.push(JSON.stringify(current));
			} catch {
				parts.push(String(current));
			}
			break;
		}
		parts.push(String(current));
		break;
	}
	return parts.join("\n");
};
const isVideoTooLargeError = (error) => /video file too large|upload_group_file|upload_private_file/i.test(errorText(error));
const canUploadFile = (e) => ["group", "friend"].includes(e.contact.scene) && typeof e.bot.uploadFile === "function";
const uploadVideoFile = async (e, file, size) => {
	if (!canUploadFile(e)) {
		await replyText(e, size ? `视频文件 ${formatFileSize(size)}，超过 100MB，当前场景无法作为视频消息发送。` : "视频文件超过 100MB，当前场景无法作为视频消息发送。");
		return;
	}
	await replyText(e, size ? `视频文件 ${formatFileSize(size)}，超过 100MB，改为上传群文件。` : "视频文件超过 100MB，改为上传群文件。");
	try {
		await e.bot.uploadFile(e.contact, file, filenameFromPath(file));
	} catch (error) {
		await replyText(e, `上传群文件失败：${errorText(error) || "未知错误"}\n可以调低 B站下载画质或缩短下载上限后重试。`);
	}
};
const replyVideo = async (e, file, pageUrl) => {
	const size = getLocalFileSize(file);
	if (size && size > videoMessageLimitBytes) {
		await uploadVideoFile(e, file, size);
		return;
	}
	try {
		await e.reply(segment.video(toVideoMessageFile(file)));
	} catch (error) {
		if (isVideoTooLargeError(error)) {
			await uploadVideoFile(e, file, size);
			return;
		}
		if (Config.resolver.sending.videoFailureFallbackEnabled !== false) await replyText(e, `视频发送失败：${error instanceof Error ? error.message : String(error)}${pageUrl ? `\n原链接：${pageUrl}` : ""}`);
	}
};
const replyText = async (e, text) => {
	await e.reply(`${prefix()}：${text}`);
};
const replyPlainText = async (e, text) => {
	await e.reply(text);
};
const replyImage = async (e, url, title) => {
	const elements = [title ? segment.text(`${prefix()}：${title}`) : void 0, segment.image(url)].filter(Boolean);
	try {
		await e.reply(elements);
	} catch {
		await replyText(e, `${title ? `${title}\n` : ""}${url}`);
	}
};
const replyMusicList = async (e, items, page) => {
	if (items.length === 0) {
		await replyText(e, "没有搜到相关歌曲");
		return;
	}
	const rows = items.map((item) => {
		const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : "";
		return {
			title: item.title,
			artists: formatArtists(item.artists),
			duration
		};
	});
	try {
		const images = await renderCardImage({
			name: "music-list",
			html: buildMusicListCardHtml(rows, page),
			width: 920
		});
		await e.reply(images);
		return;
	} catch (error) {
		logCardRenderFailure("music-list", error);
		const lines = rows.map((item, index) => `${index + 1}. ${item.title} - ${item.artists}${item.duration ? ` ${item.duration}` : ""}`);
		await replyPlainText(e, [
			`---点歌列表[第${page}页]---`,
			...lines,
			"----------------",
			"发送序号点歌，发送 #下一页 查看更多。"
		].join("\n"));
	}
};
const replyMusicPlayable = async (e, playable) => {
	await sendMusicCard(e, playable);
};
const replyVoiceFileOrAudio = async (e, playable, voiceFile) => {
	try {
		await e.reply(segment.record(voiceFile || playable.audioUrl));
	} catch {
		await replyMusicPlayable(e, playable);
	}
};
const isFailure = (result) => "ok" in result && result.ok === false;
const resolverCommentsEnabled = () => Config.resolver.commentsEnabled !== false;
const botForwardIdentity = (e, fallbackName) => {
	const bot = e.bot;
	return {
		id: String(bot.account?.selfId || e.selfId || ""),
		name: fallbackName
	};
};
const canSendForward = canSendResolverForward;
const resolvedPostText = (post) => {
	const title = post.title ? `，${post.title}` : "";
	return `识别：${post.displayName}${title}${post.description ? `\n${post.description}` : ""}${post.pageUrl ? `\n${post.pageUrl}` : ""}`;
};
const resolverImageUrls = (images) => {
	const media = Config.resolver.media;
	if (media.dedupeImages !== false) return dedupeImageUrls(images, { filterLowQuality: media.filterLowQualityImages !== false });
	const urls = images.map((url) => url.trim()).filter(Boolean);
	if (media.filterLowQualityImages === false) return urls;
	const usable = urls.filter(isUsableImageUrl);
	if (usable.length > 0) return usable;
	return urls.filter((url) => imageQuality(url) !== "blurred");
};
const resolverImageDedupeOptions = () => ({
	dedupe: Config.resolver.media.dedupeImages !== false,
	filterLowQuality: Config.resolver.media.filterLowQualityImages !== false
});
const directResolvedPost = async (e, post, text) => {
	const elements = [segment.text(text), ...resolverImageUrls(post.images).slice(0, 9).map((url) => segment.image(url))];
	await e.reply(elements);
};
const cardResolvedPost = async (e, post, text) => {
	try {
		const elements = [...await renderCardImage({
			name: `resolver-${post.platform}`,
			html: buildResolverCardHtml(post),
			width: 920
		}), ...resolverImageUrls(post.images).slice(0, 9).map((url) => segment.image(url))];
		await e.reply(elements);
	} catch (error) {
		logCardRenderFailure(`resolver-${post.platform}`, error);
		await directResolvedPost(e, post, text);
	}
};
const richResolverPreviewCopy = (post) => {
	if (post.platform === "bilibili") return "已识别B站视频，简介和视频将随后发送。";
	if (post.platform === "kuaishou") return "已识别快手作品，完整内容将随后发送。";
	if (post.platform === "xiaoheihe") return "已识别小黑盒分享，完整内容将随后发送。";
	if (post.platform === "xiaohongshu") return "已识别小红书笔记，完整图文将随后发送。";
	if (post.platform === "weibo") return "已识别微博分享，正文和评论将随后发送。";
	if (post.platform === "tieba") return "已识别贴吧帖子，正文和回复将随后发送。";
	if (post.platform === "general") return "已识别通用解析结果，内容将随后发送。";
	return `已识别${post.displayName}分享，完整内容将随后发送。`;
};
const resolverPreviewCardPost = async (e, post, text) => {
	try {
		const renderPost = Config.resolver.media.inlinePreviewCover === false ? post : await inlinePreviewCover(post);
		const images = await renderCardImage({
			name: `resolver-${post.platform}-preview`,
			html: buildResolverPreviewCardHtml(renderPost, richResolverPreviewCopy(renderPost), { commentsEnabled: resolverCommentsEnabled() }),
			width: 920
		});
		await e.reply(images);
	} catch (error) {
		logCardRenderFailure(`resolver-${post.platform}-preview`, error);
		await directResolvedPost(e, post, text);
	}
};
const replyResolvedPostForward = async (e, post, text) => {
	const identity = botForwardIdentity(e, `${post.displayName}解析`);
	const nodes = common.makeForward([segment.text(text), ...resolverImageUrls(post.images).map((url) => segment.image(url))], identity.id, identity.name);
	const isLongText = (post.description?.length || 0) > resolverLongTextLength;
	const summary = post.images.length > 1 ? `查看${post.images.length}张图片` : isLongText ? "查看完整解析内容" : "查看解析内容";
	await e.bot.sendForwardMsg(e.contact, nodes, {
		source: "解析结果",
		summary,
		prompt: `${post.displayName}解析结果`,
		news: [{ text: "点击查看解析结果" }]
	});
};
const richResolverPlatforms = /* @__PURE__ */ new Set([
	"bilibili",
	"kuaishou",
	"xiaoheihe",
	"xiaohongshu",
	"weibo",
	"tieba",
	"general"
]);
const hasRichResolverExtras = (post) => richResolverPlatforms.has(post.platform) && Boolean(post.extras?.contentBlocks?.length || resolverCommentsEnabled() && post.extras?.commentBlocks?.length);
const replyRichResolverPost = async (e, post, text) => {
	await resolverPreviewCardPost(e, post, text);
	if (!canSendForward(e)) {
		await directResolvedPost(e, post, text);
		return;
	}
	try {
		const copy = resolverForwardCopy(post);
		const contentBlocks = post.extras?.contentBlocks || [];
		if (Config.resolver.sending.contentForwardEnabled !== false && contentBlocks.length > 0) await sendResolverForward(e, post, buildResolverContentNodes(e, post, contentBlocks, resolverImageDedupeOptions()), copy.contentPrompt, "查看完整图文");
		const commentBlocks = resolverCommentsEnabled() ? post.extras?.commentBlocks || [] : [];
		if (commentBlocks.length > 0) await sendResolverForward(e, post, buildResolverCommentNodes(commentBlocks), copy.commentPrompt, `查看${commentBlocks.length}条${copy.commentUnit}`);
	} catch {
		await directResolvedPost(e, post, text);
	}
};
const replyResolvedPost = async (e, result) => {
	if (isFailure(result)) {
		try {
			const images = await renderCardImage({
				name: `resolver-error-${result.platform}`,
				html: buildErrorCardHtml({
					title: `${result.displayName}解析失败`,
					subtitle: result.displayName,
					reason: result.reason,
					suggestion: "可以检查 Cookie、代理和平台接口状态；渲染不可用时会自动退回文本提示。",
					details: [`platform=${result.platform}`]
				}),
				width: 920
			});
			await e.reply(images);
		} catch (error) {
			logCardRenderFailure(`resolver-error-${result.platform}`, error);
			await replyPlainText(e, `${result.displayName}解析失败：${result.reason}`);
		}
		return;
	}
	const post = result;
	const text = resolvedPostText(post);
	if (hasRichResolverExtras(post)) {
		await replyRichResolverPost(e, post, text);
		const video = post.videos[0];
		if (video) await replyVideo(e, video, post.pageUrl);
		return;
	}
	if ((post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength) && canSendForward(e)) try {
		await replyResolvedPostForward(e, post, text);
	} catch {
		await directResolvedPost(e, post, text);
	}
	else await cardResolvedPost(e, post, text);
	const video = post.videos[0];
	if (video) await replyVideo(e, video, post.pageUrl);
};
export { replyResolvedPost as a, fetchResolverJson as c, cardStatusSnapshot as d, replyPlainText as i, fetchResolverText as l, replyMusicList as n, replyText as o, replyMusicPlayable as r, replyVoiceFileOrAudio as s, replyImage as t, resolveResolverRedirectUrl as u };

//# sourceMappingURL=message.js.map