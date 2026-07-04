import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import type {
  ExperienceDiff,
  FlowComparison,
  NarrationSegment,
  PipelineRunOutput,
} from '@experience-diff/contract';
import { deriveChanges } from './changes.js';
import { NARRATION_SYSTEM_PROMPT } from './prompt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const DEFAULT_NARRATION_MODEL = 'gpt-4o';
const DEFAULT_TTS_MODEL = 'tts-1';
const DEFAULT_TTS_VOICE = 'nova';
const NARRATION_TIME_TOLERANCE_SEC = 2;
const OPENAI_TIMEOUT_MS = 30_000;
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

interface Args {
  input: string; // pipeline-output.json
  out: string; // output dir for report + composed media
  prTitle: string;
}

export function parseArgs(argv = process.argv): Args {
  const get = (flag: string, def?: string): string => {
    const i = argv.indexOf(flag);
    if (i !== -1 && argv[i + 1]) return argv[i + 1];
    if (def !== undefined) return def;
    console.error(`Missing required arg ${flag}`);
    process.exit(1);
  };
  return {
    input: get('--input'),
    out: get('--out', resolve(REPO_ROOT, 'assets/generated/report')),
    prTitle: get('--pr-title', 'Experience Diff report'),
  };
}

function deterministicNarration(flow: FlowComparison): NarrationSegment[] {
  return flow.perceivableChanges.map((change) => ({
    id: `narr-${change.id}`,
    startSec: Math.max(0, change.timestampSec - 2),
    endSec: change.timestampSec + 5,
    text: change.description,
    severity: change.severity,
    changeIds: [change.id],
    evidenceIds: change.evidenceIds,
  }));
}

function isLlmDisabled(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.NARRATOR_DISABLE_LLM ?? '').toLowerCase());
}

function isTtsDisabled(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.NARRATOR_DISABLE_TTS ?? '').toLowerCase());
}

