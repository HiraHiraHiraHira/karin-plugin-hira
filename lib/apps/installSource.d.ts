//#region src/apps/installSource.d.ts
/**
 * 读取宿主 package.json 中该插件的依赖声明。
 * 仅当 package.json 确实声明了该依赖时才返回字符串，未声明返回 undefined。
 */
declare const readPackageDependencySpec: (pluginName: string, cwd?: string) => string | undefined;
/**
 * 宿主是否从 npm registry 安装该插件。
 * 只认明确的 npm 语义：仅版本号 / 版本范围 / dist-tag / npm: 别名。
 * 未声明（如 Karin 用 pnpm 从 tarball 安装、插件自行安装）一律视为非 npm 来源。
 */
declare const isNpmRegistrySpec: (spec: string | undefined) => boolean;
//# sourceMappingURL=installSource.d.ts.map
//#endregion
export { isNpmRegistrySpec, readPackageDependencySpec };
//# sourceMappingURL=installSource.d.ts.map