import * as node_karin0 from "node-karin";
import { Message } from "node-karin";

// src/apps/translate.d.ts
/** 从消息元素里取引用段的 messageId：引用段只带 id，正文要再用 getMsg 取一次。 */
declare const findReplyId: (elements: unknown) => string | undefined;
/**
 * 引用消息的纯文本。
 * 只拼 text 段并 trim：图片/表情会被转成占位串，塞给翻译器只会得到噪声。
 */
declare const extractQuotedText: (e: Message) => Promise<string | undefined>;
declare const translateReg: RegExp;
declare const translateHandler: (e: Message, next?: () => unknown) => Promise<unknown>;
declare const translate: node_karin0.Command<keyof node_karin0.MessageEventMap>;
//# sourceMappingURL=translate.d.ts.map

export { extractQuotedText, findReplyId, translate, translateHandler, translateReg };
//# sourceMappingURL=translate.d.ts.map