import * as node_karin1 from "node-karin";
import { Message } from "node-karin";

// src/apps/status.d.ts
declare const statusReg: RegExp;
declare const cleanupReg: RegExp;
declare const statusText: () => string;
declare const replyStatus: (e: Message) => Promise<void>;
declare const status: node_karin1.Command<keyof node_karin1.MessageEventMap>;
declare const cleanup: node_karin1.Command<keyof node_karin1.MessageEventMap>;
//# sourceMappingURL=status.d.ts.map

export { cleanup, cleanupReg, replyStatus, status, statusReg, statusText };
//# sourceMappingURL=status.d.ts.map