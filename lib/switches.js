import { a as setAllModules, c as moduleById, i as applySwitchChanges, l as offVerbs, o as snapshotGroupSwitches, r as isHiraAppEnabled, s as moduleByAlias, u as onVerbs } from "./runtime.js";
import { i as replyPlainText, o as replyText } from "./message.js";
// src/switches/commandParser.ts
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 长词优先：`通用解析` 不能被 `通用` 截走，`关闭` 不能被 `关` 截走 */
const byLengthDesc = (left, right) => right.length - left.length;
const aliasPattern = [...moduleByAlias.keys()].sort(byLengthDesc).map(escapeRegExp).join("|");
const offPattern = [...offVerbs].sort(byLengthDesc).map(escapeRegExp).join("|");
const onPattern = [...onVerbs].sort(byLengthDesc).map(escapeRegExp).join("|");
/**
* 命令体（不含开头的 `#`）。
* `#点歌开关` 这种「模块 + 开关」的写法也算状态查询，否则会被点歌当成搜索关键词。
*/
const switchBody = `(?:群\\s*\\d{5,}\\s*)?(?:开关|全部(?:${offPattern}|${onPattern})|(?:${aliasPattern})(?:${offPattern}|${onPattern}|开关))`;
/** 命令必须整条匹配，`#点歌 晴天` 这类正常点歌不会误伤 */
const switchCommandReg = new RegExp(`^#${switchBody}$`, "i");
/**
* 给同样以 `#点歌` 开头的命令用的负向断言：Karin 1.18 的命令按加载顺序匹配，
* 点歌文件排在开关前面，`#点歌关闭` 会先被点歌当成搜索「关闭」。
* 把这段拼在点歌正则最前面，相当于让关闭类命令永远优先匹配。
*/
const notSwitchCommandSource = `(?!#${switchBody}$)`;
/** `#群477640404 点歌关闭`：私聊里远程操作别的群 */
const groupPrefixReg = /^#\s*群\s*(\d{5,})\s*/;
const stripPrefix = (message) => {
	const trimmed = message.trim();
	const groupMatch = trimmed.match(groupPrefixReg);
	if (!groupMatch) return {
		rest: trimmed.replace(/^#/, "").trim(),
		groupId: void 0
	};
	return {
		rest: trimmed.slice(groupMatch[0].length).trim(),
		groupId: groupMatch[1]
	};
};
/** 从尾部切开关动词，返回剩余命令词与目标状态 */
const splitVerb = (body) => {
	for (const verb of [...onVerbs].sort(byLengthDesc)) if (body.length > verb.length && body.endsWith(verb)) return {
		word: body.slice(0, -verb.length),
		enabled: true
	};
	for (const verb of [...offVerbs].sort(byLengthDesc)) if (body.length > verb.length && body.endsWith(verb)) return {
		word: body.slice(0, -verb.length),
		enabled: false
	};
};
const resolveModuleId = (word) => {
	const key = word.toLowerCase();
	const direct = moduleByAlias.get(key);
	if (direct) return direct;
	const trimmed = key.replace(/功能$/, "");
	return moduleByAlias.get(trimmed);
};
const parseSwitchCommand = (message) => {
	if (!switchCommandReg.test(message)) return { type: "none" };
	const { rest, groupId } = stripPrefix(message);
	if (!rest) return { type: "none" };
	if (/^(?:开关|状态)$/i.test(rest)) return {
		type: "status",
		groupId
	};
	if (/开关$/i.test(rest)) return {
		type: "status",
		groupId,
		moduleId: resolveModuleId(rest.slice(0, -2))
	};
	const split = splitVerb(rest);
	if (!split) return { type: "none" };
	if (split.word === "全部" || split.word === "所有") return {
		type: "all",
		groupId,
		enabled: split.enabled
	};
	const moduleId = resolveModuleId(split.word);
	if (!moduleId) return { type: "none" };
	return {
		type: "toggle",
		groupId,
		moduleId,
		enabled: split.enabled
	};
};
// src/apps/switches.ts
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
			const label = moduleById.get(command.moduleId)?.label ?? command.moduleId;
			await replyPlainText(e, `${scope}开关状态｜${label}：${item ? stateText(item) : "未知"}`);
			return true;
		}
		await replyPlainText(e, statusLines(snapshotGroupSwitches(selfId, groupId)));
		return true;
	}
	if (command.type === "all") {
		const text = !setAllModules(selfId, groupId, command.enabled, e.userId) ? `${scope}已经是全部开启状态了，没改` : `${scope}已${command.enabled ? "开启" : "关闭"}全部功能`;
		await replyPlainText(e, text);
		return true;
	}
	const label = moduleById.get(command.moduleId)?.label ?? command.moduleId;
	const text = applySwitchChanges(selfId, groupId, [{
		moduleId: command.moduleId,
		enabled: command.enabled
	}], e.userId).length ? `${scope}${toggleText(label, command.enabled)}` : `${scope}本来就${command.enabled ? "开启" : "关闭"}了，没改`;
	await replyPlainText(e, text);
	return true;
};
export { switchCommandReg as i, toggleText as n, notSwitchCommandSource as r, switchHandler as t };

//# sourceMappingURL=switches.js.map