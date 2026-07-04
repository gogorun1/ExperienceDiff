import type { Change, EvidenceEvent } from '@experience-diff/contract';

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
  if (spinnerBefore && noSpinnerAfter) {
    changes.push({
      id: 'change-feedback-lost',
      type: 'feedback-lost',
      description:
        'The old version shows a processing indicator during payment; the new version waits with no visible loading feedback.',
      timestampSec: noSpinnerAfter.timestampSec,
      severity: 'regression',
      evidenceIds: [spinnerBefore.id, noSpinnerAfter.id],
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
        id: `change-copy-${tb.selector}`,
        type: 'visual',
        description: `Copy changed from '${tb.value}' to '${ta.value}'.`,
        timestampSec: ta.timestampSec,
        severity: 'neutral',
        evidenceIds: [tb.id, ta.id],
        confidence: 0.98,
      });
    }
  }

  return changes;
}
