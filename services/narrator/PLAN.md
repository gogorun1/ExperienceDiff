# Narrator Implementation Plan

## Scope

Implement BE-2 from the current skeleton:

- Input: `PipelineRunOutput` from `assets/generated/<run>/pipeline-output.json`.
- Transform: `evidence` -> `deriveChanges()` -> `generateNarration()` -> `assertEvidenceBacked()` -> TTS -> ffmpeg side-by-side + audio mux.
- Output: `ExperienceDiff` JSON plus composed media in the requested `--out` directory.

The frozen contract is `packages/contract/src/index.ts`. Do not change it unless all five workstreams are notified and agree.

## T1 - Export Testable Narrator Units

- Files: `services/narrator/src/index.ts`.
- Functions:
  - Export `parseArgs`, `generateNarration`, `assertEvidenceBacked`, `synthesizeVoiceover`, `composeSideBySide`, and `main` where useful.
  - Guard CLI execution so importing the module for tests does not run `main()`.
- Dependencies:
  - Must preserve the existing CLI path used by `npm run narrate`.
  - Needed by T3, T4, T5, and T7 for focused tests.
- Test method:
  - `npm run typecheck`
  - Import the exported functions from a small Node/TS test harness or future test file without invoking the CLI.
- Complexity: S.

## T2 - Harden `deriveChanges()` Against DoD Fixtures

- Files: `services/narrator/src/changes.ts`, `packages/contract/mock/mock-experience-diff.json`, `packages/contract/mock/mock-experience-diff-pr-b.json`, `packages/contract/mock/mock-followup-response.json`.
- Functions:
  - `deriveChanges(evidence: EvidenceEvent[]): Change[]`.
- Work:
  - Keep deterministic, evidence-only rules.
  - Ensure PR-A evidence yields both an improvement (`step-removed`) and a regression (`feedback-lost`).
  - Ensure PR-B evidence yields only one neutral cosmetic change and no extra flow/timing claims.
  - Ensure PR-C failure evidence yields `error-recovery-lost`.
  - Improve generated IDs so selector-derived IDs are valid, stable, and readable.
- Dependencies:
  - Independent of OpenAI and ffmpeg.
  - Must be complete before T3 because LLM narration can only narrate `perceivableChanges`.
- Test method:
  - Build fixture-style `PipelineRunOutput` inputs from the mock report flow evidence and assert returned `Change[]` ids, severities, evidence ids, and summaries.
  - `npm run typecheck`
- Complexity: M.

## T3 - Implement OpenAI Narration Generation

- Files: `services/narrator/src/index.ts`, `services/narrator/src/prompt.ts`.
- Functions:
  - `generateNarration(flow: FlowComparison): Promise<NarrationSegment[]>`.
  - `assertEvidenceBacked(segments: NarrationSegment[], flow: FlowComparison): void`.
- Work:
  - Use the existing `openai` dependency and `NARRATION_SYSTEM_PROMPT`.
  - Send only `flowId`, `flowTitle`, `viewport`, `durationSec`, `perceivableChanges`, and `evidence`.
  - Require strict JSON matching `NarrationSegment[]`.
  - Validate every segment with `assertEvidenceBacked()` after parsing.
  - Preserve deterministic template fallback when `OPENAI_API_KEY` is absent or OpenAI fails.
  - Keep cosmetic-only narration short when all changes are neutral.
- Dependencies:
  - Depends on T2.
  - Can run in parallel with T4 after the segment contract is stable.
- Test method:
  - Without `OPENAI_API_KEY`: run narrator and confirm deterministic narration exists.
  - With `OPENAI_API_KEY`: run narrator on PR-A fallback output and confirm narration is valid JSON, every sentence has non-empty known `evidenceIds`, and no forbidden unsupported UX claims appear.
  - `npm run narrate -- --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json --out assets/generated/pr-a-report --pr-title "PR-A: Unify checkout into a single step"`
  - `npm run typecheck`
- Complexity: M.

## T4 - Implement Evidence Validation Coverage

- Files: `services/narrator/src/index.ts`.
- Functions:
  - `assertEvidenceBacked(segments: NarrationSegment[], flow: FlowComparison): void`.
