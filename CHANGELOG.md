# Changelog

## 2026-11-04

### Added

- 新增 OIDB 通道：插件自己按 `0xb77_9` 结构拼包，经 NapCat 的 `send_packet` 直接发 QQ 音乐卡。不经过任何第三方签名服务，`retcode=0` 才算成功，因此可观测、可熔断；凭据是 QQ 客户端内置的分享常量（与 mirai `MusicShare.kt` 同源），无需配置。默认排在 `platform` 之后、`ark` 之前，配置项 `music.card.oidb.enabled`。
- `#点歌卡片状态` 增加 OIDB 通道状态、熔断与计数。

### Changed

- 默认通道顺序改为 `platform → oidb → ark → music`：平台原生卡优先，其次本机拼包，再次第三方签名，最后才是哑兜底的 `music` 段。
- `ark` 默认超时 5000ms → 3000ms、重试 1 → 0：有 OIDB 兜底后不必在第三方站点上多等。
- QQ 音乐搜索把官方接口与旧接口改为**并行**请求，官方结果优先；未登录态下省掉一次串行等待。
- QQ 音乐直链增加 10 分钟进程内缓存（同一首歌重复点不再走 vkey + 聚合），上限 300 条。
- 聚合音源兜底：总预算 8000ms → 6000ms，单关键词重试 3 → 2，重试间隔 250ms → 120ms。

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

## 2026-10-30

本批为"迁移回归修复"：对照 Yunzai 侧 rconsole-plugin / xiaofei-plugin 的原版体验，修复开箱失败、交互语义退化、解析缩水与媒体链路问题。

### Fixed（开箱失败 / 回归）

- 翻译：默认兜底接口 `api.interpreter.caiyunai.com` 需要 token，配置里却没有凭据字段，开箱必然 `HTTP 401`。默认改为腾讯 transmart 匿名接口，并按 R 插件协议实现请求体（`text_analysis` 探测源语言 + `auto_translation`）；`deeplxApi` 支持逗号分隔多镜像随机选取，降级链 deeplx→transmart，失败提示带用法示例。
- 翻译：`翻中hello` 这种无空格写法不命中；解析改为长别名优先切片，不再要求空格。译文改为引用回复且不再带 `Hira：` 前缀。
- 轻量：`#买家秀`/`#累了` 默认源 `api.vvhan.com` 已无 DNS 记录，开箱必失败；默认源换为 suyanw / imgapi，并适配 `[imgurl]` 与 `[imgurls]` 两种新响应。`#累了` 恢复多张 cos 图 + 固定文案语义。`#推荐软件`/`#医药查询` 裸命令恢复（返回全量列表/用法说明），`#cat` 与轻量输出改为合并转发，减少刷屏。
- 点歌：裸 `#语音`/`#歌词`（不带序号）因入口正则要求序号而静默丢弃；序号改为可选，无序号时取上次选中或列表首项。
- 点歌：`#提交音乐ck MUSIC_U=...` 旧式单段粘贴静默失效；现支持单段自动识别网易云/QQ，提交时即时校验账号并回显 VIP，校验失败不落盘；状态卡补 VIP 显示。
- 点歌：QQ 音乐搜索失败时伪造 `${关键词} #1` 假列表；改为返回"没有找到歌曲！"。`vkey` 从单一 M800 档改为 320mp3/192ogg/128mp3/96aac 阶梯（`media_mid` 优先）。B站 dash 无音轨时回退 durl，纯 IP 主机改写 upos 镜像。
- 点歌：越界序号会吞掉纯数字消息并回错误文案；现越界直接放行给其它插件，无会话时才回引导文案。
- 解析：小黑盒游戏价格直接插值对象，渲染成 `[object Object]`；改为读取 `price.current`，主机版读地区价。
- 解析：B站只认普通视频 BV，番剧/动态/直播/专栏/av 号统统一句"无法识别 BVID"；现支持 `play/ep|ss`、`t.bilibili.com` 动态（需 SESSDATA）、直播间（仅信息）、专栏、av→BV。
- 解析：B站 `fnval` 固定 `16`，配置的 AV1/高画质永远匹配不到；现按画质补 2048/4096/8192 等标志并写 `fourk`，`codec` 优先级真正生效，默认画质 64(720P)→112(1080P+)。充电专属/试看会显式标注，不再伪装完整视频。
- 解析：抖音直播与 `webcast.amemv.com` 分享整体缺失；现支持直播标题/封面/在线人数（不拉流）与 reflow 分享。抖音时长 <1s 被误判超限的换算 bug 修复。
- 解析：抖音动图只发第一条、BGM 丢失；现全部动图片段进入 `videos`，BGM 作为 `audioUrl` 交给发送侧合并。
- 解析：贴吧只取 5 楼 → 上限 30 楼；微博热评 5 条 → 20 条并带点赞/时间/来源，补投票帖兜底图与头条文章标题；小黑盒评论 50 条按楼层排序并带点赞/回复数。
- 解析：皮皮虾与 AcFun 只剩第三方通用 API；新增原生解析（皮皮虾去水印/互动数据/评论、AcFun 稿件详情 mp4 优先 m3u8 候补），失败自动降级。西瓜 `v.ixigua.com` 短链归一化，通用解析按域名显示具体来源。
- 消息：`e.reply` 默认不带引用，机器人回复全是裸消息；`replyText`/`replyPlainText` 新增可选 `{ reply, recallMsg }`，默认引用触发消息，临时提示可定时撤回。
- 消息："伪装合并转发"身份不统一（多图/长文伪装成 bot 自己、评论节点 `userId='1'` 灰头像）；统一为发送者身份，评论作者名保留在正文与昵称中。评论节点渲染 `👍 N`/`💬 M`。
- 消息：图片发送失败只改 URL hash 重试一次；新增本地下载兜底（域名 Referer + 随机字节扰动 hash）并覆盖合并转发节点内媒体。
- 消息：解析慢在"全部下载完才回消息"；媒体改为惰性——解析只产出直链，预览/文案先发，视频在发送时下载、按需合并音轨与转封装，多视频逐个发送（上限 9）。
- 权限：`perm` 选项会让 Karin 自动回"暂无权限"并吞消息；`#Hira更新`/`#清理垃圾`/`#总结一下` 改为 handler 内判定、失败 `next()` 静默放行。`#清理垃圾` 只认 hira/hi 前缀，不再匹配裸词。
- HTTP：解析请求无重试；`fetchResponse` 对网络错误与 5xx 增加 3 次指数退避（4xx 不重试）。
- 渲染：帮助/状态等卡片每次重新截图；改为按 HTML md5 缓存（LRU 64）。

