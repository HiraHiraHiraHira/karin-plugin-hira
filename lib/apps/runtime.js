import { t as Config } from "../config.js";
//#region src/apps/runtime.ts
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const configuredCommandToPattern = (command) => {
	const normalized = command.trim().replace(/^#/, "");
	if (!normalized) return void 0;
	return escapeRegExp(normalized).replace(/\\ /g, "\\s*");
};
const createConfiguredCommandRegExp = (command, aliases) => {
	const patterns = [configuredCommandToPattern(command), ...aliases].filter(Boolean);
	return new RegExp(`^#?(?:${patterns.join("|")})$`, "i");
};
const isHiraAppEnabled = () => Config.app.enabled;
//#endregion
export { createConfiguredCommandRegExp, isHiraAppEnabled };

//# sourceMappingURL=runtime.js.map