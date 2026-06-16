import { t as Root } from "./root.js";
import { r as Config } from "./runtime.js";
import fs from "node:fs";
import path from "node:path";
import { karinPathBase } from "node-karin/root";
//#region src/runtime/temp.ts
const defaultTempRoot = () => path.join(karinPathBase, Root.pluginName, "data", "temp");
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
const cleanupOldFiles = (root, beforeTimestamp) => {
	const resolvedRoot = path.resolve(root);
	const result = {
		deletedFiles: 0,
		deletedDirs: 0
	};
	if (!fs.existsSync(resolvedRoot)) return result;
	const visit = (dir) => {
		if (!isSubPath(resolvedRoot, dir)) return;
		for (const entry of fs.readdirSync(dir)) {
			const filePath = path.join(dir, entry);
			if (!isSubPath(resolvedRoot, filePath)) continue;
			const stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				visit(filePath);
				if (filePath !== resolvedRoot && fs.existsSync(filePath) && fs.readdirSync(filePath).length === 0) {
					fs.rmdirSync(filePath);
					result.deletedDirs++;
				}
				continue;
			}
			if (stat.mtimeMs < beforeTimestamp) {
				fs.rmSync(filePath, { force: true });
				result.deletedFiles++;
			}
		}
	};
	visit(resolvedRoot);
	return result;
};
const cleanupRuntimeTemp = () => {
	const cutoff = Date.now() - Config.runtime.cleanupMaxAgeMinutes * 6e4;
	return cleanupOldFiles(getTempRoot(), cutoff);
};
//#endregion
export { getTempRoot as i, createTempFilePath as n, ensureTempDir as r, cleanupRuntimeTemp as t };

//# sourceMappingURL=temp.js.map