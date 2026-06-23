import { t as Root } from "./root.js";
import { n as isHiraAppEnabled, r as Config, t as createConfiguredCommandRegExp } from "./runtime.js";
import { c as logCardRenderFailure, l as renderCardImage, s as buildUpdateCardHtml } from "./cardRender.js";
import karin, { checkGitPluginUpdate, checkPkgUpdate, config, db, exec, getLocalCommitHash, getRemoteCommitHash, hooks, restart, segment, updateGitPlugin, updatePkg } from "node-karin";
import fs from "node:fs";
import path from "node:path";
//#region src/runtime/semver.ts
const isSemverGreater = (remote, local) => {
	if (!remote || !local) return false;
	const parse = (value) => {
		const [withoutBuild] = value.trim().replace(/^[vV]/, "").split("+", 2);
		const [core, prereleaseText] = withoutBuild.split("-", 2);
		const [major = "0", minor = "0", patch = "0"] = core.split(".");
		return {
			major: Number.parseInt(major, 10) || 0,
			minor: Number.parseInt(minor, 10) || 0,
			patch: Number.parseInt(patch, 10) || 0,
			prerelease: prereleaseText ? prereleaseText.split(".") : []
		};
	};
	const compareIdentifier = (left, right) => {
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric && rightNumeric) {
			const leftNumber = Number.parseInt(left, 10);
			const rightNumber = Number.parseInt(right, 10);
			if (leftNumber === rightNumber) return 0;
			return leftNumber > rightNumber ? 1 : -1;
		}
		if (leftNumeric) return -1;
		if (rightNumeric) return 1;
		if (left === right) return 0;
		return left > right ? 1 : -1;
	};
	const remoteVersion = parse(remote);
	const localVersion = parse(local);
	if (remoteVersion.major !== localVersion.major) return remoteVersion.major > localVersion.major;
	if (remoteVersion.minor !== localVersion.minor) return remoteVersion.minor > localVersion.minor;
	if (remoteVersion.patch !== localVersion.patch) return remoteVersion.patch > localVersion.patch;
	const remotePrerelease = remoteVersion.prerelease;
	const localPrerelease = localVersion.prerelease;
	if (remotePrerelease.length === 0 && localPrerelease.length === 0) return false;
	if (remotePrerelease.length === 0) return true;
	if (localPrerelease.length === 0) return false;
	const length = Math.min(remotePrerelease.length, localPrerelease.length);
	for (let index = 0; index < length; index += 1) {
		const result = compareIdentifier(remotePrerelease[index], localPrerelease[index]);
		if (result !== 0) return result > 0;
	}
	return remotePrerelease.length > localPrerelease.length;
};
//#endregion
//#region src/apps/update.ts
const UPDATE_LOCK_KEY = "hira:update:lock";
const UPDATE_MSGID_KEY = "hira:update:msgId";
const updateReg = createConfiguredCommandRegExp("#Hira更新", ["hira\\s*更新", "hi\\s*更新"]);
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const isNpmNotFoundError = (error) => {
	const message = errorMessage(error);
	return message.includes("E404") || message.includes("404 Not Found") || message.includes("is not in this registry");
};
const hasGitDir = (dir) => fs.existsSync(path.join(dir, ".git"));
const readPackageDependencySpec = (cwd) => {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
		return pkg.dependencies?.[Root.pluginName] || pkg.devDependencies?.[Root.pluginName] || pkg.optionalDependencies?.[Root.pluginName];
	} catch {
		return;
	}
};
const resolveGitUpdateTarget = (pluginPath = Root.pluginPath, cwd = process.cwd()) => {
	if (hasGitDir(pluginPath)) return {
		path: pluginPath,
		refreshInstall: false
	};
	const spec = readPackageDependencySpec(cwd);
	if (spec?.startsWith("file:")) {
		const sourcePath = path.resolve(cwd, spec.slice(5));
		if (hasGitDir(sourcePath)) return {
			path: sourcePath,
			refreshInstall: true
		};
	}
	const siblingPath = path.resolve(cwd, "..", Root.pluginName);
	if (hasGitDir(siblingPath)) return {
		path: siblingPath,
		refreshInstall: true
	};
};
const refreshFileInstall = async () => {
	const cwd = process.cwd();
	const result = await exec(fs.existsSync(path.join(cwd, "pnpm-lock.yaml")) ? "pnpm install --force" : "npm install", { cwd });
	if (typeof result === "boolean") return result;
	return result.status;
};
const replyUpdateText = async (e, text, options) => {
	const payload = `${Config.app.replyPrefix}：${text}`;
	if (options) return e.reply(payload, options);
	return e.reply(payload);
};
const updateSourceText = (update) => "source" in update && update.source === "git" ? "Git" : "npm";
const displayVersion = (version) => version.trim().match(/^v/i) ? version.trim() : `v${version.trim()}`;
const currentPluginVersionText = () => displayVersion(Root.pluginVersion);
const gitCommitMeta = (local, remote) => [{
	label: "当前提交",
	value: local
}, ...remote ? [{
	label: "远程提交",
	value: remote
}] : []];
const gitVersionFallbackText = (title, local, remote, extraLines = []) => [
	title,
	`当前版本：${currentPluginVersionText()}`,
	`当前提交：${local}`,
	...remote ? [`远程提交：${remote}`] : [],
	...extraLines
].join("\n");
const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "");
const updateDetailLines = (value) => stripAnsi(value || "").split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean).slice(0, 6);
const replyUpdateCard = async (e, options, fallbackText, replyOptions) => {
	try {
		const payload = await renderCardImage({
			name: "update",
			html: buildUpdateCardHtml(options),
			width: 920
		});
		if (replyOptions) return e.reply(payload, replyOptions);
		return e.reply(payload);
	} catch (error) {
		logCardRenderFailure("update", error);
		return replyUpdateText(e, fallbackText, replyOptions);
	}
};
const clearUpdateNoticeState = async () => {
	try {
		await db.del(UPDATE_MSGID_KEY);
		await db.del(UPDATE_LOCK_KEY);
	} catch {}
};
const checkGitUpdate = async () => {
	const target = resolveGitUpdateTarget();
	if (!target) return {
		status: "error",
		error: /* @__PURE__ */ new Error(`${Root.pluginName} 未发布到 npm，且当前安装目录不是 Git 仓库。请使用 Git 克隆安装，或在宿主项目 package.json 中使用 file: 指向源码仓库。`),
		source: "git"
	};
	const update = await checkGitPluginUpdate(target.path);
	if (update.status === "error") return {
		status: "error",
		error: update.data instanceof Error ? update.data : new Error(String(update.data)),
		source: "git"
	};
	const local = await getLocalCommitHash(target.path, { short: true }).catch(() => Root.pluginVersion);
	if (update.status === "no") return {
		status: "no",
		local,
		path: target.path,
		refreshInstall: target.refreshInstall,
		source: "git"
	};
	return {
		status: "yes",
		local,
		remote: await getRemoteCommitHash(target.path, { short: true }).catch(() => `origin +${update.count}`),
		count: update.count,
		data: update.data,
		path: target.path,
		refreshInstall: target.refreshInstall,
		source: "git"
	};
};
const checkAvailableUpdate = async () => {
	const update = await checkPkgUpdate(Root.pluginName, { compare: "semver" });
	if (update.status === "error" && isNpmNotFoundError(update.error)) return checkGitUpdate();
	return update;
};
const updateByGit = async (update, e) => {
	await replyUpdateCard(e, {
		state: "available",
		title: "发现 Git 更新",
		subtitle: `检测到 ${update.count} 次新提交，更新前先展示摘要。`,
		current: currentPluginVersionText(),
		latest: currentPluginVersionText(),
		source: "Git",
		lagCount: update.count,
		meta: gitCommitMeta(update.local, update.remote),
		details: updateDetailLines(update.data),
		tip: `将开始更新 ${Root.pluginName}，成功后自动重启 Karin。`
	}, gitVersionFallbackText("检测到 Git 更新", update.local, update.remote, [`落后 ${update.count} 次提交，开始更新 ${Root.pluginName} ...`]), { reply: true });
	const result = await updateGitPlugin(update.path);
	if (result.status !== "ok") {
		await replyUpdateText(e, `${Root.pluginName} Git 更新失败: ${result.data instanceof Error ? result.data.message : result.data}`);
		return;
	}
	if (update.refreshInstall && !await refreshFileInstall()) {
		await replyUpdateText(e, `${Root.pluginName} Git 更新成功，但刷新 file 依赖失败。请在 Karin 目录执行 pnpm install --force 后重启。`);
		return;
	}
	const msgResult = await replyUpdateText(e, `${Root.pluginName} Git 更新成功！\n${result.commit || result.data}\n开始执行重启......`);
	if (msgResult.messageId) await clearUpdateNoticeState();
	await restart(e.selfId, e.contact, msgResult.messageId);
};
const handleHiraUpdate = async (e) => {
	try {
		const update = await checkAvailableUpdate();
		if (update.status === "error") {
			await replyUpdateText(e, `获取远程版本失败：${errorMessage(update.error)}`);
			return;
		}
		if (update.status === "no") {
			const source = updateSourceText(update);
			await replyUpdateCard(e, {
				state: "latest",
				title: "当前已是最新版本",
				subtitle: `${source} 检查完成，没有发现新的可用更新。`,
				current: source === "Git" ? currentPluginVersionText() : displayVersion(update.local),
				latest: source === "Git" ? currentPluginVersionText() : displayVersion(update.local),
				source,
				lagCount: 0,
				meta: source === "Git" ? gitCommitMeta(update.local) : void 0,
				tip: source === "Git" ? "Hira 当前 Git 提交已与远程保持一致。" : "Hira 当前 npm 版本已是可用最新版本。"
			}, source === "Git" ? gitVersionFallbackText("当前已是最新版本", update.local) : `当前已是最新版本：${update.local}`, { reply: true });
			return;
		}
		if ("source" in update && update.source === "git") {
			await updateByGit(update, e);
			return;
		}
		if (!isSemverGreater(update.remote, update.local)) {
			await replyUpdateCard(e, {
				state: "preview",
				title: "当前已是最新或预览版本",
				subtitle: "远程稳定版本没有高于当前版本，暂不执行更新。",
				current: displayVersion(update.local),
				latest: displayVersion(update.remote),
				source: "npm",
				tip: "如果这是预览版或本地开发版，保持当前版本即可。"
			}, `当前已是最新或预览版本：${update.local}`, { reply: true });
			return;
		}
		await replyUpdateCard(e, {
			state: "available",
			title: "发现可用更新",
			subtitle: "检测到 npm 远程版本更新，更新前先展示摘要。",
			current: displayVersion(update.local),
			latest: displayVersion(update.remote),
			source: "npm",
			tip: `将开始更新 ${Root.pluginName}，成功后自动重启 Karin。`
		}, `检测到可用更新：${update.local} -> ${update.remote}\n开始更新 ${Root.pluginName} ...`, { reply: true });
		const result = await updatePkg(Root.pluginName);
		if (result.status !== "ok") {
			await replyUpdateText(e, `${Root.pluginName} 更新失败: ${result.data ?? "更新执行失败"}`);
			return;
		}
		const msgResult = await replyUpdateText(e, `${Root.pluginName} 更新成功！\n${result.local} -> ${result.remote}\n开始执行重启......`);
		if (msgResult.messageId) await clearUpdateNoticeState();
		await restart(e.selfId, e.contact, msgResult.messageId);
	} catch (error) {
		await replyUpdateText(e, `${Root.pluginName} 更新失败: ${errorMessage(error)}`);
	}
};
const shouldNotifyForLockedVersion = async (remoteVersion) => {
	try {
		const lockedVersion = await db.get(UPDATE_LOCK_KEY);
		if (typeof lockedVersion !== "string" || lockedVersion.length === 0) return true;
		if (!isSemverGreater(lockedVersion, Root.pluginVersion)) {
			await db.del(UPDATE_LOCK_KEY);
			return true;
		}
		return isSemverGreater(remoteVersion, lockedVersion);
	} catch {
		return true;
	}
};
const lockNotifiedVersion = async (remoteVersion) => {
	try {
		await db.set(UPDATE_LOCK_KEY, remoteVersion);
	} catch {}
};
const updateReminderText = (localVersion, remoteVersion) => [
	`${Root.pluginName} 有新的更新！`,
	`当前版本：${localVersion}`,
	`最新版本：${remoteVersion}`,
	"",
	"回复这条消息“更新”可自动更新并重启。",
	"也可以发送 #Hira更新 手动检查。"
].join("\n");
const gitUpdateReminderText = (update) => [
	`${Root.pluginName} 有新的更新！`,
	`当前版本：${currentPluginVersionText()}`,
	`当前提交：${update.local}`,
	`远程提交：${update.remote}`,
	`落后提交：${update.count} 次`,
	"",
	"回复这条消息“更新”可自动更新并重启。",
	"也可以发送 #Hira更新 手动检查。"
].join("\n");
const updateReminderCardMessage = async (update) => {
	const source = updateSourceText(update);
	try {
		const images = await renderCardImage({
			name: "update",
			html: buildUpdateCardHtml({
				state: "available",
				title: source === "Git" ? "发现 Git 更新" : "发现可用更新",
				subtitle: "回复这条消息“更新”可自动更新并重启。",
				current: source === "Git" ? currentPluginVersionText() : displayVersion(update.local),
				latest: source === "Git" ? currentPluginVersionText() : displayVersion(update.remote),
				source,
				lagCount: "source" in update && update.source === "git" ? update.count : void 0,
				meta: "source" in update && update.source === "git" ? gitCommitMeta(update.local, update.remote) : void 0,
				details: "source" in update && update.source === "git" ? updateDetailLines(update.data) : void 0,
				tip: "也可以发送 #Hira更新 手动检查。"
			}),
			width: 920
		});
		return [segment.text(`${Root.pluginName} 有新的更新！`), ...images];
	} catch (error) {
		logCardRenderFailure("update-reminder", error);
		if ("source" in update && update.source === "git") return [segment.text(gitUpdateReminderText(update))];
		return [segment.text(updateReminderText(update.local, update.remote))];
	}
};
const checkAndNotifyUpdate = async () => {
	const update = await checkAvailableUpdate().catch(() => void 0);
	if (!update || update.status !== "yes") return true;
	if (!("source" in update) && !isSemverGreater(update.remote, update.local)) return true;
	if (!await shouldNotifyForLockedVersion(update.remote)) return true;
	await lockNotifiedVersion(update.remote);
	const masters = config.master().filter((id) => id !== "console");
	if (masters.length === 0) return true;
	const botItems = karin.getAllBotList().filter((item) => item.bot.account.name !== "console");
	if (botItems.length === 0) return true;
	const friendsMap = /* @__PURE__ */ new Map();
	await Promise.all(botItems.map(async (item) => {
		try {
			const friends = await item.bot.getFriendList();
			friendsMap.set(item.bot.account.selfId, Array.isArray(friends) ? friends : []);
		} catch {
			friendsMap.set(item.bot.account.selfId, []);
		}
	}));
	const masterToBot = /* @__PURE__ */ new Map();
	for (const master of masters) {
		const matched = botItems.find((item) => (friendsMap.get(item.bot.account.selfId) || []).some((friend) => friend.userId === master));
		if (matched) masterToBot.set(master, matched.bot);
	}
	const message = await updateReminderCardMessage(update);
	let storedMsgId;
	for (const master of masters) {
		const bot = masterToBot.get(master);
		if (!bot) continue;
		const result = await karin.sendMaster(bot.account.selfId, master, message);
		if (!storedMsgId && result?.messageId) storedMsgId = result.messageId;
	}
	if (storedMsgId) try {
		await db.set(UPDATE_MSGID_KEY, storedMsgId);
	} catch {}
	return true;
};
const handleHiraUpdateReply = async (e, next) => {
	if (e.msg.includes("更新")) {
		const msgId = await db.get(UPDATE_MSGID_KEY);
		if (typeof msgId === "string" && e.replyId === msgId) await handleHiraUpdate(e);
	}
	await next?.();
};
const hiraUpdateHook = hooks.message.friend(handleHiraUpdateReply, { priority: 100 });
const hiraUpdateCommand = karin.command(updateReg, async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	await handleHiraUpdate(e);
	return true;
}, {
	name: "Hira-更新",
	perm: "master"
});
const update = karin.task("hira-更新检测", "*/3 * * * *", checkAndNotifyUpdate, {
	name: "hira-更新检测",
	log: false
});
//#endregion
export { handleHiraUpdateReply as a, resolveGitUpdateTarget as c, handleHiraUpdate as i, update as l, UPDATE_MSGID_KEY as n, hiraUpdateCommand as o, checkAndNotifyUpdate as r, hiraUpdateHook as s, UPDATE_LOCK_KEY as t, updateReg as u };

//# sourceMappingURL=update.js.map