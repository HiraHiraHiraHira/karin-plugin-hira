export const createDocument = (body: string, width = 920, useDarkTheme = false) => `<!doctype html>
<html lang="zh-CN" data-theme="${useDarkTheme ? 'dark' : 'light'}">
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
</html>`

