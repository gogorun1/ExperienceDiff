# @experience-diff/pipeline — BE-1 双版本 Pipeline

对 base/head 两个 ref 各起一个 demo-shop 实例，用同一段 Playwright flow 双跑，输出原始录像 + timestamped evidence events。

## 前置

```bash
npm install                      # 仓库根
npx playwright install chromium  # 一次
npm run bootstrap:demo-shop      # 生成 apps/demo-shop 嵌套 repo
```

## 运行

```bash
npm run pipeline -- --base main --head pr-a --flow checkout-happy --viewport desktop
```

流程：`git worktree` 双 checkout → `npm install` + 双端口启动（3001 before / 3002 after）→ 同一 flow 双跑录像 → 输出到 `assets/generated/<head>-<flow>-<viewport>/`：

- `before.webm` / `after.webm` — 原始录像
- `pipeline-output.json` — `PipelineRunOutput`（含全部 evidence events），BE-2 的唯一输入

## Fallback 模式（铁律 1 的落地）

```bash
npm run pipeline -- --head pr-a --flow checkout-happy --fallback
```

用 `assets/fallback/` 里的预录视频（没有就退到 contract 占位视频）+ mock evidence，输出**完全相同结构**的 `pipeline-output.json`。M1（Sat 16:00）双跑不通就永久切这个模式，不恋战。

## 清理

```bash
npm run clean --workspace services/pipeline   # 幂等：清端口 3001/3002 + worktrees
```

## DoD

- [ ] base/head 双 ref、双端口启动、同脚本双跑
- [ ] 输出 raw videos + evidence events（click/navigation/visible/hidden/wait/assertion/text/url）
- [ ] **Sat 16:00 前 PR-A 有 before/after 两段真实原始录像**
- [ ] `--fallback` 可切换到 mock / prerecorded mode，产物结构一致
- [ ] 端口和临时文件幂等清理

## 与其他模块的边界

- 依赖 FE-1 的 demo-shop 分支和 `data-testid` 约定（见 `templates/demo-shop-seed/README.md`）
- 只产出文件，不 import BE-2/FE-2 的代码
- flow 定义在 `src/flows.ts`：同一个 flow 必须能容忍 before/after 结构差异（差异记为 evidence，不是失败）
