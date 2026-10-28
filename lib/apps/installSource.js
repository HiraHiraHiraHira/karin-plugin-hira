import fs from "node:fs";
import path from "node:path";
//#region src/apps/installSource.ts
const readRootPackageSpecFields = (cwd) => {
	try {
		const raw = fs.readFileSync(path.join(cwd, "package.json"), "utf-8");
		if (!raw.includes("\"dependencies\"")) return void 0;
		return JSON.parse(raw);
	} catch {
		return;
	}
};
/**
* 读取宿主 package.json 中该插件的依赖声明。
* 仅当 package.json 确实声明了该依赖时才返回字符串，未声明返回 undefined。
*/
const readPackageDependencySpec = (pluginName, cwd = process.cwd()) => {
	const pkg = readRootPackageSpecFields(cwd);
	if (!pkg) return void 0;
	return pkg.dependencies?.[pluginName] || pkg.devDependencies?.[pluginName] || pkg.optionalDependencies?.[pluginName];
};
/**
* 宿主是否从 npm registry 安装该插件。
* 只认明确的 npm 语义：仅版本号 / 版本范围 / dist-tag / npm: 别名。
* 未声明（如 Karin 用 pnpm 从 tarball 安装、插件自行安装）一律视为非 npm 来源。
*/
const isNpmRegistrySpec = (spec) => {
	if (typeof spec !== "string") return false;
	const value = spec.trim();
	if (value.length === 0) return false;
	if (value.startsWith("npm:")) return value.length > 4;
	if (/^(file:|link:|workspace:|portal:|git\+|git:|github:|gitlab:|bitbucket:|ssh:|https?:|\.{1,2}[\\/]|~[\\/]|[\\/])/i.test(value)) return false;
	if (/^[^@\s][^\s]*[\\/]/.test(value) && !value.startsWith("@")) return false;
	return true;
};
//#endregion
export { isNpmRegistrySpec, readPackageDependencySpec };

//# sourceMappingURL=installSource.js.map