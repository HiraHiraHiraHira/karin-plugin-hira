//#region src/resolvers/url.ts
const trailingPunctuation = /[，。！？、；;,.!?]+$/;
const cjkBoundary = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
const normalizeSharedUrl = (url) => {
	return url.replaceAll("\\/", "/").replace(/^https:(?!\/\/)\//, "https://").replace(/^http:(?!\/\/)\//, "http://").replace(trailingPunctuation, "");
};
/**
* QQ 分享卡片会把自己的登录凭据塞进 jumpUrl，解析请求和对外回显都不能带出去。
* 只作用于分享卡 jumpUrl；裸 `key`/`token` 是许多站点链接的功能参数，删掉会改坏链接，因此不收。
*/
const trackingCredential = /^(?:p_skey|skey|access_token|pass_ticket|ticket|clientkey|wxuin)$/i;
const stripTrackingCredentials = (url) => {
	try {
		const parsed = new URL(url);
		const credentials = [...parsed.searchParams.keys()].filter((key) => trackingCredential.test(key));
		if (credentials.length === 0) return url;
		for (const key of credentials) parsed.searchParams.delete(key);
		return parsed.toString();
	} catch {
		return url;
	}
};
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
const stringField = (value) => typeof value === "string" && value ? value : void 0;
const extractShareCardMeta = (message) => {
	const marker = message.indexOf("[json:");
	const news = parseJsonObjectFrom(message, marker >= 0 ? marker + 6 : 0)?.meta?.news;
	if (!news || typeof news !== "object") return void 0;
	const jumpUrl = stringField(news.jumpUrl || news.url);
	const meta = {
		jumpUrl: jumpUrl ? stripTrackingCredentials(normalizeSharedUrl(jumpUrl)) : void 0,
		title: stringField(news.title),
		desc: stringField(news.desc),
		preview: stringField(news.preview),
		tag: stringField(news.tag)
	};
	return Object.values(meta).some(Boolean) ? meta : void 0;
};
/** `[^\s"'<>]+` 会把中文正文一起吃进 token，所以先按首个中文标点或汉字截断。 */
const trimUrlToken = (token) => {
	const boundaryIndex = token.search(cjkBoundary);
	return (boundaryIndex >= 0 ? token.slice(0, boundaryIndex) : token).replace(trailingPunctuation, "");
};
const bareBvidPattern = /(?<![\p{L}\p{N}])BV[1-9A-HJ-NP-Za-km-z]{10}(?![\p{L}\p{N}_])(?!\.\w{1,4}\b)/u;
const bareAcPattern = /(?<![\p{L}\p{N}])ac\d{6,}(?![\p{L}\p{N}_])/u;
/** 聊天里常见的裸 ID（无链接纯文本分享）：补全成可解析的完整 URL。 */
const expandBareShareId = (message) => {
	const bvid = message.match(bareBvidPattern)?.[0];
	if (bvid) return `https://www.bilibili.com/video/${bvid.replace(/^bv/i, "BV")}`;
	const ac = message.match(bareAcPattern)?.[0];
	if (ac) return `https://www.acfun.cn/v/${ac}`;
};
const extractFirstUrl = (message) => {
	const shareMeta = extractShareCardMeta(message);
	if (shareMeta?.jumpUrl) return shareMeta.jumpUrl;
	const normalized = normalizeSharedUrl(message);
	const token = normalized.match(/https?:\/\/[^\s"'<>]+/)?.[0];
	if (token) return trimUrlToken(token);
	return expandBareShareId(normalized);
};
const hostnameOf = (url) => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return;
	}
};
//#endregion
export { extractShareCardMeta as n, hostnameOf as r, extractFirstUrl as t };

//# sourceMappingURL=url.js.map