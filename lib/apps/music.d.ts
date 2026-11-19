import * as node_karin12 from "node-karin";

// src/apps/music.d.ts

/**
 * 命令门禁. 与 commandParser 保持一致:
 * - 序号(歌词/语音/下载音乐)可省略, 省略时取上次选中/首项(云崽行为);
 * - 搜索关键词允许为空, 由处理器回用法说明;
 * - 新增 QQ 个性化歌单命令;
 * - 排除 cookie 管理命令, 交给 musicCookieReg.
 * - 排除开关命令, 交给 switches.ts（否则 `#点歌关闭` 会被当成搜索「关闭」）.
 */
declare const musicReg: RegExp;
declare const musicCookieReg: RegExp;
declare const musicCookie: node_karin12.Command<keyof node_karin12.MessageEventMap>;
/**
 * 开关命令注册在点歌之前：Karin 1.18 的命令按加载顺序匹配，
 * 点歌正则里的负向断言保证 `#点歌关闭` 落到这里而不是被当成搜索「关闭」。
 */
declare const switchesCommand: node_karin12.Command<keyof node_karin12.MessageEventMap>;
declare const music: node_karin12.Command<keyof node_karin12.MessageEventMap>;
//# sourceMappingURL=music.d.ts.map

export { music, musicCookie, musicCookieReg, musicReg, switchesCommand };
//# sourceMappingURL=music.d.ts.map