### Changed

- 点歌新增：`#每日推荐`/`#日推`/`#每日30首`、`#个性电台`、`#我的收藏`/`#我喜欢的歌`、`#来首歌`/`#放首歌`、引用音乐卡片后的 `#下载音乐`；`#点歌` 空关键词回用法说明；`#下一页` 等列表会话超时/换歌会整批撤回历史列表图。
- 语音：普通语音下载后转 SILK 真语音条（任何 OneBot 端可播），高清语音保留原音质直传，失败自动降级 SILK。
- 歌词：以合并转发发送完整歌词（去时间轴 + 原始 LRC），不再截断 1800 字，网易云附带翻译歌词。
- 点歌列表默认每页 10 → 20。
- AI 总结：新增自动触发域名 `ai.autoSummaryDomains`（默认微信/arxiv/sspai/chinadaily/知乎/github/v2ex），结构化提示词，正文上限 12000 → 50000 字，抓取 3 次重试，输出改为合并转发；权限由 owner/admin 放开到群成员（保留 3 次/5 分钟限流与全局并发 2）。
- 翻译/轻量默认接口变更：`translate.tencentApi` 默认 transmart，`light.buyerShowApis`/`light.tiredApis` 默认换新源。

### Added

- 依赖 `silk-wasm`（语音 SILK 编码，失败自动回退 opus）。

### Removed

- 解析器内同步下载/转码链路（`downloadDouyinVideos`、B站 DASH 下载合并），改由发送侧惰性执行。

### Fixed（发布前评审修复）

