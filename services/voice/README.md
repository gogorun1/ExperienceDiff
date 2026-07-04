# @experience-diff/voice — Audio 语音追问闭环

STT → intent matching → 预定义 flow routing → `FollowUpResponse` 给 viewer append。

**纪律：这不是开放世界 agent。** 只有三类 intent（`payment_failure_branch` / `mobile_viewport` / `specific_state`），路由到预定义 Playwright flow。

## 运行

```bash
npm run voice     # http://localhost:4100
npm run test:intents --workspace services/voice   # 法语/英语/中文 intent 测试
```

```bash
curl -X POST localhost:4100/follow-up \
  -d '{"reportId":"pr-a","questionText":"Et si le paiement échoue ?","language":"fr","allowedIntents":["payment_failure_branch","mobile_viewport","specific_state"]}'
```

## 三层兜底（PRD 第 13 节）

| 层 | 机制 | 状态 |
| --- | --- | --- |
| Level 1 | 真实 STT（Whisper）→ `/follow-up` | 待接：`POST /transcribe` |
| Level 2 | viewer 隐藏按钮直接 POST questionText | **已可用**（viewer 的 `followup-fallback-button`） |
| Level 3 | 播放预录追问片段（不经过本服务） | 素材放 `assets/fallback/` |

台词兜底："Live audio is always risky on stage, so here is the same follow-up we recorded five minutes ago."

## 骨架现状 / 待完成

- [x] 三类 intent 关键词匹配（en/fr/zh）+ 单测
- [x] intent → flowId/viewport 路由表
- [x] `/follow-up` HTTP 服务，返回 mock `FollowUpResponse`
- [ ] **Whisper STT**（whisper-1，`POST /transcribe`，语言提示 fr/en/zh）
- [ ] 追问触发 pipeline 桥：intent 路由结果调 BE-1 pipeline（或直接返回预生成分支 report）
- [ ] 麦克风采集 UI（viewer 侧协作）

## DoD

- [ ] STT 可用；法语 "Et si le paiement échoue ?" 稳定命中 `payment_failure_branch`
- [ ] 三类 intent routing 可用（intent 单测全绿）
- [ ] 失败时隐藏按钮可触发同一 intent
- [ ] 预录片段可无缝接入 viewer 时间轴
