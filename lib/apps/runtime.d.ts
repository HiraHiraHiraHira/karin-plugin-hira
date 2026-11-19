import { Message } from "node-karin";

// src/apps/runtime.d.ts
declare const createConfiguredCommandRegExp: (command: string, aliases: string[]) => RegExp;
declare const isHiraAppEnabled: () => boolean;
/**
 * 群级功能开关：私聊/频道没有群号，直接按开启处理；
 * 群聊按 `data/group-switches.json` 里该群的记录判断（含上位模块连带关闭）。
 */
declare const isGroupModuleEnabled: (e: Message, moduleId: string) => boolean;
//# sourceMappingURL=runtime.d.ts.map
export { createConfiguredCommandRegExp, isGroupModuleEnabled, isHiraAppEnabled };
//# sourceMappingURL=runtime.d.ts.map