import * as node_karin17 from "node-karin";

// src/apps/maintenance.d.ts

/**
 * 定时清理临时目录。
 *
 * 必须放在 `apps/` 下并且作为模块导出：Karin 只会把 `pkg.apps`（构建后的 `lib/apps/*.js`）里的导出
 * 交给 pkgCache 收集，主入口的导出不会被收集——写在 setup.ts 里任务对象拿不到 scheduleJob，永远不会跑。
 *
 * `cleanupRuntimeTemp` 内部会读 `runtime.cleanupEnabled`，开关关闭时不做任何清理。
 */
declare const tempCleanup: node_karin17.Task;
//# sourceMappingURL=maintenance.d.ts.map
export { tempCleanup };
//# sourceMappingURL=maintenance.d.ts.map