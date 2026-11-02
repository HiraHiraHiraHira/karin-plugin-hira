# karin-plugin-hira

Hira 自用的 Karin 插件，定位是补足 KKK 之外的日常功能：点歌、多平台解析、轻量查询、翻译和 AI 网页总结。后续可以继续扩展 AI 画图。

多平台解析的展示体验参考了 KKK 插件和 R 插件：预览卡片尽量保持 KKK 风格的轻量、浅色、克制；完整正文、图文顺序、评论和楼层则参考 R 插件的伪装合并转发，让长内容像自然聊天记录一样展开。

YouTube 不做。B站、抖音、快手、小红书裸链在 `resolver.kkkCompat: true` 时继续交给 KKK；关闭兼容模式后由 Hira 尝试解析。

## 功能

- 点歌：网易云、QQ音乐、酷我、酷狗、哔哩哔哩搜索，支持列表选择、下一页、歌词、语音（`#语音N`）、更高码率的高清语音（`#高清语音N`）和 B站链接转音乐；多选列表优先以图片卡片展示，渲染不可用时自动退回文本。
- 音乐 Cookie：主人/管理员可提交 Cookie，支持网易云和 QQ音乐在线状态校验，其他源显示配置状态；状态检查优先以图片卡片展示。
- 多平台解析：微博、贴吧、小黑盒帖子和小黑盒游戏详情、通用小平台 API 解析；关闭 KKK 兼容模式后支持 B站、抖音、快手、小红书裸链解析。
- 解析展示：富解析优先使用轻量浅色预览卡，正文/图文/评论按 R 插件式伪装合并转发展开；解析结果不再自动追加 `Hira：` 前缀。
- 视频解析：B站优先使用 DASH 流并按配置画质/编码选择，同质量同编码时优先低码率；抖音和 B站都支持下载上限与清晰度配置。
- 轻量命令：随机猫图、买家秀、累了、医药查询、推荐软件。
- 翻译：`翻中/翻英/翻日/...`，优先 DeepLX，可配置备用接口。
- AI 总结：`#总结一下 <链接>`，使用 OpenAI 兼容接口。
- 帮助与配置：`#Hira帮助`、多选点歌列表、`#Hira状态` 和音乐 Cookie 状态优先返回 KKK 风格图片卡片；Karin WebUI 使用自带配置页管理基础、点歌、多平台解析、运行时、轻量功能和 AI 配置。
- 运行时工具：临时文件清理（每小时一次的定时任务，`#清理垃圾` 可手动触发）、下载超时、视频/音频/封面/临时目录容量上限、ffmpeg/ffprobe 路径和语音转码配置。

## 命令

- `#点歌 <关键词>`
- `#网易点歌 <关键词>`
- `#QQ点歌 <关键词>`
- `#酷我点歌 <关键词>`
- `#酷狗点歌 <关键词>`
- `#哔哩点歌 <关键词>`
- `#多选点歌 <关键词>`
- `1`、`#听1`、`#播放1`
- `#下一页`
- `#歌词`、`#歌词 1`
- `#语音`、`#高清语音1`
- `音乐 <B站链接>`
- `#提交音乐ck <网易云|QQ|酷我|酷狗|B站> <cookie>`
- `#点歌ck检查`、`#音乐cookie状态`
- `#cat`、`#买家秀`、`#累了`
- `#医药查询 <关键词>`
- `#推荐软件 <关键词>`
- `翻英 <文本>`、`翻日 <文本>`、`翻中 <文本>`
- `#总结一下 <链接>`
- `#Hira状态`
- `#Hira清理垃圾`、`#清理垃圾`
- `#点歌卡片状态`（主人/管理员）
- `#Hira帮助`

## 点歌卡片发送

点歌结果按 `music.card.channels` 的顺序逐通道尝试，前面的失败自动降级到后面：

1. `platform`：发**平台 ID 卡**（`{type:'163', id}` 这种形态），卡片身份由平台决定，网易云的歌就是网易云样式的卡。签名由协议端完成，插件收不到失败信号，属于哑通道。
2. `ark`：调用第三方签名服务换回一张**签好名的卡片**，用 `json` 段发出。协议端对 `json` 段是原样透传、不再签名，所以这条路失败是**可观测**的，可以重试、可以熔断。卡片身份由签名服务按 `format` 参数决定。
3. `music`：自定义 `music` 段，签名由协议端内置服务完成。协议端签名失败时会**静默丢弃**这个元素，插件无从感知，因此它只适合当兜底。

顺序这么排的原因是「表现优先、可观测兜底」：`platform` 身份最正确但不可观测，`ark` 可观测但身份取决于签名服务，`music` 全平台都能发但同样不可观测。拿不到标准卡数字 ID 的平台（QQ音乐是 MID、B站不支持）会自动跳过 `platform`。

全部通道失败时，会退回一条「标题 - 歌手 + 链接」文字，避免命令完全没有回应。

配置见 `music.yaml` 的 `card` 段：

