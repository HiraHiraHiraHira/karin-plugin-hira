import * as node_karin23 from "node-karin";
import { Message } from "node-karin";

// src/apps/help.d.ts
/** R apps/help.js 的别名表：菜单/help/说明/功能/指令/使用说明 都算帮助命令。 */
declare const helpAliases: string[];
declare const helpReg: RegExp;
declare const helpMenu: ({
  title: string;
  items: {
    title: string;
    description: string;
    icon: string;
  }[];
  subGroups?: undefined;
} | {
  title: string;
  items: {
    title: string;
    description: string;
    icon: string;
  }[];
  subGroups: {
    title: string;
    items: {
      title: string;
      description: string;
      icon: string;
    }[];
  }[];
})[];
declare const helpFallbackText: () => string;
declare const replyHelp: (e: Message) => Promise<void>;
declare const help: node_karin23.Command<keyof node_karin23.MessageEventMap>;
//# sourceMappingURL=help.d.ts.map
export { help, helpAliases, helpFallbackText, helpMenu, helpReg, replyHelp };
//# sourceMappingURL=help.d.ts.map