- 抖音动图 + BGM 合并补 `-stream_loop -1` 与 `-shortest`，输出时长现在与视频片段一致，不再出现"画面早停、音乐继续"的长视频。
- AcFun 只登记 mp4 直链为视频；仅有 m3u8 时不再把播放列表当媒体下载发送（发送侧同样拦截 HLS 并提示原链接）。
- 升级配置迁移：旧版 `translate.tencentApi`（已停用的彩云地址）与 `light.buyerShowApis`/`tiredApis`（已无 DNS 的 vvhan 地址）在读取时自动迁移到新默认值；用户自定义地址不受影响。
- 音乐 Cookie 提交的在线校验失败（超时/5xx）不再阻断保存：按"校验不可用，已保存"处理并提示。
- 视频音轨下载失败时降级为只发视频本体，不再丢弃已下载的视频。
- 文言文目标（`wyw`）在新默认翻译接口不存在，改为直接提示不支持，不再白跑请求后报接口错误。
- 裸 `#医药查询` 直接回用法，不再请求空关键词后回误导性的"未找到"。
- `总结一下…` 这类无 `#`、无链接的闲聊改为放行给其它插件；自动总结优先级调整为 950，排在点歌/翻译/解析等命令之后，避免吞掉同消息里的命令。
- 个性电台不再建立可翻页会话，`#下一页` 不会重复拉同一批电台歌曲。
- `#累了` 图片最多 9 张，并对含空格/CJK 的地址做编码。
- 卡片截图缓存只在同一 HTML 第二次出现时写入，避免一次性列表/预览卡挤掉可复用卡片。

## 2026-10-29

### Fixed

- 翻译：引用消息翻译读错了 Karin 的返回字段（正文在 `MessageResponse.elements`，不是 `message`），导致引用后发 `翻英` 永远回“请附上要翻译的文本”；现在以 `elements` 为主并兼容旧适配器的 `message`。
- 翻译：命令层正则不含 `trans` 且缺 `#?`，`trans英 你好` 与 `#翻英` 都命中不到；命令与解析统一为 `/^#?(?:翻|trans)…/`，并补上文言文目标 `wyw`。`wyw` 不是 DeepL 支持的语言，配置了 DeepLX 时会先白失败一次再落到兜底接口；现在 `wyw` 直接走 tencent 兼容接口（`target` 原样透传，能否译成文言文取决于该接口后端）。
- 解析：聊天里的裸 BV/AcFun 编号补全会误伤同形文本——文件名 `附件BV….zip`、编号 `AC4567号文件` 会生成假链接并回复“解析失败”。裸 ID 识别收紧为 B站 base58 字符集 + 前后非字母数字边界 + 扩展名排除，`ac` 要求 6 位以上数字。
- 轻量命令：`推荐软件 <关键词>` 之前忽略关键词、固定返回 ghxi 最新榜单；现在 `light.softwareApi` 留空时用内置源并按关键词本地过滤（无命中回前 5 条并给出提示），配置了含 `{keyword}` 的接口时走服务端搜索。
- 轻量命令：`医药查询` 写死了 dayi 接口；现在读 `light.medicineApi`，仅对 `server.dayi.org.cn`（证书链损坏）关闭 TLS 校验，其余源保持严格校验。
- 轻量命令：`cat` 声称 10 张，但默认源每次只给 1 张且逐张串行发送；现在按配置源改写 `count`/`limit` 后并发拉取，再分批并发发出（每批 3 张，避免适配器限流），取图失败时只回一条错误而不再先发趣味文案。
- 解析：抖音 SSR 兜底用贪婪量词抽取 `__NEXT_DATA__`/`__UNIVERSAL_DATA_FOR_REHYDRATION__`，页面存在第二个 `<script>` 时必然 `JSON.parse` 失败；改为惰性量词 + 括号配平扫描，并支持 `props.pageProps`、`__DEFAULT_SCOPE__` 内嵌的 `aweme_detail`。
- 解析：SSR 兜底不再绕过 `resolver.douyin.maxVideoDurationSeconds` 与画质配置；抓取带 `Referer`/浏览器 UA 与 3MB 上限，下载复用同一组请求头。
- 点歌：会话过期原先只在用户再次交互时才被发现，列表卡片不会按时撤回、会话 `Map` 随用户数无限增长；新增 60 秒定时清理（`unref`，不阻塞进程退出）。
- 点歌：`#高清语音` 之前把网易云 lossless 的 mp3 直传给 `segment.record`；现在只有 amr 源直传，其余转码为 opus ogg，PCQQ 兼容提示只在真正的 amr 直传成功后发出。
- 点歌：原生音乐卡不再接受形状非法的 kuwo/kugou id（避免发出空卡），非法时自动降级为自定义卡。单曲发送同时简化为一条消息：有原生卡只发原生卡，否则只发自定义卡，不再附带封面图和标题文本链接（失败才降级为纯文本链接）。
- 解析：图片重试不再给带签名的 CDN URL 追加缓存参数（会破坏签名），注释明确它只缓解 URL 侧缓存负命中，不解决上传/风控失败；短签名参数 `sig` 一并识别。解析阶段日志的键名过滤不再误吞 `keyword` 这类普通字段。
- 解析：分享卡 `jumpUrl` 只剥离 QQ 凭据参数（`p_skey`/`skey`/`access_token`/`pass_ticket` 等），不再误删功能性 `key`/`token`；中文正文紧贴链接时按首个汉字截断。
- 解析：域名表收敛为单一 `PLATFORM_DOMAINS` 数据源，命令层预筛正则与平台匹配规则不再各维护一份。
- 配置：`conformToDefaults` 会把 Web 面板提交的数字字符串（如 `"60"`）转成数字，其余类型不匹配仍回退默认值；未知键仍在保存时丢弃。
- 配置：`insecure` 请求与代理同时配置时显式报错（此前代理静默优先、TLS 校验并未放宽），并补齐 `maxBytes` 限制。

