import { matchIntent, routeIntent } from './intents.js';
import type { FollowUpIntent } from '@experience-diff/contract';

const ALL: FollowUpIntent[] = ['payment_failure_branch', 'mobile_viewport', 'specific_state'];

const cases: Array<[string, FollowUpIntent | null]> = [
  ['Et si le paiement échoue ?', 'payment_failure_branch'],
  ['What happens if payment fails?', 'payment_failure_branch'],
  ['如果支付失败会怎样？', 'payment_failure_branch'],
  ['What about mobile?', 'mobile_viewport'],
  ['Can I see this on a phone?', 'mobile_viewport'],
  ['What if the cart has an expensive item?', 'specific_state'],
  ['What if the user has a saved card?', 'specific_state'],
  ['Tell me a joke', null],
];

let failed = 0;
for (const [question, expected] of cases) {
  const match = matchIntent(question, ALL);
  const actual = match?.intent ?? null;
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${question}" -> ${actual} (expected ${expected})`);
}

console.log(
  `routing: payment_failure_branch -> ${JSON.stringify(routeIntent('payment_failure_branch'))}`,
);

if (failed > 0) {
  console.error(`${failed} intent case(s) failed`);
  process.exit(1);
}
console.log('all intent cases passed');
