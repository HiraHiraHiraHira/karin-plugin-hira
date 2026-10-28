# karin-plugin-hira

Hira 自用的 Karin 插件，定位是补足 KKK 之外的日常功能：点歌、多平台解析、轻量查询、翻译和 AI 网页总结。后续可以继续扩展 AI 画图。

多平台解析的展示体验参考了 KKK 插件和 R 插件：预览卡片尽量保持 KKK 风格的轻量、浅色、克制；完整正文、图文顺序、评论和楼层则参考 R 插件的伪装合并转发，让长内容像自然聊天记录一样展开。

YouTube 不做。B站、抖音、快手、小红书裸链在 `resolver.kkkCompat: true` 时继续交给 KKK；关闭兼容模式后由 Hira 尝试解析。

## 功能

- 点歌：网易云、QQ音乐、酷我、酷狗、哔哩哔哩搜索，支持列表选择、下一页、歌词、语音/高清语音和 B站链接转音乐；多选列表优先以图片卡片展示，渲染不可用时自动退回文本。
- 音乐 Cookie：主人/管理员可提交 Cookie，支持网易云和 QQ音乐在线状态校验，其他源显示配置状态；状态检查优先以图片卡片展示。
- 多平台解析：微博、贴吧、小黑盒帖子和小黑盒游戏详情、通用小平台 API 解析；关闭 KKK 兼容模式后支持 B站、抖音、快手、小红书裸链解析。
- 解析展示：富解析优先使用轻量浅色预览卡，正文/图文/评论按 R 插件式伪装合并转发展开；解析结果不再自动追加 `Hira：` 前缀。
- 视频解析：B站优先使用 DASH 流并按配置画质/编码选择，同质量同编码时优先低码率；抖音和 B站都支持下载上限与清晰度配置。
- 轻量命令：随机猫图、买家秀、累了、医药查询、推荐软件。
- 翻译：`翻中/翻英/翻日/...`，优先 DeepLX，可配置备用接口。
- AI 总结：`#总结一下 <链接>`，使用 OpenAI 兼容接口。
- 帮助与配置：`#Hira帮助`、多选点歌列表、`#Hira状态` 和音乐 Cookie 状态优先返回 KKK 风格图片卡片；Karin WebUI 使用自带配置页管理基础、点歌、多平台解析、运行时、轻量功能和 AI 配置。
- 运行时工具：临时文件清理、下载超时、视频/封面/临时目录容量上限、ffmpeg/ffprobe 路径和语音转码配置。

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
- `#Hira帮助`

## 安装

推荐用 Git 克隆安装，并把 Karin 项目里的依赖声明为 `file:` 指向该克隆。这样 `#Hira更新` 才能通过 `git pull` 真正拉取更新，同时宿主不依赖 npm registry。

```bash
# 1. 在 Karin 项目同级目录克隆插件仓库
git clone git@github.com:HiraHiraHiraHira/karin-plugin-hira.git ../karin-plugin-hira

# 2. 在 Karin 项目里声明为本地依赖（相对路径按实际位置调整）
pnpm add "karin-plugin-hira@file:../karin-plugin-hira"

# 3. 安装运行时依赖
cd ../karin-plugin-hira && pnpm install
```

`lib/` 和 `resources/web/` 随仓库提交，`git pull` 会一并更新，克隆安装无需本地构建。只在改动源码后需要 `pnpm build` 并提交产物。

插件按以下顺序判定更新来源，只在确认是 npm registry 安装时才查询 npm：

1. 宿主 `package.json` 以版本号/版本范围/dist-tag/`npm:` 别名声明该插件 → 走 npm 检查。
2. 否则，插件目录（或 `file:` 指向的源码目录、同级同名目录）是 Git 仓库 → 走 `git fetch` + `git pull`。
3. 两者都不满足 → 不发起任何网络请求。定时任务静默跳过，手动 `#Hira更新` 返回可操作错误。

> 不要在服务器上手改 `lib/`。它是随仓库提交的构建产物，下次 `git pull` 会覆盖；要改就改 `src/`，执行 `pnpm build` 后提交。`file:` 部署更新成功后，插件会自动执行 `pnpm install --force` 刷新依赖并重启 Karin。

Hermes 等第三方安装器如果用 pnpm tarball 直接塞进 `node_modules/`，属于第 3 种情况：插件不会报错，但也不会有更新提醒。需要自动更新就改成上面的克隆安装。

## 配置

默认配置在 `config/default_config/`：

- `app.yaml`：基础开关、回复前缀和命令名。回复前缀只用于普通命令，多平台解析结果不会附加此前缀。
- `music.yaml`：点歌源、列表会话、语音、高品质、B站音乐 App 凭据、Cookie 和音乐 API。
- `resolver.yaml`：多平台解析开关、KKK 兼容、平台开关、发送策略、媒体策略、诊断日志、B站/抖音下载上限、画质、编码、Cookie 和通用解析 API。
- `runtime.yaml`：临时目录、自动清理、ffmpeg/ffprobe、下载超时，以及单个媒体、预览封面和临时目录容量上限。
- `light.yaml`：轻量命令使用的外部 API。
- `translate.yaml`：翻译接口。
- `ai.yaml`：OpenAI 兼容接口、模型和网页总结开关。