- `card.platform.types` 决定哪些平台走 ID 卡，留空的平台直接跳过
- `card.ark.key` 为空时自动跳过 `ark` 通道
- `card.ark.apiUrl` 需要返回 `{ code: 200, data: <ark 卡片> }`；换服务只改这一行
- `card.ark.formats` 决定哪些平台走 `ark`，值会作为 `format` 参数传给签名服务
- `card.ark.attachCover` 默认 `false`，因为卡片本身带封面
- `card.breaker` 连续失败到阈值后冷却一段时间，冷却结束自动恢复（只作用于 `ark`）

排查用 `#点歌卡片状态`：能看到通道顺序、`platform` 映射、`ark` 是否配置、熔断状态、各通道成功/失败/跳过计数和最近 10 条发送记录。每次发送也会在日志里打一行 `[Hira-卡片] 通道=... 结果=... 耗时=... 曲目=...`。

设计取舍、平台支持矩阵和验收清单见 [`docs/music-card-best-practice.md`](docs/music-card-best-practice.md)。

## 安装

推荐把仓库克隆到 Karin 的 `plugins/` 目录，这是 Karin 的第一类 Git 插件形态，`#Hira更新` 可直接通过 `git fetch` + `git pull` 工作。

```bash
cd <Karin 项目根目录>
git clone git@github.com:HiraHiraHiraHira/karin-plugin-hira.git plugins/karin-plugin-hira
cd plugins/karin-plugin-hira && pnpm install
```

`lib/` 和 `resources/web/` 随仓库提交，`git pull` 会一并更新，克隆安装无需本地构建。只在改动源码后需要 `pnpm build` 并提交产物。

不要把插件声明成宿主的 `file:` 依赖：pnpm 会把它硬链接进 `node_modules/.pnpm/`，而 Karin 的 `collectNpmPlugins` 也会加载那一份，热更新后可能与源仓库不一致；跨分区时硬链接还会退化成复制。

插件按以下顺序判定更新来源，只在确认是 npm registry 安装时才查询 npm：

1. 宿主 `package.json` 以版本号/版本范围/dist-tag/`npm:` 别名声明该插件 → 走 npm 检查。
2. 否则，插件目录（或 `file:` 指向的源码目录、同级同名目录）是 Git 仓库 → 走 `git fetch` + `git pull`。
3. 两者都不满足 → 不发起任何网络请求。定时任务静默跳过，手动 `#Hira更新` 返回可操作错误。

> 不要在服务器上手改 `lib/`。它是随仓库提交的构建产物，下次 `git pull` 会覆盖；要改就改 `src/`，执行 `pnpm build` 后提交。

从 tarball 安装迁移过来的具体步骤（含验证与回滚）见 [`docs/deploy-migration.md`](docs/deploy-migration.md)。Hermes 等第三方安装器如果把 pnpm tarball 直接塞进 `node_modules/`，属于第 3 种情况：插件不会报错，但也不会有更新提醒。

## 配置

默认配置在 `config/default_config/`：

- `app.yaml`：基础开关、回复前缀和命令名。回复前缀只用于普通命令，多平台解析结果不会附加此前缀。
- `music.yaml`：点歌源、列表会话、语音、语音码率（`highQuality`，开启后 `#语音N` 用 128kbps 双声道转码）、B站音乐 App 凭据、Cookie 和音乐 API。其中 `api.aggregatorUrl` 是聚合音源（默认 `https://music.txqq.pro/`），原生接口失效时兜底搜索与直链；`api.aggregatorEnabled` 可关掉它。
- `resolver.yaml`：多平台解析开关、KKK 兼容、平台开关、发送策略、媒体策略、诊断日志、B站/抖音下载上限、画质、编码、Cookie 和通用解析 API。
- `runtime.yaml`：临时目录（默认 `@karinjs/temp/<插件名>`，协议端可读）、自动清理、ffmpeg/ffprobe、下载超时，以及单个视频、单个音频、预览封面和临时目录容量上限。
- `light.yaml`：轻量命令使用的外部 API。
- `translate.yaml`：翻译接口。
- `ai.yaml`：OpenAI 兼容接口、模型和网页总结开关。

Karin WebUI 会打开 Hira 自带配置页 `/hira/karin-config`。配置页使用和 KKK 最新面板一致的 React + HeroUI + Tailwind 组件栈：顶部 Tabs、卡片分组、浮动重新读取/保存按钮，并复用 Karin Web 登录态。B站和抖音下载上限按分钟填写；配置文件中仍保存为秒。`0` 表示不限制。B站画质默认 `64`（720P），编码默认 `auto`，如果群里客户端对 HEVC/AV1 兼容不好，可以改成 `avc`。

解析配置里可以单独关闭 B站、抖音、快手、微博、贴吧、小黑盒、小红书或通用解析；关闭后对应链接会交还给后续插件或 Karin 默认流程。发送策略可以关闭正文伪装合并转发，或关闭视频发送失败后的原链接提示。媒体策略默认会去重图片、过滤缩略图/模糊图/马赛克图，并尝试内联预览封面以减少防盗链缺图。诊断日志默认记录解析阶段，关闭“成功阶段日志”后仍会保留失败告警。

