import { n as initConfig, o as Root } from "./config-BFMeS00C.js";
import "./apps/help.js";
import "./light-B_NwfuPu.js";
import "./music-CbK7bxLU.js";
import "./resolvers-2vRMtxFc.js";
import "./apps/status.js";
import "./summary-DUiH9nVX.js";
import "./translate-CdFBI_uv.js";
import { logger, mkdirSync } from "node-karin";
import { karinPathBase } from "node-karin/root";
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

//# sourceMappingURL=setup-BbcM8BQP.js.map