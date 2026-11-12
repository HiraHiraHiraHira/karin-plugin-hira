import { h as fetchJson, t as Config } from "./config.js";
import { isHiraAppEnabled } from "./apps/runtime.js";
import { i as replyPlainText } from "./message.js";
import karin from "node-karin";
// src/translate/commandParser.ts
const targetMap = {
	中: "zh",
	中文: "zh",
	英: "en",
	英文: "en",
	日: "ja",
	日文: "ja",
	韩: "ko",
	韩文: "ko",
	法: "fr",
	法文: "fr",
	德: "de",
	德文: "de",
	俄: "ru",
	俄文: "ru",
	文: "wyw",
	文言文: "wyw"
};
/** 长别名优先，保证 `翻中文hello` 取 `中文` 而不是 `中`。 */
const translateTargetAliases = Object.keys(targetMap).sort((left, right) => right.length - left.length);
const translateCommandReg = /^#?(?:翻|trans)/i;
/** 剥掉命令词，返回目标语言 + 正文；不是翻译命令时返回 undefined。 */
const splitTarget = (message) => {
	const trimmed = message.trim();
	const prefix = trimmed.match(translateCommandReg);
	if (!prefix) return void 0;
	const rest = trimmed.slice(prefix[0].length);
	for (const alias of translateTargetAliases) {
		if (!rest.startsWith(alias)) continue;
		return {
			target: targetMap[alias],
			text: rest.slice(alias.length).trim()
		};
	}
};
const parseTranslateCommand = (message) => {
	const parsed = splitTarget(message);
	if (!parsed?.text) return { type: "none" };
	return {
		type: "translate",
		target: parsed.target,
		text: parsed.text
	};
};
/** 无正文时仅解析目标语言（配合引用消息翻译），不是翻译命令时返回 undefined。 */
const parseTranslateTargetOnly = (message) => {
	const parsed = splitTarget(message);
	if (!parsed || parsed.text) return void 0;
	return parsed.target;
};
// src/translate/service.ts
/**
* 腾讯交互翻译（transmart）协议：
* 1. `text_analysis` 先探测源语言；
* 2. `auto_translation` 用探测到的源语言 + 目标语言出译文。
* 语言码沿用 R constants/constant.js 的 tencentTransMap（补齐云崽缺的法/德/文言文）。
*/
const transmartClientKey = "browser-firefox-111.0.0-Mac OS-d35fca23-eb48-45ba-9913-114f1177b02b-1679376552800";
const transmartUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0";
const transmartLangMap = {
	zh: "zh",
	en: "en",
	ja: "ja",
	ko: "ko",
	fr: "fr",
	de: "de",
	ru: "ru",
	wyw: "wyw"
};
/** R 探测失败时回落到 `en`；这里用 transmart 支持的 `auto`，避免把中文正文按英文再翻一次。 */
const fallbackSourceLang = "auto";
const callTransmart = async (body, timeoutMs) => fetchJson(Config.translate.tencentApi.trim(), {
	timeoutMs,
	method: "POST",
	body: JSON.stringify(body),
	headers: {
		"Content-Type": "application/json",
		"User-Agent": transmartUserAgent
	}
});
/** 探测源语言，失败时返回 `auto`（由后端自行判断），不阻塞翻译主流程。 */
const detectSourceLanguage = async (text, timeoutMs = Config.translate.timeoutSeconds * 1e3) => {
	if (!Config.translate.tencentApi.trim()) return fallbackSourceLang;
	try {
		const payload = await callTransmart({
			header: {
				fn: "text_analysis",
				client_key: transmartClientKey
			},
			text,
			type: "plain",
			normalize: { merge_broken_line: false }
		}, timeoutMs);
		if (payload.header?.ret_code === "succ" && typeof payload.language === "string" && payload.language) return payload.language;
	} catch {}
	return fallbackSourceLang;
};
const translateWithTransmart = async (text, target, sourceLang, timeoutMs) => {
	if (!Config.translate.tencentApi.trim()) throw new Error("未配置腾讯翻译接口");
	const payload = await callTransmart({
		header: {
			fn: "auto_translation",
			client_key: transmartClientKey
		},
		type: "plain",
		model_category: "normal",
		text_domain: "general",
		source: {
			lang: sourceLang,
			text_list: [
				"",
				text,
				""
			]
		},
		target: { lang: transmartLangMap[target] }
	}, timeoutMs);
	if (payload.header?.ret_code !== "succ") throw new Error(`接口返回 ${payload.header?.ret_code || "未知状态"}`);
	const translated = Array.isArray(payload.auto_translation) ? payload.auto_translation[1] : void 0;
	if (typeof translated !== "string" || !translated.trim()) throw new Error("接口没有返回译文");
	return translated.trim();
};
/** deeplxApi 允许逗号分隔多镜像，逐次随机选一个，避免单点镜像挂掉就整体失败。 */
const resolveDeeplxUrls = (raw) => raw.split(",").map((url) => url.trim()).filter(Boolean);
const translateText = async (text, target) => {
	if (target === "wyw") throw new Error("暂不支持翻译为文言文：当前翻译接口没有 wyw 语言支持。");
	const timeoutMs = Config.translate.timeoutSeconds * 1e3;
	const failures = [];
	const sourceLang = await detectSourceLanguage(text, timeoutMs);
	const deeplxUrls = resolveDeeplxUrls(Config.translate.deeplxApi);
	if (deeplxUrls.length > 0) {
		const url = deeplxUrls[Math.floor(Math.random() * deeplxUrls.length)];
		try {
			const payload = await fetchJson(url, {
				timeoutMs,
				method: "POST",
				body: JSON.stringify({
					text,
					source_lang: sourceLang === fallbackSourceLang ? sourceLang : sourceLang.toUpperCase(),
					target_lang: target.toUpperCase()
				}),
				headers: { "Content-Type": "application/json" }
			});
			const translated = typeof payload.data === "string" ? payload.data.trim() : "";
			if (translated) return translated;
			failures.push("DeepLX 没有返回译文");
		} catch (error) {
			failures.push(`DeepLX：${error instanceof Error ? error.message : String(error)}`);
		}
	}
	try {
		return await translateWithTransmart(text, target, sourceLang, timeoutMs);
	} catch (error) {
		failures.push(`腾讯翻译：${error instanceof Error ? error.message : String(error)}`);
	}
	throw new Error([
		`翻译失败：${failures.join("；")}`,
		"请检查 translate.yaml 的 deeplxApi / tencentApi 配置，或稍后重试。",
		"用法：翻中 hello（目标语言后可以不加空格）"
	].join("\n"));
};
// src/apps/translate.ts
/** 从消息元素里取引用段的 messageId：引用段只带 id，正文要再用 getMsg 取一次。 */
const findReplyId = (elements) => {
	if (!Array.isArray(elements)) return void 0;
	for (const el of elements) if (el && typeof el === "object" && "type" in el && "messageId" in el && el.type === "reply") {
		const id = el.messageId;
		if (typeof id === "string" && id) return id;
	}
};
/**
* 取 getMsg 返回值里的正文元素。
* karin 现行实现的返回体是 MessageResponse，正文在 elements；旧适配器只给 message。
* 先读 elements 再兜底 message，两者都没有时按“取不到正文”处理。
*/
const readQuotedElements = (quoted) => {
	if (!quoted || typeof quoted !== "object") return void 0;
	const record = quoted;
	for (const key of ["elements", "message"]) {
		const value = record[key];
		if (Array.isArray(value)) return value;
	}
};
/**
* 引用消息的纯文本。
* 只拼 text 段并 trim：图片/表情会被转成占位串，塞给翻译器只会得到噪声。
*/
const extractQuotedText = async (e) => {
	const replyId = findReplyId(e.elements);
	if (!replyId) return void 0;
	try {
		const elements = readQuotedElements(await e.bot.getMsg(e.contact, replyId));
		if (!elements) return void 0;
		return elements.filter((el) => el !== null && typeof el === "object" && "type" in el).filter((el) => el.type === "text").map((el) => typeof el.text === "string" ? el.text : "").join("").trim() || void 0;
	} catch {
		return;
	}
};
const translateReg = translateCommandReg;
const translateHandler = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.translate.enabled) return next?.();
	let command = parseTranslateCommand(e.msg);
	if (command.type === "none") {
		const target = parseTranslateTargetOnly(e.msg);
		if (!target) return next?.();
		const quoted = await extractQuotedText(e);
		if (!quoted) {
			await replyPlainText(e, "请附上要翻译的文本，或引用一条消息后重试");
			return true;
		}
		command = {
			type: "translate",
			target,
			text: quoted
		};
	}
	try {
		await e.reply(await translateText(command.text, command.target), { reply: true });
	} catch (error) {
		await replyPlainText(e, error instanceof Error ? error.message : String(error));
	}
	return true;
};
const translate = karin.command(translateReg, translateHandler, { name: "Hira-翻译" });
export { translateReg as a, translateHandler as i, findReplyId as n, translate as r, extractQuotedText as t };

//# sourceMappingURL=translate.js.map