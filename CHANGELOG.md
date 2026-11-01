# Changelog

## 2026-11-01

### Added

- 点歌卡片改为通道链 `platform` → `ark` → `music`：优先发平台标准 ID 卡（网易云就是网易云身份，与小飞一致），其次走第三方签名服务换签好的 ark 卡，最后才降级到由协议端签名的 music 段；全部通道失败回一条文字兜底，不再静默失败。
- 新增聚合音源（txqq.pro）作为 QQ音乐/网易云/酷狗/酷我 的搜索与直链兜底，QQ音乐直链由 60 秒试听变为完整时长。
- 新增 `#点歌卡片状态`（主人/管理员可用）与 `[Hira-卡片]` 结构化日志，卡片走了哪个通道、失败原因都能查。
- B站点歌内置 B站 Android 客户端的公开 appkey/secret 作为默认值，装上即可用，可用 `music.bilibili.appKey/appSecret` 或 `HIRA_BILIBILI_APP_KEY` / `HIRA_BILIBILI_APP_SECRET` 覆盖。

### Fixed

- B站音频直链按小飞的做法改写 CDN 镜像域名（优先 IP 型地址，再替换为 `upos-sz-mirrorhw.bilivideo.com`），避免原始 host 失效导致卡片点开播不了。
- 直链可用性校验（HEAD 探测）：网易云会员/版权歌不再发出点不动的卡，同时保留平台卡片可用。
- 拿不到直链时的报错改为中文并给出具体原因（原为 `empty playable URL`），酷狗/酷我分别给出各自的原因。
- 酷狗原生路径不再用 `fileName` 覆盖歌曲标题；QQ音乐搜索全部失败时直接报错，不再返回 `歌曲 #1` 这类假 id 占位结果。
- 聚合音源增加单次超时、总预算与结果缓存，避免上游抖动时把点歌拖到几十秒。

## 2026-10-28

### Fixed

- Update checks now pick npm vs Git from the plugin's install source before querying: the plugin only calls `checkPkgUpdate` when the host `package.json` declares it as an npm registry dependency, otherwise it goes straight to the Git check. Previously tarball/pnpm installs triggered a `callback: npm 404 Not Found` error log from Karin every 3 minutes.
- The `hira-更新检测` task silently skips polling when neither an npm declaration nor a Git checkout can be resolved, instead of logging a 404 followed by a failed Git probe. Manual `#Hira更新` still reports an actionable error.

## 2026-08-04

### Added

- Added owner/admin-only AI webpage summarization with HTTP(S)-only public URL validation, private-network/DNS protection, redirect limits, page-size limits, per-requester rate limiting, and concurrency control.
- Added resolver/media proxy support, download byte limits, temporary-file quota cleanup, atomic download renames, and first-video-only sending behavior.
- Added strict configuration shape/URL validation, secret masking, masked-secret restoration, atomic YAML writes, and runtime limits for video, preview covers, and the temp directory.
- Added CI coverage for Node.js 18/20/22, type checking, tests, build output, and package smoke testing.

### Changed

- Removed hard-coded Bilibili music app credentials; they now come from Karin configuration or environment variables and are masked in WebUI/API responses.
- Upgraded the known网易云默认 API and playback fallback URLs to HTTPS while retaining user-configured endpoint overrides.
- Kept resolver failure messages actionable by including the failed endpoint host without exposing cookies or credentials.
