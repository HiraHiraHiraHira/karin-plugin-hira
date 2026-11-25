//#region src/index.ts
globalThis.__hiraLoadStart ??= process.hrtime.bigint();
import("./setup.js").catch((error) => {
	console.error("[karin-plugin-hira] 插件初始化失败:", error);
});
//#endregion
export {};

//# sourceMappingURL=index.js.map