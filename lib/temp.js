import { t as Root } from "./root.js";
import { t as Config } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import { karinPathTemp } from "node-karin/root";
// src/runtime/temp.ts
/**
* 默认临时目录放在 Karin 的共享 temp 下（`@karinjs/temp/<插件名>`），不是插件自己的 data 目录。
* 视频、语音这类要交给协议端读取的文件必须让协议端看得见：NapCat 的 checkUriType 对裸路径
* 先做 existsSync，取不到就判成 Unknown 直接拒收（retcode 1200「文件处理失败: 识别URL失败」）。
* 本机部署只把 `@karinjs/temp` 挂进了 napcat 容器，所以放在这里才发得出去。
*/
const defaultTempRoot = () => path.join(karinPathTemp, Root.pluginName);
const getTempRoot = () => Config.runtime.tempRoot.trim() || defaultTempRoot();
const isSubPath = (root, target) => {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
};
const ensureTempDir = (root, name) => {
	const safeName = name.replace(/[^\w.-]+/g, "_");
	const dir = path.resolve(root, safeName);
	if (!isSubPath(root, dir)) throw new Error("临时目录越界");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
};
const createTempFilePath = (scope, ext) => {
	const dir = ensureTempDir(getTempRoot(), scope);
	const cleanExt = ext.replace(/^\.+/, "").replace(/[^\w]+/g, "") || "tmp";
	return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`);
};
const visitFiles = (root, callback) => {
	const resolvedRoot = path.resolve(root);
	if (!fs.existsSync(resolvedRoot)) return;
	const visit = (dir) => {
		if (!isSubPath(resolvedRoot, dir)) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const filePath = path.join(dir, entry.name);
			if (!isSubPath(resolvedRoot, filePath)) continue;
			try {
				const stat = fs.lstatSync(filePath);
				if (stat.isDirectory()) visit(filePath);
				else callback(filePath, stat);
			} catch {}
		}
	};
	visit(resolvedRoot);
};
const removeEmptyDirs = (root, result) => {
	const resolvedRoot = path.resolve(root);
	const visit = (dir) => {
		if (!isSubPath(resolvedRoot, dir) || !fs.existsSync(dir)) return;
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) if (entry.isDirectory()) visit(path.join(dir, entry.name));
		if (dir !== resolvedRoot) try {
			if (fs.readdirSync(dir).length === 0) {
				fs.rmdirSync(dir);
				result.deletedDirs++;
			}
		} catch {}
	};
	visit(resolvedRoot);
};
const cleanupOldFiles = (root, beforeTimestamp) => {
	const result = {
		deletedFiles: 0,
		deletedDirs: 0
	};
	visitFiles(root, (filePath, stat) => {
		if (stat.mtimeMs >= beforeTimestamp) return;
		try {
			fs.rmSync(filePath, { force: true });
			result.deletedFiles++;
		} catch {}
	});
	removeEmptyDirs(root, result);
	return result;
};
const enforceTempQuota = (root, maxBytes, result) => {
	if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;
	const entries = [];
	visitFiles(root, (filePath, stat) => {
		entries.push({
			path: filePath,
			size: stat.size,
			mtimeMs: stat.mtimeMs
		});
	});
	let usage = entries.reduce((total, entry) => total + entry.size, 0);
	if (usage <= maxBytes) return;
	const now = Date.now();
	for (const entry of entries.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
		if (entry.path.includes(".part-") && now - entry.mtimeMs < 3e5) continue;
		try {
			fs.rmSync(entry.path, { force: true });
			usage -= entry.size;
			result.deletedFiles++;
			if (usage <= maxBytes) break;
		} catch {}
	}
	removeEmptyDirs(root, result);
};
const cleanupRuntimeTemp = () => {
	const result = Config.runtime.cleanupEnabled ? cleanupOldFiles(getTempRoot(), Date.now() - Config.runtime.cleanupMaxAgeMinutes * 6e4) : {
		deletedFiles: 0,
		deletedDirs: 0
	};
	enforceTempQuota(getTempRoot(), Config.runtime.maxTempBytes, result);
	return result;
};
export { getTempRoot as i, createTempFilePath as n, ensureTempDir as r, cleanupRuntimeTemp as t };

//# sourceMappingURL=temp.js.map