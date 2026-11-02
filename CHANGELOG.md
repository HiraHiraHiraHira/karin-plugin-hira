# Changelog

## 2026-11-02

### Added

- 新增每小时一次的临时目录清理任务 `hira-临时清理`（受 `runtime.cleanupEnabled` 控制），临时目录不再只靠 `#清理垃圾` 手动清；WebUI 与自定义配置页的开关说明同步改成「每小时一次」。
- 新增 `runtime.maxAudioFileSizeBytes`（默认 100 MiB），语音点歌的源音频下载受体积上限约束，不再无限制下载。

### Changed

- `music.highQuality` 与 `#高清语音N` 真正生效：开启后语音转码用 128kbps 双声道 48kHz，关闭时保持原来的 32kbps 单声道 24kHz；自定义配置页的开关文案改为「高品质语音」。
- 语音转码结束后立即删除临时源文件，失败时同时清理半成品，不再每次语音点歌残留两个文件。
- 聚合音源兜底查询把剩余预算算进单次请求超时，整体耗时回到 8 秒预算内（此前已在飞的请求可把总耗时拖到约 10 秒）。
- `Config` 读取按配置文件 mtime + size 缓存，改 YAML 仍然立即生效，但同一次操作不会再读到不同版本。
- 移除无效配置项：`resolver.priority`（Karin 1.18.0 的排序按加载顺序生效，`priority`/`rank` 都不参与排序）和顶层 `music.textFallback`（从未被读取，生效的是 `music.card.textFallback`）。同步清理 `karin.command` 上不生效的 `priority` 选项、WebUI 表单、自定义配置页、配置校验和 README 说明。

### Fixed

- **临时文件默认目录从插件私有 `data/temp` 改到 Karin 共享的 `@karinjs/temp/<插件名>`**：NapCat 处理裸文件路径时会先判断文件在不在，插件私有目录没挂进协议端容器 → 判成未知类型直接拒收（`retcode 1200 文件处理失败: 识别URL失败`），语音消息和解析视频都会发不出去、只剩降级内容。`runtime.tempRoot` 仍可覆盖，改到别处时要给协议端容器挂同一路径。
- 用户可见报错中文化：`fetchJson` 的 `JSON.parse` 失败不再把 `Unexpected token '<', "<!doctype "... is not valid JSON` 抛进群里，改为「接口返回的不是 JSON（HTTP xxx，开头：…）」；请求超时改为「请求超时（N ms）」；网络层错误统一加「网络请求失败：」前缀；非 2xx 改为「接口返回 HTTP xxx」；微博解析的 `empty api data` 改为中文，并在兜底详情页也失败时让该错误真正浮现到解析失败卡片。
- 修复 `fetchResponse` 在调用方传入 `signal` 时本地超时完全失效的问题，现在两者同时生效且能区分「超时」与「调用方主动取消」。
- 限制内存中保留的点歌会话数（默认 500）和网页总结限流状态条目数（默认 500），超出按最旧淘汰；新增会话 `sweep()`。

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
