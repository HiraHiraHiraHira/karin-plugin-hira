import { t as Root } from "./root.js";
import { karinPathHtml, logger, render, segment } from "node-karin";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
//#region src/services/cardRender/styles.ts
const createDocument = (body, width = 920, useDarkTheme = false) => `<!doctype html>
<html lang="zh-CN" data-theme="${useDarkTheme ? "dark" : "light"}">
<head style="display:none!important">
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style style="display:none!important">
* { box-sizing: border-box; }

/* 主题颜色系统 - 浅色主题 */
:root {
  --hira-bg: #f8f9fb;
  --hira-fg: #0f172a;
  --hira-muted: #64748b;
  --hira-border: rgba(15, 23, 42, 0.1);
  --hira-surface: #ffffff;
  --hira-surface-strong: #ffffff;
  --hira-surface-hover: #f1f5f9;

  /* 语义化颜色 */
  --hira-blue: #3b82f6;
  --hira-violet: #8b5cf6;
  --hira-teal: #14b8a6;
  --hira-pink: #ec4899;
  --hira-amber: #f59e0b;
  --hira-green: #10b981;
  --hira-red: #ef4444;

  /* 阴影 */
  --hira-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --hira-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --hira-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);
}

/* 主题颜色系统 - 暗色主题 */
[data-theme="dark"] {
  --hira-bg: #0f172a;
  --hira-fg: #f1f5f9;
  --hira-muted: #94a3b8;
  --hira-border: rgba(248, 250, 252, 0.1);
  --hira-surface: #1e293b;
  --hira-surface-strong: #334155;
  --hira-surface-hover: #475569;

  /* 语义化颜色调整 */
  --hira-blue: #60a5fa;
  --hira-violet: #a78bfa;
  --hira-teal: #2dd4bf;
  --hira-pink: #f472b6;
  --hira-amber: #fbbf24;
  --hira-green: #34d399;
  --hira-red: #f87171;

  /* 阴影调整 */
  --hira-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --hira-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --hira-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5);
}
html {
  background: var(--hira-bg);
}
body {
  margin: 0;
  width: ${width}px;
  background: var(--hira-bg);
  color: var(--hira-fg);
  font-family: "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  line-height: 1.6;
}
#container {
  width: ${width}px;
  padding: 20px;
  background: var(--hira-bg);
}
.hira-render-shell {
  position: relative;
  isolation: isolate;
  width: 100%;
  min-height: 360px;
  border-radius: 16px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  box-shadow: var(--hira-shadow-lg);
  overflow: hidden;
  transition: all 0.3s ease;
}
.hira-render-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.03;
  background-image:
    linear-gradient(var(--hira-fg) 1px, transparent 1px),
    linear-gradient(90deg, var(--hira-fg) 1px, transparent 1px);
  background-size: 32px 32px;
}
.render-content {
  position: relative;
  z-index: 2;
  padding: 32px;
}
.render-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 2px solid var(--hira-border);
}
.system-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin-bottom: 12px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--hira-blue) 10%, transparent);
  color: var(--hira-blue);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.system-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.hero-word {
  margin: 0;
  color: var(--hira-fg);
  font-size: 42px;
  line-height: 1.2;
  font-weight: 900;
  letter-spacing: 0;
}
.module-meta {
  min-width: 180px;
  text-align: right;
}
.header-label {
  display: block;
  margin-bottom: 6px;
  color: var(--hira-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.module-title {
  color: var(--hira-fg);
  font-size: 18px;
  line-height: 1.3;
  font-weight: 800;
}
.module-subtitle {
  margin-top: 8px;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.5;
  font-weight: 500;
}
.guide-watermark {
  position: absolute;
  top: 60px;
  right: 24px;
  z-index: 0;
  color: color-mix(in srgb, var(--hira-fg) 3%, transparent);
  font-size: 96px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
  writing-mode: vertical-rl;
  user-select: none;
  pointer-events: none;
}
.corner-code {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 0;
  color: color-mix(in srgb, var(--hira-fg) 20%, transparent);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0;
  user-select: none;
  pointer-events: none;
}
.dot-matrix {
  position: absolute;
  top: 20px;
  left: 24px;
  z-index: 0;
  display: grid;
  grid-template-columns: repeat(3, 4px);
  gap: 5px;
  opacity: 0.15;
}
.dot-matrix span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--hira-fg);
}
.section-list {
  display: grid;
  gap: 32px;
  padding-bottom: 12px;
}
.command-section {
  position: relative;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 20px;
}
.section-bar {
  width: 4px;
  height: 32px;
  border-radius: 4px;
  background: var(--section-color, var(--hira-blue));
}
.section-title {
  margin: 0;
  color: var(--hira-fg);
  font-size: 32px;
  line-height: 1.2;
  font-weight: 900;
  letter-spacing: 0;
}
.subgroup-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 16px;
  color: var(--hira-muted);
  font-size: 18px;
  line-height: 1.3;
  font-weight: 800;
}
.subgroup-title::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.command-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.command-item {
  display: flex;
  gap: 16px;
  min-height: 88px;
  padding: 18px;
  border-radius: 12px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
  transition: all 0.2s ease;
}
.command-item:hover {
  background: var(--hira-surface-hover);
  transform: translateY(-2px);
  box-shadow: var(--hira-shadow-md);
}
.command-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  color: var(--section-color, var(--hira-blue));
  background: color-mix(in srgb, var(--section-color, var(--hira-blue)) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--section-color, var(--hira-blue)) 20%, transparent);
  font-size: 20px;
  font-weight: 900;
  line-height: 1;
}
.command-body {
  flex: 1;
  min-width: 0;
}
.command-title {
  margin: 0 0 6px;
  color: var(--hira-fg);
  font-size: 18px;
  line-height: 1.3;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.command-desc {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.6;
  font-weight: 500;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.music-list {
  display: grid;
  gap: 14px;
}
.music-row {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  align-items: center;
  gap: 16px;
  min-height: 72px;
  padding: 16px;
  border-radius: 12px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
  transition: all 0.2s ease;
}
.music-row:hover {
  background: var(--hira-surface-hover);
  transform: translateY(-2px);
  box-shadow: var(--hira-shadow-md);
}
.music-index {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--hira-blue), var(--hira-violet));
  color: #fff;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 18px;
  font-weight: 900;
  box-shadow: var(--hira-shadow-sm);
}
.song-main {
  flex: 1;
  min-width: 0;
}
.song-title {
  margin: 0 0 6px;
  color: var(--hira-fg);
  font-size: 19px;
  line-height: 1.3;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.song-artists {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.duration {
  padding: 6px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--hira-violet) 12%, transparent);
  color: var(--hira-violet);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  font-weight: 800;
}
.card-tip {
  margin: 16px 0 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--hira-teal) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--hira-teal) 20%, transparent);
  color: var(--hira-teal);
  font-size: 14px;
  line-height: 1.6;
  font-weight: 700;
}
.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.status-item {
  min-height: 110px;
  padding: 18px;
  border-radius: 12px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
  transition: all 0.2s ease;
}
.status-item:hover {
  background: var(--hira-surface-hover);
  box-shadow: var(--hira-shadow-md);
}
.status-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.status-label {
  color: var(--hira-muted);
  font-size: 13px;
  line-height: 1.4;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.status-pill {
  flex-shrink: 0;
  min-width: 52px;
  padding: 4px 10px;
  border-radius: 8px;
  text-align: center;
  font-size: 11px;
  line-height: 1.3;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.status-ok {
  color: var(--hira-green);
  background: color-mix(in srgb, var(--hira-green) 12%, transparent);
}
.status-off {
  color: var(--hira-muted);
  background: color-mix(in srgb, var(--hira-muted) 12%, transparent);
}
.status-warn {
  color: var(--hira-amber);
  background: color-mix(in srgb, var(--hira-amber) 12%, transparent);
}
.status-info {
  color: var(--hira-blue);
  background: color-mix(in srgb, var(--hira-blue) 12%, transparent);
}
.status-value {
  margin: 0 0 8px;
  color: var(--hira-fg);
  font-size: 26px;
  line-height: 1.2;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.status-detail {
  margin: 0;
  color: var(--hira-muted);
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.update-panel {
  display: grid;
  gap: 20px;
}
.update-summary {
  display: grid;
  gap: 18px;
  padding: 20px;
  border-radius: 12px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.update-state-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.update-state-badge,
.update-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.3;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.update-state-available {
  color: var(--hira-blue);
  background: color-mix(in srgb, var(--hira-blue) 12%, transparent);
}
.update-state-latest {
  color: var(--hira-green);
  background: color-mix(in srgb, var(--hira-green) 12%, transparent);
}
.update-state-preview {
  color: var(--hira-amber);
  background: color-mix(in srgb, var(--hira-amber) 12%, transparent);
}
.update-state-error {
  color: var(--hira-red);
  background: color-mix(in srgb, var(--hira-red) 12%, transparent);
}
.update-source-badge {
  color: var(--hira-violet);
  background: color-mix(in srgb, var(--hira-violet) 12%, transparent);
}
.update-flow {
  display: grid;
  grid-template-columns: 1fr 48px 1fr;
  align-items: stretch;
  gap: 14px;
}
.update-node {
  min-height: 96px;
  padding: 16px;
  border-radius: 12px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
}
.update-node-label {
  color: var(--hira-muted);
  font-size: 12px;
  line-height: 1.3;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.update-node-value {
  margin-top: 12px;
  color: var(--hira-fg);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.update-arrow {
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--hira-fg) 5%, transparent);
  color: var(--hira-muted);
  font-size: 24px;
  line-height: 1;
  font-weight: 900;
}
.update-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.update-meta-card {
  min-height: 76px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
}
.update-meta-label {
  color: var(--hira-muted);
  font-size: 12px;
  line-height: 1.3;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.update-meta-value {
  margin-top: 10px;
  color: var(--hira-fg);
  font-size: 18px;
  line-height: 1.3;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.update-change-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.update-change-list li {
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: start;
  gap: 14px;
  min-height: 52px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  transition: all 0.2s ease;
}
.update-change-list li:hover {
  background: var(--hira-surface-hover);
  box-shadow: var(--hira-shadow-sm);
}
.update-change-index {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--hira-blue), var(--hira-violet));
  color: #fff;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  line-height: 1;
  font-weight: 900;
}
.update-change-text {
  color: var(--hira-fg);
  font-size: 15px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.update-empty,
.update-tip {
  margin: 0;
  padding: 14px 18px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.update-empty {
  color: var(--hira-muted);
  background: color-mix(in srgb, var(--hira-muted) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--hira-muted) 15%, transparent);
}
.update-tip {
  color: var(--hira-teal);
  background: color-mix(in srgb, var(--hira-teal) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--hira-teal) 20%, transparent);
}
.resolver-card {
  display: grid;
  gap: 20px;
}
.resolver-summary {
  display: grid;
  gap: 14px;
  padding: 20px;
  border-radius: 12px;
  background: var(--hira-surface-strong);
  border: 1px solid var(--hira-border);
}
.resolver-platform {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--hira-blue) 12%, transparent);
  color: var(--hira-blue);
  font-size: 13px;
  line-height: 1.3;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.resolver-title {
  margin: 0;
  color: var(--hira-fg);
  font-size: 30px;
  line-height: 1.3;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.resolver-author,
.resolver-desc,
.resolver-url {
  margin: 0;
  color: var(--hira-muted);
  font-size: 15px;
  line-height: 1.6;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.resolver-desc {
  color: var(--hira-fg);
  font-weight: 500;
  white-space: pre-line;
}
.resolver-url {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
}
.resolver-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.metric-card {
  min-height: 86px;
  padding: 16px;
  border-radius: 12px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  transition: all 0.2s ease;
}
.metric-card:hover {
  background: var(--hira-surface-hover);
  box-shadow: var(--hira-shadow-sm);
}
.metric-label {
  color: var(--hira-muted);
  font-size: 12px;
  line-height: 1.3;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.metric-value {
  margin-top: 10px;
  color: var(--hira-fg);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 28px;
  line-height: 1.1;
  font-weight: 900;
}
.error-panel {
  display: grid;
  gap: 18px;
}
.error-reason {
  padding: 20px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--hira-red) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--hira-red) 20%, transparent);
}
.error-label {
  color: var(--hira-red);
  font-size: 12px;
  line-height: 1.3;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.error-text {
  margin: 10px 0 0;
  color: var(--hira-red);
  font-size: 18px;
  line-height: 1.5;
  font-weight: 800;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.error-suggestion {
  padding: 16px 18px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--hira-amber) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--hira-amber) 20%, transparent);
  color: var(--hira-amber);
  font-size: 15px;
  line-height: 1.6;
  font-weight: 700;
}
.error-detail-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.error-detail-list li {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--hira-surface);
  border: 1px solid var(--hira-border);
  color: var(--hira-muted);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.render-footer {
  display: flex;
  justify-content: center;
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--hira-border);
  color: var(--hira-muted);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
}
</style>
</head>
<body>
${body}
</body>
</html>`;
//#endregion
//#region src/services/cardRender/types.ts
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const compactText = (value, maxLength) => {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};
//#endregion
//#region src/services/cardRender/musicListCard.ts
const safeCoverUrl = (url) => {
	const trimmed = url?.trim();
	if (!trimmed) return void 0;
	return /^(?:https?:\/\/|data:image\/|file:\/\/)/i.test(trimmed) ? trimmed : void 0;
};
const formatTtlNote = (ttlSeconds) => {
	const seconds = typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.round(ttlSeconds) : 120;
	if (seconds < 60) return `列表 ${seconds} 秒后失效`;
	const minutes = seconds / 60;
	return `列表 ${Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, "")} 分钟后失效`;
};
const fallbackSleeveArtSvg = `<svg viewBox="0 0 286 196" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="mistSky" x1="0" y1="0" x2="1" y2="0.85">
      <stop offset="0%" stop-color="#f3e6d6"/>
      <stop offset="48%" stop-color="#dfecea"/>
      <stop offset="100%" stop-color="#9cb9c0"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0.5" x2="1" y2="0.35">
      <stop offset="0%" stop-color="#fff8e8" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#f4ebd8" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#f4ebd8" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="waveDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4e7280"/>
      <stop offset="100%" stop-color="#29434f"/>
    </linearGradient>
    <linearGradient id="waveMid" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7fa4ad"/>
      <stop offset="100%" stop-color="#3c5e6c"/>
    </linearGradient>
  </defs>
  <rect width="286" height="196" fill="url(#mistSky)"/>
  <path d="M58 62 C78 14, 152 10, 186 42 C214 14, 268 18, 290 54 L290 105 C242 94, 214 66, 174 74 C140 80, 122 52, 86 68 C68 76, 56 84, 58 62 Z" fill="#466875" opacity="0.82"/>
  <path d="M98 44 C124 22, 168 24, 188 50 C166 56, 148 42, 124 52 C104 60, 92 78, 72 74 C76 58, 86 50, 98 44 Z" fill="#6f949f" opacity="0.78"/>
  <polygon points="154,102 286,74 286,102" fill="url(#beam)"/>
  <path d="M108 168 L124 124 L152 118 L174 132 L192 172 Z" fill="#2c4551"/>
  <path d="M124 124 L152 118 L158 134 L132 142 Z" fill="#517380"/>
  <rect x="148" y="98" width="9" height="22" fill="#e8ece9"/>
  <rect x="147" y="96" width="11" height="4" fill="#2b434f"/>
  <polygon points="146,96 152.5,90 159,96" fill="#2b434f"/>
  <rect x="136" y="112" width="12" height="9" fill="#d8e3e2"/>
  <polygon points="134,112 142,107 149,112" fill="#3a5764"/>
  <path d="M0 132 C38 112, 74 134, 118 152 C156 168, 212 142, 286 150 L286 196 L0 196 Z" fill="url(#waveMid)"/>
  <path d="M0 150 C46 132, 82 158, 128 172 C178 186, 232 158, 286 168 L286 196 L0 196 Z" fill="url(#waveDeep)"/>
  <path d="M0 132 C32 116, 62 128, 92 142 C64 134, 34 126, 0 140 Z" fill="#f3e8da" opacity="0.72"/>
  <path d="M162 162 C196 148, 236 146, 286 154 C244 154, 202 158, 168 168 Z" fill="#dfecea" opacity="0.58"/>
</svg>`;
const musicListDocument = (body, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head style="display:none!important">
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style style="display:none!important">
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: ${width}px;
  background: #dde9e9;
  color: #1c313b;
  font-family: "HarmonyOS Sans SC", "PingFang SC", "SF Pro Display", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#container {
  width: ${width}px;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(ellipse 65% 48% at 72% 46%, rgba(236, 245, 244, 0.58) 0%, rgba(236, 245, 244, 0) 70%),
    radial-gradient(ellipse 52% 42% at 18% 18%, rgba(240, 247, 247, 0.76) 0%, rgba(240, 247, 247, 0) 68%),
    linear-gradient(180deg, #dde9e9 0%, #cfdede 38%, #b6c8cb 72%, #8e9fa3 100%);
  color: #1c313b;
  padding: 30px 48px 40px;
}
#container::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 110px;
  background: linear-gradient(180deg, rgba(44, 58, 63, 0) 0%, rgba(35, 48, 53, 0.16) 100%);
  pointer-events: none;
  z-index: 0;
}
.shelf-topbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 34px;
}
.shelf-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid rgba(28, 49, 59, 0.16);
  background: rgba(255, 255, 255, 0.18);
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.18em;
  color: #253b45;
}
.shelf-right-meta {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: rgba(28, 49, 59, 0.56);
}
.shelf-rule {
  display: inline-block;
  width: 30px;
  height: 1px;
  background: rgba(28, 49, 59, 0.24);
}
.shelf-body {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 396px minmax(0, 1fr);
  gap: 26px;
  align-items: center;
}
.shelf-body.is-tall {
  align-items: start;
}
.shelf-body.is-tall .vinyl-stage {
  margin-top: 24px;
}
.editorial-col {
  min-width: 0;
}
.meta-line {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: rgba(28, 49, 59, 0.62);
  margin-bottom: 10px;
}
.meta-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4e7380;
}
.hero-title {
  margin: 0;
  font-size: 46px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.025em;
  color: #192f39;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hero-title.is-long {
  font-size: 36px;
}
.short-hint {
  margin: 12px 0 28px;
  font-size: 13px;
  color: rgba(28, 49, 59, 0.62);
  letter-spacing: 0.02em;
}
.short-hint code {
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 12px;
  color: #1d3540;
  font-weight: 600;
}
.music-list {
  border-top: 1px solid rgba(25, 47, 57, 0.14);
}
.music-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 12px 2px;
  border-bottom: 1px solid rgba(25, 47, 57, 0.11);
}
.music-list.is-compact .music-row {
  padding: 9.5px 2px;
}
.music-row:last-child {
  border-bottom-color: rgba(25, 47, 57, 0.14);
}
.music-index {
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(25, 47, 57, 0.46);
  font-variant-numeric: tabular-nums;
}
.song-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.song-title {
  margin: 0;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 500;
  color: #172b34;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-artists {
  margin: 0;
  flex: 0 999 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 400;
  color: rgba(25, 47, 57, 0.52);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.duration {
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(25, 47, 57, 0.54);
  font-variant-numeric: tabular-nums;
}
.ttl-note {
  margin: 12px 0 0 2px;
  font-size: 11.5px;
  color: rgba(20, 38, 46, 0.58);
  letter-spacing: 0.02em;
}
.vinyl-stage {
  position: relative;
  height: 340px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 8px;
}
.vinyl-floor-shadow {
  position: absolute;
  left: 20px;
  bottom: 14px;
  width: 356px;
  height: 30px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(22, 34, 39, 0.42) 0%, rgba(22, 34, 39, 0) 72%);
  filter: blur(8px);
  z-index: 0;
}
.vinyl-disc {
  position: absolute;
  left: 152px;
  top: 28px;
  width: 282px;
  height: 282px;
  border-radius: 50%;
  z-index: 1;
  background:
    radial-gradient(circle at center, #a5b5b8 0 3.5px, #211a20 3.8px 5px, transparent 5.2px),
    radial-gradient(circle at center, #c4dad9 0 46px, rgba(35, 58, 66, 0.22) 46.5px 47.5px, #1d161d 48px 51px, transparent 51.5px),
    conic-gradient(
      from 14deg,
      rgba(255, 255, 255, 0.00) 0deg,
      rgba(248, 232, 244, 0.28) 34deg,
      rgba(255, 255, 255, 0.05) 68deg,
      rgba(0, 0, 0, 0.26) 118deg,
      rgba(255, 255, 255, 0.00) 168deg,
      rgba(238, 218, 234, 0.22) 214deg,
      rgba(255, 255, 255, 0.03) 252deg,
      rgba(0, 0, 0, 0.28) 308deg,
      rgba(255, 255, 255, 0.00) 360deg
    ),
    radial-gradient(
      circle at center,
      transparent 0 72px,
      rgba(12, 8, 12, 0.52) 72.5px 74px,
      transparent 74.5px 100px,
      rgba(12, 8, 12, 0.52) 100.5px 102px,
      transparent 102.5px 124px,
      rgba(12, 8, 12, 0.52) 124.5px 126px,
      transparent 126.5px
    ),
    repeating-radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.05) 0px,
      rgba(255, 255, 255, 0.05) 1px,
      rgba(18, 13, 18, 0.30) 1.5px,
      rgba(50, 39, 50, 0.20) 3px
    ),
    radial-gradient(circle at 42% 38%, #5e4a5c 0%, #413340 48%, #261d26 86%, #181218 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    14px 18px 34px rgba(18, 28, 33, 0.36);
}
.vinyl-label-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 78px;
  height: 78px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px solid rgba(30, 52, 60, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 6.5px;
  letter-spacing: 0.12em;
  color: rgba(25, 48, 56, 0.65);
  pointer-events: none;
}
.vinyl-sleeve-wrap {
  position: relative;
  z-index: 2;
  perspective: 1100px;
}
.vinyl-sleeve {
  position: relative;
  width: 300px;
  height: 300px;
  transform: rotateY(-7deg);
  transform-origin: left center;
  background: #334e5d;
  border-radius: 2px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow:
    4px 0 0 #1c2c34,
    5px 0 0 rgba(255, 255, 255, 0.1),
    16px 22px 38px rgba(15, 26, 31, 0.42),
    0 2px 6px rgba(15, 26, 31, 0.24);
}
.vinyl-sleeve::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(125deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0) 42%, rgba(0, 0, 0, 0.12) 100%);
  pointer-events: none;
  z-index: 4;
}
.sleeve-full-cover {
  position: relative;
  width: 100%;
  height: 100%;
  background: #334e5d;
}
.sleeve-fallback-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  isolation: isolate;
  display: flex;
  flex-direction: column;
}
.sleeve-cover-img {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sleeve-cover-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 26px 14px 11px;
  background: linear-gradient(180deg, rgba(16, 24, 30, 0) 0%, rgba(16, 24, 30, 0.68) 100%);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  color: rgba(244, 248, 249, 0.94);
}
.sleeve-cover-title {
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sleeve-cover-tag {
  flex: none;
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  opacity: 0.78;
  white-space: nowrap;
}
.sleeve-top {
  position: relative;
  z-index: 2;
  padding: 15px 18px 12px;
  background: #426172;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.sleeve-artist {
  font-size: 10px;
  font-weight: 500;
  color: rgba(235, 244, 245, 0.78);
}
.sleeve-title {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 700;
  color: #f3f8f8;
  line-height: 1.2;
}
.sleeve-cat {
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 8.5px;
  letter-spacing: 0.12em;
  color: rgba(235, 244, 245, 0.65);
  padding-top: 2px;
  white-space: nowrap;
}
.sleeve-art {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: #d9e4e2;
}
.sleeve-art svg {
  display: block;
  width: 100%;
  height: 100%;
}
.sleeve-bottom {
  position: relative;
  z-index: 2;
  height: 28px;
  padding: 0 18px;
  background: #273c47;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: rgba(226, 238, 240, 0.7);
}
</style>
</head>
<body>
${body}
</body>
</html>`;
const renderFallbackSleeve = (title, source, pageTag) => `
  <div class="sleeve-top">
    <div style="min-width:0">
      <div class="sleeve-artist">${escapeHtml(source)}</div>
      <div class="sleeve-title">${escapeHtml(compactText(title, 18))}</div>
    </div>
    <div class="sleeve-cat">${escapeHtml(pageTag)}</div>
  </div>
  <div class="sleeve-art">${fallbackSleeveArtSvg}</div>
  <div class="sleeve-bottom"><span>HIRA</span><span>MUSIC</span></div>`;
const buildMusicListCardHtml = (items, page, startIndex = 1, options = {}) => {
	const pageTag = `PAGE ${String(Math.max(1, Math.floor(page || 1))).padStart(2, "0")}`;
	const sourceLabel = (options.source || items[0]?.source || "聚合音源").trim();
	const heroTitle = compactText((options.keyword || "").trim() || "点歌列表", 18);
	const isLongTitle = heroTitle.length > 8;
	const isTall = items.length > 12;
	const isCompact = items.length >= 8;
	const firstItem = items[0];
	const coverUrl = safeCoverUrl(options.coverUrl) || safeCoverUrl(items.find((item) => safeCoverUrl(item.coverUrl))?.coverUrl);
	const coverItem = items.find((item) => safeCoverUrl(item.coverUrl)) || firstItem;
	const coverIndex = coverItem?.index ?? startIndex;
	const coverTag = `#${String(coverIndex).padStart(2, "0")}`;
	const ttlNote = formatTtlNote(options.ttlSeconds);
	const sleeveContent = coverUrl ? `
      <div class="sleeve-full-cover">
        <div class="sleeve-fallback-bg">${renderFallbackSleeve(heroTitle, sourceLabel, pageTag)}</div>
        <img class="sleeve-cover-img" src="${escapeHtml(coverUrl)}" alt="" onerror="this.style.display='none'">
        <div class="sleeve-cover-caption">
          <div class="sleeve-cover-title">${escapeHtml(compactText(coverItem?.title || heroTitle, 24))}</div>
          <span class="sleeve-cover-tag">${escapeHtml(coverTag)}</span>
        </div>
      </div>` : renderFallbackSleeve(heroTitle, sourceLabel, pageTag);
	return musicListDocument(`
  <main id="container" data-card="music-list-vinyl">
    <header class="shelf-topbar">
      <div class="shelf-pill">HIRA MUSIC</div>
      <div class="shelf-right-meta">
        <span>${escapeHtml(sourceLabel)}</span>
        <span class="shelf-rule"></span>
        <span>${escapeHtml(pageTag)}</span>
      </div>
    </header>

    <section class="shelf-body${isTall ? " is-tall" : ""}">
      <div class="editorial-col">
        <div class="meta-line">
          <span class="meta-dot"></span>
          <span>${escapeHtml(sourceLabel)} · ${items.length} 首</span>
        </div>
        <h1 class="hero-title${isLongTitle ? " is-long" : ""}">${escapeHtml(heroTitle)}</h1>
        <p class="short-hint">发序号点歌 · <code>#下一页</code></p>

        <div class="music-list${isCompact ? " is-compact" : ""}">
          ${items.map((item, position) => {
		const index = item.index ?? startIndex + position;
		return `
            <article class="music-row">
              <div class="music-index">${String(index).padStart(2, "0")}</div>
              <div class="song-main">
                <h2 class="song-title">${escapeHtml(compactText(item.title, 42))}</h2>
                ${item.artists ? `<p class="song-artists">${escapeHtml(compactText(item.artists, 32))}</p>` : ""}
              </div>
              ${item.duration ? `<div class="duration">${escapeHtml(item.duration)}</div>` : ""}
            </article>`;
	}).join("")}
        </div>
        <p class="ttl-note">${escapeHtml(ttlNote)}</p>
      </div>

      <div class="vinyl-stage">
        <div class="vinyl-floor-shadow"></div>
        <div class="vinyl-disc">
          <div class="vinyl-label-ring">
            <span>SIDE A</span>
            <span>HIRA</span>
          </div>
        </div>
        <div class="vinyl-sleeve-wrap">
          <div class="vinyl-sleeve">
            ${sleeveContent}
          </div>
        </div>
      </div>
    </section>
  </main>`);
};
//#endregion
//#region src/services/cardRender/templates.ts
const h = createElement;
const iconText = (item) => compactText(item.icon || item.title.replace(/^#?/, "").trim().slice(0, 2) || "?", 2);
const decorNodes = (watermark) => [
	h("div", {
		key: "dots",
		className: "dot-matrix",
		"aria-hidden": "true"
	}, Array.from({ length: 9 }, (_, index) => h("span", { key: index }))),
	h("div", {
		key: "corner",
		className: "corner-code",
		"aria-hidden": "true"
	}, "SYS.32.91"),
	h("div", {
		key: "watermark",
		className: "guide-watermark",
		"aria-hidden": "true"
	}, watermark)
];
const renderTemplateHtml = ({ eyebrow, hero, title, subtitle, watermark = hero, body, footer, width = 920, useDarkTheme = false }) => createDocument(renderToStaticMarkup(h("main", {
	id: "container",
	"data-template-engine": "react-static"
}, h("section", { className: "hira-render-shell" }, ...decorNodes(watermark), h("div", { className: "render-content" }, h("header", { className: "render-header" }, h("div", null, h("div", { className: "system-line" }, h("span", { className: "system-dot" }), eyebrow), h("h1", { className: "hero-word" }, hero)), h("div", { className: "module-meta" }, h("span", { className: "header-label" }, "CURRENT MODULE"), h("div", { className: "module-title" }, title), subtitle ? h("div", { className: "module-subtitle" }, subtitle) : null)), h("div", { dangerouslySetInnerHTML: { __html: body } }), footer ? h("footer", { className: "render-footer" }, footer) : null)))), width, useDarkTheme);
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
const buildHelpCardHtml = (groups) => renderTemplateHtml({
	eyebrow: "SYSTEM READY",
	hero: "HELP",
	title: "插件帮助",
	subtitle: "常用命令、点歌、多平台解析和轻量功能一览",
	watermark: "GUIDE",
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
});
const statusText = (status) => ({
	ok: "ONLINE",
	off: "OFFLINE",
	warn: "WARNING",
	info: "INFO"
})[status || "info"];
const buildStatusCardHtml = (options) => renderTemplateHtml({
	eyebrow: options.eyebrow || "SYSTEM STATUS",
	hero: "STATUS",
	title: options.title,
	subtitle: options.subtitle,
	watermark: "STATE",
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
});
const updateStateText = (state) => ({
	available: "可更新",
	latest: "已最新",
	preview: "预览版",
	error: "异常"
})[state];
const updateActionText = (state) => ({
	available: "准备更新",
	latest: "无需操作",
	preview: "保持当前版本",
	error: "等待处理"
})[state];
const updateLagText = (options) => {
	if (typeof options.lagCount === "number") return `${options.lagCount} 次`;
	if (options.state === "latest") return "0 次";
	return options.latest && options.latest !== options.current ? "待确认" : "无差异";
};
const buildUpdateCardHtml = (options) => {
	const source = options.source || "Karin";
	const latest = options.latest || options.current;
	const details = (options.details || []).map((item) => compactText(item, 118)).filter(Boolean).slice(0, 6);
	const metaItems = [
		{
			label: "更新源",
			value: source
		},
		{
			label: "差异",
			value: updateLagText(options)
		},
		{
			label: "动作",
			value: updateActionText(options.state)
		},
		...options.meta || []
	].filter((item) => item.value);
	return renderTemplateHtml({
		eyebrow: "UPDATE CHECK",
		hero: "UPDATE",
		title: options.title,
		subtitle: options.subtitle || `${source} 更新检查结果`,
		watermark: "SYNC",
		footer: options.footer || "Generated by karin-plugin-hira",
		body: `
      <section class="update-panel">
        <div class="update-summary">
          <div class="update-state-row">
            <div class="update-state-badge update-state-${options.state}">${escapeHtml(updateStateText(options.state))}</div>
            <div class="update-source-badge">${escapeHtml(source)}</div>
          </div>
          <div class="update-flow">
            <article class="update-node">
              <div class="update-node-label">当前版本</div>
              <div class="update-node-value">${escapeHtml(options.current)}</div>
            </article>
            <div class="update-arrow">→</div>
            <article class="update-node">
              <div class="update-node-label">${options.state === "available" ? "目标版本" : "远程版本"}</div>
              <div class="update-node-value">${escapeHtml(latest)}</div>
            </article>
          </div>
          <div class="update-meta-grid">
            ${metaItems.map((item) => `
            <article class="update-meta-card">
              <div class="update-meta-label">${escapeHtml(item.label)}</div>
              <div class="update-meta-value">${escapeHtml(item.value)}</div>
            </article>`).join("")}
          </div>
        </div>
        ${details.length > 0 ? `<ul class="update-change-list">${details.map((detail, index) => `
          <li>
            <span class="update-change-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="update-change-text">${escapeHtml(detail)}</span>
          </li>`).join("")}</ul>` : "<p class=\"update-empty\">远程没有返回可展示的变更摘要，当前只显示版本检查结果</p>"}
        ${options.tip ? `<p class="update-tip">${escapeHtml(options.tip)}</p>` : ""}
      </section>`
	});
};
const buildErrorCardHtml = (options) => renderTemplateHtml({
	eyebrow: "SYSTEM ERROR",
	hero: "ERROR",
	title: "诊断卡片",
	subtitle: options.subtitle || options.title,
	watermark: "FAIL",
	footer: "Generated by karin-plugin-hira",
	body: `
    <section class="error-panel">
      <div class="error-reason">
        <div class="error-label">${escapeHtml(options.title)}</div>
        <p class="error-text">${escapeHtml(options.reason)}</p>
      </div>
      ${options.suggestion ? `<div class="error-suggestion">${escapeHtml(options.suggestion)}</div>` : ""}
      ${(options.details || []).length > 0 ? `<ul class="error-detail-list">${(options.details || []).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}
    </section>`
});
//#endregion
//#region src/resolvers/media.ts
const trimUrl = (url) => url.trim().replace(/\\+$/g, "");
const resizeQueryPattern = /(?:imageView2|imageMogr2|x-oss-process|resize|thumbnail|thumb|blur|format\/webp|[?&](?:w|h|width|height|size)=)/i;
const normalizeMediaKey = (url) => {
	const clean = trimUrl(url);
	try {
		const parsed = new URL(clean);
		const rawSearch = parsed.search;
		if (rawSearch && resizeQueryPattern.test(rawSearch)) parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return clean.replace(/[?#].*$/u, "");
	}
};
const widthFromUrl = (url) => {
	for (const pattern of [
		/(?:^|[/?&,])w[=_/-]?(\d{2,5})(?:\D|$)/i,
		/(?:^|[/?&,])width[=_-]?(\d{2,5})(?:\D|$)/i,
		/\/(\d{2,5})x\d{2,5}(?:\D|$)/i
	]) {
		const value = Number(url.match(pattern)?.[1]);
		if (Number.isFinite(value) && value > 0) return value;
	}
	return 0;
};
const imageQuality = (url) => {
	const clean = trimUrl(url).toLowerCase();
	if (!clean) return "blurred";
	if (/blur|blurred|mosaic|placeholder|blurhash|imageMogr2\/blur/i.test(clean)) return "blurred";
	if (/\/(?:thumb|thumbnail|preview|small)(?:[/?#]|$)|(?:^|[?&])thumb=|\/s\d{2,3}\//i.test(clean)) return "thumbnail";
	const width = widthFromUrl(clean);
	if (width > 0 && width <= 320) return "thumbnail";
	if (/original|origin|large|raw|1080|1440|2160/i.test(clean)) return "original";
	return "normal";
};
const qualityBaseScore = (quality) => ({
	original: 4e3,
	normal: 3e3,
	thumbnail: 1e3,
	blurred: 0
})[quality];
const imageScore = (url) => qualityBaseScore(imageQuality(url)) + Math.min(widthFromUrl(url), 3e3);
const isUsableImageUrl = (url) => {
	const quality = imageQuality(url);
	return quality === "original" || quality === "normal";
};
const selectBestImageUrl = (values) => {
	const candidates = values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean);
	if (candidates.length === 0) return void 0;
	return candidates.sort((left, right) => imageScore(right) - imageScore(left))[0];
};
const dedupeImageUrls = (urls, options = {}) => {
	const bestByKey = /* @__PURE__ */ new Map();
	for (const url of urls) {
		if (!url.trim()) continue;
		const key = normalizeMediaKey(url);
		const current = bestByKey.get(key);
		if (!current || imageScore(url) > imageScore(current)) bestByKey.set(key, url);
	}
	const values = [...bestByKey.values()];
	if (options.filterLowQuality === false) return values;
	const usable = values.filter(isUsableImageUrl);
	if (usable.length > 0) return usable;
	return values.filter((url) => imageQuality(url) !== "blurred");
};
const dedupeRichContentBlocks = (blocks, options = {}) => {
	if (options.dedupe === false) return blocks.filter((block) => {
		if (block.type === "text") return Boolean(block.text.trim());
		if (options.filterLowQuality === false) return Boolean(block.url.trim());
		return isUsableImageUrl(block.url) || imageQuality(block.url) !== "blurred";
	});
	const bestImageByKey = /* @__PURE__ */ new Map();
	for (const block of blocks) {
		if (block.type !== "image") continue;
		const key = normalizeMediaKey(block.url);
		const current = bestImageByKey.get(key);
		if (!current || imageScore(block.url) > imageScore(current)) bestImageByKey.set(key, block.url);
	}
	const seenImages = /* @__PURE__ */ new Set();
	return blocks.filter((block) => {
		if (block.type === "text") return Boolean(block.text.trim());
		const key = normalizeMediaKey(block.url);
		if (seenImages.has(key)) return false;
		if (bestImageByKey.get(key) !== block.url) return false;
		if (options.filterLowQuality !== false && !isUsableImageUrl(block.url) && imageQuality(block.url) === "blurred") return false;
		seenImages.add(key);
		return true;
	});
};
//#endregion
//#region src/services/cardRender/resolverCards.ts
const mediaCount = (items) => Array.isArray(items) ? items.length : 0;
const metricCard = (label, value) => `
  <article class="metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </article>`;
const resolverCountText = (value, unit) => value > 0 ? `${value} ${unit}` : "";
const stripResolverCommentSections = (value) => value.replace(/\n\n热门(?:评论|回复)\n[\s\S]*$/u, "").trim();
const resolverPreviewDocument = (body, width = 920) => `<!doctype html>
<html lang="zh-CN">
<head style="display:none!important">
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style style="display:none!important">
* { box-sizing: border-box; }
html {
  background: #f4f4f5;
}
body {
  margin: 0;
  width: ${width}px;
  background: #f4f4f5;
  color: #18181b;
  font-family: HarmonyOSHans-Regular, "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}
#container {
  width: ${width}px;
  padding: 8px;
  background: #f4f4f5;
}
.resolver-preview-shell {
  width: 100%;
  min-height: 360px;
  padding: 20px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(24, 24, 27, 0.08);
  box-shadow: none;
  overflow: hidden;
}
.resolver-preview-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.resolver-preview-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #52525b;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 850;
}
.resolver-preview-brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--resolver-accent, #22c55e);
}
.resolver-preview-source {
  color: #a1a1aa;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-main {
  display: grid;
  grid-template-columns: 168px 1fr;
  gap: 20px;
  align-items: start;
}
.resolver-preview-main-no-cover {
  display: block;
}
.resolver-preview-cover {
  width: 168px;
  height: 168px;
  border-radius: 8px;
  object-fit: cover;
  background: #f4f4f5;
}
.resolver-preview-title {
  margin: 0;
  color: #18181b;
  font-size: 30px;
  line-height: 1.22;
  font-weight: 900;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.resolver-preview-author {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
}
.resolver-preview-avatar,
.resolver-preview-avatar-fallback {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 999px;
}
.resolver-preview-avatar {
  object-fit: cover;
  background: #f4f4f5;
}
.resolver-preview-avatar-fallback {
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--resolver-accent, #22c55e) 14%, white);
  color: var(--resolver-accent-strong, #14532d);
  font-size: 14px;
  font-weight: 900;
}
.resolver-preview-author-name {
  color: #27272a;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 850;
}
.resolver-preview-author-meta {
  margin-top: 2px;
  color: #71717a;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 650;
}
.resolver-preview-desc {
  margin: 16px 0 0;
  color: #3f3f46;
  font-size: 16px;
  line-height: 1.68;
  font-weight: 520;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.resolver-preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
}
.resolver-preview-chip {
  padding: 5px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--resolver-accent, #22c55e) 9%, #f4f4f5);
  color: #3f3f46;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-divider {
  height: 1px;
  margin: 20px 0 14px;
  background: #e4e4e7;
}
.resolver-preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.resolver-preview-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: #71717a;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
}
.resolver-preview-mark {
  color: #d4d4d8;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 850;
}
</style>
</head>
<body>
${body}
</body>
</html>`;
const resolverPlatformTones = {
	bilibili: {
		accent: "#00a1d6",
		strong: "#0369a1"
	},
	kuaishou: {
		accent: "#ff5f00",
		strong: "#c2410c"
	},
	xiaoheihe: {
		accent: "#16a34a",
		strong: "#14532d"
	},
	xiaohongshu: {
		accent: "#e11d48",
		strong: "#9f1239"
	},
	weibo: {
		accent: "#f59e0b",
		strong: "#92400e"
	},
	tieba: {
		accent: "#2563eb",
		strong: "#1e40af"
	},
	general: {
		accent: "#64748b",
		strong: "#334155"
	}
};
const resolverPlatformTone = (platform) => resolverPlatformTones[platform] || {
	accent: "#2563eb",
	strong: "#1e40af"
};
const resolverPreviewCover = (post) => {
	const cover = selectBestImageUrl([post.extras?.coverUrl, ...post.images]);
	return cover && isUsableImageUrl(cover) ? cover : void 0;
};
const avatarInitial = (author) => author.trim().slice(0, 1) || "?";
const buildResolverPreviewCardHtml = (post, defaultDescription, options = {}) => {
	const extras = post.extras || {};
	const commentsEnabled = options.commentsEnabled ?? true;
	const cover = resolverPreviewCover(post);
	const tags = (extras.tags || []).slice(0, 4);
	const title = compactText(post.title || post.displayName, 58);
	const description = compactText((commentsEnabled ? post.description : stripResolverCommentSections(post.description || "")) || defaultDescription || `已识别${post.displayName}分享，完整内容将随后发送。`, 150);
	const author = post.author || post.displayName;
	const avatarText = avatarInitial(author);
	const meta = [extras.location, extras.createdAt ? String(extras.createdAt) : void 0].filter(Boolean).join(" · ");
	const stats = [
		resolverCountText(mediaCount(dedupeImageUrls(post.images)), "张图片"),
		resolverCountText(mediaCount(post.videos), "个视频"),
		commentsEnabled ? resolverCountText(mediaCount(extras.commentBlocks), "条评论") : ""
	].filter(Boolean);
	const tone = resolverPlatformTone(post.platform);
	return resolverPreviewDocument(`
    <main id="container">
      <article class="resolver-preview-shell" data-platform="${escapeHtml(post.platform)}" style="--resolver-accent: ${tone.accent}; --resolver-accent-strong: ${tone.strong};">
        <header class="resolver-preview-topbar">
          <div class="resolver-preview-brand"><span class="resolver-preview-brand-dot"></span>${escapeHtml(post.displayName)}</div>
          <div class="resolver-preview-source">Hira Resolver</div>
        </header>
        <section class="${cover ? "resolver-preview-main" : "resolver-preview-main-no-cover"}">
          ${cover ? `<img class="resolver-preview-cover" src="${escapeHtml(cover)}" alt="">` : ""}
          <div class="resolver-preview-content">
            <h1 class="resolver-preview-title">${escapeHtml(title)}</h1>
            <div class="resolver-preview-author">
              ${extras.authorAvatar ? `<img class="resolver-preview-avatar" src="${escapeHtml(extras.authorAvatar)}" alt="">` : `<div class="resolver-preview-avatar-fallback">${escapeHtml(avatarText)}</div>`}
              <div>
                <div class="resolver-preview-author-name">${escapeHtml(author)}</div>
                ${meta ? `<div class="resolver-preview-author-meta">${escapeHtml(meta)}</div>` : ""}
              </div>
            </div>
            <p class="resolver-preview-desc">${escapeHtml(description)}</p>
            ${tags.length > 0 ? `<div class="resolver-preview-chips">${tags.map((tag) => `<span class="resolver-preview-chip">#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          </div>
        </section>
        ${stats.length > 0 ? `
        <div class="resolver-preview-divider"></div>
        <footer class="resolver-preview-footer">
          <div class="resolver-preview-stats">${stats.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          <div class="resolver-preview-mark">karin-plugin-hira</div>
        </footer>` : ""}
      </article>
    </main>`);
};
const buildResolverCardHtml = (post) => {
	const title = post.title || `${post.displayName}解析结果`;
	const description = post.description ? compactText(post.description, 260) : "已识别分享链接，媒体内容将随卡片一并发送";
	return renderTemplateHtml({
		eyebrow: "RESOLVER RESULT",
		hero: "RESOLVE",
		title: "解析结果",
		subtitle: post.displayName,
		watermark: "POST",
		footer: "Generated by karin-plugin-hira",
		body: `
      <section class="resolver-card">
        <div class="resolver-summary">
          <div class="resolver-platform">${escapeHtml(post.displayName)}</div>
          <h2 class="resolver-title">${escapeHtml(compactText(title, 72))}</h2>
          ${post.author ? `<p class="resolver-author">作者：${escapeHtml(post.author)}</p>` : ""}
          <p class="resolver-desc">${escapeHtml(description)}</p>
          ${post.pageUrl ? `<p class="resolver-url">${escapeHtml(post.pageUrl)}</p>` : ""}
        </div>
        <div class="resolver-metrics">
          ${metricCard("平台", post.platform)}
          ${metricCard("图片", mediaCount(post.images))}
          ${metricCard("视频", mediaCount(post.videos))}
        </div>
      </section>`
	});
};
//#endregion
//#region src/services/cardRender.ts
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
/**
* 相同 HTML(+宽度) 直接复用上次截图, 参考 R apps/help.js:31-42 的 md5 缓存.
* 截图成本高且状态卡/帮助卡在短时间内高度重复; 限制条数避免常驻内存膨胀.
* 一次性卡片(点歌列表/解析预览)的 HTML 每次不同, 首次渲染不入缓存, 第二次遇到同一 key
* 才说明会被复用 (评审 I3), 避免 64 个 LRU 槽被一次性卡片挤满.
*/
const cardImageCache = /* @__PURE__ */ new Map();
const pendingCardImageKeys = /* @__PURE__ */ new Set();
const cardImageCacheLimit = 64;
const pendingCardKeysLimit = 256;
const readCardImageCache = (key) => {
	const cached = cardImageCache.get(key);
	if (!cached) return void 0;
	cardImageCache.delete(key);
	cardImageCache.set(key, cached);
	return cached;
};
const writeCardImageCache = (key, images) => {
	cardImageCache.set(key, images);
	while (cardImageCache.size > cardImageCacheLimit) {
		const oldest = cardImageCache.keys().next().value;
		if (oldest === void 0) break;
		cardImageCache.delete(oldest);
	}
};
const trackPendingCardKey = (key) => {
	pendingCardImageKeys.add(key);
	while (pendingCardImageKeys.size > pendingCardKeysLimit) {
		const oldest = pendingCardImageKeys.values().next().value;
		if (oldest === void 0) break;
		pendingCardImageKeys.delete(oldest);
	}
};
const renderCardImage = async ({ name, html, width = 760, writeHtml = writeCardHtmlFile, render: render$1 = render.render.bind(render) }) => {
	const cacheKey = crypto.createHash("md5").update(`${width}\n${html}`).digest("hex");
	const cached = readCardImageCache(cacheKey);
	if (cached) {
		logger.debug(`[${Root.pluginName}] Render card ${name}: cache hit`);
		return cached;
	}
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
	const images = (Array.isArray(result) ? result : [result]).map((image) => segment.image(`base64://${image}`));
	if (pendingCardImageKeys.delete(cacheKey)) writeCardImageCache(cacheKey, images);
	else trackPendingCardKey(cacheKey);
	logger.debug(`[${Root.pluginName}] Render card ${name}: ${file}, images=${images.length}`);
	return images;
};
const logCardRenderFailure = (name, error) => {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	logger.error(`[${Root.pluginName}] Render card ${name} failed: ${message}`);
};
//#endregion
export { dedupeImageUrls as a, isUsableImageUrl as c, buildHelpCardHtml as d, buildStatusCardHtml as f, buildResolverPreviewCardHtml as i, selectBestImageUrl as l, buildMusicListCardHtml as m, renderCardImage as n, dedupeRichContentBlocks as o, buildUpdateCardHtml as p, buildResolverCardHtml as r, imageQuality as s, logCardRenderFailure as t, buildErrorCardHtml as u };

//# sourceMappingURL=cardRender.js.map