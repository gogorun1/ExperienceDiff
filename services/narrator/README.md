# @experience-diff/narrator — BE-2 解说引擎 + 视频合成

evidence → perceivableChanges → narration → TTS → ffmpeg side-by-side → `ExperienceDiff` JSON。

## 输入纪律（PRD 第 11 节）

只允许输入 `perceivableChanges` + `evidenceEvents` + flow metadata。**LLM 不看代码、不看视频、不脑补。** 每句 narration 必须带非空 `evidenceIds`，`assertEvidenceBacked()` 会硬校验，不满足直接 throw。

禁止输出："This might confuse users." / "The design is more modern." / "This is better UX."（除非 evidence 明确支持）。

## 运行

```bash
# 先跑 pipeline（真实或 --fallback）拿到 pipeline-output.json，然后：
npm run narrate -- --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json \
  --out assets/generated/pr-a-report --pr-title "PR-A: Unify checkout into a single step"
```

产出 `experience-diff.json`（合约格式）+ `side-by-side.mp4`，viewer 直接消费。

## 骨架现状 / 待完成

- [x] `deriveChanges()`：规则式 evidence diff（flow 长度 / feedback 丢失 / error recovery / copy 变化）
- [x] `assertEvidenceBacked()`：evidence 链硬校验
- [x] ffmpeg hstack 并排合成
- [x] 无 API key 时的模板 narration 兜底（deterministic）
- [ ] **接 OpenAI gpt-4o**：`generateNarration()` 里用 `NARRATION_SYSTEM_PROMPT`，输出后仍必须过 `assertEvidenceBacked`
- [ ] **接 TTS（tts-1）**：`synthesizeVoiceover()`，按 `startSec` 对齐音轨
- [ ] 音轨 mux 进 side-by-side 视频

## DoD

- [ ] PR-A 讲清 improvement + regression，每句有 evidenceIds
- [ ] PR-B 只输出一句 cosmetic 短评（`deriveChanges` 全 neutral 时 summary 自动是 "Cosmetic change only."）
- [ ] PR-C 讲清失败分支 retry 丢失
- [ ] TTS 可用，ffmpeg 合成可用
