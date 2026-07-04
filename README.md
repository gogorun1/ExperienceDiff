# Experience Diff

> Experience Diff turns every pull request into a narrated, evidence-backed, queryable product demo.

对一个 PR 的 base/head 两个版本自动跑同一段用户流程，产出 30 秒并排体验对比视频 + AI 语音解说，观众可以语音追问（"Et si le paiement échoue ?"），agent 现场跑对应分支并把新片段接到 report 时间轴。**代码有 diff，现在体验也有 diff。**

## 快速开始

```bash
npm install
npx playwright install chromium

# 各自的入口
npm run bootstrap:demo-shop   # FE-1：生成 apps/demo-shop 嵌套 repo（main + pr-a/b/c 分支）
npm run dev:viewer            # FE-2：viewer，开箱就能播 mock report
npm run pipeline -- --base main --head pr-a --flow checkout-happy   # BE-1
npm run narrate -- --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json  # BE-2
npm run voice                 # Audio：follow-up 服务（4100 端口）
```

## 分工表（5 人）

| 角色 | 目录 | 产出 | 详细 DoD |
| --- | --- | --- | --- |
| FE-1 Demo 语料 | `apps/demo-shop/`（种子在 `templates/demo-shop-seed/`） | 假电商 app + `main`/`pr-a`/`pr-b`/`pr-c` 分支 | `templates/demo-shop-seed/README.md` |
| FE-2 Viewer | `apps/viewer/` | 影院感 report viewer（并排视频/字幕/timeline/severity/追问入口） | `apps/viewer/README.md` |
| BE-1 Pipeline | `services/pipeline/` + `packages/contract/`（合约 owner） | 双 ref 双端口 Playwright 双跑 → raw videos + evidence JSON | `services/pipeline/README.md` |
| BE-2 Narration / Video | `services/narrator/` | evidence → changes → narration → TTS → ffmpeg 并排 → `experience-diff.json` | `services/narrator/README.md` |
| Audio 追问 | `services/voice/` | STT → 3 类 intent → flow 路由 → `FollowUpResponse` | `services/voice/README.md` |

## 数据流：只通过文件产物交接

```
contract（冻结的类型 + mock） ← 所有人依赖
demo-shop 分支 ──→ pipeline ──→ assets/generated/<run>/pipeline-output.json + raw videos
                                    │
                                    ▼
                              narrator ──→ assets/generated/<pr>-report/experience-diff.json + side-by-side.mp4
                                    │
                                    ▼
voice ──FollowUpResponse──→   viewer（消费 report JSON，append 追问 flow）
```

**接口合约在 `packages/contract`，已冻结（M0）。** 改动需全员知会。narration 每句必须有非空 `evidenceIds`——没有 evidence 就不能讲。

## Git 规范

- `main` 受保护，小步 PR 合入
- 分支前缀：`fe1/*`、`fe2/*`、`be1/*`、`be2/*`、`audio/*`
- `apps/demo-shop/` 是嵌套独立 repo（主仓 gitignore），FE-1 在里面用真实分支做 PR-A/B/C
- `assets/fallback/` 里的兜底产物必须提交（铁律 2），`assets/generated/` gitignore

## 里程碑

| 里程碑 | 时间 | 验收 |
| --- | --- | --- |
| M0 | Sat 12:30 | 合约冻结 + mock JSON + 占位视频提交；viewer 可渲染 mock（**已完成，就是本仓库初始状态**） |
| M1 | Sat 16:00 | PR-A 真实 before/after 原始录像存在；不通则 pipeline 永久切 `--fallback` |
| M2 | Sat 22:00 | PR-A 完整 report：并排视频 + narration + 字幕 + timeline + summary |
| M3 | Sun 08:00 | Feature Freeze：只修 bug / 换素材 / 排练 / 备 QA |

## 降级路径（铁律 1）

双 ref pipeline M1 不通：真实 pipeline 停止开发 → `--fallback`（预录视频 + mock evidence，产物结构完全一致）→ viewer / narration / voice 全部照常 → demo 叙事不变。评委看到的是体验 diff 产品，不是 pipeline 工程炫技。

## 三条铁律

1. **Sat 16:00 双跑录像不出，立刻降级，不恋战。**
2. **所有现场环节必须有预生成兜底**（主 demo 视频、追问视频、transcript、PR 页、report JSON、TTS 音轨），提交在 `assets/fallback/`。
3. **Sun 08:00 后不写新功能。**

## 边界（三个不做）

1. 不做依赖图 / blast radius——code graph 工具的地盘
2. 不做像素回归——我们比较 user journey，不比较 screen
3. 不做任意仓库——24h 版本只支持预埋 demo repo

口径：Static tools explain the code. Visual tools compare screens. **Experience Diff narrates the user journey.**
