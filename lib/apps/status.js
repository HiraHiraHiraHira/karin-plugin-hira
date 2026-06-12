import { o as Root, t as Config } from "../config-BFMeS00C.js";
import { d as buildStatusCardHtml, f as logCardRenderFailure, o as replyText, p as renderCardImage } from "../message-tlVwsfIp.js";
import { t as cleanupRuntimeTemp } from "../temp-CGGBIhnK.js";
import karin from "node-karin";
//#region src/apps/status.ts
const statusReg = /^#?(?:hira|hi)\s*状态$/i;
const cleanupReg = /^#?(?:(?:hira|hi)\s*)?清理垃圾$/i;
const switchStatus = (enabled) => enabled ? "ok" : "off";
const switchText = (enabled) => enabled ? "开启" : "关闭";
const statusText = () => [
	`${Root.pluginName} v${Root.pluginVersion}`,
	`点歌：${Config.music.enabled ? "开启" : "关闭"}，默认源：${Config.music.defaultSource}`,
	`多平台解析：${Config.resolver.enabled ? "开启" : "关闭"}，KKK兼容：${Config.resolver.kkkCompat ? "开启" : "关闭"}`,
	`轻量命令：${Config.light.enabled ? "开启" : "关闭"}，翻译：${Config.translate.enabled ? "开启" : "关闭"}`,
	`AI总结：${Config.ai.summaryEnabled ? "开启" : "关闭"}`,
	`ffmpeg：${Config.runtime.ffmpegPath}`
].join("\n");
const replyStatus = async (e) => {
	try {
		const images = await renderCardImage({
			name: "status",
			html: buildStatusCardHtml({
				title: "运行状态",
				subtitle: `${Root.pluginName} v${Root.pluginVersion}`,
				eyebrow: "SYSTEM.STATUS",
				items: [
					{
						label: "点歌",
						value: switchText(Config.music.enabled),
						detail: `默认源：${Config.music.defaultSource}`,
						status: switchStatus(Config.music.enabled)
					},
					{
						label: "多平台解析",
						value: switchText(Config.resolver.enabled),
						detail: `KKK 兼容：${switchText(Config.resolver.kkkCompat)}`,
						status: switchStatus(Config.resolver.enabled)
					},
					{
						label: "轻量命令",
						value: switchText(Config.light.enabled),
						detail: `翻译：${switchText(Config.translate.enabled)}`,
						status: switchStatus(Config.light.enabled)
					},
					{
						label: "AI 总结",
						value: switchText(Config.ai.summaryEnabled),
						detail: Config.ai.model,
						status: switchStatus(Config.ai.summaryEnabled)
					},
					{
						label: "ffmpeg",
						value: Config.runtime.ffmpegPath || "未配置",
						detail: "用于合并 B站 DASH 视频和音频。",
						status: Config.runtime.ffmpegPath ? "info" : "warn"
					}
				]
			}),
			width: 920
		});
		await e.reply(images);
	} catch (error) {
		logCardRenderFailure("status", error);
		await replyText(e, statusText());
	}
};
const status = karin.command(statusReg, async (e) => {
	await replyStatus(e);
	return true;
}, { name: "Hira-状态" });
const cleanup = karin.command(cleanupReg, async (e) => {
	const result = cleanupRuntimeTemp();
	await replyText(e, `清理完成：删除 ${result.deletedFiles} 个文件，${result.deletedDirs} 个空目录`);
	return true;
}, {
	name: "Hira-清理垃圾",
	perm: "master"
});
//#endregion
export { cleanup, cleanupReg, replyStatus, status, statusReg, statusText };

//# sourceMappingURL=status.js.map