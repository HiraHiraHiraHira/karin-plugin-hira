import * as node_karin0 from "node-karin";
import { Message } from "node-karin";

//#region src/apps/status.d.ts
declare const statusReg: RegExp;
declare const cleanupReg: RegExp;
declare const statusText: () => string;
declare const replyStatus: (e: Message) => Promise<void>;
declare const status: node_karin0.Command<keyof node_karin0.MessageEventMap>;
declare const cleanup: node_karin0.Command<keyof node_karin0.MessageEventMap>;
//# sourceMappingURL=status.d.ts.map

//#endregion
export { cleanup, cleanupReg, replyStatus, status, statusReg, statusText };
//# sourceMappingURL=status.d.ts.map