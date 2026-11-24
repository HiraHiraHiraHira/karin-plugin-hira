import * as node_karin0 from "node-karin";
import { Message } from "node-karin";

// src/apps/light.d.ts
declare const lightHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
declare const light: node_karin0.Command<keyof node_karin0.MessageEventMap>;
//# sourceMappingURL=light.d.ts.map

export { light, lightHandler };
//# sourceMappingURL=light.d.ts.map