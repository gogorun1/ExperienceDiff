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

- [x] `deriveChanges()`：规则式 evidence diff + timing detection（flow 长度 / feedback 丢失 / error recovery / copy 变化）
- [x] `assertEvidenceBacked()`：evidence 链硬校验，包含 `changeId` + timing validation
- [x] ffmpeg hstack 并排合成
- [x] 无 API key 时的模板 narration 兜底（deterministic）
- [x] OpenAI gpt-4o narration：`generateNarration()` 使用 `NARRATION_SYSTEM_PROMPT`，输出后仍必须过 `assertEvidenceBacked()`
- [x] TTS（tts-1）：`synthesizeVoiceover()` per-segment synthesis，并按 `startSec` 做 silence alignment
- [x] 音轨 mux 进 side-by-side 视频

## DoD

- [x] PR-A：讲清 improvement + regression，每句有 `evidenceIds`
- [x] PR-B：只输出一句 cosmetic 短评（`deriveChanges` 全 neutral 时 summary 自动是 "Cosmetic change only."）
- [x] PR-C：讲清失败分支 retry 丢失（error-recovery-lost）
- [x] TTS：`OPENAI_API_KEY` 存在时产出 `voiceoverAudio`
- [x] ffmpeg：产出 `side-by-side.mp4` + final muxed video

## Quick verify

```bash
# PR-A: fallback pipeline -> narrator -> experience-diff.json
npm run pipeline -- --head pr-a --flow checkout-happy --fallback
npm run narrate -- --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json \
  --out assets/generated/pr-a-report --pr-title "PR-A: Unify checkout into a single step"
test -f assets/generated/pr-a-report/experience-diff.json

# PR-B: cosmetic-only narration
npm run pipeline -- --head pr-b --flow checkout-happy --fallback
npm run narrate -- --input assets/generated/pr-b-checkout-happy-desktop/pipeline-output.json \
  --out assets/generated/pr-b-report --pr-title "PR-B: Rename Continue to Next step"
test -f assets/generated/pr-b-report/experience-diff.json

# PR-C: error recovery regression
npm run pipeline -- --head pr-c --flow checkout-fail --fallback
npm run narrate -- --input assets/generated/pr-c-checkout-fail-desktop/pipeline-output.json \
  --out assets/generated/pr-c-report --pr-title "PR-C: Checkout failure route regression"
test -f assets/generated/pr-c-report/experience-diff.json

# Optional TTS + mux verification when OPENAI_API_KEY is set
OPENAI_API_KEY="$OPENAI_API_KEY" npm run narrate -- \
  --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json \
  --out assets/generated/pr-a-report-tts \
  --pr-title "PR-A: Unify checkout into a single step"
test -f assets/generated/pr-a-report-tts/voiceover.mp3
test -f assets/generated/pr-a-report-tts/final-side-by-side.mp4
```
