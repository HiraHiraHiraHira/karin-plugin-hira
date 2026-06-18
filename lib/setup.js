import { t as Root } from "./root.js";
import { a as readAllConfig, i as initConfig, o as saveAllConfig, s as saveConfigModule } from "./runtime.js";
import "./apps/help.js";
import "./light.js";
import "./music.js";
import "./resolvers.js";
import "./apps/status.js";
import "./summary.js";
import "./translate.js";
import { app, authMiddleware, logger, mkdirSync, select } from "node-karin";
import fs from "node:fs";
import path from "node:path";
import { karinPathBase } from "node-karin/root";
import express from "node-karin/express";
//#region src/config/validation.ts
const numberRules = [
	{
		path: "music.pageSize",
		label: "music.pageSize",
		min: 1,
		max: 20
	},
	{
		path: "music.sessionTtlSeconds",
		label: "music.sessionTtlSeconds",
		min: 30,
		max: 3600
	},
	{
		path: "resolver.priority",
		label: "resolver.priority",
		min: 0,
		max: 9999
	},
	{
		path: "resolver.maxVideoDurationSeconds",
		label: "resolver.maxVideoDurationSeconds",
		min: 0,
		max: 21600
	},
	{
		path: "resolver.bilibili.maxVideoDurationSeconds",
		label: "resolver.bilibili.maxVideoDurationSeconds",
		min: 0,
		max: 21600
	},
	{
		path: "resolver.douyin.maxVideoDurationSeconds",
		label: "resolver.douyin.maxVideoDurationSeconds",
		min: 0,
		max: 21600
	},
	{
		path: "runtime.cleanupMaxAgeMinutes",
		label: "runtime.cleanupMaxAgeMinutes",
		min: 1,
		max: 10080
	},
	{
		path: "runtime.downloadTimeoutSeconds",
		label: "runtime.downloadTimeoutSeconds",
		min: 5,
		max: 600
	},
	{
		path: "translate.timeoutSeconds",
		label: "translate.timeoutSeconds",
		min: 1,
		max: 120
	},
	{
		path: "ai.maxInputChars",
		label: "ai.maxInputChars",
		min: 1e3,
		max: 2e5
	}
];
const bilibiliCodecs = [
	"auto",
	"av1",
	"hevc",
	"avc"
];
const douyinQualities = [
	"adapt",
	"540p",
	"720p",
	"1080p",
	"2k",
	"4k"
];
const musicSources = [
	"netease",
	"qq",
	"kuwo",
	"kugou",
	"bilibili"
];
const getPathValue = (source, path) => {
	return path.split(".").reduce((current, key) => {
		return current && typeof current === "object" ? current[key] : void 0;
	}, source);
};
const validateNumberRule = (config, rule) => {
	const value = Number(getPathValue(config, rule.path));
	if (!Number.isFinite(value)) return `${rule.label} 必须是数字`;
	if (rule.min !== void 0 && value < rule.min) return `${rule.label} 必须在 ${rule.min} 到 ${rule.max} 之间`;
	if (rule.max !== void 0 && value > rule.max) return `${rule.label} 必须在 ${rule.min} 到 ${rule.max} 之间`;
};
const validateEnum = (value, label, allowed) => {
	return allowed.includes(String(value)) ? void 0 : `${label} 必须是 ${allowed.join("、")} 之一`;
};
const validateHiraConfig = (config) => {
	return [
		...numberRules.map((rule) => validateNumberRule(config, rule)),
		validateEnum(config.music.defaultSource, "music.defaultSource", musicSources),
		validateEnum(config.resolver.bilibili.codec, "resolver.bilibili.codec", bilibiliCodecs),
		validateEnum(config.resolver.douyin.quality, "resolver.douyin.quality", douyinQualities)
	].filter((message) => Boolean(message));
};
//#endregion
//#region src/web/components.ts
const webFieldPathMap = {
	appEnabled: "app.enabled",
	appReplyPrefix: "app.replyPrefix",
	appHelpCommand: "app.helpCommand",
	appStatusCommand: "app.statusCommand",
	musicEnabled: "music.enabled",
	musicDefaultSource: "music.defaultSource",
	musicListModeDefault: "music.listModeDefault",
	musicHighQuality: "music.highQuality",
	musicVoiceEnabled: "music.voiceEnabled",
	musicPageSize: "music.pageSize",
	musicSessionTtlSeconds: "music.sessionTtlSeconds",
	musicCookiesNetease: "music.cookies.netease",
	musicCookiesQq: "music.cookies.qq",
	musicCookiesBilibili: "music.cookies.bilibili",
	resolverEnabled: "resolver.enabled",
	resolverKkkCompat: "resolver.kkkCompat",
	resolverCommentsEnabled: "resolver.commentsEnabled",
	resolverPriority: "resolver.priority",
	resolverMaxVideoDurationMinutes: "resolver.maxVideoDurationSeconds",
	resolverMaxVideoDurationSeconds: "resolver.maxVideoDurationSeconds",
	resolverPlatformBilibili: "resolver.platforms.bilibili",
	resolverPlatformDouyin: "resolver.platforms.douyin",
	resolverPlatformKuaishou: "resolver.platforms.kuaishou",
	resolverPlatformWeibo: "resolver.platforms.weibo",
	resolverPlatformTieba: "resolver.platforms.tieba",
	resolverPlatformXiaoheihe: "resolver.platforms.xiaoheihe",
	resolverPlatformXiaohongshu: "resolver.platforms.xiaohongshu",
	resolverPlatformGeneral: "resolver.platforms.general",
	resolverSendingContentForwardEnabled: "resolver.sending.contentForwardEnabled",
	resolverSendingVideoFailureFallbackEnabled: "resolver.sending.videoFailureFallbackEnabled",
	resolverMediaDedupeImages: "resolver.media.dedupeImages",
	resolverMediaFilterLowQualityImages: "resolver.media.filterLowQualityImages",
	resolverMediaInlinePreviewCover: "resolver.media.inlinePreviewCover",
	resolverDiagnosticsStageLogsEnabled: "resolver.diagnostics.stageLogsEnabled",
	resolverDiagnosticsVerboseLogsEnabled: "resolver.diagnostics.verboseLogsEnabled",
	resolverBilibiliMaxVideoDurationMinutes: "resolver.bilibili.maxVideoDurationSeconds",
	resolverBilibiliMaxVideoDurationSeconds: "resolver.bilibili.maxVideoDurationSeconds",
	resolverBilibiliQuality: "resolver.bilibili.quality",
	resolverBilibiliCodec: "resolver.bilibili.codec",
	resolverDouyinMaxVideoDurationMinutes: "resolver.douyin.maxVideoDurationSeconds",
	resolverDouyinMaxVideoDurationSeconds: "resolver.douyin.maxVideoDurationSeconds",
	resolverDouyinQuality: "resolver.douyin.quality",
	resolverProxy: "resolver.proxy",
	resolverCookiesWeibo: "resolver.cookies.weibo",
	resolverCookiesXiaoheihe: "resolver.cookies.xiaoheihe",
	resolverCookiesDouyin: "resolver.cookies.douyin",
	resolverCookiesXiaohongshu: "resolver.cookies.xiaohongshu",
	resolverCookiesBilibili: "resolver.cookies.bilibili",
	runtimeTempRoot: "runtime.tempRoot",
	runtimeCleanupEnabled: "runtime.cleanupEnabled",
	runtimeCleanupMaxAgeMinutes: "runtime.cleanupMaxAgeMinutes",
	runtimeFfmpegPath: "runtime.ffmpegPath",
	runtimeFfprobePath: "runtime.ffprobePath",
	lightEnabled: "light.enabled",
	translateEnabled: "translate.enabled",
	translateDeeplxApi: "translate.deeplxApi",
	aiSummaryEnabled: "ai.summaryEnabled",
	aiApiBaseUrl: "ai.apiBaseUrl",
	aiModel: "ai.model",
	aiApiKey: "ai.apiKey"
};
select.createItem("netease", {
	label: "网易云",
	value: "netease"
}), select.createItem("qq", {
	label: "QQ音乐",
	value: "qq"
}), select.createItem("kuwo", {
	label: "酷我",
	value: "kuwo"
}), select.createItem("kugou", {
	label: "酷狗",
	value: "kugou"
}), select.createItem("bilibili", {
	label: "哔哩哔哩",
	value: "bilibili"
});
select.createItem("16", {
	label: "360P 流畅",
	value: "16"
}), select.createItem("32", {
	label: "480P 清晰",
	value: "32"
}), select.createItem("64", {
	label: "720P 高清",
	value: "64"
}), select.createItem("80", {
	label: "1080P 高清",
	value: "80"
}), select.createItem("112", {
	label: "1080P+ 高码率",
	value: "112"
}), select.createItem("116", {
	label: "1080P60 高帧率",
	value: "116"
}), select.createItem("120", {
	label: "4K 超清",
	value: "120"
});
select.createItem("auto", {
	label: "自动选择",
	value: "auto"
}), select.createItem("avc", {
	label: "AVC/H.264 兼容",
	value: "avc"
}), select.createItem("hevc", {
	label: "HEVC/H.265",
	value: "hevc"
}), select.createItem("av1", {
	label: "AV1",
	value: "av1"
});
select.createItem("adapt", {
	label: "自动选择",
	value: "adapt"
}), select.createItem("540p", {
	label: "标清 540p",
	value: "540p"
}), select.createItem("720p", {
	label: "高清 720p",
	value: "720p"
}), select.createItem("1080p", {
	label: "高清 1080p",
	value: "1080p"
}), select.createItem("2k", {
	label: "超清 2K",
	value: "2k"
}), select.createItem("4k", {
	label: "超清 4K",
	value: "4k"
});
//#endregion
//#region src/web/configAdapter.ts
const isRecord = (value) => {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};
const unflattenConfig = (flat) => {
	const result = {};
	for (const [key, value] of Object.entries(flat)) {
		const parts = key.split(".").filter(Boolean);
		let cursor = result;
		for (const part of parts.slice(0, -1)) {
			const current = cursor[part];
			if (!isRecord(current)) cursor[part] = {};
			cursor = cursor[part];
		}
		const last = parts.at(-1);
		if (last) cursor[last] = value;
	}
	return result;
};
const deepMerge = (base, patch) => {
	const result = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const oldValue = result[key];
		if (isRecord(oldValue) && isRecord(value)) result[key] = deepMerge(oldValue, value);
		else result[key] = value;
	}
	return result;
};
const minutesToSeconds = (value) => {
	const minutes = Number(value);
	if (!Number.isFinite(minutes)) return value;
	return Math.round(minutes * 60);
};
const webFieldValueTransforms = {
	resolverMaxVideoDurationMinutes: minutesToSeconds,
	resolverBilibiliMaxVideoDurationMinutes: minutesToSeconds,
	resolverDouyinMaxVideoDurationMinutes: minutesToSeconds
};
const remapWebFieldKeys = (value, result = {}) => {
	if (Array.isArray(value)) {
		for (const item of value) remapWebFieldKeys(item, result);
		return result;
	}
	if (!isRecord(value)) return result;
	for (const [key, item] of Object.entries(value)) {
		const mappedKey = webFieldPathMap[key];
		if (mappedKey) {
			result[mappedKey] = webFieldValueTransforms[key]?.(item) ?? item;
			continue;
		}
		remapWebFieldKeys(item, result);
	}
	return result;
};
const normalizeWebConfigPatch = (patch) => {
	if (isRecord(patch) && Object.keys(patch).some((key) => key in webFieldPathMap || key === "hiraConfig")) return remapWebFieldKeys(patch);
	return patch;
};
const mergeConfigPatch = (base, patch) => {
	const normalizedPatch = normalizeWebConfigPatch(patch);
	return deepMerge(base, Object.keys(normalizedPatch).some((key) => key.includes(".")) ? unflattenConfig(normalizedPatch) : normalizedPatch);
};
//#endregion
//#region src/server/register.ts
const webDistPath = path.join(Root.pluginPath, "resources", "web");
const webIndexPath = path.join(webDistPath, "index.html");
const configModules = [
	"app",
	"music",
	"resolver",
	"runtime",
	"light",
	"translate",
	"ai"
];
const isConfigModule = (value) => {
	return configModules.includes(value);
};
const sendWebIndex = (res) => {
	try {
		const html = fs.readFileSync(webIndexPath, "utf8");
		res.setHeader("Cache-Control", "no-cache");
		res.type("html").send(html);
	} catch (error) {
		const message = `[karin-plugin-hira] Failed to read Web UI entry: ${webIndexPath}`;
		logger.error(error instanceof Error ? `${message}\n${error.stack ?? error.message}` : `${message}\n${String(error)}`);
		res.status(500).type("text/plain").send(message);
	}
};
const apiRouter = express.Router();
apiRouter.use(express.json({ limit: "2mb" }));
apiRouter.use(express.urlencoded({
	extended: true,
	limit: "2mb"
}));
const saveFullConfig = (req, res) => {
	const nextConfig = req.body?.config ?? req.body;
	if (!nextConfig || typeof nextConfig !== "object" || Array.isArray(nextConfig)) {
		res.status(400).json({
			success: false,
			message: "请求体必须是有效的配置对象",
			data: null
		});
		return;
	}
	const merged = mergeConfigPatch(readAllConfig(), nextConfig);
	const errors = validateHiraConfig(merged);
	if (errors.length > 0) {
		res.status(400).json({
			success: false,
			message: errors.join("；"),
			data: null
		});
		return;
	}
	saveAllConfig(merged);
	res.json({
		success: true,
		message: "Hira 配置已保存",
		data: readAllConfig()
	});
};
apiRouter.get("/v1/config", authMiddleware, (_req, res) => {
	res.json({
		success: true,
		message: "获取配置成功",
		data: readAllConfig()
	});
});
apiRouter.get("/v1/config/:module", authMiddleware, (req, res) => {
	const moduleName = req.params.module;
	if (!isConfigModule(moduleName)) {
		res.status(400).json({
			success: false,
			message: `配置模块 "${moduleName}" 不存在`,
			data: null
		});
		return;
	}
	res.json({
		success: true,
		message: "获取配置成功",
		data: readAllConfig()[moduleName]
	});
});
apiRouter.post("/v1/config", authMiddleware, saveFullConfig);
apiRouter.put("/v1/config", authMiddleware, saveFullConfig);
apiRouter.post("/v1/config/:module", authMiddleware, (req, res) => {
	const moduleName = req.params.module;
	if (!isConfigModule(moduleName)) {
		res.status(400).json({
			success: false,
			message: `配置模块 "${moduleName}" 不存在`,
			data: null
		});
		return;
	}
	const nextConfig = req.body?.config ?? req.body;
	if (!nextConfig || typeof nextConfig !== "object" || Array.isArray(nextConfig)) {
		res.status(400).json({
			success: false,
			message: "请求体必须是有效的配置对象",
			data: null
		});
		return;
	}
	const merged = mergeConfigPatch(readAllConfig(), { [moduleName]: nextConfig });
	const errors = validateHiraConfig(merged);
	if (errors.length > 0) {
		res.status(400).json({
			success: false,
			message: errors.join("；"),
			data: null
		});
		return;
	}
	saveConfigModule(moduleName, merged[moduleName]);
	res.json({
		success: true,
		message: "配置更新成功",
		data: readAllConfig()[moduleName]
	});
});
const staticRouter = express.Router();
staticRouter.use(express.static(webDistPath, {
	redirect: false,
	setHeaders: (res, filePath) => {
		if (filePath.endsWith(".html")) {
			res.setHeader("Cache-Control", "no-cache");
			return;
		}
		res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
	}
}));
staticRouter.use((_req, res) => {
	sendWebIndex(res);
});
app.use("/hira", staticRouter);
app.use("/api/hira", apiRouter);
//#endregion
//#region src/setup.ts
initConfig();
mkdirSync(`${karinPathBase}/${Root.pluginName}/data`);
const start = globalThis.__hiraLoadStart;
const elapsedMs = typeof start === "bigint" ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
const timeText = elapsedMs >= 1e3 ? `${Number((elapsedMs / 1e3).toFixed(2))}s` : `${Math.round(elapsedMs)}ms`;
logger.info(`${logger.violet(`[插件:${Root.pluginName}]`)} ${logger.green(`v${Root.pluginVersion}`)} 初始化完成 ~ 耗时 ${logger.green(timeText)}`);
delete globalThis.__hiraLoadStart;
//#endregion
export {};

//# sourceMappingURL=setup.js.map