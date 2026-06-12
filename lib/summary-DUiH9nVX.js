import { t as Config } from "./config-BFMeS00C.js";
import { o as replyText } from "./message-tlVwsfIp.js";
import { n as fetchText, t as fetchJson } from "./http-CckAyz66.js";
import karin from "node-karin";
//#region src/summary/service.ts
const stripHtml = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
const readWebPageText = async (url) => {
	return stripHtml(await fetchText(url, { timeoutMs: 2e4 })).slice(0, Config.ai.maxInputChars);
};
const summarizeUrl = async (url) => {
	if (!Config.ai.summaryEnabled) throw new Error("网页总结未开启");
	if (!Config.ai.apiKey.trim()) throw new Error("未配置 AI API Key，无法总结");
	const text = await readWebPageText(url);
	if (!text) throw new Error("没有读取到可总结的网页正文");
	const summary = (await fetchJson(`${Config.ai.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
		timeoutMs: 6e4,
		method: "POST",
		headers: {
			Authorization: `Bearer ${Config.ai.apiKey}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			model: Config.ai.model,
			messages: [{
				role: "system",
				content: "你是网页总结助手。请用中文总结核心内容、要点和需要注意的信息。"
			}, {
				role: "user",
				content: `链接：${url}\n\n正文：\n${text}`
			}],
			temperature: .2
		})
	})).choices?.[0]?.message?.content?.trim();
	if (!summary) throw new Error("AI 接口没有返回总结");
	const readingMinutes = Math.max(1, Math.round(text.length / 500));
	return `网页总结\n原文约 ${text.length} 字，预计阅读 ${readingMinutes} 分钟。\n\n${summary}`;
};
//#endregion
//#region src/apps/summary.ts
const summaryReg = /^#?总结一下\s+(https?:\/\/[^\s"'<>]+)$/i;
const summary = karin.command(summaryReg, async (e, next) => {
	const match = e.msg.trim().match(summaryReg);
	if (!match?.[1]) return next?.();
	try {
		await replyText(e, "识别：网页总结，正在为您总结，请稍等...");
		await replyText(e, await summarizeUrl(match[1]));
	} catch (error) {
		await replyText(e, error instanceof Error ? error.message : String(error));
	}
	return true;
}, {
	name: "Hira-AI总结",
	priority: 660
});
//#endregion
export { summary as t };

//# sourceMappingURL=summary-DUiH9nVX.js.map