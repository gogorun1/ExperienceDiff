# BE-2 Narrator Review

Branch reviewed: `be2/narrator` against `main`.

Scope reviewed:

- `packages/contract/src/index.ts`
- `services/narrator/PLAN.md`
- `services/narrator/README.md`
- `services/narrator/src/index.ts`
- `services/narrator/src/changes.ts`
- `services/narrator/src/prompt.ts`

Typecheck note: I attempted to run `npm run typecheck`, but the command was rejected by the tool layer before execution, so this review is based on static code inspection.

## PASS

- `generateNarration()` uses the expected OpenAI path when configured. It uses the `openai` dependency, `NARRATION_SYSTEM_PROMPT`, sends only flow metadata plus `perceivableChanges` and `evidence`, requests strict JSON, parses into `NarrationSegment[]`, and validates before accepting the result (`services/narrator/src/index.ts:113`, `services/narrator/src/index.ts:124`, `services/narrator/src/index.ts:126`, `services/narrator/src/index.ts:132`, `services/narrator/src/index.ts:169`, `services/narrator/src/index.ts:170`).

- `NARRATOR_DISABLE_LLM` works as a force-fallback switch. When the env var is truthy or `OPENAI_API_KEY` is absent, `generateNarration()` returns deterministic narration and still runs `assertEvidenceBacked()` (`services/narrator/src/index.ts:55`, `services/narrator/src/index.ts:178`, `services/narrator/src/index.ts:185`).

- `assertEvidenceBacked()` covers the required evidence, change, and timing checks. It rejects empty or unknown `evidenceIds`, unknown `changeIds`, negative starts, invalid end times, and segment times outside `durationSec` plus tolerance (`services/narrator/src/index.ts:199`, `services/narrator/src/index.ts:204`, `services/narrator/src/index.ts:213`, `services/narrator/src/index.ts:221`, `services/narrator/src/index.ts:227`).

- `deriveChanges()` is deterministic and evidence-only. It derives step-count changes, lost processing feedback, lost retry recovery, text/visual changes, and explicit wait timing from `EvidenceEvent[]` without involving the LLM (`services/narrator/src/changes.ts:36`, `services/narrator/src/changes.ts:41`, `services/narrator/src/changes.ts:66`, `services/narrator/src/changes.ts:100`, `services/narrator/src/changes.ts:121`, `services/narrator/src/changes.ts:138`).

- The PR-A, PR-B, and PR-C fixture requirements appear covered by the local heuristics. PR-A-style evidence produces `change-step-removed` and `change-feedback-lost`; PR-B-style same-selector text evidence produces only a neutral `visual` change; PR-C-style retry evidence produces `change-error-recovery-lost` (`services/narrator/src/changes.ts:44`, `services/narrator/src/changes.ts:80`, `services/narrator/src/changes.ts:108`, `services/narrator/src/changes.ts:125`).

- `NARRATOR_DISABLE_TTS` works as a TTS kill switch. `synthesizeVoiceover()` returns `null` when the switch is set or when no API key is present, so JSON generation can continue without `voiceoverAudio` (`services/narrator/src/index.ts:59`, `services/narrator/src/index.ts:280`, `services/narrator/src/index.ts:284`).

- The happy-path media chain exists. `composeSideBySide()` creates a silent hstack video, `synthesizeVoiceover()` writes per-segment TTS parts with silence gaps, and `muxVoiceoverIntoVideo()` muxes audio with `-shortest` while preserving the silent video if muxing fails (`services/narrator/src/index.ts:352`, `services/narrator/src/index.ts:304`, `services/narrator/src/index.ts:339`, `services/narrator/src/index.ts:387`, `services/narrator/src/index.ts:404`, `services/narrator/src/index.ts:410`).

- The generated report uses the frozen top-level contract types directly: `PipelineRunOutput`, `FlowComparison`, `NarrationSegment`, and `ExperienceDiff` (`services/narrator/src/index.ts:6`, `services/narrator/src/index.ts:423`, `services/narrator/src/index.ts:428`, `services/narrator/src/index.ts:462`).

## FAIL

### 1. Generated media paths are not viewer-consumable

`composeSideBySide()`, `synthesizeVoiceover()`, and `muxVoiceoverIntoVideo()` return paths built from `outDir`, and `main()` writes those paths directly into `sideBySideVideo` and `voiceoverAudio` (`services/narrator/src/index.ts:358`, `services/narrator/src/index.ts:339`, `services/narrator/src/index.ts:388`, `services/narrator/src/index.ts:443`, `services/narrator/src/index.ts:444`, `services/narrator/src/index.ts:446`). When `outDir` is absolute, the report contains local filesystem paths such as `/Users/.../assets/generated/...`.