function assertStringArray(value: unknown, field: string, segmentId: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Narration segment '${segmentId}' has invalid ${field}.`);
  }
}

function assertNarrationSegments(value: unknown): asserts value is NarrationSegment[] {
  if (!Array.isArray(value)) {
    throw new Error('LLM narration response must be a JSON array.');
  }

  for (const [i, segment] of value.entries()) {
    if (segment === null || typeof segment !== 'object') {
      throw new Error(`Narration segment at index ${i} must be an object.`);
    }

    const candidate = segment as Record<string, unknown>;
    const segmentId = typeof candidate.id === 'string' ? candidate.id : `index ${i}`;

    if (typeof candidate.id !== 'string') {
      throw new Error(`Narration segment at index ${i} has invalid id.`);
    }
    if (typeof candidate.startSec !== 'number') {
      throw new Error(`Narration segment '${segmentId}' has invalid startSec.`);
    }
    if (candidate.endSec !== undefined && typeof candidate.endSec !== 'number') {
      throw new Error(`Narration segment '${segmentId}' has invalid endSec.`);
    }
    if (typeof candidate.text !== 'string') {
      throw new Error(`Narration segment '${segmentId}' has invalid text.`);
    }
    if (
      candidate.severity !== 'improvement' &&
      candidate.severity !== 'regression' &&
      candidate.severity !== 'neutral'
    ) {
      throw new Error(`Narration segment '${segmentId}' has invalid severity.`);
    }

    assertStringArray(candidate.changeIds, 'changeIds', segmentId);
    assertStringArray(candidate.evidenceIds, 'evidenceIds', segmentId);
  }
}

function parseNarrationResponse(content: string): NarrationSegment[] {
  const parsed = JSON.parse(content) as unknown;
  assertNarrationSegments(parsed);
  return parsed;
}

function assertPipelineRunOutput(value: unknown): asserts value is PipelineRunOutput {
  if (value === null || typeof value !== 'object') {
    throw new Error('invalid pipeline output: expected an object.');
  }

  const candidate = value as Record<string, unknown>;
  for (const field of ['baseRef', 'headRef', 'flowId', 'videoBefore', 'videoAfter'] as const) {
    if (typeof candidate[field] !== 'string') {
      throw new Error(`invalid pipeline output: missing or invalid ${field}.`);
    }
  }

  if (candidate.viewport !== 'desktop' && candidate.viewport !== 'mobile') {
    throw new Error('invalid pipeline output: missing or invalid viewport.');
  }
  if (typeof candidate.durationSec !== 'number' || !Number.isFinite(candidate.durationSec) || candidate.durationSec <= 0) {
    throw new Error('invalid pipeline output: missing or invalid durationSec.');
  }
  if (!Array.isArray(candidate.evidence)) {
    throw new Error('invalid pipeline output: missing or invalid evidence.');
  }
  if (candidate.mode !== 'recorded' && candidate.mode !== 'fallback') {
    throw new Error('invalid pipeline output: missing or invalid mode.');
  }
}

function buildNarrationPayload(flow: FlowComparison) {
  return {
    flowId: flow.flowId,
    flowTitle: flow.flowTitle,
    viewport: flow.viewport,
    durationSec: flow.durationSec,
    perceivableChanges: flow.perceivableChanges,
    evidence: flow.evidence,
  };
}

async function generateLlmNarration(flow: FlowComparison, apiKey: string): Promise<NarrationSegment[]> {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: OPENAI_TIMEOUT_MS });
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_NARRATION_MODEL ?? DEFAULT_NARRATION_MODEL,
    messages: [
      { role: 'system', content: NARRATION_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(buildNarrationPayload(flow)) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'narration_segments',
        strict: true,
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              startSec: { type: 'number' },
              endSec: { type: 'number' },
              text: { type: 'string' },
              severity: { type: 'string', enum: ['improvement', 'regression', 'neutral'] },
              changeIds: {
                type: 'array',
                items: { type: 'string' },
              },
              evidenceIds: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['id', 'startSec', 'endSec', 'text', 'severity', 'changeIds', 'evidenceIds'],
          },
        },
      },
    },
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error('LLM narration response was empty.');
  }

  const segments = parseNarrationResponse(content);
  assertEvidenceBacked(segments, flow);
  return segments;
}

/**
 * Generate narration through OpenAI when configured, with deterministic fallback
 * for local/offline runs and any model or validation failure.
 */
export async function generateNarration(flow: FlowComparison): Promise<NarrationSegment[]> {
  const fallback = (): NarrationSegment[] => {
    const segments = deterministicNarration(flow);
    assertEvidenceBacked(segments, flow);
    return segments;
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || isLlmDisabled()) {
    return fallback();
  }

  try {
    return await generateLlmNarration(flow, apiKey);
  } catch (err) {
    console.warn('[narrator] LLM narration failed, using deterministic fallback', err);
    return fallback();
  }
}

/** Validate the iron rule: every narration sentence must be evidence-backed. */
export function assertEvidenceBacked(segments: NarrationSegment[], flow: FlowComparison): void {
  const knownEvidence = new Set(flow.evidence.map((e) => e.id));
  const knownChanges = new Set(flow.perceivableChanges.map((change) => change.id));
  const maxEndSec = flow.durationSec + NARRATION_TIME_TOLERANCE_SEC;

  for (const seg of segments) {
    if (!Array.isArray(seg.evidenceIds) || seg.evidenceIds.length === 0) {
      throw new Error(`Narration segment '${seg.id}' has no evidenceIds — not allowed.`);
    }
    for (const id of seg.evidenceIds) {
      if (!knownEvidence.has(id)) {
        throw new Error(`Narration segment '${seg.id}' references unknown evidence '${id}'.`);
      }
    }
    if (!Array.isArray(seg.changeIds)) {
      throw new Error(`Narration segment '${seg.id}' has invalid changeIds.`);
    }
    for (const id of seg.changeIds) {
      if (!knownChanges.has(id)) {
        throw new Error(`Narration segment '${seg.id}' references unknown change '${id}'.`);
      }
    }
    if (!Number.isFinite(seg.startSec) || seg.startSec < 0) {
      throw new Error(`Narration segment '${seg.id}' starts before 0s.`);
    }
    if (seg.endSec !== undefined && (!Number.isFinite(seg.endSec) || seg.endSec <= seg.startSec)) {
      throw new Error(`Narration segment '${seg.id}' ends before it starts.`);
    }
    if (seg.startSec > maxEndSec) {
      throw new Error(`Narration segment '${seg.id}' starts after the flow duration tolerance.`);
    }
    if (seg.endSec !== undefined && seg.endSec > maxEndSec) {
      throw new Error(`Narration segment '${seg.id}' ends after the flow duration tolerance.`);
    }
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'segment';
}

function escapeFfmpegConcatPath(path: string): string {
  return path.replace(/'/g, "'\\''");
}

function normalizeBrowserPath(path: string): string {
  return path.split(sep).join('/');
}

function toAssetBaseUrl(outDir: string): string {
  return normalizeBrowserPath(relative(REPO_ROOT, resolve(outDir))) || '.';
}

function toBrowserAssetRef(filePath: string, outDir: string): string {
  if (/^https?:\/\//i.test(filePath)) return filePath;
  return normalizeBrowserPath(relative(resolve(outDir), resolve(filePath)));
}

function assertNonEmptyFile(path: string, label: string): void {
  if (!existsSync(path) || statSync(path).size <= 0) {
    throw new Error(`${label} was not created or is empty: ${path}`);
  }
}

function getMediaDurationSec(path: string): number {
  const output = execFileSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { encoding: 'utf8' },
  );
  const duration = Number.parseFloat(output.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`Could not determine audio duration with ${FFPROBE} for ${path}`);
  }
  return duration;
}

function createSilenceMp3(path: string, durationSec: number): void {
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      durationSec.toFixed(3),
      '-q:a',
      '9',
      '-acodec',
      'libmp3lame',
      path,
    ],
    { stdio: 'inherit' },
  );
  assertNonEmptyFile(path, 'silence audio');
}

export async function synthesizeVoiceover(
  segments: NarrationSegment[],
  outDir: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || isTtsDisabled()) {
    return null;
  }

  const orderedSegments = [...segments]
    .filter((segment) => segment.text.trim().length > 0)
    .sort((a, b) => a.startSec - b.startSec);
  if (orderedSegments.length === 0) {
    return null;
  }

  try {
    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: OPENAI_TIMEOUT_MS });
    const voiceoverDir = join(outDir, 'voiceover');
    mkdirSync(voiceoverDir, { recursive: true });

    const concatParts: string[] = [];
    let cursorSec = 0;
    const targetEndSec = Math.max(
      ...orderedSegments.map((segment) => segment.endSec ?? segment.startSec),
    );

    for (const [index, segment] of orderedSegments.entries()) {
      const startSec = Math.max(0, segment.startSec);
      const gapSec = startSec - cursorSec;
      if (gapSec > 0.01) {
        const silencePath = join(voiceoverDir, `${String(index).padStart(3, '0')}-silence.mp3`);
        createSilenceMp3(silencePath, gapSec);
        concatParts.push(silencePath);
        cursorSec = startSec;
      } else if (gapSec < -0.01) {
        console.warn(
          `[narrator] narration segment '${segment.id}' overlaps prior audio; it will start after the previous segment`,
        );
      }

      const segmentPath = join(
        voiceoverDir,
        `${String(index).padStart(3, '0')}-${sanitizeFilename(segment.id)}.mp3`,
      );
      const speech = await client.audio.speech.create({
        model: process.env.OPENAI_TTS_MODEL ?? DEFAULT_TTS_MODEL,
        voice: process.env.OPENAI_TTS_VOICE ?? DEFAULT_TTS_VOICE,
        input: segment.text,
        response_format: 'mp3',
      });
      writeFileSync(segmentPath, Buffer.from(await speech.arrayBuffer()));
      assertNonEmptyFile(segmentPath, 'TTS segment audio');
      concatParts.push(segmentPath);
      cursorSec = Math.max(cursorSec, startSec) + getMediaDurationSec(segmentPath);
    }

    const trailingSilenceSec = targetEndSec - cursorSec;
    if (trailingSilenceSec > 0.01) {
      const silencePath = join(voiceoverDir, '999-trailing-silence.mp3');
      createSilenceMp3(silencePath, trailingSilenceSec);
      concatParts.push(silencePath);
    }

    const concatListPath = join(voiceoverDir, 'concat.txt');
    writeFileSync(
      concatListPath,
      concatParts.map((part) => `file '${escapeFfmpegConcatPath(part)}'`).join('\n'),
    );

    const out = join(outDir, 'voiceover.mp3');
    execFileSync(
      FFMPEG,
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', out],
      { stdio: 'inherit' },
    );
    assertNonEmptyFile(out, 'voiceover audio');
    return out;
  } catch (err) {
    console.warn('[narrator] TTS synthesis failed, report will omit voiceover audio', err);
    return null;
  }
}

/** ffmpeg side-by-side composition of the two raw videos. */
export function composeSideBySide(
  videoBefore: string,
  videoAfter: string,
  outDir: string,
): string | null {
  const out = join(outDir, 'side-by-side.mp4');
  try {
    execFileSync(
      FFMPEG,
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        videoBefore,
        '-i',
        videoAfter,
        '-filter_complex',
        '[0:v]scale=640:-2[l];[1:v]scale=640:-2[r];[l][r]hstack=inputs=2[v]',
        '-map',
        '[v]',
        '-pix_fmt',
        'yuv420p',
        out,
      ],
      { stdio: 'inherit' },
    );
    assertNonEmptyFile(out, 'side-by-side video');
    return out;
  } catch (err) {
    console.warn(`[narrator] ${FFMPEG} composition failed, report will use raw videos only`, err);
    return null;
  }
}

export function muxVoiceoverIntoVideo(videoPath: string, voiceoverPath: string, outDir: string): string | null {
  const out = join(outDir, 'final-side-by-side.mp4');
  try {
    execFileSync(
      FFMPEG,
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-i',
        voiceoverPath,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        out,
      ],
      { stdio: 'inherit' },
    );
    assertNonEmptyFile(out, 'muxed side-by-side video');
    return out;
  } catch (err) {
    console.warn(`[narrator] ${FFMPEG} audio mux failed, keeping silent side-by-side video`, err);
    return null;
  }
}

export async function main(argv = process.argv): Promise<void> {
  const args = parseArgs(argv);
  if (!existsSync(args.input)) {
    console.error(`[narrator] input not found: ${args.input}`);
    console.error('[narrator] run the pipeline first (or with --fallback)');
    process.exit(1);
  }
  const parsedRun = JSON.parse(readFileSync(args.input, 'utf8')) as unknown;
  assertPipelineRunOutput(parsedRun);
  const run = parsedRun;
  mkdirSync(args.out, { recursive: true });

  const changes = deriveChanges(run.evidence);

  const flow: FlowComparison = {
    flowId: run.flowId,
    flowTitle: run.flowId === 'checkout-fail' ? 'Checkout payment failure branch' : 'Checkout happy path',
    viewport: run.viewport,
    videoBefore: toBrowserAssetRef(run.videoBefore, args.out),
    videoAfter: toBrowserAssetRef(run.videoAfter, args.out),
    durationSec: run.durationSec,
    narration: [],
    perceivableChanges: changes,
    evidence: run.evidence,
  };

  flow.narration = await generateNarration(flow);
  assertEvidenceBacked(flow.narration, flow);

  const sideBySideVideo = composeSideBySide(run.videoBefore, run.videoAfter, args.out);
  const voiceoverAudio = await synthesizeVoiceover(flow.narration, args.out);
  flow.sideBySideVideo = sideBySideVideo ? toBrowserAssetRef(sideBySideVideo, args.out) : undefined;
  flow.voiceoverAudio = voiceoverAudio ? toBrowserAssetRef(voiceoverAudio, args.out) : undefined;
  if (sideBySideVideo && voiceoverAudio) {
    const muxedVideo = muxVoiceoverIntoVideo(sideBySideVideo, voiceoverAudio, args.out);
    flow.sideBySideVideo = muxedVideo ? toBrowserAssetRef(muxedVideo, args.out) : flow.sideBySideVideo;
  }

  const regressions = changes.filter((c) => c.severity === 'regression');
  const improvements = changes.filter((c) => c.severity === 'improvement');
  const summary =
    changes.length === 0 || changes.every((c) => c.severity === 'neutral')
      ? 'Cosmetic change only. No meaningful user-flow change detected.'
      : [
          improvements.length ? improvements[0].description : null,
          regressions.length ? regressions[0].description : null,
        ]
          .filter(Boolean)
          .join(' But: ');

  const report: ExperienceDiff = {
    prMetadata: {
      title: args.prTitle,
      author: 'experience-diff',
      branch: run.headRef,
      baseRef: run.baseRef,
      headRef: run.headRef,
    },
    status: run.mode === 'fallback' ? 'fallback' : 'generated',
    createdAt: new Date().toISOString(),
    assetBaseUrl: toAssetBaseUrl(args.out),
    summary,
    flows: [flow],
  };

  const outPath = join(args.out, 'experience-diff.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[narrator] wrote ${outPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error('[narrator] failed:', err);
    process.exit(1);
  });
}
