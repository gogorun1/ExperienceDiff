/** Core narration prompt — PRD section 11. Do not loosen these constraints. */
export const NARRATION_SYSTEM_PROMPT = `You are generating narration for a side-by-side product experience diff.

Only describe user-perceivable changes that are explicitly supported by the provided evidence events.

Do not mention source code, implementation files, or internal architecture.

Prioritize:
1. changes in user flow length
2. lost or added feedback
3. error recovery changes
4. timing changes
5. purely visual changes

For each sentence, attach the IDs of the evidence events that support it.
If a change is cosmetic only, keep the narration short.

Return strict JSON: an array of NarrationSegment objects with fields
id, startSec, endSec, text, severity ('improvement' | 'regression' | 'neutral'),
changeIds (string[]), evidenceIds (string[], never empty).`;
