# karin-plugin-hira 部署迁移指南（给服务器 Agent）

目标：把现有的 pnpm tarball 安装改成 **Git 克隆到 `plugins/` 目录** 的部署形态，消除每 3 分钟一条 `npm 404 Not Found` 的 `[ERRO]` 日志，并让 `#Hira更新` 真正可用。

**为什么不用 `file:` 依赖**：pnpm 会把 `file:` 依赖硬链接进 `node_modules/.pnpm/...`。Karin 的插件发现逻辑（`collectNpmPlugins`）会同时加载 `node_modules` 里那份，热更新后容易和源仓库不一致；且硬链接在跨分区时退化为复制，行为不可预测。`plugins/` 下的 Git 仓库是 Karin 的第一类插件类型（`collectGitPlugins`），路径解析最直接，是本次采用的形态。

---

## 0. 前置检查

```bash
# Karin 项目根目录，下文记作 $KARIN
# Node >= 18，Karin >= 1.14
node -v && pnpm -v

# 确认当前是 tarball 安装（应能查到该目录且无 .git）
ls -d "$KARIN/node_modules/karin-plugin-hira" 2>/dev/null && \
  test ! -d "$KARIN/node_modules/karin-plugin-hira/.git" && echo "CONFIRMED: tarball install"

# 目标提交（修复版本）
# 03873708f86c844b4006ec0decfecbfc62edd348
```

**停止 Karin 前先备份**：

```bash
cp -a "$KARIN/config" "$KARIN/config.bak.$(date +%Y%m%d%H%M%S)"
```

插件配置在 Karin 数据目录（通常是 `$KARIN/config/` 下的 hira 相关 YAML），不在插件目录内，迁移不会丢失。

---

## 1. 移除 tarball 安装

```bash
cd "$KARIN"
pnpm remove karin-plugin-hira
test -e node_modules/karin-plugin-hira && echo "STILL PRESENT - 手动删除" || echo "removed"
```

若 `pnpm remove` 后目录仍在，直接 `rm -rf node_modules/karin-plugin-hira`。

---

## 2. 克隆到 plugins/

```bash
cd "$KARIN"
mkdir -p plugins
test -e plugins/karin-plugin-hira && echo "ABORT: 目标已存在，先确认并移走" && exit 1

git clone git@github.com:HiraHiraHiraHira/karin-plugin-hira.git plugins/karin-plugin-hira
cd plugins/karin-plugin-hira

# 校验提交
git rev-parse HEAD   # 期望 03873708f86c844b4006ec0decfecbfc62edd348
```

如果不是期望提交，先 `git pull` 再校验。

> 用 HTTPS 克隆（`https://github.com/HiraHiraHiraHira/karin-plugin-hira.git`）时，确认目标机器没有 `url.git@github.com:.insteadOf` 之类的全局改写，否则 `#Hira更新` 走的 SSH fetch 会失败。

---

## 3. 安装依赖

```bash
cd "$KARIN/plugins/karin-plugin-hira"
pnpm install
```

`lib/` 和 `resources/web/` 随仓库提交，**这一步不需要 `pnpm build`**。确认产物存在：

```bash
test -f lib/update.js && test -f lib/apps/installSource.js && echo "artifacts OK"
```

---

## 4. 启动并验证

重启 Karin（用你现有的进程管理方式）。

### 4.1 插件被正确识别为 git 类型

日志中该插件应显示为 `git:karin-plugin-hira`，不是 `npm:karin-plugin-hira`。排查用：

```bash
cd "$KARIN" && node -e "
const p=require('./plugins/karin-plugin-hira/package.json');
console.log('name:',p.name,'| karin.apps:',JSON.stringify(p.karin.apps));
" && test -d plugins/karin-plugin-hira/.git && echo "git plugin: YES"
```

### 4.2 404 日志消失

```bash
# 观察 >= 7 分钟（3 分钟周期至少覆盖两次）
tail -f "$KARIN"/logs/*.log | grep -i "404 Not Found\|checkPkgUpdate"
```

**期望：无输出。** 若仍出现，说明插件仍从 `node_modules` 加载 —— 检查 `node_modules/karin-plugin-hira` 是否被其它依赖重新拉回（`pnpm why karin-plugin-hira`）。

### 4.3 手动更新命令

在 QQ 里以主人身份发送：

```
#Hira更新
```

期望返回「当前已是最新版本」卡片（显示当前提交哈希），**不是**「无法检查更新」或「获取远程版本失败」。

### 4.4 更新链路（可选，建议在预发环境做）

在插件目录手工验证 fetch 权限，不触发真实更新：

```bash
cd "$KARIN/plugins/karin-plugin-hira"
git fetch origin && git status -uno
```

`git status` 应显示 `up to date with 'origin/main'`。若报权限错误，`#Hira更新` 也会同样失败 —— 补好 SSH key / deploy key。

---

## 5. 回滚

```bash
cd "$KARIN"
rm -rf plugins/karin-plugin-hira
pnpm add karin-plugin-hira@<旧版本>
# 恢复配置
cp -a config.bak.<时间戳>/. config/
# 重启
```

回到旧版后 `npm 404` 日志会重新出现，属预期。

---

## 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| 日志仍每 3 分钟报 404 | 仍有 `node_modules/karin-plugin-hira` | `pnpm why karin-plugin-hira`，移除来源依赖 |
| `#Hira更新` 返回「无法检查更新」 | `resolveUpdateCheckSource()` 判定为 `none`：目录无 `.git` 且宿主未声明 npm 依赖 | 确认 `plugins/karin-plugin-hira/.git` 存在 |
| `#Hira更新` 返回「获取远程版本失败」 | fetch/pull 失败（权限、网络、分支不一致） | 在插件目录手工执行 `git fetch origin` 看错误 |
| `git pull` 提示本地有改动 | `lib/` 被手改过 | `git checkout -- .` 后重试；**不要手改 `lib/`** |
| 更新后行为未变 | Karin 未重启，或加载了 `node_modules` 副本 | 重启；排查副本 |

---

## 约束（不要违反）

- **不要手改 `lib/`**。它是入库的构建产物，`git pull` 会覆盖。要改就改 `src/`，`pnpm build` 后提交。
- **不要给这个目录做 shallow clone**（`--depth`）。更新检查会执行 `getCommit({ branch: 'origin' })` 取落后提交摘要，浅克隆历史不足时会抛错并让 `#Hira更新` 报「获取远程版本失败」。
- **不要在 `plugins/karin-plugin-hira` 里 `git checkout` 到游离 HEAD**。`checkGitPluginUpdate` 依赖 `git status -uno` 的 *branch is behind* 输出。
- 迁移完成后，本插件所有更新都只需：`cd plugins/karin-plugin-hira && git pull` + 重启 Karin。
