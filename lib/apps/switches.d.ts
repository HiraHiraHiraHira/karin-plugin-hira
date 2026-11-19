import { Message } from "node-karin";

// src/apps/switches.d.ts

/**
 * 回执必须把动词放在前面：「点歌已开启」以「点歌」开头，同群另一个 Bot 会把它当成
 * 点歌搜索命令再处理一次（实测会触发一次 10 秒的搜索请求）。「已开启点歌」不会被误认。
 */
declare const toggleText: (label: string, enabled: boolean) => string;
declare const switchHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
//# sourceMappingURL=switches.d.ts.map

export { switchHandler, toggleText };
//# sourceMappingURL=switches.d.ts.map