### Changed

- `light.medicineApi` 默认指向 dayi 医药源；`light.softwareApi` 默认为空（留空使用内置 ghxi 源 + 本地关键词过滤，填写需含 `{keyword}`）。

### Removed

- 删除无调用方的 `getCatImage`、`MusicSessionStore.clear()`；`transcodePlayableToVoice` 收回为模块内私有。

## 2026-10-28

### Fixed

- Update checks now pick npm vs Git from the plugin's install source before querying: the plugin only calls `checkPkgUpdate` when the host `package.json` declares it as an npm registry dependency, otherwise it goes straight to the Git check. Previously tarball/pnpm installs triggered a `callback: npm 404 Not Found` error log from Karin every 3 minutes.
- The `hira-更新检测` task silently skips polling when neither an npm declaration nor a Git checkout can be resolved, instead of logging a 404 followed by a failed Git probe. Manual `#Hira更新` still reports an actionable error.
- `音乐 <B站链接>` 现在会先还原 `b23.tv` 短链，再按 BV 号解析；识别不到 BV 号或视频信息不完整时返回明确错误，不再发出一条只有“B站视频音频”标题的空结果。
- 解析链接提取会按首个中文标点截断，`https://b23.tv/abc，好看` 这类带后续正文的分享消息不再把正文拼进 URL 导致解析失败。
- QQ 分享卡片的 `jumpUrl` 会剥离 `skey`/`p_skey`/`token` 等凭据参数；解析阶段日志和失败原因也会对这些 query 参数做脱敏。
- 微博接口与页面都取不到内容时返回解析失败（提示检查 Cookie），不再伪装成一条只有标题的成功结果。
- `resolver.yaml` 的“自动解析优先级”无论改成多少都不会生效（命令在导入时读取默认值）。现在读取 `#hi状态` 时会刷新该优先级。
- `runtime.cleanupEnabled`/`cleanupMaxAgeMinutes` 之前没有生效时机，现在由每小时的 `hira-临时文件清理` 任务按保留时长和容量上限执行。
- 插件总开关关闭后，好友消息里的“回复更新提示即更新”钩子仍然会触发更新；现在与其他命令一致地受 `app.enabled` 控制。
- `music.highQuality` 之前只出现在配置页不影响任何请求，现在控制网易云音源档位（`lossless`/`exhigh`）；同时移除从未生效的 `music.textFallback` 和只用于未使用探测函数的 `runtime.ffprobePath`，旧 YAML 里的这些键会在保存时被丢弃。
- 测试改用空配置目录运行（`HIRA_CONFIG_ROOT`），避免读到开发机 `@karinjs` 下的真实配置导致断言随环境漂移。

### Removed

- 移除未被引用的 `src/ai` 占位模块、`replyVoiceOrAudio`、`toRichResolvedPost` 与 `runtime/temp` 中重复的域名表。

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