The viewer resolver treats any string beginning with `/` as an already-servable URL, not as a filesystem path (`apps/viewer/src/assets.ts:20`, `apps/viewer/src/assets.ts:22`). That means generated reports can point the browser at `/Users/...`, which Vite will not serve. The report also does not set `assetBaseUrl` (`services/narrator/src/index.ts:462`, `services/narrator/src/index.ts:473`), even though the contract provides it (`packages/contract/src/index.ts:24`) and the viewer resolver is built around it (`apps/viewer/src/assets.ts:23`).

Suggested fix:

- Emit browser-addressable asset names in the report, not local filesystem paths. For example, write files under `outDir` but set `assetBaseUrl` to a served URL like `/assets/generated/pr-a-report`, and store `sideBySideVideo: "final-side-by-side.mp4"` and `voiceoverAudio: "voiceover.mp3"`.
- Apply the same normalization to `videoBefore` and `videoAfter`, because `PipelineRunOutput` also carries local paths from the pipeline.
- Add a small helper that converts generated filesystem paths to contract asset references in one place.

### 2. TTS output does not guarantee coverage through the last narration segment

The plan says the acceptance check should verify the audio covers the last narration segment (`services/narrator/PLAN.md:100`, `services/narrator/PLAN.md:103`). The implementation concatenates silence before each segment and each generated MP3, then immediately writes `voiceover.mp3` (`services/narrator/src/index.ts:301`, `services/narrator/src/index.ts:304`, `services/narrator/src/index.ts:329`, `services/narrator/src/index.ts:333`, `services/narrator/src/index.ts:339`). It never pads trailing silence to `max(segment.endSec)` after the final spoken segment.

For a short final line with `startSec: 0` and `endSec: 6`, OpenAI speech could be only 2-3 seconds long; `voiceover.mp3` would then end before the segment's declared subtitle window. That violates the T5 acceptance requirement and can also interact poorly with muxing because `-shortest` will stop at the shorter audio track (`services/narrator/src/index.ts:404`).

Suggested fix:

- Track `targetEndSec = max(segment.endSec ?? segment.startSec)` across ordered segments.
- After the last TTS part, if `cursorSec < targetEndSec`, append a final generated silence part for `targetEndSec - cursorSec`.
- Add a fixture or script assertion using `ffprobe` that `voiceover.mp3` duration is at least the last narration `endSec` within a small tolerance.

### 3. Claimed CLI/fixture acceptance harness is missing

T7 requires a script or lightweight harness that exercises the narrator against PR-A, PR-B, and PR-C and validates `main()`, `deriveChanges()`, `generateNarration()`, `assertEvidenceBacked()`, `synthesizeVoiceover()`, and media helpers (`services/narrator/PLAN.md:127`, `services/narrator/PLAN.md:131`, `services/narrator/PLAN.md:133`, `services/narrator/PLAN.md:143`). The narrator package only has `build` and `start` scripts (`services/narrator/package.json:6`, `services/narrator/package.json:7`, `services/narrator/package.json:8`), and there are no test files under `services/narrator`.

The README marks the DoD as complete (`services/narrator/README.md:31`, `services/narrator/README.md:33`, `services/narrator/README.md:36`, `services/narrator/README.md:37`), but the acceptance automation described by the plan is not present.

Suggested fix:

- Add a `test` or `verify` script in `services/narrator/package.json`.
- Include fixture-driven checks for PR-A improvement plus regression, PR-B cosmetic-only summary/narration, PR-C `error-recovery-lost`, invalid evidence rejection, invalid change rejection, and invalid timing rejection.
- Keep media checks conditional on `ffmpeg`/`OPENAI_API_KEY` so offline runs still validate the deterministic path.

### 4. `FFMPEG_PATH` and `FFPROBE_PATH` environment overrides are documented but ignored

The plan documents `FFMPEG_PATH` and `FFPROBE_PATH` as optional overrides (`services/narrator/PLAN.md:177`, `services/narrator/PLAN.md:178`). The implementation hardcodes `ffprobe` and `ffmpeg` in every media helper (`services/narrator/src/index.ts:244`, `services/narrator/src/index.ts:246`, `services/narrator/src/index.ts:257`, `services/narrator/src/index.ts:259`, `services/narrator/src/index.ts:340`, `services/narrator/src/index.ts:341`, `services/narrator/src/index.ts:360`, `services/narrator/src/index.ts:361`, `services/narrator/src/index.ts:390`, `services/narrator/src/index.ts:391`).

This is a spec compliance gap for environments where the binaries are not on `PATH` or are intentionally pinned.

Suggested fix:

- Add `const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'` and `const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'`.
- Use those constants in all media helpers.
- Include the binary path in warning messages so failures are actionable.

### 5. Media helpers return success without verifying output files

T5 explicitly says to avoid claiming TTS success unless the audio file exists (`services/narrator/PLAN.md:95`, `services/narrator/PLAN.md:96`). `synthesizeVoiceover()` returns `out` immediately after `ffmpeg` exits (`services/narrator/src/index.ts:339`, `services/narrator/src/index.ts:340`, `services/narrator/src/index.ts:345`). `composeSideBySide()` and `muxVoiceoverIntoVideo()` do the same for video outputs (`services/narrator/src/index.ts:358`, `services/narrator/src/index.ts:360`, `services/narrator/src/index.ts:380`, `services/narrator/src/index.ts:388`, `services/narrator/src/index.ts:390`, `services/narrator/src/index.ts:409`).

