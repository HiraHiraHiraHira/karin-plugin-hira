import { t as Config } from "./config.js";
import { t as Root } from "./root.js";
import fs from "node:fs";
import path from "node:path";
import { karinPathBase } from "node-karin/root";
// src/switches/modules.ts
/**
* 顺序即 `#开关` 状态列表顺序。
*
* 解析拆成「平台级」而不是一个整体：群里往往只想关抖音，不想关 B站。
* `resolve` 作为上位模块保留，`#解析关闭` 一次关掉下面全部平台。
*/
const switchModules = [
	{
		id: "music",
		label: "点歌",
		aliases: [
			"点歌",
			"音乐",
			"点歌功能"
		]
	},
	{
		id: "resolve",
		label: "解析（全部平台）",
		aliases: [
			"解析",
			"链接解析",
			"解析功能"
		]
	},
	{
		id: "resolve:bilibili",
		label: "B站解析",
		aliases: [
			"B站",
			"b站",
			"哔哩哔哩",
			"哔哩",
			"bilibili"
		],
		parent: "resolve"
	},
	{
		id: "resolve:douyin",
		label: "抖音解析",
		aliases: ["抖音", "douyin"],
		parent: "resolve"
	},
	{
		id: "resolve:kuaishou",
		label: "快手解析",
		aliases: ["快手", "kuaishou"],
		parent: "resolve"
	},
	{
		id: "resolve:xiaohongshu",
		label: "小红书解析",
		aliases: [
			"小红书",
			"xhs",
			"xiaohongshu"
		],
		parent: "resolve"
	},
	{
		id: "resolve:weibo",
		label: "微博解析",
		aliases: ["微博", "weibo"],
		parent: "resolve"
	},
	{
		id: "resolve:tieba",
		label: "贴吧解析",
		aliases: ["贴吧", "tieba"],
		parent: "resolve"
	},
	{
		id: "resolve:xiaoheihe",
		label: "小黑盒解析",
		aliases: ["小黑盒", "xiaoheihe"],
		parent: "resolve"
	},
	{
		id: "resolve:general",
		label: "通用解析",
		aliases: [
			"通用解析",
			"通用",
			"其他平台"
		],
		parent: "resolve"
	},
	{
		id: "light",
		label: "轻量功能",
		aliases: ["轻量", "轻量功能"]
	},
	{
		id: "light:fun",
		label: "娱乐（全部）",
		aliases: ["娱乐"],
		parent: "light"
	},
	{
		id: "light:cat",
		label: "猫图",
		aliases: ["猫图", "cat"],
		parent: "light:fun"
	},
	{
		id: "light:buyer",
		label: "买家秀",
		aliases: ["买家秀"],
		parent: "light:fun"
	},
	{
		id: "light:tired",
		label: "累了",
		aliases: ["累了"],
		parent: "light:fun"
	},
	{
		id: "light:query",
		label: "查询（医药/软件）",
		aliases: [
			"查询",
			"医药",
			"医药查询",
			"推荐软件"
		],
		parent: "light"
	},
	{
		id: "translate",
		label: "翻译",
		aliases: ["翻译", "translate"],
		parent: "translate"
	},
	{
		id: "summary",
		label: "AI 总结",
		aliases: [
			"总结",
			"AI总结",
			"ai总结",
			"网页总结"
		],
		parent: "summary"
	}
];
/** 命令里可用的「关」动词，长的在前，保证 `打开` 不会被 `开` 抢先切掉。 */
const offVerbs = [
	"关闭",
	"禁用",
	"停用",
	"关掉",
	"关"
];
const onVerbs = [
	"开启",
	"启用",
	"打开",
	"开"
];
/** 模块 id → 定义 */
const moduleById = new Map(switchModules.map((module) => [module.id, module]));
/** 命令词（小写）→ 模块 id；同一命令词只允许指向一个模块 */
const moduleByAlias = /* @__PURE__ */ new Map();
for (const module of switchModules) for (const alias of module.aliases) moduleByAlias.set(alias.toLowerCase(), module.id);
/** 全部可关闭的叶子模块（不含上位模块），`#全部开关` 用 */
const leafModuleIds = switchModules.filter((module) => !switchModules.some((child) => child.parent === module.id)).map((module) => module.id);
switchModules.map((module) => module.id);
// src/switches/store.ts
const dataDir = () => path.join(karinPathBase, Root.pluginName, "data");
const file = () => path.join(dataDir(), "group-switches.json");
let cache;
const emptyFile = () => ({});
/** 读文件，按 mtime + size 缓存；手改文件后立刻生效，不用重启 */
const readFile = () => {
	try {
		const target = file();
		const stat = fs.statSync(target);
		if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.data;
		const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
		const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : emptyFile();
		cache = {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			data
		};
		return data;
	} catch {
		return emptyFile();
	}
};
/** 原子写：先写临时文件再 rename，避免进程被杀时留下半个 JSON */
const writeFile = (data) => {
	fs.mkdirSync(dataDir(), { recursive: true });
	const target = file();
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		const descriptor = fs.openSync(temporary, "w");
		try {
			fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, "utf8");
			fs.fsyncSync(descriptor);
		} finally {
			fs.closeSync(descriptor);
		}
		fs.renameSync(temporary, target);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
	cache = void 0;
};
const groupSwitchKey = (selfId, groupId) => `${selfId}:${groupId}`;
const getGroupProfile = (selfId, groupId) => {
	const entry = readFile()[groupSwitchKey(selfId, groupId)];
	return {
		disabled: Array.isArray(entry?.disabled) ? entry.disabled.filter((id) => typeof id === "string") : [],
		updatedAt: entry?.updatedAt,
		updatedBy: entry?.updatedBy
	};
};
/**
* 模块是否生效：自己没被关，且链路上任何一个上位模块也没被关。
* 例如关掉 `解析` 后，`resolve:bilibili` 即使没写进 disabled 也算关闭。
*/
const isModuleEnabled = (selfId, groupId, moduleId) => {
	const disabled = getGroupProfile(selfId, groupId).disabled;
	if (!disabled.length) return true;
	let current = moduleId;
	const seen = /* @__PURE__ */ new Set();
	while (current && !seen.has(current)) {
		if (disabled.includes(current)) return false;
		seen.add(current);
		current = moduleById.get(current)?.parent;
	}
	return true;
};
/**
* 批量改开关。返回值里带上真正发生变化的条目，命令层用它拼回执。
* 关一个上位模块时，把下位模块里的同向记录清掉，避免「先关B站再关解析再开解析」留下历史残留。
*/
const applySwitchChanges = (selfId, groupId, changes, operator) => {
	const data = readFile();
	const key = groupSwitchKey(selfId, groupId);
	const current = new Set(data[key]?.disabled ?? []);
	const before = new Set(current);
	for (const change of changes) {
		if (change.enabled) {
			current.delete(change.moduleId);
			continue;
		}
		current.add(change.moduleId);
		for (const child of switchModules) if (child.parent === change.moduleId) current.delete(child.id);
	}
	const changed = changes.filter((change) => before.has(change.moduleId) === change.enabled).map((change) => ({
		moduleId: change.moduleId,
		enabled: change.enabled
	}));
	if (!changed.length) return [];
	data[key] = {
		disabled: [...current],
		updatedAt: Date.now(),
		updatedBy: operator
	};
	if (!data[key].disabled.length) delete data[key];
	writeFile(data);
	return changed;
};
const setAllModules = (selfId, groupId, enabled, operator) => {
	const data = readFile();
	const key = groupSwitchKey(selfId, groupId);
	if (enabled) {
		if (!data[key]) return false;
		delete data[key];
		writeFile(data);
		return true;
	}
	data[key] = {
		disabled: [.../* @__PURE__ */ new Set([...leafModuleIds, ...switchModules.filter((module) => module.parent).map((module) => module.id)])],
		updatedAt: Date.now(),
		updatedBy: operator
	};
	writeFile(data);
	return true;
};
const snapshotGroupSwitches = (selfId, groupId) => {
	const direct = new Set(getGroupProfile(selfId, groupId).disabled);
	return switchModules.map((module) => {
		let mutedBy;
		let current = module.parent;
		const seen = /* @__PURE__ */ new Set();
		while (current && !seen.has(current)) {
			if (direct.has(current)) {
				mutedBy = moduleById.get(current)?.label ?? current;
				break;
			}
			seen.add(current);
			current = moduleById.get(current)?.parent;
		}
		return {
			id: module.id,
			label: module.label,
			enabled: !direct.has(module.id) && !mutedBy,
			mutedBy
		};
	});
};
// src/apps/runtime.ts
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const configuredCommandToPattern = (command) => {
	const normalized = command.trim().replace(/^#/, "");
	if (!normalized) return void 0;
	return escapeRegExp(normalized).replace(/\\ /g, "\\s*");
};
const createConfiguredCommandRegExp = (command, aliases) => {
	const patterns = [configuredCommandToPattern(command), ...aliases].filter(Boolean);
	return new RegExp(`^#?(?:${patterns.join("|")})$`, "i");
};
const isHiraAppEnabled = () => Config.app.enabled;
/**
* 群级功能开关：私聊/频道没有群号，直接按开启处理；
* 群聊按 `data/group-switches.json` 里该群的记录判断（含上位模块连带关闭）。
*/
const isGroupModuleEnabled = (e, moduleId) => {
	const ctx = e;
	if (!ctx.isGroup) return true;
	const groupId = ctx.groupId ?? ctx.contact?.peer ?? "";
	if (!groupId) return true;
	return isModuleEnabled(e.selfId, groupId, moduleId);
};
export { setAllModules as a, moduleById as c, applySwitchChanges as i, offVerbs as l, isGroupModuleEnabled as n, snapshotGroupSwitches as o, isHiraAppEnabled as r, moduleByAlias as s, createConfiguredCommandRegExp as t, onVerbs as u };

//# sourceMappingURL=runtime.js.map