- Work:
  - Keep the hard rule: every narration segment must have non-empty `evidenceIds`.
  - Also validate referenced `changeIds` exist in `flow.perceivableChanges` when non-empty.
  - Validate `startSec >= 0`, `endSec > startSec` when present, and segment times stay within `flow.durationSec` with a small tolerance only if needed for generated speech padding.
- Dependencies:
  - Depends on T1.
  - Supports T3 and T5.
- Test method:
  - Unit-style checks for empty `evidenceIds`, unknown evidence ids, unknown change ids, invalid times, and a valid mock segment.
  - `npm run typecheck`
- Complexity: S.

## T5 - Implement TTS Segment Synthesis and Alignment

- Files: `services/narrator/src/index.ts`.
- Functions:
  - `synthesizeVoiceover(segments: NarrationSegment[], outDir: string): Promise<string | null>`.
- Work:
  - Use OpenAI TTS (`tts-1`) to synthesize each segment.
  - Write per-segment audio under `outDir`, then concatenate with silence so each spoken segment starts at `segment.startSec`.
  - Return a relative or absolute path consistently with `sideBySideVideo`.
  - Preserve `null` fallback when `OPENAI_API_KEY` is absent or TTS fails, so viewer remains tolerant.
  - Avoid claiming TTS success unless the audio file exists.
- Dependencies:
  - Depends on T1 and T4.
  - Can run in parallel with T3 after segment shape is stable.
- Test method:
  - Without `OPENAI_API_KEY`: output JSON omits `voiceoverAudio`.
  - With `OPENAI_API_KEY` and ffmpeg available: narrator writes an audio file and `voiceoverAudio` points to it.
  - Inspect duration with `ffprobe` and verify it covers the last narration segment.
  - `npm run typecheck`
- Complexity: L.

## T6 - Mux Voiceover Into Side-by-Side Video

- Files: `services/narrator/src/index.ts`.
- Functions:
  - `composeSideBySide(videoBefore: string, videoAfter: string, outDir: string): string | null`.
  - New helper if needed: `muxAudio(videoPath: string, audioPath: string, outDir: string): string | null`.
- Work:
  - Keep current ffmpeg hstack behavior for silent video.
  - If `voiceoverAudio` exists, mux audio into the composed side-by-side video.
  - Use `-shortest` or explicit duration handling so muxing does not create runaway media.
  - Preserve graceful fallback: if mux fails, keep the silent side-by-side video and still emit `voiceoverAudio`.
- Dependencies:
  - Depends on T5.
  - Independent of T2/T3 except for final acceptance.
- Test method:
  - Run narrator with TTS enabled and confirm `sideBySideVideo` has an audio stream via `ffprobe`.
  - Run narrator with TTS disabled and confirm side-by-side video still exists.
  - `npm run typecheck`
- Complexity: M.

## T7 - Add CLI/Fixture Acceptance Harness

- Files: `services/narrator/package.json`, `services/narrator/src/index.ts`, optional `services/narrator/src/*.test.ts` or `services/narrator/test-fixtures/*`.
- Functions:
  - Exercise `main()`, `deriveChanges()`, `generateNarration()`, `assertEvidenceBacked()`, `synthesizeVoiceover()`, and media helpers.
- Work:
  - Add a script that validates narrator behavior against the three mock JSON scenarios:
    - PR-A: improvement + regression.
    - PR-B: one neutral cosmetic short narration.
    - PR-C: failure branch retry lost.
  - Prefer a lightweight script over adding a large test framework unless the repo already adopts one.
  - Use temporary output dirs under `assets/generated/` or OS temp; do not commit generated media.
- Dependencies:
  - Depends on T1 through T6 for full coverage.
  - Can start earlier with T1/T2-only checks.
- Test method:
  - `npm run test --workspace services/narrator` if a test script is added.
  - `npm run typecheck`
  - Manual CLI smoke commands from T3/T5/T6.
- Complexity: M.

## T8 - Final DoD Runbook and Fallback Assets

