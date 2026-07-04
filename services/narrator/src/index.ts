import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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
const NARRATION_TIME_TOLERANCE_SEC = 5;

interface Args {
  input: string; // pipeline-output.json
  out: string; // output dir for report + composed media
  prTitle: string;
}

function parseArgs(): Args {
  const get = (flag: string, def?: string): string => {
    const i = process.argv.indexOf(flag);
    if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
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
  const client = new OpenAI({ apiKey });
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

/**
 * TTS. TODO(BE-2): OpenAI tts-1 per segment, concat with silences so audio
 * aligns to startSec. Returns null until wired (viewer tolerates it).
 */
export async function synthesizeVoiceover(
  _segments: NarrationSegment[],
  _outDir: string,
): Promise<string | null> {
  return null;
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
      'ffmpeg',
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
    return out;
  } catch (err) {
    console.warn('[narrator] ffmpeg composition failed, report will use raw videos only', err);
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!existsSync(args.input)) {
    console.error(`[narrator] input not found: ${args.input}`);
    console.error('[narrator] run the pipeline first (or with --fallback)');
    process.exit(1);
  }
  const run = JSON.parse(readFileSync(args.input, 'utf8')) as PipelineRunOutput;
  mkdirSync(args.out, { recursive: true });

  const changes = deriveChanges(run.evidence);

  const flow: FlowComparison = {
    flowId: run.flowId,
    flowTitle: run.flowId === 'checkout-fail' ? 'Checkout payment failure branch' : 'Checkout happy path',
    viewport: run.viewport,
    videoBefore: run.videoBefore,
    videoAfter: run.videoAfter,
    durationSec: run.durationSec,
    narration: [],
    perceivableChanges: changes,
    evidence: run.evidence,
  };

  flow.narration = await generateNarration(flow);
  assertEvidenceBacked(flow.narration, flow);

  flow.sideBySideVideo = composeSideBySide(run.videoBefore, run.videoAfter, args.out) ?? undefined;
  flow.voiceoverAudio = (await synthesizeVoiceover(flow.narration, args.out)) ?? undefined;

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