Karin WebUI 会打开 Hira 自带配置页 `/hira/karin-config`。配置页使用和 KKK 最新面板一致的 React + HeroUI + Tailwind 组件栈：顶部 Tabs、卡片分组、浮动重新读取/保存按钮，并复用 Karin Web 登录态。B站和抖音下载上限按分钟填写；配置文件中仍保存为秒。`0` 表示不限制。B站画质默认 `64`（720P），编码默认 `auto`，如果群里客户端对 HEVC/AV1 兼容不好，可以改成 `avc`。

解析配置里可以单独关闭 B站、抖音、快手、微博、贴吧、小黑盒、小红书或通用解析；关闭后对应链接会交还给后续插件或 Karin 默认流程。发送策略可以关闭正文伪装合并转发，或关闭视频发送失败后的原链接提示。媒体策略默认会去重图片、过滤缩略图/模糊图/马赛克图，并尝试内联预览封面以减少防盗链缺图。诊断日志默认记录解析阶段，关闭“成功阶段日志”后仍会保留失败告警。

小黑盒解析需要在 `resolver.cookies.xiaoheihe` 配置 Cookie。B站点歌搜索和播放需要在 `music.yaml` 的 `bilibili.appKey`、`bilibili.appSecret` 中配置凭据，也可以使用 `HIRA_BILIBILI_APP_KEY`、`HIRA_BILIBILI_APP_SECRET` 环境变量；默认留空时不会影响其他音乐源和普通 B站链接解析。AI 总结默认关闭，需要在配置面板或 `ai.yaml` 启用并填写 API Key。代理和各平台 Cookie 都是可选项，留空不会阻止保存。

配置保存会先做完整结构、类型、枚举和 URL 校验；Cookie、代理账号密码、B站音乐 App 凭据、DeepLX 地址和 AI Key 在 WebUI/API 响应中会显示为 `********`，提交原掩码会保留旧值，提交空字符串才会清空。配置文件使用同目录临时文件、刷盘和替换写入，避免进程中断时留下半份 YAML。

运行时默认限制：单个视频/音频 200 MiB、预览封面 10 MiB、临时目录 2 GiB。下载超过限制会中止并删除 `.part-*` 半成品；临时目录超限时按最旧文件优先清理。一个作品只保留并发送主视频，避免多视频作品造成重复下载和刷屏。

resolver 代理只用于平台解析 API、短链跳转、预览封面和媒体下载，不会自动套用到音乐、轻量 API 或 AI 接口。默认网易云入口和播放回退地址已改为 HTTPS；通用解析列表中仍保留没有可信 HTTPS 替代的旧端点，用户可以在自定义配置中覆盖。解析失败提示会显示失败服务的主机名和下一步建议，但不会回显 Cookie、代理密码或完整授权信息。

AI 网页总结仅开放给 owner/admin，输入地址必须是 HTTP(S) 公网网页；会拒绝回环、内网、链路本地、云元数据和带账号密码的 URL，限制重定向和网页大小，并按请求人限流。

`#Hira帮助`、多选点歌列表、`#Hira状态` 和音乐 Cookie 状态的图片卡片依赖 Karin 渲染器。若运行实例未安装 `@karinjs/plugin-puppeteer`，插件会记录渲染失败日志并退回文本。

## 说明

纯数字消息如 `1` 只会在当前存在点歌列表会话时被 Hira 消费，避免影响其它插件。`#听1`、`#播放1` 仍属于 Hira 点歌命令。

`音乐 <B站链接>` 只用于把 B站视频提取为音乐播放，和普通 B站裸链解析分开处理。

`resolver.kkkCompat: true` 时，Hira 不接管 B站、抖音、快手、小红书裸链，避免和 KKK 重复回复。

`resolver.kkkCompat: false` 时，Hira 会尝试解析 B站、抖音、快手、小红书裸链。抖音、小红书、B站部分接口可能需要在 `resolver.cookies` 中配置对应 Cookie；快手和部分抖音链接会使用 `resolver.generalApis` 兜底。

抖音视频链路当前只做诊断和降级：下载失败会记录 `media/fallback` 阶段日志，并保留封面、正文和原链接提示，不把失败伪装成成功。

## 测试

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify:ci
```

`pnpm build` 会先构建 Web 配置页到 `resources/web/`，再构建 Karin 插件运行时代码。`pnpm verify:ci` 会串行执行类型检查、测试、构建和 `pnpm pack --dry-run`；发布前的人工检查见 [`docs/release-checklist.md`](docs/release-checklist.md)。
