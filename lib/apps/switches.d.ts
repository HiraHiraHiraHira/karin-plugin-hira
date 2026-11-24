import * as node_karin12 from "node-karin";
import { Message } from "node-karin";

// src/apps/switches.d.ts

/**
 * 回执必须把动词放在前面：「点歌已开启」以「点歌」开头，同群另一个 Bot 会把它当成
 * 点歌搜索命令再处理一次（实测会触发一次 10 秒的搜索请求）。「已开启点歌」不会被误认。
 */
declare const toggleText: (label: string, enabled: boolean) => string;
declare const switchHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
/**
 * 开关命令单独注册在自己这个文件里，别塞进 music.ts：
 * `groups.json` 的 disable 是按产物文件名匹配的（`karin-plugin-hira:music.js`），
 * 点歌被某个群禁掉时会把同文件的开关命令一起带走，群里就再也改不了开关。
 */
declare const switchesCommand: node_karin12.Command<keyof node_karin12.MessageEventMap>;
//# sourceMappingURL=switches.d.ts.map

export { switchHandler, switchesCommand, toggleText };
//# sourceMappingURL=switches.d.ts.map