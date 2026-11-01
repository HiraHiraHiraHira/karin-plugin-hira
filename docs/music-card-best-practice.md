# 点歌卡片发送最佳实践（Karin + NapCat）

> 目标：群里点歌尽量发出**能听的音乐卡片**，卡片身份跟平台一致（网易云的歌就是网易云样式），
> 单一第三方服务挂掉时不至于整条消息废掉，并且「卡片没出来」这件事**可查、可恢复**。

## 1. 三种通道对照

| 通道 | 消息形态 | 卡片身份 | 签名来源 | 失败可观测 | 依赖第三方 |
|---|---|---|---|---|---|
| `platform` | `{type:'music', data:{type:'163', id}}` | 平台原生（网易云/酷狗/酷我） | 协议端内置签名服务 | **否**（协议端静默丢元素） | 是（协议端配置） |
| `ark` | `{type:'json', data:{data:<ark>}}` | 由签名服务的 `format` 决定 | 第三方签名 API + 自己的 key | **是**（HTTP / 返回体可校验） | 是（插件自己的 key） |
| `music` | 自定义 `music` 段（url/audio/title/image/content） | 协议端签名服务决定（QQ音乐身份） | 协议端内置签名服务 | **否** | 是（协议端配置） |

关键事实（已核对源码）：

- NapCat 的 `music` 段会 `POST` 给签名服务；失败时 `return void 0` 丢弃该元素，**其余段照发** → 群里只剩封面图和文字
- NapCat 对 id 形态（`{type:'163', id}`）会签出**对应平台身份**的卡片；对自定义形态则签成 QQ音乐身份
- NapCat 的 `json` 段直接塞进 `arkElement.bytesData`，**不做任何签名** → 谁签好都行
- Karin 的 `segment.music(type, id)` / `segment.json(x)` 正好转成上面两种 OneBot 形态

## 2. 通道顺序：platform → ark → music

排序原则是「**表现优先、可观测兜底**」：

- `platform` 身份最正确（网易云的歌出网易云的卡），但失败不可观测 → 第一跳，因为它决定"表现"
- `ark` 可观测、可重试、可熔断，但身份取决于签名服务是否支持 `format` → 第二跳，接住 platform 覆盖不到的形态
- `music` 全平台都能发，但同样不可观测 → 只当兜底
- 拿不到标准卡数字 ID 的平台（QQ音乐搜索返回 MID、B站不在协议端支持列表）**自动跳过 `platform`**，落到 `ark`/`music`，与同类插件的做法一致

三条通道必须串行短路：都发一遍会出现"两条卡片"。

## 3. 配置设计（`music.yaml` 的 `card` 段）

```yaml
card:
  channels: [platform, ark, music]
  textFallback: true

  platform:
    enabled: true
    # 平台 -> OneBot 音乐卡片类型（qq/163/kugou/kuwo/migu）；留空 = 该平台跳过
    types:
      qq: ""
      netease: "163"
      kuwo: ""
      kugou: ""
      bilibili: ""

  ark:
    apiUrl: "https://apii.xianyuw.cn/api/v1/qq-musicArk"
    key: ""                 # 空 = 不启用 ark 通道
    timeoutMs: 5000
    retries: 1
    attachCover: false      # ark 卡片自带封面，默认不再单独发一张图
    formats:                # 平台 -> 签名站 format 参数，留空则跳过 ark
      qq: qq
      netease: netease
      kuwo: ""
      kugou: kugou
      bilibili: bilibili

  music:
    enabled: true

  breaker:
    failThreshold: 3        # 连续失败几次后熔断（只作用于 ark）
    cooldownSeconds: 600
```

默认值取最保守：`ark.key` 为空即跳过 ark；`platform.types` 只映射实测过的网易云。

## 4. 发送流程

```ts
async function sendMusicCard(e, playable) {
  for (const ch of Config.music.card.channels) {
    if (!isAvailable(ch, playable)) continue   // 开关 / 前置条件 / 熔断
    try {
      await sendBy(ch, e, playable)            // 抛异常 = 该通道失败
      return logCardOk(ch, playable)
    } catch (err) {
      recordFailure(ch, err)                   // 只有 ark 参与熔断
    }
  }
  await replyText(e, `${title} - ${artists}\n${pageUrl}`)
}
```

`isAvailable` 的前置条件：

- `platform`：开关开、平台有映射、歌曲有 ID
- `ark`：`key` 非空、平台在 `formats` 里、`audioUrl` 与 `coverUrl` 都有、未熔断
- `music`：`enabled` 为真

## 5. 成功判定

