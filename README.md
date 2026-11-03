# dsh-usage-dashboard

DeepSeek Harness 的 Token 用量统计插件 —— 在 **设置 → Token 统计** 中提供 zcode 风格的用量面板：

- **5 张指标卡**：累计 Token、单日峰值、最长会话时长、当前/最长连续使用天数
- **Token 活动热力图**：最近 12 个自然月 GitHub 风格（每日 / 累计切换），悬浮显示当日各模型明细
- **每日 Token 趋势**：近 7 日 / 近 30 日，按模型分系列折线，悬浮显示当日各模型用量与合计
- **模型用量环形图**：占比 + 明细列表，悬浮高亮扇区并显示精确 Token 数与占比

## 原理

- **零运行时依赖**，图表全部手写 SVG。
- 服务端注册 `tokenStats` 会话投影（`ctx.sessionProjections.register`），
  折叠 `request/header` / `step/start` / `assistant usage` / `step/end` /
  `compaction/summary` 事件，按 **天 × 模型** 累计 token。Harness 会在会话
  首次被触碰时回放持久化日志，因此历史会话同样被统计。
- 客户端通过 `settings.section` 槽位注入设置页，聚合全部会话的
  `projectionValues.tokenStats` 渲染面板。

## 安装

### npm（推荐）

```bash
dsh plugin --profile web add dsh-usage-dashboard
# 桌面版：设置 → 插件 → Add plugin → npm 包名填 dsh-usage-dashboard
```

### 从源码 / 本地开发

```bash
# web / tui profile：
dsh plugin --profile web add /path/to/dsh-usage-dashboard

# desktop profile 暂无插件页安装入口，需手动：
# 1. 依赖 + bundle 声明（ ~/.dsh/profiles/desktop/package.json ）
#    dependencies 增加 "dsh-usage-dashboard": "file:/path/to/dsh-usage-dashboard"
#    dsh.profile.bundles 增加 "dsh-usage-dashboard"
# 2. 安装
cd ~/.dsh/profiles/desktop && npx pnpm@11.9.0 install
# 3. 重启 DeepSeek Harness 应用
```

### 从 GitHub

```bash
dsh plugin add github:<owner>/dsh-usage-dashboard
```

（git 安装装的是源码，可能需要在 profile 的 pnpm-workspace 里授权构建脚本；
优先推荐 npm 安装。）

## 历史数据回填

投影按需折叠：只有被打开过的会话才有数据。要一次性回填全部历史，运行：

```bash
node tools/backfill.mjs --dry   # 预览
node tools/backfill.mjs         # 写入 projcache（自动跳过活跃会话）
```

回填后重启 Harness，设置面板立即显示全部历史统计。

## 口径说明

- token 总量 = input + cacheRead + cacheWrite + output（与内置 tokenUsage 投影一致，
  已对 19 个真实会话逐一对账验证）。
- 同一 (turn, step) 的多次 usage 上报只计最新一次（流式 chunk 替换语义）。
- 不估算费用，只统计 token。

## 开发

```bash
npm run check   # 语法检查
npm test        # 投影 fold 单元测试（node:test，无外部依赖）
```

## 兼容性

peer 依赖接受 DSH `0.1.0-rc.6` 起的 0.1 线与 0.2 线全部版本（含 rc）。
0.3.0 及以后未经测试。

## License

[MIT](./LICENSE)
