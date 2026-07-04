# @experience-diff/contract — P0-0 接口合约（Owner: BE-1）

**这是整个项目的冻结点。** M0（Sat 12:30）后本包视为冻结：任何字段变更必须在团队群里知会全部 5 人并得到确认。

## 内容

| 文件 | 说明 |
| --- | --- |
| `src/index.ts` | 全部 TS 类型：`ExperienceDiff` / `FlowComparison` / `NarrationSegment` / `Change` / `EvidenceEvent` / `FollowUpRequest` / `FollowUpResponse` / `PipelineRunOutput` |
| `mock/mock-experience-diff.json` | PR-A 完整 mock report（improvement + regression，含 narration/changes/evidence 全链路） |
| `mock/mock-experience-diff-pr-b.json` | PR-B mock（cosmetic 短评，证明系统知道闭嘴） |
| `mock/mock-followup-response.json` | PR-C 语音追问的 mock `FollowUpResponse`（失败分支 flow） |
| `mock/placeholder-*.mp4` | 占位视频，viewer 从第一分钟就能播 |

## 使用方式

```ts
import type { ExperienceDiff, FollowUpResponse } from '@experience-diff/contract';
import mockReport from '@experience-diff/contract/mock/mock-experience-diff.json';
```

## 纪律

1. narration 每一句必须有非空 `evidenceIds`——没有 evidence 就不能讲（PRD 第 11 节）。
2. mock 数据是各模块的验收基准：viewer 能播 mock、narrator 能对 mock 生成解说、voice 能返回 mock follow-up，就算模块独立完成。
3. 模块间交接只走文件产物（JSON + mp4/mp3），路径约定见根 README。
