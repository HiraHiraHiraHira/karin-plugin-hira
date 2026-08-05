# Hira 发布检查清单

适用于本地发布前、Karin 实例升级前和提交 PR 前的人工检查。CI 会自动执行带有 `pnpm install --frozen-lockfile` 的类型检查、测试、构建和打包冒烟；以下内容仍需要维护者确认。

## 自动验证

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm pack --dry-run`，确认包内包含 `config/`、`lib/`、`resources/`、`README.md`、`CHANGELOG.md` 和 `docs/`。
- [ ] 检查 `git diff --stat`，确认 Web 构建产物和 `lib/` 生成文件已随源码同步，且没有混入无关改动。

## 配置与安全

- [ ] 升级前备份 Karin 数据目录下的 Hira 配置。
- [ ] 通过 WebUI 重新读取配置，确认 Cookie、代理、B站音乐 App 凭据和 AI Key 显示为掩码，不要把掩码替换成真实值之外的内容；需要清空时提交空字符串。
- [ ] 发布前扫描源码、构建产物和 `pnpm pack --dry-run` 清单，确认没有硬编码 App Secret、Token、Cookie 或私钥；B站音乐凭据只从 Karin 配置或 `HIRA_BILIBILI_APP_KEY` / `HIRA_BILIBILI_APP_SECRET` 环境变量读取。
- [ ] 确认 `runtime.maxVideoFileSizeBytes`、`runtime.maxPreviewCoverBytes` 和 `runtime.maxTempBytes` 符合机器磁盘和群聊发送策略。默认值分别为 200 MiB、10 MiB 和 2 GiB。
- [ ] AI 总结保持 owner/admin 权限；确认测试 URL 不指向内网、回环、云元数据或带账号密码的地址。
- [ ] resolver 代理只用于解析请求、预览封面和媒体下载；音乐、轻量 API 和 AI 接口不会自动套用 resolver 代理。
- [ ] 若使用代理账号密码，使用 `http(s)://user:password@host:port`，并确认配置日志和接口响应不会回显完整代理地址。

## 外部服务与回滚

- [ ] 检查网易云、通用解析、翻译和轻量 API 的当前可用性；确定可用的网易云默认入口使用 HTTPS，但自定义 API 仍以用户配置为准。
- [ ] 手动验证至少一个 B站 DASH、一个普通视频、一个图文/评论解析和一个封面防盗链场景。
- [ ] 验证下载超限会删除 `.part-*` 半成品，临时目录超限会按最旧文件优先清理。
- [ ] 确认只发送主视频；多视频作品不会批量下载或批量发送。
- [ ] 保留上一版本包或 Git 提交，出现外部 API 变化时先回滚配置/版本，不要临时关闭安全校验。
