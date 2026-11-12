import * as node_karin11 from "node-karin";
import { Message } from "node-karin";

// src/apps/status.d.ts
declare const statusReg: RegExp;
declare const cleanupReg: RegExp;
declare const statusText: () => string;
declare const replyStatus: (e: Message) => Promise<void>;
declare const status: node_karin11.Command<keyof node_karin11.MessageEventMap>;
/** `cleanupEnabled` 打开时每小时按保留时长和容量上限清理一次临时目录。 */
declare const runtimeCleanup: node_karin11.Task;
declare const cleanup: node_karin11.Command<keyof node_karin11.MessageEventMap>;
//# sourceMappingURL=status.d.ts.map

export { cleanup, cleanupReg, replyStatus, runtimeCleanup, status, statusReg, statusText };
//# sourceMappingURL=status.d.ts.map