import type { EvidenceEvent, FlowComparison, NarrationSegment } from '@experience-diff/contract';
import { deriveChanges } from './changes.js';
import { assertEvidenceBacked } from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrows(fn: () => void, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function flowFromEvidence(flowId: string, evidence: EvidenceEvent[]): FlowComparison {
  const perceivableChanges = deriveChanges(evidence);
  return {
    flowId,
    flowTitle: flowId,
    viewport: 'desktop',
    videoBefore: 'before.webm',
    videoAfter: 'after.webm',
    durationSec: 10,
    narration: [],
    perceivableChanges,
    evidence,
  };
}

function segmentFor(flow: FlowComparison, id: string, changeId: string): NarrationSegment {
  const change = flow.perceivableChanges.find((candidate) => candidate.id === changeId);
  assert(change, `missing expected change ${changeId}`);
  return {
    id,
    startSec: Math.max(0, change.timestampSec - 1),
    endSec: change.timestampSec + 1,
    text: change.description,
    severity: change.severity,
    changeIds: [change.id],
    evidenceIds: change.evidenceIds,
  };
}

function verifyPrA(): void {
  const flow = flowFromEvidence('pr-a-checkout-happy', [
    {
      id: 'before-nav-cart',
      run: 'before',
      timestampSec: 0.5,
      kind: 'navigation',
      label: 'Cart',
      value: '/cart',
    },
    {
      id: 'before-nav-payment',
      run: 'before',
      timestampSec: 3,
      kind: 'navigation',
      label: 'Payment',
      value: '/payment',
    },
    {
      id: 'after-nav-checkout',
      run: 'after',
      timestampSec: 1,
      kind: 'navigation',
      label: 'Checkout',
      value: '/checkout',
    },
    {
      id: 'before-spinner',
      run: 'before',
      timestampSec: 4,
      kind: 'visible',
      selector: '[data-testid="payment-loading"]',
      label: 'Payment spinner is visible',
    },
    {
      id: 'before-disabled',
      run: 'before',
      timestampSec: 4.1,
      kind: 'assertion',
      selector: '[data-testid="submit-payment-button"]',
      label: 'Submit button disabled',
      value: true,
    },
    {
      id: 'after-wait',
      run: 'after',
      timestampSec: 5,
      kind: 'wait',
      label: 'Waited 2 seconds',
      value: 2,
    },
    {
      id: 'after-no-spinner',
      run: 'after',
      timestampSec: 6,
      kind: 'assertion',
      selector: '[data-testid="payment-loading"]',
      label: 'Payment spinner absent',
      value: true,
    },
    {
      id: 'after-enabled',
      run: 'after',
      timestampSec: 6.1,
      kind: 'assertion',
      selector: '[data-testid="submit-payment-button"]',
      label: 'Submit button remains enabled',
      value: false,
    },
  ]);

  assert(
    flow.perceivableChanges.some(
      (change) => change.id === 'change-step-removed' && change.severity === 'improvement',
    ),
    'PR-A should derive a step removal improvement',
  );
  assert(
    flow.perceivableChanges.some(
      (change) => change.id === 'change-feedback-lost' && change.severity === 'regression',
    ),
    'PR-A should derive a feedback lost regression',
  );

  assertEvidenceBacked(
    [
      segmentFor(flow, 'narr-step-removed', 'change-step-removed'),
      segmentFor(flow, 'narr-feedback-lost', 'change-feedback-lost'),
    ],
    flow,
  );
}

function verifyPrB(): void {
  const flow = flowFromEvidence('pr-b-checkout-happy', [
    {
      id: 'before-copy',
      run: 'before',
      timestampSec: 2,
      kind: 'text',
      selector: '[data-testid="continue-button"]',
      label: 'Continue button text',
      value: 'Continue',
    },
    {
      id: 'after-copy',
      run: 'after',
      timestampSec: 2,
      kind: 'text',
      selector: '[data-testid="continue-button"]',
      label: 'Continue button text',
      value: 'Next step',
    },
  ]);

  assert(flow.perceivableChanges.length === 1, 'PR-B should derive one cosmetic change');
  assert(flow.perceivableChanges[0]?.severity === 'neutral', 'PR-B change should be neutral');
  assertEvidenceBacked([segmentFor(flow, 'narr-cosmetic', flow.perceivableChanges[0]!.id)], flow);
}

function verifyPrC(): void {
  const flow = flowFromEvidence('pr-c-checkout-fail', [
    {
      id: 'before-retry',
      run: 'before',
      timestampSec: 7,
      kind: 'visible',
      selector: '[data-testid="retry-payment-button"]',
      label: 'Retry payment action is visible',
    },
    {
      id: 'after-no-retry',
      run: 'after',
      timestampSec: 7,
      kind: 'assertion',
      selector: '[data-testid="retry-payment-button"]',
      label: 'Retry payment action is absent',
      value: false,
    },
  ]);

  assert(
    flow.perceivableChanges.some((change) => change.id === 'change-error-recovery-lost'),
    'PR-C should derive retry recovery loss',
  );
  assertEvidenceBacked(
    [segmentFor(flow, 'narr-error-recovery-lost', 'change-error-recovery-lost')],
    flow,
  );
}

function verifyRejections(): void {
  const flow = flowFromEvidence('invalid-cases', [
    {
      id: 'before-copy',
      run: 'before',
      timestampSec: 2,
      kind: 'text',
      selector: '[data-testid="button"]',
      label: 'Button text',
      value: 'Continue',
    },
    {
      id: 'after-copy',
      run: 'after',
      timestampSec: 2,
      kind: 'text',
      selector: '[data-testid="button"]',
      label: 'Button text',
      value: 'Next',
    },
  ]);
  const valid = segmentFor(flow, 'narr-valid', flow.perceivableChanges[0]!.id);

  expectThrows(
    () => assertEvidenceBacked([{ ...valid, evidenceIds: ['missing-evidence'] }], flow),
    'unknown evidence should be rejected',
  );
  expectThrows(
    () => assertEvidenceBacked([{ ...valid, changeIds: ['missing-change'] }], flow),
    'unknown change should be rejected',
  );
  expectThrows(
    () => assertEvidenceBacked([{ ...valid, startSec: 0, endSec: 12.1 }], flow),
    'timing beyond the two second tolerance should be rejected',
  );
}

verifyPrA();
verifyPrB();
verifyPrC();
verifyRejections();
console.log('[narrator] verify passed');
