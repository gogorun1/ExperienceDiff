import type { FollowUpIntent } from '@experience-diff/contract';

/**
 * NOT an open-world agent (PRD section 9): keyword-based matching over
 * exactly three intents, in en / fr / zh. Deterministic and demo-safe.
 */
const PATTERNS: Record<FollowUpIntent, RegExp[]> = {
  payment_failure_branch: [
    /fail|fails|failure|échoue|echoue|erreur|declin|refus/i,
    /失败|支付.*(不成功|出错)/,
  ],
  mobile_viewport: [
    /mobile|phone|téléphone|telephone|petit écran|small screen/i,
    /手机|移动端/,
  ],
  specific_state: [
    /expensive|saved card|carte enregistrée|cart has|panier/i,
    /贵|已保存|购物车/,
  ],
};

export interface IntentMatch {
  intent: FollowUpIntent;
  confidence: number;
}

export function matchIntent(
  questionText: string,
  allowedIntents: FollowUpIntent[],
): IntentMatch | null {
  for (const intent of allowedIntents) {
    const patterns = PATTERNS[intent] ?? [];
    if (patterns.some((p) => p.test(questionText))) {
      return { intent, confidence: 0.9 };
    }
  }
  return null;
}

/** Route an intent to a predefined pipeline run — never free-form. */
export function routeIntent(intent: FollowUpIntent): {
  flowId: string;
  viewport: 'desktop' | 'mobile';
} {
  switch (intent) {
    case 'payment_failure_branch':
      return { flowId: 'checkout-fail', viewport: 'desktop' };
    case 'mobile_viewport':
      return { flowId: 'checkout-happy', viewport: 'mobile' };
    case 'specific_state':
      return { flowId: 'checkout-happy', viewport: 'desktop' };
  }
}
