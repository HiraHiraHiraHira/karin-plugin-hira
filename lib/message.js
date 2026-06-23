import { r as Config } from "./runtime.js";
import { a as buildResolverPreviewCardHtml, c as logCardRenderFailure, d as dedupeRichContentBlocks, f as imageQuality, i as buildResolverCardHtml, l as renderCardImage, p as isUsableImageUrl, r as buildMusicListCardHtml, t as buildErrorCardHtml, u as dedupeImageUrls } from "./cardRender.js";
import { common, segment } from "node-karin";
import * as fs$1 from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
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
	if (!url?.trim()) throw new Error("empty playable URL");
	return url;
};
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
const coverFetchTimeoutMs = 8e3;
const inlinePreviewCover = async (post, fetcher = fetch) => {
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
		const bytes = Buffer.from(await response.arrayBuffer());
		const contentType = response.headers.get("content-type")?.split(";")[0] || contentTypeFromUrl(coverUrl);
		return {
			...post,
			extras: {
				...post.extras,
				coverUrl: `data:${contentType};base64,${bytes.toString("base64")}`
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
	const { item } = playable;
	const artists = formatArtists(item.artists);
	const elements = [
		item.coverUrl ? segment.image(item.coverUrl) : void 0,
		segment.customMusic(item.pageUrl, playable.audioUrl, item.title, artists, item.coverUrl || ""),
		segment.text(`${item.title} - ${artists}\n${item.pageUrl}`)
	].filter(Boolean);
	try {
		await e.reply(elements);
	} catch {
		await e.reply(`${prefix()}：${item.title} - ${artists}\n${playable.audioUrl || item.pageUrl}`);
	}
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
//#endregion
export { replyResolvedPost as a, normalizeDuration as c, replyPlainText as i, requirePlayableUrl as l, replyMusicList as n, replyText as o, replyMusicPlayable as r, replyVoiceFileOrAudio as s, replyImage as t };

//# sourceMappingURL=message.js.map