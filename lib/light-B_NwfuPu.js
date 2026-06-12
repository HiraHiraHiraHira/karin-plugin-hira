import { t as Config } from "./config-BFMeS00C.js";
import { o as replyText, t as replyImage } from "./message-tlVwsfIp.js";
import { t as fetchJson } from "./http-CckAyz66.js";
import karin from "node-karin";
//#region src/light/commandParser.ts
const parseLightCommand = (message) => {
	const msg = message.trim();
	if (/^#?cat$/i.test(msg)) return { type: "cat" };
	if (/^#?买家秀$/.test(msg)) return { type: "buyerShow" };
	if (/^#?累了$/.test(msg)) return { type: "tired" };
	const medicine = msg.match(/^#?医药查询\s+(.+)$/);
	if (medicine?.[1]?.trim()) return {
		type: "medicine",
		keyword: medicine[1].trim()
	};
	const software = msg.match(/^#?推荐软件\s+(.+)$/);
	if (software?.[1]?.trim()) return {
		type: "software",
		keyword: software[1].trim()
	};
	return { type: "none" };
};
//#endregion
//#region src/light/service.ts
const firstString = (value) => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(firstString).find(Boolean);
	if (value && typeof value === "object") {
		const obj = value;
		return firstString(obj.url) ?? firstString(obj.imgurl) ?? firstString(obj.image) ?? firstString(obj.pic);
	}
};
const stripHtml = (value) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const fetchFirstImage = async (apis, title) => {
	for (const api of apis) try {
		const url = firstString(await fetchJson(api));
		if (url) return {
			type: "image",
			title,
			url
		};
	} catch {}
	throw new Error(`${title}接口暂时不可用`);
};
const getCatImage = () => fetchFirstImage(Config.light.catApis, "猫图");
const getBuyerShowImage = () => fetchFirstImage(Config.light.buyerShowApis, "买家秀");
const getTiredImage = () => fetchFirstImage(Config.light.tiredApis, "累了");
const normalizeListText = (payload, emptyText) => {
	const root = payload;
	const data = root.data ?? root.result ?? root.list;
	const lines = (Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : []).slice(0, 5).map((item, index) => {
		const obj = item;
		const title = String(obj.title ?? obj.name ?? obj.goodsName ?? obj.softName ?? `结果 ${index + 1}`);
		const desc = stripHtml(String(obj.introduction ?? obj.desc ?? obj.description ?? obj.content ?? ""));
		const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? "");
		return [
			`${index + 1}. ${title}`,
			desc,
			url
		].filter(Boolean).join("\n");
	});
	return lines.length ? lines.join("\n\n") : emptyText;
};
const queryMedicine = async (keyword) => {
	return {
		type: "text",
		title: "医药查询",
		text: normalizeListText(await fetchJson(Config.light.medicineApi.replace("{keyword}", encodeURIComponent(keyword))), "未找到相关医药信息")
	};
};
const querySoftware = async (keyword) => {
	return {
		type: "text",
		title: "推荐软件",
		text: normalizeListText(await fetchJson(Config.light.softwareApi.replace("{keyword}", encodeURIComponent(keyword))), "未找到相关软件")
	};
};
const light = karin.command(/^#?(?:cat|买家秀|累了|医药查询\s+.+|推荐软件\s+.+)$/i, async (e, next) => {
	if (!Config.light.enabled) return next?.();
	const command = parseLightCommand(e.msg);
	if (command.type === "none") return next?.();
	try {
		const result = command.type === "cat" ? await getCatImage() : command.type === "buyerShow" ? await getBuyerShowImage() : command.type === "tired" ? await getTiredImage() : command.type === "medicine" ? await queryMedicine(command.keyword) : await querySoftware(command.keyword);
		if (result.type === "image") await replyImage(e, result.url, result.title);
		else await replyText(e, `${result.title}\n${result.text}`);
	} catch (error) {
		await replyText(e, error instanceof Error ? error.message : String(error));
	}
	return true;
}, {
	name: "Hira-轻量命令",
	priority: 680
});
//#endregion
export { light as t };

//# sourceMappingURL=light-B_NwfuPu.js.map