If ffmpeg exits successfully but writes an empty, missing, or corrupt file, the report will still advertise the artifact.

Suggested fix:

- After each ffmpeg command, check `existsSync(out)` and `statSync(out).size > 0`.
- For video mux output, optionally run a cheap `ffprobe` stream check before replacing the silent `sideBySideVideo`.
- Throw inside the helper if validation fails so the existing graceful fallback paths can omit or preserve the correct field.

### 6. T1 asks for importable `parseArgs` and `main`, but they are not exported

The plan asks to export `parseArgs`, `generateNarration`, `assertEvidenceBacked`, `synthesizeVoiceover`, `composeSideBySide`, and `main` where useful for focused tests (`services/narrator/PLAN.md:13`, `services/narrator/PLAN.md:17`, `services/narrator/PLAN.md:22`). The implementation exports the core helpers but keeps `parseArgs()` and `main()` private (`services/narrator/src/index.ts:28`, `services/narrator/src/index.ts:178`, `services/narrator/src/index.ts:199`, `services/narrator/src/index.ts:280`, `services/narrator/src/index.ts:353`, `services/narrator/src/index.ts:416`).

The CLI guard is present (`services/narrator/src/index.ts:481`), so exporting these functions should not accidentally run the CLI.

Suggested fix:

- Export `parseArgs` and `main`.
- Prefer changing `parseArgs(argv = process.argv)` so tests can pass argv explicitly instead of mutating global process state.

## WARN

- OpenAI calls rely on SDK defaults for retry and timeout behavior. The code catches LLM failures and falls back deterministically (`services/narrator/src/index.ts:190`, `services/narrator/src/index.ts:192`), but it does not set explicit `maxRetries` or a shorter timeout on the `OpenAI` client (`services/narrator/src/index.ts:125`, `services/narrator/src/index.ts:297`). For a demo CLI, explicit timeouts would make failures faster and easier to explain.

- `parseNarrationResponse()` uses `JSON.parse()` directly (`services/narrator/src/index.ts:107`, `services/narrator/src/index.ts:108`). This is acceptable with strict structured outputs, but if the API returns malformed JSON, the warning only says the LLM failed and dumps the raw error object (`services/narrator/src/index.ts:192`, `services/narrator/src/index.ts:193`). A wrapped error with the model name and response id would be more actionable.

- Runtime input validation is thin. `main()` casts parsed JSON to `PipelineRunOutput` without checking required fields (`services/narrator/src/index.ts:423`). If `pipeline-output.json` is malformed, downstream failures will likely be less clear than a direct "invalid pipeline output: missing evidence[]" error.

- `assertEvidenceBacked()` allows narration to extend five seconds past the flow duration (`services/narrator/src/index.ts:20`, `services/narrator/src/index.ts:202`, `services/narrator/src/index.ts:230`). The plan allows only a small tolerance if needed for generated speech padding (`services/narrator/PLAN.md:77`). Five seconds is large relative to short demo flows; consider reducing this or tying the tolerance to an explicit TTS padding policy.

- The TTS concat path uses MP3 files with concat demuxer and `-c copy` (`services/narrator/src/index.ts:333`, `services/narrator/src/index.ts:340`, `services/narrator/src/index.ts:342`). This may work for uniform OpenAI MP3 output, but it is more fragile than re-encoding the concatenated result, especially when generated silence and speech files have different encoder metadata.

- Overlapping narration segments are silently shifted later in audio while their subtitle `startSec` stays unchanged (`services/narrator/src/index.ts:312`, `services/narrator/src/index.ts:313`). That is a reasonable fallback, but it means TTS timing can drift from the validated narration timing. If overlap is invalid for the product, reject it in `assertEvidenceBacked()` instead.

- The current viewer does not yet play `sideBySideVideo` or `voiceoverAudio`; it still renders before/after videos and subtitles (`apps/viewer/src/App.tsx:51`, `apps/viewer/src/App.tsx:53`, `apps/viewer/src/App.tsx:57`, `apps/viewer/README.md:23`, `apps/viewer/README.md:28`). This is not a narrator-only bug, but it means the README claim that final muxed video is viewer-consumed should be validated end-to-end before demo signoff.

## Summary

The branch implements the core BE-2 narration loop: evidence-derived changes, LLM narration with deterministic fallback, evidence validation, TTS generation, side-by-side video composition, and muxing. The main blockers are around integration hardening: generated asset paths are not reliably browser-consumable, TTS duration alignment is incomplete, the claimed acceptance harness is missing, documented ffmpeg/ffprobe overrides are ignored, and media outputs are trusted without validation.
