import { compactText, escapeHtml, type MusicListCardItem, type MusicListCardOptions } from './types'

const safeCoverUrl = (url: string | undefined) => {
  const trimmed = url?.trim()
  if (!trimmed) return undefined
  return /^(?:https?:\/\/|data:image\/|file:\/\/)/i.test(trimmed) ? trimmed : undefined
}

const formatTtlNote = (ttlSeconds?: number) => {
  const seconds = typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? Math.round(ttlSeconds)
    : 120
  if (seconds < 60) return `列表 ${seconds} 秒后失效`
  const minutes = seconds / 60
  const display = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, '')
  return `列表 ${display} 分钟后失效`
}

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
</svg>`

const musicListDocument = (body: string, width = 920) => `<!doctype html>
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
</html>`

const renderFallbackSleeve = (title: string, source: string, pageTag: string) => `
  <div class="sleeve-top">
    <div style="min-width:0">
      <div class="sleeve-artist">${escapeHtml(source)}</div>
      <div class="sleeve-title">${escapeHtml(compactText(title, 18))}</div>
    </div>
    <div class="sleeve-cat">${escapeHtml(pageTag)}</div>
  </div>
  <div class="sleeve-art">${fallbackSleeveArtSvg}</div>
  <div class="sleeve-bottom"><span>HIRA</span><span>MUSIC</span></div>`

export const buildMusicListCardHtml = (
  items: MusicListCardItem[],
  page: number,
  startIndex = 1,
  options: MusicListCardOptions = {}
) => {
  const safePage = Math.max(1, Math.floor(page || 1))
  const pageTag = `PAGE ${String(safePage).padStart(2, '0')}`
  const sourceLabel = (options.source || items[0]?.source || '聚合音源').trim()
  const rawTitle = (options.keyword || '').trim() || '点歌列表'
  const heroTitle = compactText(rawTitle, 18)
  const isLongTitle = heroTitle.length > 8
  const isTall = items.length > 12
  const isCompact = items.length >= 8
  const firstItem = items[0]
  const coverUrl = safeCoverUrl(options.coverUrl) || safeCoverUrl(items.find(item => safeCoverUrl(item.coverUrl))?.coverUrl)
  const coverItem = items.find(item => safeCoverUrl(item.coverUrl)) || firstItem
  const coverIndex = coverItem?.index ?? startIndex
  const coverTag = `#${String(coverIndex).padStart(2, '0')}`
  const ttlNote = formatTtlNote(options.ttlSeconds)

  const sleeveContent = coverUrl
    ? `
      <div class="sleeve-full-cover">
        <div class="sleeve-fallback-bg">${renderFallbackSleeve(heroTitle, sourceLabel, pageTag)}</div>
        <img class="sleeve-cover-img" src="${escapeHtml(coverUrl)}" alt="" onerror="this.style.display='none'">
        <div class="sleeve-cover-caption">
          <div class="sleeve-cover-title">${escapeHtml(compactText(coverItem?.title || heroTitle, 24))}</div>
          <span class="sleeve-cover-tag">${escapeHtml(coverTag)}</span>
        </div>
      </div>`
    : renderFallbackSleeve(heroTitle, sourceLabel, pageTag)

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

    <section class="shelf-body${isTall ? ' is-tall' : ''}">
      <div class="editorial-col">
        <div class="meta-line">
          <span class="meta-dot"></span>
          <span>${escapeHtml(sourceLabel)} · ${items.length} 首</span>
        </div>
        <h1 class="hero-title${isLongTitle ? ' is-long' : ''}">${escapeHtml(heroTitle)}</h1>
        <p class="short-hint">发序号点歌 · <code>#下一页</code></p>

        <div class="music-list${isCompact ? ' is-compact' : ''}">
          ${items.map((item, position) => {
            const index = item.index ?? startIndex + position
            return `
            <article class="music-row">
              <div class="music-index">${String(index).padStart(2, '0')}</div>
              <div class="song-main">
                <h2 class="song-title">${escapeHtml(compactText(item.title, 42))}</h2>
                ${item.artists ? `<p class="song-artists">${escapeHtml(compactText(item.artists, 32))}</p>` : ''}
              </div>
              ${item.duration ? `<div class="duration">${escapeHtml(item.duration)}</div>` : ''}
            </article>`
          }).join('')}
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
  </main>`)
}
