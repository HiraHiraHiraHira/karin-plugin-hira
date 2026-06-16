import { n as isHiraAppEnabled, r as Config } from "./runtime.js";
import { o as replyText } from "./message.js";
import { t as fetchJson } from "./http.js";
import karin from "node-karin";
//#region src/translate/commandParser.ts
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
	俄文: "ru"
};
const parseTranslateCommand = (message) => {
	const match = message.trim().match(/^翻(\S+)\s+([\s\S]+)$/);
	if (!match) return { type: "none" };
	const target = targetMap[match[1]];
	const text = match[2]?.trim();
	if (!target || !text) return { type: "none" };
	return {
		type: "translate",
		target,
		text
	};
};
//#endregion
//#region src/translate/service.ts
const translateText = async (text, target) => {
	const timeoutMs = Config.translate.timeoutSeconds * 1e3;
	if (Config.translate.deeplxApi.trim()) try {
		const payload = await fetchJson(Config.translate.deeplxApi, {
			timeoutMs,
			method: "POST",
			body: JSON.stringify({
				text,
				source_lang: "auto",
				target_lang: target.toUpperCase()
			}),
			headers: { "Content-Type": "application/json" }
		});
		if (payload.data) return payload.data;
	} catch {}
	const payload = await fetchJson(Config.translate.tencentApi, {
		timeoutMs,
		method: "POST",
		body: JSON.stringify({
			source: "auto",
			target,
			source_text: text,
			text
		}),
		headers: { "Content-Type": "application/json" }
	});
	const translated = payload.target_text ?? payload.data?.target_text ?? payload.data?.translation;
	if (!translated) throw new Error("翻译接口没有返回结果");
	return translated;
};
const translate = karin.command(/^翻\S+\s+[\s\S]+$/i, async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.translate.enabled) return next?.();
	const command = parseTranslateCommand(e.msg);
	if (command.type === "none") return next?.();
	try {
		await replyText(e, await translateText(command.text, command.target));
	} catch (error) {
		await replyText(e, error instanceof Error ? error.message : String(error));
	}
	return true;
}, {
	name: "Hira-翻译",
	priority: 670
});
//#endregion
export { translate as t };

//# sourceMappingURL=translate.js.map