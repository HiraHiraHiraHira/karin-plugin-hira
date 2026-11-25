import { a as setAllModules, c as moduleById, i as applySwitchChanges, o as snapshotGroupSwitches, r as isHiraAppEnabled } from "../runtime.js";
import { a as replyText, r as replyPlainText } from "../message.js";
import { n as parseSwitchCommand, r as switchCommandReg } from "../commandParser.js";
import karin from "node-karin";
//#region src/apps/switches.ts
const senderRole = (e) => {
	const role = e.sender?.role;
	return role === "owner" || role === "admin" ? role : void 0;
};
/** 群聊：群主/群管/机器人主人；私聊：只认主人 */
const canOperate = (e) => Boolean(e.isMaster || e.isAdmin || senderRole(e));
const isGroupMessage = (e) => Boolean(e.isGroup);
const groupIdOf = (e) => {
	const ctx = e;
	return ctx.groupId ?? ctx.contact?.peer ?? "";
};
/**
* 解析这条消息要操作哪个群。
* 群聊里默认就是当前群；带了 `#群<号>` 时只有主人能指到别的群，避免群管改到不相关的群。
*/
const resolveResource = (e, groupIdFromCommand) => {
	const inGroup = isGroupMessage(e);
	const currentGroupId = inGroup ? groupIdOf(e) : "";
	if (groupIdFromCommand) {
		if (inGroup && groupIdFromCommand !== currentGroupId && !e.isMaster) return { error: "只有机器人主人能操作其它群。" };
		if (!inGroup && !e.isMaster) return { error: "私聊只能由机器人主人操作。" };
		return {
			selfId: e.selfId,
			groupId: groupIdFromCommand,
			remote: !inGroup
		};
	}
	if (!inGroup) return { error: "私聊里请带上群号：#群123456789 点歌关闭" };
	if (!currentGroupId) return { error: "取不到当前群号，无法操作。" };
	return {
		selfId: e.selfId,
		groupId: currentGroupId,
		remote: false
	};
};
const stateText = (item) => {
	if (item.enabled) return "开启";
	if (item.mutedBy) return `随「${item.mutedBy}」关闭`;
	return "关闭";
};
const statusLines = (items) => {
	const lines = ["本群功能开关"];
	for (const item of items) {
		const indent = item.id.includes(":") ? "  " : "";
		lines.push(`${indent}${item.label}：${stateText(item)}`);
	}
	return lines.join("\n");
};
/**
* 回执必须把动词放在前面：「点歌已开启」以「点歌」开头，同群另一个 Bot 会把它当成
* 点歌搜索命令再处理一次（实测会触发一次 10 秒的搜索请求）。「已开启点歌」不会被误认。
*/
const toggleText = (label, enabled) => `${enabled ? "已开启" : "已关闭"}${label}`;
const switchHandler = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	const command = parseSwitchCommand(e.msg);
	if (command.type === "none") return next?.();
	if (!canOperate(e)) {
		await replyText(e, "只有群主、管理员或机器人主人能改开关。");
		return true;
	}
	const resource = resolveResource(e, command.groupId);
	if ("error" in resource) {
		await replyText(e, resource.error);
		return true;
	}
	const { selfId, groupId } = resource;
	const scope = resource.remote ? `群 ${groupId} ` : "";
	if (command.type === "status") {
		if (command.moduleId) {
			const item = snapshotGroupSwitches(selfId, groupId).find((entry) => entry.id === command.moduleId);
			await replyPlainText(e, `${scope}开关状态｜${moduleById.get(command.moduleId)?.label ?? command.moduleId}：${item ? stateText(item) : "未知"}`);
			return true;
		}
		await replyPlainText(e, statusLines(snapshotGroupSwitches(selfId, groupId)));
		return true;
	}
	if (command.type === "all") {
		await replyPlainText(e, !setAllModules(selfId, groupId, command.enabled, e.userId) ? `${scope}已经是全部开启状态了，没改` : `${scope}已${command.enabled ? "开启" : "关闭"}全部功能`);
		return true;
	}
	const label = moduleById.get(command.moduleId)?.label ?? command.moduleId;
	const changed = applySwitchChanges(selfId, groupId, [{
		moduleId: command.moduleId,
		enabled: command.enabled
	}], e.userId);
	if (command.enabled) {
		const item = snapshotGroupSwitches(selfId, groupId).find((entry) => entry.id === command.moduleId);
		if (item?.mutedBy) {
			await replyPlainText(e, `${scope}已开启${label}，但「${item.mutedBy}」还关着，得先把它开回来。`);
			return true;
		}
	}
	await replyPlainText(e, changed.length ? `${scope}${toggleText(label, command.enabled)}` : `${scope}本来就${command.enabled ? "开启" : "关闭"}了，没改`);
	return true;
};
/**
* 开关命令单独注册在自己这个文件里，别塞进 music.ts：
* `groups.json` 的 disable 是按产物文件名匹配的（`karin-plugin-hira:music.js`），
* 点歌被某个群禁掉时会把同文件的开关命令一起带走，群里就再也改不了开关。
*/
const switchesCommand = karin.command(switchCommandReg, switchHandler, { name: "Hira-功能开关" });
//#endregion
export { switchHandler, switchesCommand, toggleText };

//# sourceMappingURL=switches.js.map