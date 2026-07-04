import type { Change, EvidenceEvent } from '@experience-diff/contract';

function kebabCase(value: string): string {
  return value
    .replace(/data-testid=['"]([^'"]+)['"]/g, '$1')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function stableEvidenceName(evidence: EvidenceEvent): string {
  return kebabCase(evidence.selector ?? evidence.label ?? evidence.kind) || evidence.kind;
}

function waitDurationSec(evidence: EvidenceEvent): number | null {
  if (typeof evidence.value === 'number') return evidence.value;

  const source = typeof evidence.value === 'string' ? evidence.value : evidence.label;
  const match = source.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function describeDuration(seconds: number): string {
  return `${Number(seconds.toFixed(2))} seconds`;
}

function timingIdSuffix(evidence: EvidenceEvent, index: number): string {
  return evidence.selector ? stableEvidenceName(evidence) : `wait-${index + 1}`;
}

/**
 * Rule-based evidence diff -> perceivable changes.
 * Deterministic heuristics only; the LLM never invents changes, it only
 * narrates what this step produced.
 */
export function deriveChanges(evidence: EvidenceEvent[]): Change[] {
  const before = evidence.filter((e) => e.run === 'before');
  const after = evidence.filter((e) => e.run === 'after');
  const changes: Change[] = [];

  // 1. Flow length: compare navigation step counts.
  const navBefore = before.filter((e) => e.kind === 'navigation');
  const navAfter = after.filter((e) => e.kind === 'navigation');
  if (navAfter.length < navBefore.length) {
    changes.push({
      id: 'change-step-removed',
      type: 'step-removed',
      description: `The flow has fewer steps: ${navBefore.length} navigations before vs ${navAfter.length} after.`,
      timestampSec: navAfter[navAfter.length - 1]?.timestampSec ?? 0,
      severity: 'improvement',
      evidenceIds: [...navBefore.map((e) => e.id), ...navAfter.map((e) => e.id)],
      confidence: 0.9,
    });
  } else if (navAfter.length > navBefore.length) {
    changes.push({
      id: 'change-step-added',
      type: 'step-added',
      description: `The flow has more steps: ${navBefore.length} navigations before vs ${navAfter.length} after.`,
      timestampSec: navAfter[navAfter.length - 1]?.timestampSec ?? 0,
      severity: 'regression',
      evidenceIds: [...navBefore.map((e) => e.id), ...navAfter.map((e) => e.id)],
      confidence: 0.9,
    });
  }

  // 2. Feedback: spinner visible before but asserted absent after.
  const spinnerBefore = before.find(
    (e) => e.kind === 'visible' && e.selector?.includes('payment-loading'),
  );
  const noSpinnerAfter = after.find(
    (e) => e.kind === 'assertion' && e.selector?.includes('payment-loading') && e.value === true,
  );
  const disabledBefore = before.find(
    (e) => e.kind === 'assertion' && e.selector?.includes('button') && e.value === true,
  );
  const enabledAfter = after.find(
    (e) => e.kind === 'assertion' && e.selector?.includes('button') && e.value === false,
  );
  const afterWait = after.find((e) => e.kind === 'wait' && waitDurationSec(e) !== null);
  if (spinnerBefore && noSpinnerAfter) {
    const waitDescription = afterWait
      ? ` for about ${describeDuration(waitDurationSec(afterWait) ?? 0)}`
      : '';
    const buttonDescription =
      disabledBefore && enabledAfter ? ' and the primary action stays enabled' : '';
    const evidenceIds = [spinnerBefore.id, disabledBefore?.id, noSpinnerAfter.id, enabledAfter?.id]
      .filter((id): id is string => Boolean(id));

    changes.push({
      id: 'change-feedback-lost',
      type: 'feedback-lost',
      description: `The old version shows processing feedback; the new version waits${waitDescription} with no visible loading indicator${buttonDescription}.`,
      timestampSec: noSpinnerAfter.timestampSec,
      severity: 'regression',
      evidenceIds,
      confidence: 0.92,
    });
  }

  // 3. Error recovery: retry visible before but asserted absent after.
  const retryBefore = before.find(
    (e) => e.kind === 'visible' && e.selector?.includes('retry-payment-button'),
  );
  const noRetryAfter = after.find(
    (e) =>
      e.kind === 'assertion' && e.selector?.includes('retry-payment-button') && e.value === false,
  );
  if (retryBefore && noRetryAfter) {
    changes.push({
      id: 'change-error-recovery-lost',
      type: 'error-recovery-lost',
      description:
        'The old failure branch offered a retry action; the new one lands on a generic error page with no recovery path.',
      timestampSec: noRetryAfter.timestampSec,
      severity: 'regression',
      evidenceIds: [retryBefore.id, noRetryAfter.id],
      confidence: 0.94,
    });
  }

  // 4. Copy/visual: same selector, different text value.
  const textBefore = before.filter((e) => e.kind === 'text' && e.selector);
  for (const tb of textBefore) {
    const ta = after.find((e) => e.kind === 'text' && e.selector === tb.selector);
    if (ta && ta.value !== tb.value) {
      changes.push({
        id: `change-visual-${stableEvidenceName(tb)}`,
        type: 'visual',
        description: `Copy changed from '${tb.value}' to '${ta.value}'.`,
        timestampSec: ta.timestampSec,
        severity: 'neutral',
        evidenceIds: [tb.id, ta.id],
        confidence: 0.98,
      });
    }
  }

  // 5. Timing: compare explicit wait durations when both runs recorded them.
  const waitsBefore = before.filter((e) => e.kind === 'wait' && waitDurationSec(e) !== null);
  const waitsAfter = after.filter((e) => e.kind === 'wait' && waitDurationSec(e) !== null);
  for (const [index, wb] of waitsBefore.entries()) {
    const wa =
      waitsAfter.find((e) => e.selector && e.selector === wb.selector) ??
      waitsAfter.find((e) => stableEvidenceName(e) === stableEvidenceName(wb)) ??
      waitsAfter[index];
    if (!wa) continue;

    const beforeDuration = waitDurationSec(wb);
    const afterDuration = waitDurationSec(wa);
    if (beforeDuration === null || afterDuration === null) continue;

    const delta = afterDuration - beforeDuration;
    if (Math.abs(delta) < 0.1) continue;

    changes.push({
      id: `change-timing-${timingIdSuffix(wa, index)}`,
      type: 'timing',
      description:
        delta > 0
          ? `Wait time increased from ${describeDuration(beforeDuration)} to ${describeDuration(afterDuration)}.`
          : `Wait time decreased from ${describeDuration(beforeDuration)} to ${describeDuration(afterDuration)}.`,
      timestampSec: wa.timestampSec,
      severity: delta > 0 ? 'regression' : 'improvement',
      evidenceIds: [wb.id, wa.id],
      confidence: 0.86,
    });
  }

  return changes;
}
