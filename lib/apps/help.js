import { t as Config } from "../config.js";
import { createConfiguredCommandRegExp, isHiraAppEnabled } from "./runtime.js";
import { c as logCardRenderFailure, l as renderCardImage, n as buildHelpCardHtml } from "../cardRender.js";
import { i as replyPlainText } from "../message.js";
import karin from "node-karin";
// src/apps/help.ts
/** R apps/help.js 的别名表：菜单/help/说明/功能/指令/使用说明 都算帮助命令。 */
const helpAliases = [
	"hira\\s*帮助",
	"hi\\s*帮助",
	"菜单",
	"help",
	"说明",
	"功能",
	"指令",
	"使用说明"
];
const helpReg = createConfiguredCommandRegExp(Config.app.helpCommand, helpAliases);
const helpMenu = [
	{
		title: "常用功能",
		items: [{
			title: "自动识别分享链接",
			description: "按配置解析支持的平台链接。",
			icon: "↗"
		}, {
			title: "#hi状态 / #Hira状态",
			description: "查看功能开关、兼容模式和运行信息。",
			icon: "S"
		}]
	},
	{
		title: "点歌",
		items: [
			{
				title: "#点歌 <关键词>",
				description: "使用默认音乐源点歌。",
				icon: "♪"
			},
			{
				title: "#网易点歌 / #QQ点歌 / #酷我点歌 / #酷狗点歌 <关键词>",
				description: "指定音乐源搜索。",
				icon: "源"
			},
			{
				title: "#多选点歌 <关键词>",
				description: "返回列表后发送序号选择，#下一页 翻页。",
				icon: "列"
			},
			{
				title: "#歌词 / #语音 / 音乐 <B站链接>",
				description: "歌词、语音和 B站音乐链接。",
				icon: "声"
			},
			{
				title: "#提交音乐ck <源> <cookie>",
				description: "提交音乐 Cookie；#点歌ck检查 查看状态。",
				icon: "CK"
			}
		]
	},
	{
		title: "多平台解析",
		items: [{
			title: "微博 / 贴吧 / 小黑盒 / 通用小平台",
			description: "默认补足 KKK 之外的平台解析。",
			icon: "解"
		}, {
			title: "多图 / 长文 / 视频",
			description: "多图长文以合并聊天记录展示，视频按配置下载发送。",
			icon: "媒"
		}],
		subGroups: [{
			title: "关闭 KKK 兼容模式后接管",
			items: [{
				title: "B站 / 抖音 / 快手 / 小红书",
				description: "由 Hira 尝试完整解析并按配置下载视频。",
				icon: "接"
			}]
		}]
	},
	{
		title: "轻量与 AI",
		items: [
			{
				title: "#cat / #买家秀 / #累了",
				description: "轻量娱乐命令，多图以合并聊天记录展示。",
				icon: "玩"
			},
			{
				title: "#医药查询 [关键词]",
				description: "常用查询命令；不带关键词返回最新条目。",
				icon: "?"
			},
			{
				title: "#推荐软件 [关键词]",
				description: "不带关键词返回全部推荐和下载地址。",
				icon: "软"
			},
			{
				title: "翻中/翻英/翻日 <文本>",
				description: "文本翻译，目标语言后可以不加空格（翻中hello）。",
				icon: "译"
			},
			{
				title: "#总结一下 <链接>",
				description: "网页总结，需要先启用并配置 API Key；配置域名的链接会自动总结。",
				icon: "AI"
			}
		]
	},
	{
		title: "管理",
		items: [
			{
				title: "#Hira更新 / #hi更新",
				description: "检查插件更新，更新成功后自动重启 Karin。",
				icon: "更"
			},
			{
				title: "#点歌卡片状态",
				description: "查看卡片通道顺序、熔断状态和最近发送记录。",
				icon: "卡"
			},
			{
				title: "#hi清理垃圾 / #Hira清理垃圾",
				description: "清理下载和渲染临时文件。",
				icon: "清"
			}
		]
	}
];
const helpFallbackText = () => [
	"插件帮助",
	"",
	...helpMenu.flatMap((group) => [
		group.title,
		...group.items.map((item) => `${item.title} | ${item.description}`),
		""
	]),
	"默认不包含未列出的第三方平台功能。"
].join("\n").trim();
const replyHelp = async (e) => {
	try {
		const images = await renderCardImage({
			name: "help",
			html: buildHelpCardHtml(helpMenu),
			width: 920
		});
		await e.reply(images);
	} catch (error) {
		logCardRenderFailure("help", error);
		await replyPlainText(e, helpFallbackText());
	}
};
const help = karin.command(helpReg, async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!createConfiguredCommandRegExp(Config.app.helpCommand, helpAliases).test(e.msg.trim())) return next?.();
	await replyHelp(e);
	return true;
}, { name: "Hira-帮助" });
export { help, helpAliases, helpFallbackText, helpMenu, helpReg, replyHelp };

//# sourceMappingURL=help.js.map