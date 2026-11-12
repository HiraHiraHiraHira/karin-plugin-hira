import { isHiraAppEnabled } from "./runtime.js";
import { o as replyText, p as cardStatusSnapshot } from "../message.js";
import karin from "node-karin";
// src/apps/musicCardStatus.ts
const musicCardStatusReg = /^#?(?:(?:hira|hi)\s*)?点歌卡片状态$/i;
const isAdminOrMaster = (e) => {
	const ctx = e;
	const role = ctx.sender?.role;
	return Boolean(ctx.isMaster) || role === "admin" || role === "owner";
};
const timeText = (at) => new Date(at).toTimeString().slice(0, 8);
const musicCardStatusText = () => {
	const snapshot = cardStatusSnapshot();
	const { platform, oidb, ark, music } = snapshot.stats;
	const platformMap = Object.entries(snapshot.platformTypes).filter(([, value]) => String(value).trim()).map(([source, type]) => `${source}=${String(type)}`).join("、") || "未映射任何平台";
	const lines = [
		"点歌卡片状态",
		`通道顺序：${snapshot.order.join(" -> ")}`,
		`文字兜底：${snapshot.textFallback ? "开启" : "关闭"}`,
		`platform：${snapshot.platformEnabled ? "开启" : "关闭"}（${platformMap}）`,
		`oidb：${snapshot.oidbEnabled ? "开启" : "关闭"}（本机拼包，不依赖第三方）`,
		`oidb 熔断：${snapshot.oidbBlocked ? "是" : "否"}（连续失败 ${snapshot.oidbFailures}/${snapshot.breaker.failThreshold}）`,
		`ark：${snapshot.arkConfigured ? `已配置 key（${snapshot.arkApiUrl}）` : "未配置 key，自动跳过"}`,
		`ark 熔断：${snapshot.arkBlocked ? "是" : "否"}（连续失败 ${snapshot.arkFailures}/${snapshot.breaker.failThreshold}，冷却 ${snapshot.breaker.cooldownSeconds}s）`,
		`music 通道：${snapshot.musicEnabled ? "开启" : "关闭"}`,
		`统计：platform ok ${platform.ok} / fail ${platform.fail} / skip ${platform.skip}；oidb ok ${oidb.ok} / fail ${oidb.fail} / skip ${oidb.skip}；ark ok ${ark.ok} / fail ${ark.fail} / skip ${ark.skip}；music ok ${music.ok} / fail ${music.fail} / skip ${music.skip}`,
		"最近记录："
	];
	if (!snapshot.recent.length) lines.push("  （暂无）");
	else for (const record of snapshot.recent.slice(0, 10)) {
		const cause = record.cause ? ` cause=${record.cause}` : "";
		lines.push(`  ${timeText(record.at)} ${record.channel} ${record.ok ? "ok" : "fail"} ${record.ms}ms ${record.title}${cause}`);
	}
	return lines.join("\n");
};
const musicCardStatus = karin.command(musicCardStatusReg, async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!isAdminOrMaster(e)) {
		await replyText(e, "仅管理员/群主/机器人主人可执行该命令。");
		return true;
	}
	await replyText(e, musicCardStatusText());
	return true;
}, { name: "Hira-点歌卡片状态" });
export { musicCardStatus, musicCardStatusReg, musicCardStatusText };

//# sourceMappingURL=musicCardStatus.js.map