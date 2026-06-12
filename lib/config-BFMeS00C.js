import { copyConfigSync, logger, requireFileSync } from "node-karin";
import fs from "node:fs";
import path from "node:path";
import { karinPathBase } from "node-karin/root";
import YAML from "yaml";
import { fileURLToPath } from "node:url";
//#region src/root.ts
const resolvePluginRoot = (startUrl) => {
	let dir = path.dirname(startUrl);
	for (let i = 0; i < 8; i++) {
		const pkgPath = path.join(dir, "package.json");
		if (fs.existsSync(pkgPath)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(startUrl, "../..");
};
const pluginPath = resolvePluginRoot(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, "package.json"), "utf-8"));
const Root = {
	pluginName: pkg.name,
	pluginVersion: pkg.version,
	pluginPath
};
//#endregion
//#region src/config/defaults.ts
const defaultConfig = {
	app: {
		enabled: true,
		helpCommand: "#Hira帮助",
		replyPrefix: "Hira",
		statusCommand: "#Hira状态"
	},
	music: {
		enabled: true,
		defaultSource: "qq",
		listModeDefault: false,
		pageSize: 10,
		sessionTtlSeconds: 180,
		voiceEnabled: true,
		highQuality: false,
		textFallback: true,
		cookies: {
			netease: "",
			qq: "",
			kuwo: "",
			kugou: "",
			bilibili: ""
		},
		api: {
			neteaseBaseUrl: "http://music.163.com/api",
			qqTempApi: "https://www.hhlqilongzhu.cn/api/dg_QQmusicflac.php?msg={keyword}&n={index}&type=json"
		}
	},
	resolver: {
		enabled: true,
		kkkCompat: true,
		priority: 900,
		maxVideoDurationSeconds: 480,
		bilibili: {
			maxVideoDurationSeconds: 480,
			quality: 64,
			codec: "auto"
		},
		douyin: {
			maxVideoDurationSeconds: 480,
			quality: "1080p"
		},
		proxy: "",
		cookies: {
			weibo: "",
			xiaoheihe: "",
			douyin: "",
			xiaohongshu: "",
			bilibili: ""
		},
		generalApis: [
			"http://47.99.158.118/video-crack/v2/parse?content={url}",
			"https://api.jkyai.top/API/jhspjx.php?url={url}",
			"https://api.yujn.cn/api/pipixia.php?url={url}",
			"https://api.bugpk.com/api/pipixia?url={url}"
		]
	},
	runtime: {
		tempRoot: "",
		cleanupEnabled: true,
		cleanupMaxAgeMinutes: 120,
		ffmpegPath: "ffmpeg",
		ffprobePath: "ffprobe",
		downloadTimeoutSeconds: 60
	},
	light: {
		enabled: true,
		catApis: ["https://shibe.online/api/cats?count=1", "https://api.thecatapi.com/v1/images/search?limit=1"],
		buyerShowApis: ["https://api.vvhan.com/api/tao"],
		tiredApis: ["https://api.vvhan.com/api/wallpaper/views"],
		medicineApi: "https://api.oioweb.cn/api/common/DrugSearch?keyword={keyword}",
		softwareApi: "https://api.oioweb.cn/api/common/SoftwareSearch?keyword={keyword}"
	},
	translate: {
		enabled: true,
		deeplxApi: "",
		tencentApi: "https://api.interpreter.caiyunai.com/v1/translator",
		timeoutSeconds: 15
	},
	ai: {
		summaryEnabled: false,
		apiBaseUrl: "https://api.openai.com/v1",
		apiKey: "",
		model: "gpt-4.1-mini",
		maxInputChars: 12e3
	}
};
//#endregion
//#region src/config/index.ts
const userConfigDir = path.join(karinPathBase, Root.pluginName, "config");
const defaultConfigDir = path.join(Root.pluginPath, "config", "default_config");
const merge = (base, override) => {
	const result = { ...base };
	for (const [key, value] of Object.entries(override || {})) {
		const baseValue = result[key];
		if (value && typeof value === "object" && !Array.isArray(value) && baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) result[key] = merge(baseValue, value);
		else if (value !== void 0) result[key] = value;
	}
	return result;
};
const readConfig = (name) => {
	const fallback = defaultConfig[name];
	try {
		const file = path.join(userConfigDir, `${name}.yaml`);
		if (!fs.existsSync(file)) return fallback;
		return merge(fallback, requireFileSync(file, { force: true }));
	} catch (error) {
		logger.warn(`[karin-plugin-hira] 读取配置 ${name}.yaml 失败，使用默认配置: ${error}`);
		return fallback;
	}
};
const writeConfig = (name, value) => {
	fs.mkdirSync(userConfigDir, { recursive: true });
	fs.writeFileSync(path.join(userConfigDir, `${name}.yaml`), YAML.stringify(value), "utf8");
};
const readAllConfig = () => ({
	app: readConfig("app"),
	music: readConfig("music"),
	resolver: readConfig("resolver"),
	runtime: readConfig("runtime"),
	light: readConfig("light"),
	translate: readConfig("translate"),
	ai: readConfig("ai")
});
const saveAllConfig = (config) => {
	for (const name of Object.keys(defaultConfig)) writeConfig(name, config[name]);
};
const initConfig = () => {
	try {
		copyConfigSync(defaultConfigDir, userConfigDir);
	} catch (error) {
		logger.warn(`[karin-plugin-hira] 初始化配置失败: ${error}`);
	}
};
const updateMusicCookie = (source, cookie) => {
	fs.mkdirSync(userConfigDir, { recursive: true });
	const file = path.join(userConfigDir, "music.yaml");
	const current = readConfig("music");
	const next = {
		...current,
		cookies: {
			...current.cookies,
			[source]: cookie
		}
	};
	fs.writeFileSync(file, YAML.stringify(next), "utf8");
};
const Config = {
	get app() {
		return readConfig("app");
	},
	get music() {
		return readConfig("music");
	},
	get resolver() {
		return readConfig("resolver");
	},
	get runtime() {
		return readConfig("runtime");
	},
	get light() {
		return readConfig("light");
	},
	get translate() {
		return readConfig("translate");
	},
	get ai() {
		return readConfig("ai");
	}
};
//#endregion
export { updateMusicCookie as a, saveAllConfig as i, initConfig as n, Root as o, readAllConfig as r, Config as t };

//# sourceMappingURL=config-BFMeS00C.js.map