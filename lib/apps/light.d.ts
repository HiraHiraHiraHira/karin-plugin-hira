import * as node_karin15 from "node-karin";
import { Message } from "node-karin";

//#region src/apps/light.d.ts
declare const lightHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
declare const light: node_karin15.Command<keyof node_karin15.MessageEventMap>;
//# sourceMappingURL=light.d.ts.map

//#endregion
export { light, lightHandler };
//# sourceMappingURL=light.d.ts.map