- Files: `services/narrator/README.md`, `services/narrator/PLAN.md`, generated outputs under `assets/generated/`, fallback media under `assets/fallback/` only if final demo assets must be committed.
- Functions:
  - No new core functions required unless T6 introduces a mux helper.
- Work:
  - Document exact run commands and expected outputs.
  - Confirm fallback path remains viable when OpenAI or ffmpeg is unavailable.
  - Confirm generated `experience-diff.json` is contract-shaped and viewer-consumable.
  - Commit only source, docs, and required fallback assets; never commit `assets/generated/`.
- Dependencies:
  - Serial after T2-T7.
- Test method:
  - `npm install`
  - `npx playwright install chromium`
  - `npm run bootstrap:demo-shop`
  - `npm run pipeline -- --head pr-a --flow checkout-happy --fallback`
  - `npm run narrate -- --input assets/generated/pr-a-checkout-happy-desktop/pipeline-output.json --out assets/generated/pr-a-report --pr-title "PR-A: Unify checkout into a single step"`
  - `npm run typecheck`
- Complexity: S.

## Environment Variables

- `OPENAI_API_KEY`: Required for live GPT narration and TTS. If absent, narrator must use deterministic template narration and omit `voiceoverAudio`.
- `OPENAI_NARRATION_MODEL`: Optional override for narration model; default should be `gpt-4o`.
- `OPENAI_TTS_MODEL`: Optional override for TTS model; default should be `tts-1`.
- `OPENAI_TTS_VOICE`: Optional TTS voice override; choose a stable default in code.
- `NARRATOR_DISABLE_LLM`: Optional local/demo switch to force deterministic narration even when `OPENAI_API_KEY` exists.
- `NARRATOR_DISABLE_TTS`: Optional local/demo switch to skip voiceover generation while still producing JSON and side-by-side video.
- `FFMPEG_PATH`: Optional override if `ffmpeg` is not on `PATH`.
- `FFPROBE_PATH`: Optional override for validation scripts if `ffprobe` is not on `PATH`.

## Dependency Graph

Serial path:

```text
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8
```

Practical parallelism:

- T1 is first because tests need importable functions.
- T2 can proceed independently of OpenAI/TTS/media work once T1 is done.
- T3 and T5 can proceed in parallel after T1 and the segment shape are stable.
- T4 can proceed in parallel with T3, but T3 must call it before accepting LLM output.
- T6 waits for T5 because muxing needs a real audio artifact.
- T7 can start after T1/T2 with fixture checks, then expand after T3-T6.
- T8 is final and serial because it validates the whole demo path.

## Acceptance Criteria

Per `services/narrator/README.md` DoD:

- PR-A explains both the improvement and the regression.
  - Generated `flows[0].perceivableChanges` includes at least one `improvement` and one `regression`.
  - Generated `flows[0].narration` mentions the shorter flow and the lost payment feedback.
  - Every narration segment has non-empty `evidenceIds` that reference existing events.
- PR-B outputs only a short cosmetic comment.
  - All changes are `neutral`.
  - Summary is `Cosmetic change only. No meaningful user-flow change detected.`
  - Narration is short and does not invent flow, timing, feedback, or recovery impact.
- PR-C explains the failed-payment retry regression.
  - Failure branch evidence yields an `error-recovery-lost` regression.
  - Narration states that the old version had a retry path and the new version lacks one, backed by retry/error evidence.
- TTS is usable.
  - With `OPENAI_API_KEY`, narrator emits an audio file and sets `voiceoverAudio`.
  - Without `OPENAI_API_KEY`, narrator still emits valid JSON and video with `voiceoverAudio` omitted.
- ffmpeg composition is usable.
  - `side-by-side.mp4` is produced when `ffmpeg` is available.
  - When TTS exists, the final side-by-side video has an audio stream.
  - If media composition fails, JSON generation remains usable and the failure is logged.

General repo acceptance:

- `npm run typecheck` passes.
- Narrator consumes only file artifacts and frozen contract types.
- LLM input contains only flow metadata, `perceivableChanges`, and `evidence`.
- No narration sentence is accepted without evidence.
- `assets/generated/` remains uncommitted.
