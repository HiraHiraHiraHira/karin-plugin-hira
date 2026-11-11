import { _ as fetchText, b as toAxiosProxy, g as fetchResponse, h as fetchJson, t as Config, u as formatArtists, v as readResponseBytes, y as resolveRedirectUrl } from "./config.js";
import { a as buildResolverPreviewCardHtml, c as logCardRenderFailure, d as dedupeRichContentBlocks, f as imageQuality, i as buildResolverCardHtml, l as renderCardImage, p as isUsableImageUrl, r as buildMusicListCardHtml, t as buildErrorCardHtml, u as dedupeImageUrls } from "./cardRender.js";
import { n as createTempFilePath } from "./temp.js";
import { logger, segment } from "node-karin";
import * as fs$1 from "node:fs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Buffer as Buffer$1 } from "node:buffer";
//#region src/runtime/downloader.ts
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const contentLengthOf = (value) => {
	const parsed = Number(typeof value === "string" ? value : void 0);
	return Number.isFinite(parsed) ? parsed : void 0;
};
const byteLimit = (maxBytes) => {
	if (maxBytes === void 0) return void 0;
	let total = 0;
	return new Transform({ transform(chunk, _encoding, callback) {
		total += Buffer.byteLength(chunk);
		if (total > maxBytes) {
			callback(/* @__PURE__ */ new Error(`下载内容超过 ${maxBytes} 字节限制`));
			return;
		}
		callback(null, chunk);
	} });
};
const writeDownloadedBody = async (body, output, maxBytes) => {
	const webBody = body;
	const source = typeof webBody.getReader === "function" ? Readable.fromWeb(webBody) : body;
	const limiter = byteLimit(maxBytes);
	if (limiter) {
		await pipeline(source, limiter, fs.createWriteStream(output));
		return;
	}
	await pipeline(source, fs.createWriteStream(output));
};
const downloadFile = async (options) => {
	const timeoutMs = options.timeoutMs ?? Math.max(5, Config.runtime.downloadTimeoutSeconds) * 1e3;
	const maxBytes = options.maxBytes;
	const temporaryOutput = `${options.output}.part-${process.pid}-${Math.random().toString(36).slice(2)}`;
	fs.mkdirSync(path.dirname(options.output), { recursive: true });
	try {
		if (options.proxy?.trim()) {
			const response = await axios.get(options.url, {
				headers: {
					"User-Agent": userAgent,
					...options.headers
				},
				timeout: timeoutMs,
				proxy: toAxiosProxy(options.proxy.trim()),
				responseType: "stream",
				maxRedirects: 5,
				validateStatus: () => true
			});
			if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`);
			const contentLength = contentLengthOf(response.headers["content-length"]);
			if (maxBytes !== void 0 && contentLength !== void 0 && contentLength > maxBytes) {
				response.data.destroy();
				throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
			}
			await writeDownloadedBody(response.data, temporaryOutput, maxBytes);
		} else {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetch(options.url, {
					headers: {
						"User-Agent": userAgent,
						...options.headers
					},
					redirect: "follow",
					signal: controller.signal
				});
				if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
				const contentLength = contentLengthOf(response.headers.get("content-length"));
				if (maxBytes !== void 0 && contentLength !== void 0 && contentLength > maxBytes) {
					await response.body.cancel();
					throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
				}
				await writeDownloadedBody(response.body, temporaryOutput, maxBytes);
			} finally {
				clearTimeout(timeout);
			}
		}
		fs.rmSync(options.output, { force: true });
		fs.renameSync(temporaryOutput, options.output);
		return options.output;
	} catch (error) {
		fs.rmSync(temporaryOutput, { force: true });
		throw error;
	}
};
//#endregion
//#region src/runtime/ffmpeg.ts
const execFileAsync = promisify(execFile);
const buildFfmpegArgs = (options) => {
	if (options.format === "merge") return [
		"-y",
		"-i",
		options.videoInput,
		"-stream_loop",
		"-1",
		"-i",
		options.audioInput,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-c",
		"copy",
		"-shortest",
		options.output
	];
	if (options.format === "copy") return [
		"-y",
		"-i",
		options.input,
		"-c",
		"copy",
		options.output
	];
	if (options.format === "qq-video") return [
		"-y",
		"-i",
		options.input,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-profile:a",
		"aac_low",
		"-b:a",
		"128k",
		"-movflags",
		"+faststart",
		options.output
	];
	if (options.format === "wav") return [
		"-y",
		"-i",
		options.input,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"24000",
		"-codec:a",
		"pcm_s16le",
		options.output
	];
	if (options.format === "voice") return [
		"-y",
		"-i",
		options.input,
		"-vn",
		"-ac",
		options.highQuality ? "2" : "1",
		"-ar",
		options.highQuality ? "48000" : "24000",
		"-codec:a",
		"libopus",
		"-b:a",
		options.highQuality ? "128k" : "32k",
		options.output
	];
	return [
		"-y",
		"-i",
		options.input,
		"-vn",
		"-codec:a",
		"libmp3lame",
		"-b:a",
		"192k",
		options.output
	];
};
const runFfmpeg = async (options) => {
	await execFileAsync(Config.runtime.ffmpegPath || "ffmpeg", buildFfmpegArgs(options), {
		windowsHide: true,
		timeout: Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1e3
	});
	return options.output;
};
//#endregion
//#region src/services/mediaRetry.ts
/**
* 带签名的查询参数名(大小写不敏感, 覆盖 cos/oss/aws 的 `x-expires` / `X-Amz-Signature` 前缀写法).
* 这类 URL 追加任意参数都会让签名失效, 因此必须原样返回.
*/
const signedQueryKeyPattern = /(?:^|[-_])(?:sign|signature|sig|expires|auth_key|token)$/i;
const hasSignedQuery = (url) => {
	const queryIndex = url.indexOf("?");
	if (queryIndex < 0) return false;
	return url.slice(queryIndex + 1).split("#")[0].split("&").some((pair) => signedQueryKeyPattern.test(pair.split("=")[0]));
};
/**
* 风控重发:首次发送失败(常见图床风控)时,给图片 URL 追加随机查询字节改 hash 后重试一次.
* 参考 R `utils/retry.js` replyWithRetry.仅改 URL,不动本地文件.
* 签名 URL 追加参数只会破坏签名, 故原样返回.
*/
const withCacheBuster = (url) => hasSignedQuery(url) ? url : `${url}${url.includes("?") ? "&" : "?"}hira-retry=${Math.random().toString(36).slice(2, 8)}${Date.now() % 1e3}`;
const imageHttpUrlOf = (element) => {
	if (typeof element !== "object" || element === null) return void 0;
	const segment = element;
	if (segment.type !== "image") return void 0;
	const raw = typeof segment.file === "string" ? segment.file : typeof segment.url === "string" ? segment.url : void 0;
	if (!raw || !/^https?:/i.test(raw)) return void 0;
	return raw;
};
const replaceImageUrl = (element, url) => {
	const segment = element;
	return {
		...segment,
		...typeof segment.file === "string" ? { file: url } : { url }
	};
};
/**
* 递归改写消息中的图片 URL, 包括合并转发节点里的媒体, 返回是否真的改到了东西.
*/
const rewriteImageUrls = async (payload, rewrite) => {
	if (Array.isArray(payload)) {
		const results = await Promise.all(payload.map((item) => rewriteImageUrls(item, rewrite)));
		return {
			value: results.map((result) => result.value),
			changed: results.some((result) => result.changed)
		};
	}
	if (typeof payload === "object" && payload !== null) {
		const node = payload;
		if (node.type === "node" && Array.isArray(node.message)) {
			const inner = await rewriteImageUrls(node.message, rewrite);
			return inner.changed ? {
				value: {
					...payload,
					message: inner.value
				},
				changed: true
			} : {
				value: payload,
				changed: false
			};
		}
	}
	const url = imageHttpUrlOf(payload);
	if (!url) return {
		value: payload,
		changed: false
	};
	const next = await rewrite(url);
	if (!next || next === url) return {
		value: payload,
		changed: false
	};
	return {
		value: replaceImageUrl(payload, next),
		changed: true
	};
};
const mediaReferer = (url) => {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}/`;
	} catch {
		return url;
	}
};
const imageExtension = (url) => {
	try {
		const ext = path.posix.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
		return /^(?:jpe?g|png|webp|gif|bmp|avif)$/.test(ext) ? ext : "jpg";
	} catch {
		return "jpg";
	}
};
/**
* 下载图片到本地并追加随机字节, 让 QQ 侧看到新的文件 hash (参考 R utils/retry.js:220-283).
* 追加字节只改变 hash, 不破坏图片解码.
*/
const downloadImageToLocal = async (url) => {
	const output = createTempFilePath("retry", imageExtension(url));
	await downloadFile({
		url,
		output,
		headers: {
			Referer: mediaReferer(url),
			Accept: "image/webp,image/apng,image/*,*/*;q=0.8"
		},
		timeoutMs: 3e4,
		maxBytes: Config.runtime.maxVideoFileSizeBytes
	});
	if (fs.statSync(output).size < 1024) {
		fs.rmSync(output, { force: true });
		throw new Error("图片内容过小");
	}
	fs.appendFileSync(output, crypto.randomBytes(5));
	return output.replace(/\\/g, "/");
};
/**
* 先正常发; 失败后把远程图片下载到本地(带域名 Referer + 随机字节)重发,
* 再失败则退回改查询参数改 hash 的轻量重试. 两条兜底都无效时抛首次错误.
*/
const sendWithMediaRetry = async (send, payload) => {
	try {
		return await send(payload);
	} catch (firstError) {
		try {
			const localized = await rewriteImageUrls(payload, async (url) => {
				try {
					return await downloadImageToLocal(url);
				} catch {
					return;
				}
			});
			if (localized.changed) return await send(localized.value);
		} catch {}
		try {
			const busted = await rewriteImageUrls(payload, async (url) => withCacheBuster(url));
			if (busted.changed) return await send(busted.value);
		} catch {}
		throw firstError;
	}
};
//#endregion
//#region src/services/musicOidb.ts
const profiles = {
	qq: {
		appid: 100497308,
		appname: "com.tencent.qqmusic",
		appsign: "cbd27cd7c861227d013a25b2d10f0799"
	},
	netease: {
		appid: 100495085,
		appname: "com.netease.cloudmusic",
		appsign: "da6b069da1e2982db3e386233f68d76d"
	},
	kuwo: {
		appid: 100243533,
		appname: "cn.kuwo.player",
		appsign: "bf9ff4ffb4c558a34ee3fd52c223ebf5"
	},
	kugou: {
		appid: 205141,
		appname: "com.kugou.android",
		appsign: "fe4a24d80fcf253a00676a808f62c2c6"
	},
	bilibili: {
		appid: 100951776,
		appname: "tv.danmaku.bili",
		appsign: "7194d531cbe7960a22007b9f6bdaa38b"
	}
};
const oidbSupportedSource = (source) => Boolean(profiles[source]);
const encodeVarint = (value) => {
	let current = typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
	const bytes = [];
	while (current > 127n) {
		bytes.push(Number(current & 127n) | 128);
		current >>= 7n;
	}
	bytes.push(Number(current));
	return Buffer.from(bytes);
};
const pbKey = (field, wire) => encodeVarint(BigInt(field) << 3n | BigInt(wire));
const pbUint = (field, value) => Buffer.concat([pbKey(field, 0), encodeVarint(value)]);
const pbString = (field, value) => {
	const bytes = Buffer.from(value ?? "", "utf8");
	return Buffer.concat([
		pbKey(field, 2),
		encodeVarint(bytes.length),
		bytes
	]);
};
const pbMessage = (field, parts) => {
	const bytes = Buffer.concat(parts);
	return Buffer.concat([
		pbKey(field, 2),
		encodeVarint(bytes.length),
		bytes
	]);
};
const resolveTarget = (e) => {
	const peer = String(e.contact?.peer ?? e.userId ?? "").replace(/\D/g, "");
	if (!peer) throw new Error("拿不到发送目标");
	return {
		sendType: e.isGroup ? 1 : 0,
		peer: BigInt(peer)
	};
};
const buildOidbMusicPacket = (source, target, options) => {
	const profile = profiles[source];
	if (!profile) throw new Error(`平台 ${source} 不支持 OIDB 卡片`);
	const musicUrl = options.musicUrl.trim();
	const hasAudio = musicUrl.length > 0;
	const app = [
		pbUint(1, 1),
		pbString(2, "0.0.0"),
		pbString(3, profile.appname),
		pbString(4, profile.appsign)
	];
	const music = [
		pbString(10, options.title),
		pbString(11, options.singer),
		pbString(12, options.text || `[分享]${options.title}-${options.singer}`),
		pbString(13, options.jumpUrl),
		pbString(14, options.preview),
		pbString(16, musicUrl)
	];
	return Buffer.concat([
		pbUint(1, profile.appid),
		pbUint(2, 1),
		pbUint(3, hasAudio ? 4 : 0),
		pbMessage(5, app),
		pbString(6, ""),
		pbUint(10, target.sendType),
		pbUint(11, target.peer),
		pbMessage(12, music),
		pbUint(19, 0)
	]);
};
const readVarint = (buffer, offset) => {
	let result = 0n;
	let shift = 0n;
	let index = offset;
	while (index < buffer.length) {
		const byte = buffer[index];
		result |= BigInt(byte & 127) << shift;
		index += 1;
		if ((byte & 128) === 0) return [result, index];
		shift += 7n;
		if (shift > 70n) break;
	}
	throw new Error("protobuf varint 不完整");
};
/** OIDB 响应里 field 3 是 retcode（小飞同样用它判定） */
const readOidbRetcode = (bytes) => {
	let index = 0;
	while (index < bytes.length) {
		const [key, afterKey] = readVarint(bytes, index);
		index = afterKey;
		const field = Number(key >> 3n);
		const wire = Number(key & 7n);
		if (wire === 0) {
			const [value, afterValue] = readVarint(bytes, index);
			index = afterValue;
			if (field === 3) return Number(value);
		} else if (wire === 2) {
			const [length, afterLength] = readVarint(bytes, index);
			index = afterLength + Number(length);
		} else if (wire === 5) index += 4;
		else if (wire === 1) index += 8;
		else return;
	}
};
const sendPacket = async (e, cmd, data) => {
	const bot = e.bot;
	if (typeof bot.sendApi !== "function") throw new Error("当前协议端不支持 send_packet");
	const response = await bot.sendApi("send_packet", {
		cmd,
		data: data.toString("hex"),
		rsp: true
	});
	const payload = typeof response === "string" ? response : response?.result ?? response?.data;
	if (!payload) return;
	let bytes;
	try {
		bytes = Buffer.from(payload, "hex");
	} catch {
		return;
	}
	if (bytes.length === 0) return;
	const retcode = readOidbRetcode(bytes);
	if (retcode !== void 0 && retcode !== 0) throw new Error(`OIDB 返回 retcode=${retcode}`);
};
/** 发送 OIDB 音乐卡片；失败抛错，交给通道链降级 */
const sendOidbMusicCard = async (e, playable) => {
	if (!playable.audioUrl) throw new Error("缺少音频直链");
	const target = resolveTarget(e);
	await sendPacket(e, "OidbSvc.0xb77_9", buildOidbMusicPacket(playable.item.source, target, {
		title: playable.item.title,
		singer: formatArtists(playable.item.artists),
		jumpUrl: playable.item.pageUrl,
		preview: playable.item.coverUrl || "",
		musicUrl: playable.audioUrl
	}));
};
//#endregion
//#region src/services/musicCard.ts
const cardChannels = [
	"platform",
	"oidb",
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
const arkMaxBytes = 256 * 1024;
const breakers = /* @__PURE__ */ new Map();
const stats = {
	platform: {
		ok: 0,
		fail: 0,
		skip: 0
	},
	oidb: {
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
* 熔断只作用于可观测通道（oidb / ark）：它们有明确回执，连续失败说明上游确实坏了。
* platform / music 是哑通道，协议端静默丢弃元素时插件无从感知，只记失败计数、不参与熔断。
*/
const observableChannels = new Set(["oidb", "ark"]);
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
	if (!observableChannels.has(channel)) return false;
	const state = breakerState(channel);
	const { failThreshold, cooldownSeconds } = card.breaker;
	if (state.failures < Math.max(1, failThreshold)) return false;
	if (now() < state.blockedUntil) return true;
	state.failures = 0;
	state.blockedUntil = 0;
	state.lastCause = void 0;
	logger.info(`[Hira-卡片] 通道=${channel} 熔断冷却结束，恢复尝试`);
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
	if (!observableChannels.has(channel)) return;
	const state = breakerState(channel);
	state.failures += 1;
	state.lastCause = trimmed;
	const { failThreshold, cooldownSeconds } = card.breaker;
	if (state.failures >= Math.max(1, failThreshold)) {
		state.blockedUntil = now() + Math.max(10, cooldownSeconds) * 1e3;
		logger.warn(`[Hira-卡片] 通道=${channel} 连续失败 ${state.failures} 次，熔断 ${cooldownSeconds}s`);
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
const oidbSkipReason = (playable, card) => {
	if (card.oidb?.enabled === false) return "通道已关闭";
	if (!oidbSupportedSource(playable.item.source)) return `平台 ${playable.item.source} 不支持 OIDB 卡片`;
	if (!playable.audioUrl) return "缺少音频直链";
	if (channelBlocked("oidb", card)) return "熔断中";
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
	const milky = e.bot?.adapter?.standard === "milky";
	for (const channel of cardChannelOrder(card)) {
		if (milky && channel !== "ark") {
			recordSkip(channel, title, "Milky 协议不支持该通道", false);
			continue;
		}
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
		if (channel === "oidb") {
			const reason = oidbSkipReason(playable, card);
			if (reason) {
				recordSkip("oidb", title, reason, reason !== "通道已关闭" && !reason.endsWith("不支持 OIDB 卡片"));
				continue;
			}
		}
		const start = now();
		try {
			if (channel === "platform") await sendPlatformCard(e, playable, card);
			else if (channel === "oidb") await sendOidbMusicCard(e, playable);
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
	const oidb = breakerState("oidb");
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
		oidbEnabled: card.oidb?.enabled !== false,
		oidbBlocked: channelBlocked("oidb", card),
		oidbFailures: oidb.failures,
		oidbLastCause: oidb.lastCause,
		breaker: card.breaker,
		stats,
		recent
	};
};
//#endregion
//#region src/services/resolverHttp.ts
const withResolverProxy = (options = {}) => ({
	...options,
	proxy: Config.resolver.proxy.trim() || void 0
});
const fetchResolverJson = (url, options = {}) => fetchJson(url, withResolverProxy(options));
const fetchResolverText = (url, options = {}) => fetchText(url, withResolverProxy(options));
const fetchResolverResponse = (url, options = {}) => fetchResponse(url, withResolverProxy(options));
const resolveResolverRedirectUrl = (url, options = {}) => resolveRedirectUrl(url, withResolverProxy(options));
//#endregion
//#region src/services/previewCover.ts
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
				coverUrl: `data:${contentType};base64,${Buffer$1.from(bytes).toString("base64")}`
			}
		};
	} catch {
		return post;
	} finally {
		clearTimeout(timeout);
	}
};
//#endregion
//#region src/services/resolverForward.ts
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
/**
* 合并转发可用性探测: 适配器必须实现 sendForwardMsg, 且当前事件必须带得动 contact.
* 真正的发送失败仍由调用方 catch 兜底为直发, 这里只挡掉必然失败的情况.
*/
const canSendResolverForward = (e) => {
	if (!e.contact) return false;
	return typeof e.bot?.sendForwardMsg === "function";
};
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
			comment.time,
			typeof comment.likeCount === "number" && comment.likeCount > 0 ? `👍 ${comment.likeCount}` : void 0,
			typeof comment.replyCount === "number" && comment.replyCount > 0 ? `💬 ${comment.replyCount}` : void 0
		].filter(Boolean).join(" · "),
		"",
		comment.text
	].filter((line, index) => line || index === 2).join("\n");
};
/**
* 评论节点用触发者的 id 承载转发身份(避免出现灰头像), 昵称仍显示评论作者;
* 作者信息已同时写在正文首行, 不会丢失.
*/
const buildResolverCommentNodes = (comments, identity) => comments.map((comment) => buildFakeForwardNode([segment.text(formatResolverCommentBlock(comment)), ...dedupeImageUrls(comment.images).map((url) => segment.image(url))], identity?.id || "", comment.author));
const sendResolverForward = async (e, post, nodes, prompt, summary) => {
	await sendWithMediaRetry((payload) => e.bot.sendForwardMsg(e.contact, payload, {
		source: post.displayName,
		summary,
		prompt,
		news: [{ text: "点击查看完整内容" }]
	}), nodes);
};
//#endregion
//#region src/services/message.ts
const videoMessageLimitBytes = 100 * 1024 * 1024;
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
const isRemoteMedia = (url) => /^https?:\/\//i.test(url);
/**
* CDN 直链需要平台页面作为 Referer; B站/抖音按完整页面 URL, 其余用页面源站.
*/
const videoReferer = (post) => {
	const pageUrl = post.pageUrl?.trim();
	if (pageUrl) try {
		const parsed = new URL(pageUrl);
		return post.platform === "bilibili" || post.platform === "douyin" ? pageUrl : `${parsed.protocol}//${parsed.host}/`;
	} catch {}
	return {
		bilibili: "https://www.bilibili.com/",
		douyin: "https://www.douyin.com/",
		xiaohongshu: "https://www.xiaohongshu.com/",
		weibo: "https://weibo.com/",
		kuaishou: "https://www.kuaishou.com/",
		tieba: "https://tieba.baidu.com/",
		xiaoheihe: "https://www.xiaoheihe.cn/"
	}[post.platform];
};
const videoExtension = (url) => {
	try {
		const ext = path.posix.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
		return /^(?:mp4|m4v|mov|webm|flv|mkv|m4s)$/.test(ext) ? ext : "mp4";
	} catch {
		return "mp4";
	}
};
/**
* resolve 阶段只登记直链, 真正的下载/合并/转封装留到发送时按需执行,
* 避免解析阶段长时间阻塞首条回复, 也避免用户没等到结果却已下载大文件.
*/
const downloadResolverMedia = async (url, ext, referer) => {
	const output = createTempFilePath("video", ext);
	await downloadFile({
		url,
		output,
		headers: {
			...referer ? { Referer: referer } : {},
			Accept: "*/*"
		},
		timeoutMs: Math.max(5, Config.runtime.downloadTimeoutSeconds) * 1e3,
		maxBytes: Config.runtime.maxVideoFileSizeBytes,
		proxy: Config.resolver.proxy || void 0
	});
	return output;
};
const tryFfmpeg = async (options) => {
	try {
		return await runFfmpeg(options);
	} catch (error) {
		logger.warn(`[hira] ffmpeg ${options.format} failed: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
};
/**
* 发送时准备视频: 远程直链先下载(沿用 runtime 体积上限), 有独立音轨则合并,
* 再按需做 QQ 兼容转封装; 本地视频保持原样, 不重复转码.
*/
const audioTrackOrDefault = async (audioUrl, referer) => {
	if (!audioUrl) return void 0;
	if (!isRemoteMedia(audioUrl)) return audioUrl;
	try {
		return await downloadResolverMedia(audioUrl, "m4a", referer);
	} catch (error) {
		logger.warn(`[hira] audio track download failed, sending video only: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
};
const prepareResolverVideo = async (video, options) => {
	const sourceUrl = video.url?.trim();
	if (!sourceUrl) return void 0;
	if (/\.m3u8(?:$|[?#])/i.test(sourceUrl)) throw new Error("暂不支持 HLS (m3u8) 直链，请点击原链接观看");
	const audioFile = await audioTrackOrDefault(video.audioUrl?.trim(), options?.referer);
	if (!isRemoteMedia(sourceUrl)) {
		if (!audioFile) return sourceUrl;
		return await tryFfmpeg({
			format: "merge",
			videoInput: sourceUrl,
			audioInput: audioFile,
			output: createTempFilePath("video", "mp4")
		}) || sourceUrl;
	}
	let videoFile = await downloadResolverMedia(sourceUrl, videoExtension(sourceUrl), options?.referer);
	if (audioFile) {
		const merged = await tryFfmpeg({
			format: "merge",
			videoInput: videoFile,
			audioInput: audioFile,
			output: createTempFilePath("video", "mp4")
		});
		if (merged) videoFile = merged;
	}
	return await tryFfmpeg({
		format: "qq-video",
		input: videoFile,
		output: createTempFilePath("video", "mp4")
	}) || videoFile;
};
const replyResolverVideo = async (e, video, pageUrl, referer) => {
	if (isRemoteMedia(video.url)) await replyText(e, "视频下载中，请稍候…", { recallMsg: 30 }).catch(() => void 0);
	let file;
	try {
		file = await prepareResolverVideo(video, { referer });
	} catch (error) {
		if (Config.resolver.sending.videoFailureFallbackEnabled !== false) await replyText(e, `视频下载失败：${errorText(error) || "未知错误"}${pageUrl ? `\n原链接：${pageUrl}` : ""}`);
		return;
	}
	if (!file) return;
	await replyVideo(e, file, pageUrl);
};
const replyResolverVideos = async (e, post) => {
	const referer = videoReferer(post);
	for (const video of post.videos.slice(0, 9)) await replyResolverVideo(e, video, post.pageUrl, referer);
};
const replyOptions = (options) => {
	const at = options?.reply === false ? { reply: false } : { reply: true };
	return options?.recallMsg ? {
		...at,
		recallMsg: options.recallMsg
	} : at;
};
const replyText = async (e, text, options) => {
	await e.reply(`${prefix()}：${text}`, replyOptions(options));
};
const replyPlainText = async (e, text, options) => {
	await e.reply(text, replyOptions(options));
};
const replyImage = async (e, url, title) => {
	const elements = [title ? segment.text(`${prefix()}：${title}`) : void 0, segment.image(url)].filter(Boolean);
	try {
		await sendWithMediaRetry((payload) => e.reply(payload), elements);
	} catch {
		await replyText(e, `${title ? `${title}\n` : ""}${url}`);
	}
};
const replyMusicList = async (e, items, page, options) => {
	if (items.length === 0) {
		await replyText(e, "没有搜到相关歌曲");
		return;
	}
	const startIndex = Math.max(1, Math.floor(options?.startIndex ?? 1));
	const rows = items.map((item, offset) => {
		const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : "";
		return {
			index: startIndex + offset,
			title: item.title,
			artists: formatArtists(item.artists),
			duration
		};
	});
	const extractMessageId = (result) => {
		if (typeof result !== "object" || result === null || !("messageId" in result)) return void 0;
		const messageId = result.messageId;
		return typeof messageId === "string" && messageId ? messageId : void 0;
	};
	try {
		return extractMessageId(await sendWithMediaRetry((payload) => e.reply(payload), await renderCardImage({
			name: "music-list",
			html: buildMusicListCardHtml(rows, page, startIndex),
			width: 920
		})));
	} catch (error) {
		logCardRenderFailure("music-list", error);
		const lines = rows.map((row) => `${row.index}. ${row.title} - ${row.artists}${row.duration ? ` ${row.duration}` : ""}`);
		return extractMessageId(await e.reply([
			`---点歌列表[第${page}页]---`,
			...lines,
			"----------------",
			"发送序号点歌，发送 #下一页 查看更多。"
		].join("\n")));
	}
};
const replyMusicPlayable = async (e, playable) => {
	await sendMusicCard(e, playable);
};
const replyVoiceFileOrAudio = async (e, playable, voiceFile) => {
	try {
		return (await e.reply(segment.record(voiceFile || playable.audioUrl)))?.messageId;
	} catch {
		if (voiceFile && voiceFile !== playable.audioUrl) try {
			return (await e.reply(segment.record(playable.audioUrl)))?.messageId;
		} catch {}
		await replyMusicPlayable(e, playable);
		return;
	}
};
const isFailure = (result) => "ok" in result && result.ok === false;
const resolverCommentsEnabled = () => Config.resolver.commentsEnabled !== false;
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
/** 转发按 50 条分批,超限分多条发出(参考 R sendImagesInBatches). */
const FORWARD_BATCH_SIZE = 50;
const sendForwardBatched = async (e, post, nodes, prompt, summary) => {
	for (let i = 0; i < nodes.length; i += FORWARD_BATCH_SIZE) await sendResolverForward(e, post, nodes.slice(i, i + FORWARD_BATCH_SIZE), prompt, `${summary}${nodes.length > FORWARD_BATCH_SIZE ? `(${Math.floor(i / FORWARD_BATCH_SIZE) + 1}/${Math.ceil(nodes.length / FORWARD_BATCH_SIZE)})` : ""}`);
};
const directResolvedPost = async (e, post, text) => {
	const imageUrls = resolverImageUrls(post.images).slice(0, 9);
	const elements = [segment.text(text), ...imageUrls.map((url) => segment.image(url))];
	try {
		await sendWithMediaRetry((payload) => e.reply(payload), elements);
	} catch {
		await replyPlainText(e, [text, ...imageUrls].join("\n"));
	}
};
const cardResolvedPost = async (e, post, text) => {
	try {
		await sendWithMediaRetry((payload) => e.reply(payload), [...await renderCardImage({
			name: `resolver-${post.platform}`,
			html: buildResolverCardHtml(post),
			width: 920
		}), ...resolverImageUrls(post.images).slice(0, 9).map((url) => segment.image(url))]);
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
		await sendWithMediaRetry((payload) => e.reply(payload), await renderCardImage({
			name: `resolver-${post.platform}-preview`,
			html: buildResolverPreviewCardHtml(renderPost, richResolverPreviewCopy(renderPost), { commentsEnabled: resolverCommentsEnabled() }),
			width: 920
		}));
	} catch (error) {
		logCardRenderFailure(`resolver-${post.platform}-preview`, error);
		await directResolvedPost(e, post, text);
	}
};
const replyResolvedPostForward = async (e, post, text) => {
	const identity = resolveEventForwardIdentity(e, post.displayName);
	const imageUrls = resolverImageUrls(post.images);
	const nodes = [buildFakeForwardNode([segment.text(text), ...imageUrls.map((url) => segment.image(url))], identity.id, identity.name)];
	const isLongText = (post.description?.length || 0) > resolverLongTextLength;
	const summary = imageUrls.length > 1 ? `查看${imageUrls.length}张图片` : isLongText ? "查看完整解析内容" : "查看解析内容";
	await sendForwardBatched(e, post, nodes, `${post.displayName}解析结果`, summary);
};
const richResolverPlatforms = new Set([
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
		if (Config.resolver.sending.contentForwardEnabled !== false && contentBlocks.length > 0) await sendForwardBatched(e, post, buildResolverContentNodes(e, post, contentBlocks, resolverImageDedupeOptions()), copy.contentPrompt, "查看完整图文");
		const commentBlocks = resolverCommentsEnabled() ? post.extras?.commentBlocks || [] : [];
		if (commentBlocks.length > 0) await sendForwardBatched(e, post, buildResolverCommentNodes(commentBlocks, resolveEventForwardIdentity(e, post.displayName)), copy.commentPrompt, `查看${commentBlocks.length}条${copy.commentUnit}`);
	} catch {
		await directResolvedPost(e, post, text);
	}
};
const replyResolvedPost = async (e, result) => {
	if (isFailure(result)) {
		try {
			await sendWithMediaRetry((payload) => e.reply(payload), await renderCardImage({
				name: `resolver-error-${result.platform}`,
				html: buildErrorCardHtml({
					title: `${result.displayName}解析失败`,
					subtitle: result.displayName,
					reason: result.reason,
					suggestion: "可以检查 Cookie、代理和平台接口状态；渲染不可用时会自动退回文本提示。",
					details: [`platform=${result.platform}`]
				}),
				width: 920
			}));
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
		await replyResolverVideos(e, post);
		return;
	}
	if ((post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength) && canSendForward(e)) try {
		await replyResolvedPostForward(e, post, text);
	} catch {
		await directResolvedPost(e, post, text);
	}
	else await cardResolvedPost(e, post, text);
	await replyResolverVideos(e, post);
};
//#endregion
export { replyResolvedPost as a, canSendResolverForward as c, fetchResolverText as d, resolveResolverRedirectUrl as f, downloadFile as h, replyPlainText as i, resolveEventForwardIdentity as l, runFfmpeg as m, replyMusicList as n, replyText as o, cardStatusSnapshot as p, replyMusicPlayable as r, replyVoiceFileOrAudio as s, replyImage as t, fetchResolverJson as u };

//# sourceMappingURL=message.js.map