/**
 * P0-0 — FROZEN INTERFACE CONTRACT (PRD section 9).
 *
 * Frozen at M0 (Sat 12:30). Any change after freeze requires notifying ALL
 * five workstreams. Everyone develops against these types plus the mock
 * artifacts in ../mock.
 */

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ExperienceDiff {
  prMetadata: {
    title: string;
    author: string;
    branch: string;
    baseRef: string;
    headRef: string;
  };

  status: 'mock' | 'recorded' | 'generated' | 'fallback';
  createdAt: string;
  assetBaseUrl?: string;

  /** One-liner that goes into the PR comment. */
  summary: string;
  /** Usually 1 flow; follow-up questions append more. */
  flows: FlowComparison[];
}

export interface FlowComparison {
  /** e.g. "checkout-happy" | "checkout-fail" */
  flowId: string;
  /** e.g. "Checkout happy path" */
  flowTitle: string;
  viewport: 'desktop' | 'mobile';

  /** Raw before video. */
  videoBefore: string;
  /** Raw after video. */
  videoAfter: string;
  /** ffmpeg-composited side-by-side video. */
  sideBySideVideo?: string;
  /** TTS audio track. */
  voiceoverAudio?: string;

  durationSec: number;

  narration: NarrationSegment[];
  perceivableChanges: Change[];
  evidence: EvidenceEvent[];
}

export interface NarrationSegment {
  id: string;

  startSec: number;
  endSec?: number;

  /** Text read by TTS. */
  text: string;
  severity: 'improvement' | 'regression' | 'neutral';

  /** Which changes this sentence refers to. */
  changeIds: string[];
  /** Which evidence events support this sentence. Never empty. */
  evidenceIds: string[];
}

export type ChangeType =
  | 'step-removed'
  | 'step-added'
  | 'feedback-lost'
  | 'feedback-added'
  | 'visual'
  | 'timing'
  | 'error-recovery-lost'
  | 'error-recovery-added';

export interface Change {
  id: string;

  type: ChangeType;

  description: string;
  timestampSec: number;

  severity: 'improvement' | 'regression' | 'neutral';
  evidenceIds: string[];

  /** 0 to 1 */
  confidence: number;
}

export type EvidenceKind =
  | 'click'
  | 'navigation'
  | 'visible'
  | 'hidden'
  | 'wait'
  | 'assertion'
  | 'text'
  | 'url';

export interface EvidenceEvent {
  id: string;

  run: 'before' | 'after';
  timestampSec: number;

  kind: EvidenceKind;

  selector?: string;
  label: string;
  value?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// Voice follow-up
// ---------------------------------------------------------------------------

export type FollowUpIntent =
  | 'payment_failure_branch'
  | 'mobile_viewport'
  | 'specific_state';

export interface FollowUpRequest {
  reportId: string;
  questionText: string;
  language?: 'en' | 'fr' | 'zh';

  allowedIntents: FollowUpIntent[];
}

export interface FollowUpResponse {
  intent: FollowUpIntent;
  confidence: number;

  newFlow: FlowComparison;
  answerText: string;
}

// ---------------------------------------------------------------------------
// Pipeline hand-off (BE-1 -> BE-2): raw output before narration exists
// ---------------------------------------------------------------------------

export interface PipelineRunOutput {
  baseRef: string;
  headRef: string;
  flowId: string;
  viewport: 'desktop' | 'mobile';

  videoBefore: string;
  videoAfter: string;
  durationSec: number;

  evidence: EvidenceEvent[];

  /** 'recorded' for a real double run, 'fallback' when using prerecorded assets. */
  mode: 'recorded' | 'fallback';
}
