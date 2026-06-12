import { o as Root, t as Config } from "./config-BFMeS00C.js";
import { common, karinPathHtml, logger, render, segment } from "node-karin";
import * as fs$1 from "node:fs";
import fs from "node:fs";
import path from "node:path";
import crypto, { randomBytes } from "node:crypto";
//#region src/services/cardRender.ts
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const compactText = (value, maxLength) => {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};
const iconText = (item) => compactText(item.icon || item.title.replace(/^#?/, "").trim().slice(0, 2) || "?", 2);
const createDocument = (body, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style>
* { box-sizing: border-box; }
:root {
  --hira-bg: #f7f8fb;
  --hira-fg: #131822;
  --hira-muted: #687386;
  --hira-border: rgba(28, 36, 52, 0.13);
  --hira-surface: rgba(255, 255, 255, 0.72);
  --hira-surface-strong: rgba(255, 255, 255, 0.9);
  --hira-blue: #2563eb;
  --hira-violet: #7c3aed;
  --hira-teal: #0d9488;
  --hira-pink: #f31260;
  --hira-amber: #d97706;
}
body {
  margin: 0;
  width: ${width}px;
  background: transparent;
  color: var(--hira-fg);
  font-family: HarmonyOSHans-Regular, "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
#container {
  width: ${width}px;
  padding: 24px;
}
.hira-render-shell {
  position: relative;
  width: 100%;
  min-height: 360px;
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, transparent 28%),
    linear-gradient(225deg, rgba(243, 18, 96, 0.09) 0%, transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(241, 245, 249, 0.96) 100%);
  border: 1px solid var(--hira-border);
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}
.hira-render-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.16;
  background-image:
    linear-gradient(rgba(19, 24, 34, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(19, 24, 34, 0.08) 1px, transparent 1px);
  background-size: 38px 38px;
  mask-image: linear-gradient(180deg, black 0%, transparent 78%);
}
.hira-render-shell::after {
  content: "";
  position: absolute;
  left: -80px;
  right: -80px;
  bottom: -120px;
  height: 220px;
  pointer-events: none;
  opacity: 0.08;
  transform: rotate(-7deg);
  background: repeating-linear-gradient(90deg, var(--hira-fg) 0 8px, transparent 8px 18px);
}
.render-content {
  position: relative;
  z-index: 1;
  padding: 36px 42px 32px;
}
.render-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 3px solid rgba(19, 24, 34, 0.09);
}
.system-line {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
  color: var(--hira-muted);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}
.system-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hira-blue);
  box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12);
}
.hero-word {
  margin: 0;
  color: var(--hira-fg);
  font-size: 62px;
  line-height: 0.95;
  font-weight: 900;
  letter-spacing: 0;
}
.module-meta {
  min-width: 230px;
  text-align: right;
  padding-bottom: 4px;
}
.header-label {
  display: block;
  margin-bottom: 5px;
  color: var(--hira-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}
.module-title {
  color: var(--hira-fg);
  font-size: 21px;
  line-height: 1.25;
  font-weight: 800;
}
.module-subtitle {
  margin-top: 6px;
  color: var(--hira-muted);
  font-size: 13px;
  line-height: 1.5;
}
.guide-watermark {
  position: absolute;
  top: 74px;
  right: 26px;
  color: rgba(19, 24, 34, 0.035);
  font-size: 128px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
  writing-mode: vertical-rl;
  user-select: none;
}
.corner-code {
  position: absolute;
  top: 22px;
  right: 26px;
  color: rgba(19, 24, 34, 0.28);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0;
}
.dot-matrix {
  position: absolute;
  top: 24px;
  left: 24px;
  display: grid;
  grid-template-columns: repeat(4, 5px);
  gap: 6px;
  opacity: 0.2;
}
.dot-matrix span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--hira-fg);
}
.section-list {
  display: grid;
  gap: 28px;
  margin-top: 30px;
  padding-bottom: 12px;
}
.command-section {
  position: relative;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 15px;
  margin: 0 0 16px;
}
.section-bar {
  width: 6px;
  height: 46px;
  border-radius: 6px;
  background: var(--section-color, var(--hira-blue));
}
.section-title {
  margin: 0;
  color: var(--hira-fg);
  font-size: 35px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
}
.subgroup-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 20px 0 12px;
  color: rgba(19, 24, 34, 0.62);
  font-size: 16px;
  line-height: 1.35;
  font-weight: 800;
  letter-spacing: 0;
}
.subgroup-title::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.command-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  row-gap: 15px;
}
.command-item {
  display: flex;
  gap: 14px;
  min-height: 92px;
  padding: 14px;
  border-radius: 8px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  backdrop-filter: blur(18px);
}
.command-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  color: var(--section-color, var(--hira-blue));
  background: color-mix(in srgb, var(--section-color, var(--hira-blue)) 12%, white);
  border: 1px solid color-mix(in srgb, var(--section-color, var(--hira-blue)) 24%, transparent);
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
}
.command-body {
  min-width: 0;
}
.command-title {
  margin: 0 0 7px;
  color: var(--hira-fg);
  font-size: 19px;
  line-height: 1.28;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.command-desc {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.55;
  font-weight: 500;
  letter-spacing: 0;
  white-space: pre-line;
}
.music-list {
  display: grid;
  gap: 12px;
  margin-top: 28px;
}
.music-row {
  display: grid;
  grid-template-columns: 58px 1fr auto;
  align-items: center;
  gap: 16px;
  min-height: 76px;
  padding: 14px 18px;
  border-radius: 8px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.music-index {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 19px;
  font-weight: 900;
  letter-spacing: 0;
}
.song-main {
  min-width: 0;
}
.song-title {
  margin: 0 0 5px;
  color: var(--hira-fg);
  font-size: 21px;
  line-height: 1.25;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.song-artists {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.35;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.duration {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.09);
  color: #5b21b6;
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0;
}
.card-tip {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(13, 148, 136, 0.08);
  border: 1px solid rgba(13, 148, 136, 0.16);
  color: #0f766e;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 700;
  letter-spacing: 0;
}
.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 28px;
}
.status-item {
  min-height: 118px;
  padding: 16px;
  border-radius: 8px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.status-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.status-label {
  color: var(--hira-muted);
  font-size: 13px;
  line-height: 1.4;
  font-weight: 800;
}
.status-pill {
  flex: 0 0 auto;
  min-width: 44px;
  padding: 4px 8px;
  border-radius: 8px;
  text-align: center;
  font-size: 11px;
  line-height: 1.3;
  font-weight: 900;
}
.status-ok {
  color: #047857;
  background: rgba(16, 185, 129, 0.12);
}
.status-off {
  color: #64748b;
  background: rgba(100, 116, 139, 0.13);
}
.status-warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.16);
}
.status-info {
  color: #1d4ed8;
  background: rgba(37, 99, 235, 0.12);
}
.status-value {
  margin: 13px 0 0;
  color: var(--hira-fg);
  font-size: 27px;
  line-height: 1.15;
  font-weight: 900;
  overflow-wrap: anywhere;
  letter-spacing: 0;
}
.status-detail {
  margin: 8px 0 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.render-footer {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  color: rgba(19, 24, 34, 0.35);
  font-family: Consolas, "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}
</style>
</head>
<body>
${body}
</body>
</html>`;
const renderDecor = () => `
  <div class="dot-matrix" aria-hidden="true">
    ${Array.from({ length: 16 }, () => "<span></span>").join("")}
  </div>
  <div class="corner-code" aria-hidden="true">SYS.32.91</div>
  <div class="guide-watermark" aria-hidden="true">GUIDE</div>`;
const renderShell = ({ eyebrow, hero, title, subtitle, body, footer }) => `
<main id="container">
  <section class="hira-render-shell">
    ${renderDecor()}
    <div class="render-content">
    <header class="render-header">
      <div>
        <div class="system-line"><span class="system-dot"></span>${escapeHtml(eyebrow)}</div>
        <h1 class="hero-word">${escapeHtml(hero)}</h1>
      </div>
      <div class="module-meta">
        <span class="header-label">CURRENT MODULE</span>
        <div class="module-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="module-subtitle">${escapeHtml(subtitle)}</div>` : ""}
      </div>
    </header>
      ${body}
      ${footer ? `<footer class="render-footer">${escapeHtml(footer)}</footer>` : ""}
    </div>
  </section>
</main>`;
const sectionColors = [
	"#2563eb",
	"#f31260",
	"#0d9488",
	"#7c3aed",
	"#d97706"
];
const renderCommandItems = (items) => `
  <div class="command-grid">
    ${items.map((item) => `
    <article class="command-item">
      <div class="command-icon">${escapeHtml(iconText(item))}</div>
      <div class="command-body">
        <h3 class="command-title">${escapeHtml(item.title)}</h3>
        <p class="command-desc">${escapeHtml(item.description)}</p>
      </div>
    </article>`).join("")}
  </div>`;
const buildHelpCardHtml = (groups) => createDocument(renderShell({
	eyebrow: "SYSTEM_READY",
	hero: "COMMANDS",
	title: "插件帮助",
	subtitle: "常用命令、点歌、多平台解析和轻量功能一览。",
	footer: "Generated by karin-plugin-hira",
	body: `
    <div class="section-list">
      ${groups.map((group, index) => `
      <section class="command-section" style="--section-color: ${sectionColors[index % sectionColors.length]}">
        <div class="section-heading">
          <div class="section-bar"></div>
          <h2 class="section-title">${escapeHtml(group.title)}</h2>
        </div>
        ${renderCommandItems(group.items)}
        ${(group.subGroups || []).map((subGroup) => `
        <div class="subgroup">
          <h3 class="subgroup-title">${escapeHtml(subGroup.title)}</h3>
          ${renderCommandItems(subGroup.items)}
        </div>`).join("")}
      </section>`).join("")}
    </div>`
}));
const buildMusicListCardHtml = (items, page) => createDocument(renderShell({
	eyebrow: "SEARCH.RESULTS",
	hero: "MUSIC",
	title: "点歌列表",
	subtitle: `第 ${page} 页，发送序号点歌，发送 #下一页 查看更多。`,
	footer: "Send a number to choose a track",
	body: `
      <div class="music-list">
        ${items.map((item, index) => `
        <article class="music-row">
          <div class="music-index">${index + 1}</div>
          <div class="song-main">
            <h2 class="song-title">${escapeHtml(compactText(item.title, 56))}</h2>
            <p class="song-artists">${escapeHtml(compactText(item.artists, 70))}</p>
          </div>
          <div class="duration">${escapeHtml(item.duration || "")}</div>
        </article>`).join("")}
      </div>
      <p class="card-tip">发送序号点歌，也可以发送 #下一页 翻页。</p>`
}));
const statusText = (status) => ({
	ok: "ON",
	off: "OFF",
	warn: "WARN",
	info: "INFO"
})[status || "info"];
const buildStatusCardHtml = (options) => createDocument(renderShell({
	eyebrow: options.eyebrow || "SYSTEM.STATUS",
	hero: "STATUS",
	title: options.title,
	subtitle: options.subtitle,
	footer: options.footer || "Generated by karin-plugin-hira",
	body: `
    <div class="status-grid">
      ${options.items.map((item) => {
		const status = item.status || "info";
		return `
        <article class="status-item">
          <div class="status-head">
            <div class="status-label">${escapeHtml(item.label)}</div>
            <div class="status-pill status-${status}">${statusText(status)}</div>
          </div>
          <div class="status-value">${escapeHtml(item.value)}</div>
          ${item.detail ? `<p class="status-detail">${escapeHtml(item.detail)}</p>` : ""}
        </article>`;
	}).join("")}
    </div>`
}));
const writeCardHtmlFile = (html, name) => {
	const safeName = name.replace(/[^\w.-]+/g, "_") || "card";
	const dir = path.join(karinPathHtml, Root.pluginName, `card-${safeName}`);
	fs.mkdirSync(dir, { recursive: true });
	const contentHash = crypto.createHash("md5").update(html).digest("hex").slice(0, 8);
	const file = path.join(dir, `${safeName}-${contentHash}.html`);
	if (fs.existsSync(file)) {
		const now = /* @__PURE__ */ new Date();
		fs.utimesSync(file, now, now);
		return file;
	}
	fs.writeFileSync(file, html, "utf8");
	return file;
};
const renderCardImage = async ({ name, html, width = 760, writeHtml = writeCardHtmlFile, render: render$1 = render.render.bind(render) }) => {
	const file = writeHtml(html, name);
	const result = await render$1({
		name: `${Root.pluginName}/card-${name}`,
		file,
		selector: "#container",
		fullPage: false,
		type: "png",
		captureBeyondViewport: true,
		omitBackground: true,
		setViewport: {
			width,
			height: 900,
			deviceScaleFactor: 1
		},
		pageGotoParams: {
			waitUntil: "load",
			timeout: 1e4
		}
	});
	const elements = (Array.isArray(result) ? result : [result]).map((image) => segment.image(`base64://${image}`));
	logger.debug(`[${Root.pluginName}] Render card ${name}: ${file}, images=${elements.length}`);
	return elements;
};
const logCardRenderFailure = (name, error) => {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	logger.error(`[${Root.pluginName}] Render card ${name} failed: ${message}`);
};
//#endregion
//#region src/music/providers/helpers.ts
const formatArtists = (artists) => {
	const clean = artists.map((artist) => artist.trim()).filter(Boolean);
	return clean.length > 0 ? clean.join(" / ") : "未知歌手";
};
const normalizeDuration = (value) => {
	if (value === void 0) return void 0;
	if (typeof value === "number") return value > 1e4 ? Math.round(value / 1e3) : Math.round(value);
	const parts = value.split(":").map((part) => Number(part));
	if (parts.some((part) => Number.isNaN(part))) return void 0;
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
};
const requirePlayableUrl = (url) => {
	if (!url?.trim()) throw new Error("empty playable URL");
	return url;
};
//#endregion
//#region src/services/message.ts
const videoMessageLimitBytes = 100 * 1024 * 1024;
const videoSendSaltBytes = 8;
const resolverLongTextLength = 400;
const prefix = () => Config.app.replyPrefix;
const filenameFromPath = (file) => path.posix.basename(file.replace(/\\/g, "/")) || "video.mp4";
const toVideoMessageFile = (file) => {
	if (/^(?:https?:|base64:|file:)/i.test(file)) return file;
	return `file://${file.replace(/\\/g, "/")}`;
};
const formatFileSize = (bytes) => {
	const mb = bytes / 1024 / 1024;
	return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))}MB`;
};
const getLocalFileSize = (file) => {
	try {
		if (!fs$1.existsSync(file)) return void 0;
		const stats = fs$1.statSync(file);
		if (typeof stats.isFile === "function" && !stats.isFile()) return void 0;
		return stats.size;
	} catch {
		return;
	}
};
const createUniqueVideoCopy = (file, size) => {
	if (!size || size + videoSendSaltBytes > videoMessageLimitBytes) return file;
	try {
		const parsed = path.parse(file);
		const ext = parsed.ext || ".mp4";
		const output = path.join(parsed.dir, `${parsed.name}.send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
		fs$1.copyFileSync(file, output);
		fs$1.appendFileSync(output, randomBytes(videoSendSaltBytes));
		return output;
	} catch {
		return file;
	}
};
const errorText = (error) => {
	const parts = [];
	let current = error;
	for (let i = 0; i < 4 && current; i++) {
		if (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
			continue;
		}
		if (typeof current === "object") {
			try {
				parts.push(JSON.stringify(current));
			} catch {
				parts.push(String(current));
			}
			break;
		}
		parts.push(String(current));
		break;
	}
	return parts.join("\n");
};
const isVideoTooLargeError = (error) => /video file too large|upload_group_file|upload_private_file/i.test(errorText(error));
const canUploadFile = (e) => ["group", "friend"].includes(e.contact.scene) && typeof e.bot.uploadFile === "function";
const uploadVideoFile = async (e, file, size) => {
	if (!canUploadFile(e)) {
		await replyText(e, size ? `视频文件 ${formatFileSize(size)}，超过 100MB，当前场景无法作为视频消息发送。` : "视频文件超过 100MB，当前场景无法作为视频消息发送。");
		return;
	}
	await replyText(e, size ? `视频文件 ${formatFileSize(size)}，超过 100MB，改为上传群文件。` : "视频文件超过 100MB，改为上传群文件。");
	try {
		await e.bot.uploadFile(e.contact, file, filenameFromPath(file));
	} catch (error) {
		await replyText(e, `上传群文件失败：${errorText(error) || "未知错误"}\n可以调低 B站下载画质或缩短下载上限后重试。`);
	}
};
const replyVideo = async (e, file) => {
	const size = getLocalFileSize(file);
	if (size && size > videoMessageLimitBytes) {
		await uploadVideoFile(e, file, size);
		return;
	}
	try {
		await e.reply(segment.video(toVideoMessageFile(createUniqueVideoCopy(file, size))));
	} catch (error) {
		if (isVideoTooLargeError(error)) {
			await uploadVideoFile(e, file, size);
			return;
		}
		await replyText(e, `视频发送失败：${error instanceof Error ? error.message : String(error)}`);
	}
};
const replyText = async (e, text) => {
	await e.reply(`${prefix()}：${text}`);
};
const replyPlainText = async (e, text) => {
	await e.reply(text);
};
const replyImage = async (e, url, title) => {
	const elements = [title ? segment.text(`${prefix()}：${title}`) : void 0, segment.image(url)].filter(Boolean);
	try {
		await e.reply(elements);
	} catch {
		await replyText(e, `${title ? `${title}\n` : ""}${url}`);
	}
};
const replyMusicList = async (e, items, page) => {
	if (items.length === 0) {
		await replyText(e, "没有搜到相关歌曲");
		return;
	}
	const rows = items.map((item) => {
		const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : "";
		return {
			title: item.title,
			artists: formatArtists(item.artists),
			duration
		};
	});
	try {
		const images = await renderCardImage({
			name: "music-list",
			html: buildMusicListCardHtml(rows, page),
			width: 920
		});
		await e.reply(images);
		return;
	} catch (error) {
		logCardRenderFailure("music-list", error);
		const lines = rows.map((item, index) => `${index + 1}. ${item.title} - ${item.artists}${item.duration ? ` ${item.duration}` : ""}`);
		await replyPlainText(e, [
			`---点歌列表[第${page}页]---`,
			...lines,
			"----------------",
			"发送序号点歌，发送 #下一页 查看更多。"
		].join("\n"));
	}
};
const replyMusicPlayable = async (e, playable) => {
	const { item } = playable;
	const artists = formatArtists(item.artists);
	const elements = [
		item.coverUrl ? segment.image(item.coverUrl) : void 0,
		segment.customMusic(item.pageUrl, playable.audioUrl, item.title, artists, item.coverUrl || ""),
		segment.text(`${item.title} - ${artists}\n${item.pageUrl}`)
	].filter(Boolean);
	try {
		await e.reply(elements);
	} catch {
		await e.reply(`${prefix()}：${item.title} - ${artists}\n${playable.audioUrl || item.pageUrl}`);
	}
};
const replyVoiceFileOrAudio = async (e, playable, voiceFile) => {
	try {
		await e.reply(segment.record(voiceFile || playable.audioUrl));
	} catch {
		await replyMusicPlayable(e, playable);
	}
};
const isFailure = (result) => "ok" in result && result.ok === false;
const botForwardIdentity = (e, fallbackName) => {
	const bot = e.bot;
	return {
		id: String(bot.account?.selfId || e.selfId || ""),
		name: fallbackName
	};
};
const canSendForward = (e) => typeof e.bot.sendForwardMsg === "function";
const resolvedPostText = (post) => {
	const title = post.title ? `，${post.title}` : "";
	return `识别：${post.displayName}${title}${post.description ? `\n${post.description}` : ""}${post.pageUrl ? `\n${post.pageUrl}` : ""}`;
};
const directResolvedPost = async (e, post, text) => {
	const elements = [segment.text(text), ...post.images.slice(0, 9).map((url) => segment.image(url))];
	await e.reply(elements);
};
const replyResolvedPostForward = async (e, post, text) => {
	const identity = botForwardIdentity(e, `${post.displayName}解析`);
	const nodes = common.makeForward([segment.text(text), ...post.images.map((url) => segment.image(url))], identity.id, identity.name);
	const isLongText = (post.description?.length || 0) > resolverLongTextLength;
	const summary = post.images.length > 1 ? `查看${post.images.length}张图片` : isLongText ? "查看完整解析内容" : "查看解析内容";
	await e.bot.sendForwardMsg(e.contact, nodes, {
		source: "解析结果",
		summary,
		prompt: `${post.displayName}解析结果`,
		news: [{ text: "点击查看解析结果" }]
	});
};
const replyResolvedPost = async (e, result) => {
	if (isFailure(result)) {
		await replyPlainText(e, `${result.displayName}解析失败：${result.reason}`);
		return;
	}
	const post = result;
	const text = resolvedPostText(post);
	if ((post.images.length > 1 || (post.description?.length || 0) > resolverLongTextLength) && canSendForward(e)) try {
		await replyResolvedPostForward(e, post, text);
	} catch {
		await directResolvedPost(e, post, text);
	}
	else await directResolvedPost(e, post, text);
	const video = post.videos[0];
	if (video) await replyVideo(e, video);
};
//#endregion
export { replyResolvedPost as a, normalizeDuration as c, buildStatusCardHtml as d, logCardRenderFailure as f, replyPlainText as i, requirePlayableUrl as l, replyMusicList as n, replyText as o, renderCardImage as p, replyMusicPlayable as r, replyVoiceFileOrAudio as s, replyImage as t, buildHelpCardHtml as u };

//# sourceMappingURL=message-tlVwsfIp.js.map