小黑盒解析需要在 `resolver.cookies.xiaoheihe` 配置 Cookie。B站点歌搜索和播放默认内置 B站 Android 客户端的公开凭据（`music.yaml` 的 `bilibili.appKey`、`bilibili.appSecret`），装上即可用；要换成自己的可以覆盖这两项，或使用 `HIRA_BILIBILI_APP_KEY`、`HIRA_BILIBILI_APP_SECRET` 环境变量。AI 总结默认关闭，需要在配置面板或 `ai.yaml` 启用并填写 API Key。代理和各平台 Cookie 都是可选项，留空不会阻止保存。

配置保存会先做完整结构、类型、枚举和 URL 校验；Cookie、代理账号密码、B站音乐 App 凭据、DeepLX 地址和 AI Key 在 WebUI/API 响应中会显示为 `********`，提交原掩码会保留旧值，提交空字符串才会清空。配置文件使用同目录临时文件、刷盘和替换写入，避免进程中断时留下半份 YAML。

运行时默认限制：单个视频 200 MiB、单个音频 100 MiB、预览封面 10 MiB、临时目录 2 GiB。下载超过限制会中止并删除 `.part-*` 半成品；临时目录由每小时一次的定时任务按 `cleanupMaxAgeMinutes` 清理，容量超限时按最旧文件优先清理，也可以用 `#清理垃圾` 手动触发。一个作品只保留并发送主视频，避免多视频作品造成重复下载和刷屏。

resolver 代理只用于平台解析 API、短链跳转、预览封面和媒体下载，不会自动套用到音乐、轻量 API 或 AI 接口。默认网易云入口和播放回退地址已改为 HTTPS；通用解析列表中仍保留没有可信 HTTPS 替代的旧端点，用户可以在自定义配置中覆盖。解析失败提示会显示失败服务的主机名和下一步建议，但不会回显 Cookie、代理密码或完整授权信息。

AI 网页总结仅开放给 owner/admin，输入地址必须是 HTTP(S) 公网网页；会拒绝回环、内网、链路本地、云元数据和带账号密码的 URL，限制重定向和网页大小，并按请求人限流。

`#Hira帮助`、多选点歌列表、`#Hira状态` 和音乐 Cookie 状态的图片卡片依赖 Karin 渲染器。若运行实例未安装 `@karinjs/plugin-puppeteer`，插件会记录渲染失败日志并退回文本。

## 说明

纯数字消息如 `1` 只会在当前存在点歌列表会话时被 Hira 消费，避免影响其它插件。`#听1`、`#播放1` 仍属于 Hira 点歌命令。

`音乐 <B站链接>` 只用于把 B站视频提取为音乐播放，和普通 B站裸链解析分开处理。

`resolver.kkkCompat: true` 时，Hira 不接管 B站、抖音、快手、小红书裸链，避免和 KKK 重复回复。

`resolver.kkkCompat: false` 时，Hira 会尝试解析 B站、抖音、快手、小红书裸链。抖音、小红书、B站部分接口可能需要在 `resolver.cookies` 中配置对应 Cookie；快手和部分抖音链接会使用 `resolver.generalApis` 兜底。

抖音视频链路当前只做诊断和降级：下载失败会记录 `media/fallback` 阶段日志，并保留封面、正文和原链接提示，不把失败伪装成成功。

命令之间的响应顺序由插件加载顺序决定，不受配置控制：Karin 1.18.0 里 `karin.command` / `karin.accept` 的 `priority` / `rank` 不参与实际排序，所以 Hira 不再提供 `resolver.priority` 这类排序配置项。如果和别的插件抢同一条消息（例如同一个群里有两个点歌机器人），用 Karin 的群/私聊配置里的 `enable` / `disable` 精确控制谁响应。

语音点歌会在临时目录里下载源音频并转码，转码结束后源文件立即删除；`runtime.maxAudioFileSizeBytes` 控制单个音频的下载上限，`music.highQuality` 控制是否用 128kbps 双声道转码。

临时目录默认落在 Karin 的共享 `@karinjs/temp/<插件名>` 下（`runtime.tempRoot` 可覆盖）。**视频和语音这类要交给协议端读取的文件必须放在协议端也能看到的目录里**：NapCat 处理裸路径时先判断文件是否存在，取不到就判成未知类型直接拒收（`retcode 1200 文件处理失败: 识别URL失败`），消息只剩降级内容。本机部署只把 `@karinjs/temp` 挂进了 napcat 容器，所以默认值放在这里；如果你把 `tempRoot` 改到别处，记得给协议端容器挂上同一路径。

## 测试

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify:ci
```

`pnpm build` 会先构建 Web 配置页到 `resources/web/`，再构建 Karin 插件运行时代码。`pnpm verify:ci` 会串行执行类型检查、测试、构建和 `pnpm pack --dry-run`；发布前的人工检查见 [`docs/release-checklist.md`](docs/release-checklist.md)。
