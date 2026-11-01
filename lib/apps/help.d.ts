import * as node_karin6 from "node-karin";
import { Message } from "node-karin";

// src/apps/help.d.ts
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
declare const help: node_karin6.Command<keyof node_karin6.MessageEventMap>;
//# sourceMappingURL=help.d.ts.map
export { help, helpFallbackText, helpMenu, helpReg, replyHelp };
//# sourceMappingURL=help.d.ts.map