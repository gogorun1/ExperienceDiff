# @experience-diff/viewer — FE-2 Report Viewer

**Viewer 是影院，不是后台。** 它是产品的脸，stakeholder 看 PR 用的。

## 运行

```bash
npm install          # 仓库根执行一次
npm run dev:viewer   # 或 cd apps/viewer && npm run dev
```

skeleton 已经能读 `@experience-diff/contract` 的 mock report、并排播放占位视频、显示字幕/时间轴/severity/changes，且 follow-up 按钮会把 mock 失败分支 flow append 到时间轴（这个按钮同时就是现场兜底 Level 2 的隐藏按钮，`data-testid='followup-fallback-button'`）。

## P0（必须）

- [x] PR title + one-line summary
- [x] before / after 视频并排播放
- [x] narration subtitles（按 `startSec/endSec` 同步）
- [x] timeline + severity 标记（improvement / regression / neutral）
- [x] perceivable changes 列表
- [x] follow-up 入口占位（可 append `FollowUpResponse.newFlow`）

## P1（打磨）

- [ ] 深色全屏影院感（基础已有，继续做动效）
- [ ] timeline marker 点击跳转（基础已有）
- [ ] hover change 显示 evidence 详情
- [ ] 播放 `sideBySideVideo` + `voiceoverAudio` 模式（真实产物出来后替换双 video 同步方案）
- [ ] 语音问题以 transcript 形式显示在 report 里

## 禁止项（PRD 第 12 节）

左侧巨大菜单 / 复杂 dashboard / 表格堆 / D3 图 / AST 面板 / 依赖图 / 代码分析 tab。

## DoD

- 能读 mock JSON；能播 before/after；能显示 summary、subtitle、timeline
- 能区分 improvement / regression / neutral
- 能 append follow-up flow
- **即使 pipeline 全挂，用 mock report 也能播完整故事**
- 看起来像产品，不像 dashboard
