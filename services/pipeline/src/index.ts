import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { PipelineRunOutput } from '@experience-diff/contract';
import { EvidenceRecorder } from './evidence.js';
import { FLOWS } from './flows.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const DEMO_SHOP = resolve(REPO_ROOT, 'apps/demo-shop');
const WORKTREES = resolve(HERE, '../.worktrees');
const ASSETS_OUT = resolve(REPO_ROOT, 'assets/generated');
const FALLBACK_DIR = resolve(REPO_ROOT, 'assets/fallback');

const PORTS = { before: 3001, after: 3002 } as const;

interface Args {
  baseRef: string;
  headRef: string;
  flowId: string;
  viewport: 'desktop' | 'mobile';
  fallback: boolean;
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
    baseRef: get('--base', 'main'),
    headRef: get('--head', 'pr-a'),
    flowId: get('--flow', 'checkout-happy'),
    viewport: get('--viewport', 'desktop') as Args['viewport'],
    fallback: process.argv.includes('--fallback'),
  };
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function prepareWorktree(ref: string, name: string): string {
  const dir = join(WORKTREES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(WORKTREES, { recursive: true });
  try {
    git(['worktree', 'remove', '--force', dir], DEMO_SHOP);
  } catch {
    /* not registered — fine */
  }
  git(['worktree', 'prune'], DEMO_SHOP);
  git(['worktree', 'add', '--force', dir, ref], DEMO_SHOP);
  return dir;
}

function startApp(dir: string, port: number): ChildProcess {
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  const child = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    detached: true,
  });
  return child;
}

async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App on port ${port} did not become ready in ${timeoutMs}ms`);
}

async function runFlow(
  run: 'before' | 'after',
  port: number,
  args: Args,
  outDir: string,
): Promise<{ video: string; recorder: EvidenceRecorder; durationSec: number }> {
  const flow = FLOWS[args.flowId];
  if (!flow) throw new Error(`Unknown flowId: ${args.flowId}. Known: ${Object.keys(FLOWS).join(', ')}`);

  const viewport = args.viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: outDir, size: viewport },
  });
  const page = await context.newPage();
  const recorder = new EvidenceRecorder(run);
  recorder.start();
  const startedAt = Date.now();

  try {
    await flow({ page, baseUrl: `http://localhost:${port}`, recorder, viewport: args.viewport });
  } finally {
    const durationSec = (Date.now() - startedAt) / 1000;
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const raw = await video.path();
      const target = join(outDir, `${run}.webm`);
      copyFileSync(raw, target);
      rmSync(raw, { force: true });
      return { video: target, recorder, durationSec };
    }
    throw new Error('No video recorded');
  }
}

function killApp(child: ChildProcess): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already dead */
    }
  }
}

function emitFallback(args: Args, outDir: string): PipelineRunOutput {
  // Iron Rule fallback: identical output shape from prerecorded assets.
  const mockPath = resolve(REPO_ROOT, 'packages/contract/mock/mock-experience-diff.json');
  const mock = JSON.parse(readFileSync(mockPath, 'utf8'));
  const flow = mock.flows[0];
  const pick = (name: string, fallbackName: string): string => {
    const fb = join(FALLBACK_DIR, name);
    return existsSync(fb) ? fb : resolve(REPO_ROOT, 'packages/contract/mock', fallbackName);
  };
  return {
    baseRef: args.baseRef,
    headRef: args.headRef,
    flowId: args.flowId,
    viewport: args.viewport,
    videoBefore: pick(`${args.headRef}-${args.flowId}-before.webm`, 'placeholder-before.mp4'),
    videoAfter: pick(`${args.headRef}-${args.flowId}-after.webm`, 'placeholder-after.mp4'),
    durationSec: flow.durationSec,
    evidence: flow.evidence,
    mode: 'fallback',
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const outDir = join(ASSETS_OUT, `${args.headRef}-${args.flowId}-${args.viewport}`);
  mkdirSync(outDir, { recursive: true });

  let output: PipelineRunOutput;

  if (args.fallback) {
    console.log('[pipeline] fallback mode: using prerecorded assets + mock evidence');
    output = emitFallback(args, outDir);
  } else {
    if (!existsSync(DEMO_SHOP)) {
      console.error('[pipeline] apps/demo-shop missing. Run: npm run bootstrap:demo-shop');
      process.exit(1);
    }

    console.log(`[pipeline] preparing worktrees for ${args.baseRef} / ${args.headRef}`);
    const beforeDir = prepareWorktree(args.baseRef, 'before');
    const afterDir = prepareWorktree(args.headRef, 'after');

    console.log('[pipeline] starting apps on ports 3001 / 3002');
    const beforeApp = startApp(beforeDir, PORTS.before);
    const afterApp = startApp(afterDir, PORTS.after);

    try {
      await Promise.all([waitForPort(PORTS.before), waitForPort(PORTS.after)]);

      console.log(`[pipeline] running flow '${args.flowId}' on both versions`);
      const before = await runFlow('before', PORTS.before, args, outDir);
      const after = await runFlow('after', PORTS.after, args, outDir);

      output = {
        baseRef: args.baseRef,
        headRef: args.headRef,
        flowId: args.flowId,
        viewport: args.viewport,
        videoBefore: before.video,
        videoAfter: after.video,
        durationSec: Math.max(before.durationSec, after.durationSec),
        evidence: [...before.recorder.all(), ...after.recorder.all()],
        mode: 'recorded',
      };
    } finally {
      killApp(beforeApp);
      killApp(afterApp);
    }
  }

  const outPath = join(outDir, 'pipeline-output.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`[pipeline] wrote ${outPath}`);
}

main().catch((err) => {
  console.error('[pipeline] failed:', err);
  console.error('[pipeline] tip: rerun with --fallback to use prerecorded assets');
  process.exit(1);
});
