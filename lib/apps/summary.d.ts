import * as node_karin7 from "node-karin";
import { Message } from "node-karin";

// src/apps/summary.d.ts
/** 显式命令：#总结一下 <链接>（链接后允许跟多余文字，按第一条 http(s) 链接处理）。 */
declare const summaryCommandReg: RegExp;
/**
 * 自动总结入口：消息里带链接就进来，域名再按 `ai.autoSummaryDomains` 实时判定
 * （karin 的命令正则在模块加载时固化，把域名写进正则会让改配置后不生效）。
 * R tools.js 用 linkShareSummary 规则做同样的事。
 */
declare const autoSummaryReg: RegExp;
declare const summaryHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
declare const summaryAutoHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
declare const summary: node_karin7.Command<keyof node_karin7.MessageEventMap>;
declare const summaryAuto: node_karin7.Command<keyof node_karin7.MessageEventMap>;
//# sourceMappingURL=summary.d.ts.map

export { autoSummaryReg, summary, summaryAuto, summaryAutoHandler, summaryCommandReg, summaryHandler };
//# sourceMappingURL=summary.d.ts.map