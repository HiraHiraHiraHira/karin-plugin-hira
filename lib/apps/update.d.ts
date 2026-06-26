import * as node_karin0 from "node-karin";
import { Message } from "node-karin";

//#region src/apps/update.d.ts
declare const UPDATE_LOCK_KEY = "hira:update:lock";
declare const UPDATE_MSGID_KEY = "hira:update:msgId";
declare const updateReg: RegExp;
type HookNext = () => unknown | Promise<unknown>;
declare const resolveGitUpdateTarget: (pluginPath?: string, cwd?: string) => {
  path: string;
  refreshInstall: boolean;
} | undefined;
declare const handleHiraUpdate: (e: Message) => Promise<void>;
declare const checkAndNotifyUpdate: () => Promise<boolean>;
declare const handleHiraUpdateReply: (e: Message, next?: HookNext) => Promise<void>;
declare const hiraUpdateHook: number;
declare const hiraUpdateCommand: node_karin0.Command<keyof node_karin0.MessageEventMap>;
declare const update: node_karin0.Task;
//#endregion
export { UPDATE_LOCK_KEY, UPDATE_MSGID_KEY, checkAndNotifyUpdate, handleHiraUpdate, handleHiraUpdateReply, hiraUpdateCommand, hiraUpdateHook, resolveGitUpdateTarget, update, updateReg };
//# sourceMappingURL=update.d.ts.map