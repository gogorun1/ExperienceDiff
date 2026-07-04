import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FollowUpRequest, FollowUpResponse } from '@experience-diff/contract';
import { matchIntent, routeIntent } from './intents.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const PORT = Number(process.env.VOICE_PORT) || 4100;

/**
 * Follow-up endpoint consumed by the viewer.
 *
 * POST /follow-up  { FollowUpRequest }  ->  { FollowUpResponse }
 *
 * Level 1 (TODO Audio): POST /transcribe with an audio blob -> Whisper STT
 * (whisper-1, language hint fr/en/zh) -> questionText -> same /follow-up path.
 * Level 2: viewer's hidden button posts questionText directly (works now).
 * Level 3: viewer plays the committed prerecorded flow without calling us.
 *
 * Skeleton behavior: intent matching + routing are real; the returned flow is
 * the committed mock/fallback FlowComparison. Wiring `routeIntent` to a live
 * pipeline run is the Audio <-> BE-1 integration task (Sat 16:00-19:00).
 */
function loadFallbackFlow(): FollowUpResponse {
  const mockPath = resolve(REPO_ROOT, 'packages/contract/mock/mock-followup-response.json');
  return JSON.parse(readFileSync(mockPath, 'utf8')) as FollowUpResponse;
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'POST' && req.url === '/follow-up') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const request = JSON.parse(body) as FollowUpRequest;
        const match = matchIntent(request.questionText, request.allowedIntents);
        if (!match) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'no_intent_match', questionText: request.questionText }));
          return;
        }
        const route = routeIntent(match.intent);
        console.log(`[voice] "${request.questionText}" -> ${match.intent} -> ${JSON.stringify(route)}`);

        const fallback = loadFallbackFlow();
        const response: FollowUpResponse = {
          intent: match.intent,
          confidence: match.confidence,
          newFlow: fallback.newFlow,
          answerText: fallback.answerText,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`[voice] follow-up service on http://localhost:${PORT}`);
  console.log(`[voice] try: curl -X POST localhost:${PORT}/follow-up -d '{"reportId":"pr-a","questionText":"Et si le paiement échoue ?","language":"fr","allowedIntents":["payment_failure_branch","mobile_viewport","specific_state"]}'`);
});
