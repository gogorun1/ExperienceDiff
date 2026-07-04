import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * LLM narration. TODO(BE-2): call OpenAI (gpt-4o) with NARRATION_SYSTEM_PROMPT,
 * passing ONLY changes + evidence + flow metadata, then validate that every
 * returned segment has non-empty evidenceIds that exist in the evidence list.
 *
 * Until wired, falls back to deterministic template narration so the whole
 * chain runs end-to-end without an API key.
 */
export async function generateNarration(flow: FlowComparison): Promise<NarrationSegment[]> {
  void NARRATION_SYSTEM_PROMPT;
  return flow.perceivableChanges.map((change, i) => ({
    id: `narr-${change.id}`,
    startSec: Math.max(0, change.timestampSec - 2),
    endSec: change.timestampSec + 5,
    text: change.description,
    severity: change.severity,
    changeIds: [change.id],
    evidenceIds: change.evidenceIds,
  }));
}

/** Validate the iron rule: every narration sentence must be evidence-backed. */
export function assertEvidenceBacked(segments: NarrationSegment[], flow: FlowComparison): void {
  const known = new Set(flow.evidence.map((e) => e.id));
  for (const seg of segments) {
    if (seg.evidenceIds.length === 0) {
      throw new Error(`Narration segment '${seg.id}' has no evidenceIds — not allowed.`);
    }
    for (const id of seg.evidenceIds) {
      if (!known.has(id)) {
        throw new Error(`Narration segment '${seg.id}' references unknown evidence '${id}'.`);
      }
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
