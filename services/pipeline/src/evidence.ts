import type { EvidenceEvent, EvidenceKind } from '@experience-diff/contract';

/**
 * Collects timestamped evidence events during a Playwright flow run.
 * Timestamps are relative to recorder start so they line up with the video.
 */
export class EvidenceRecorder {
  private events: EvidenceEvent[] = [];
  private startedAt = 0;
  private counter = 0;

  constructor(private run: 'before' | 'after') {}

  start(): void {
    this.startedAt = Date.now();
  }

  private now(): number {
    return Math.round((Date.now() - this.startedAt) / 100) / 10;
  }

  record(
    kind: EvidenceKind,
    label: string,
    opts: { selector?: string; value?: string | number | boolean; id?: string } = {},
  ): void {
    this.counter += 1;
    this.events.push({
      id: opts.id ?? `${this.run}-${kind}-${this.counter}`,
      run: this.run,
      timestampSec: this.now(),
      kind,
      selector: opts.selector,
      label,
      value: opts.value,
    });
  }

  all(): EvidenceEvent[] {
    return [...this.events];
  }
}