- `platform` / `music`：只要求 `e.reply()` 不抛异常。**协议端静默失败无法感知**，这两条是哑通道
- `ark`：HTTP 200 且 `code === 200`，`data` 里 `{app, meta, prompt, view}` 齐全，再要求 `e.reply()` 不抛异常

**发送成功 ≠ 客户端一定渲染**。风控、客户端版本、token 失效都可能在服务端收下之后才失败，这一段无法在插件侧感知，只能靠 `#点歌卡片状态` 里的成功率判断"最近是不是明显变差了"。

## 6. 熔断与可观测

- 只有 `ark` 参与熔断（连续失败到 `failThreshold` 后跳过 `cooldownSeconds`，到点自动恢复，不需要重启）
- 成功一次清零
- 每次发送打一条结构化日志：
  `[Hira-卡片] 通道=platform 结果=ok 耗时=6ms 曲目=朋友的酒`
  `[Hira-卡片] 通道=ark 结果=fail cause=timeout 曲目=...`
- `#点歌卡片状态`（主人/管理员）：通道顺序、`platform` 映射、`ark` 是否配置、熔断状态、各通道 ok/fail/skip 计数、最近 10 条记录
- 日志与状态命令里**不打印完整 key**

## 7. 安全与隐私

- `key` 只写在运行时配置（`config/`，已被 `.gitignore` 忽略），仓库默认值里永远留空
- 交给第三方签名站的数据：歌名、歌手、封面 URL、音频直链、跳转 URL。介意这一点就走 `platform`（不经过第三方 API，但仍依赖协议端的签名服务）
- 不要改 NapCat 的 `musicSignUrl`：那是协议端全局配置，会影响 kkk / ling 等所有插件的音乐卡片；插件自己的 key 互不干扰

## 8. 可选：OIDB 通道（实验性，暂不实现）

NapCat 有 `send_packet`（`{cmd, data: 十六进制, rsp}`），所以原生协议那套发法在 Karin 下也能复刻：

```
cmd  = "OidbSvc.0xb77_9"
body = { 1: appid, 2: 1, 3: style(4=带音频 / 0=跳转卡),
         5: { 1: 1, 2: "0.0.0", 3: appname, 4: appsign },
         6: "", 10: sendType, 11: recvUin,
         12: { 10: title, 11: singer, 12: prompt, 13: jumpUrl, 14: preview, 16: musicUrl },
         19: guildId }
```

- 编码：字段少、结构固定，手写一个 varint + length-delimited 的 protobuf 编码器（约 30 行）即可
- 凭据按平台写死（QQ音乐 `100497308` / `cbd27cd7c861227d013a25b2d10f0799` 等）
- 优点：不依赖任何第三方签名服务
- 缺点：贴着协议边走，QQ 一改就废
- 结论：默认关，代码里留好 `channels` 挂点，等真需要再补

## 9. 平台支持矩阵

| 平台 | `platform` | `ark` | `music` |
|---|---|---|---|
| 网易云 | ✅ `163`（实测出网易云身份卡） | 支持（VIP/版权受限歌可能拿不到信息） | 支持 |
| QQ音乐 | ❌ 搜索返回 MID，不是数字 ID | 支持（身份=QQ音乐） | 支持（身份=QQ音乐） |
| 酷狗 | 未验证（`kugou` 的 id 语义待确认） | 支持 | 支持 |
| 酷我 | 未验证 | 跳过（`formats.kuwo` 留空） | 支持 |
| B站 | ❌ 协议端不支持 | 支持（音频直链可能不稳定） | 支持 |

拿不到音频直链或封面时直接跳过 `ark`。

## 10. 验收清单

- [x] 网易云点歌：走 `platform`，消息里是 `{type:'music', data:{type:'163', id}}`
- [x] QQ音乐点歌：跳过 `platform`，走 `ark`（有 key 时）
- [x] `key` 为空：跳过 `ark`，落到 `music`
- [x] 签名服务不通：重试后降级，日志有明确 cause
- [x] 连续失败到阈值：熔断，冷却结束自动恢复
- [x] 缺音频直链/封面：跳过 `ark`
- [x] 全通道失败：仍能看到「标题 - 歌手 + 链接」文字
- [x] `#点歌卡片状态` 能看到三个通道的开关、熔断、计数、最近记录
- [x] 非主人/非管理员被拒
- [ ] 真机确认网易云卡片的身份与播放（需要群内实测）

## 11. 上线顺序

1. 配置段 + `platform` / `ark` 通道
2. 成功判定 + 结构化日志
3. 熔断
4. `#点歌卡片状态` 命令
5. README / 帮助节点 / `config/default_config/music.yaml` 同步
6. OIDB 通道（可选，最后做）

每次改动：`./node_modules/.bin/tsdown` 构建 `lib/` → 提交 → `docker restart karin` → 按 §10 验收。
