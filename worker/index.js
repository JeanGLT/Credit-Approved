/*
 * Credit Approved grading relay (Cloudflare Worker).
 *
 * POST /grade  { "caseId": "case-01", "question": 0, "answer": "..." }
 *   → { "ok": true, "ideas": [{ "present": true, "quote": "..." }], "feedback": "..." }
 *   → { "ok": false, "error": "..." } when grading is not possible (the game then uses keywords)
 *
 * The player never sends a prompt: the Worker builds it from the case file
 * (read from the game site) with js/grader-prompt.js, so it cannot be used as
 * a free general-purpose LLM. The API key is a Cloudflare secret (LLM_API_KEY),
 * never in the code, the repository or the player's browser.
 * Settings are in wrangler.toml ([vars]).
 */
import GraderPrompt from '../js/grader-prompt.js';

const CASE_ID = /^case-\d{2}$/;
const CASE_CACHE_SECONDS = 300;

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.indexOf(origin) !== -1 ? origin : null;
}

function reply(status, data, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// The case file, as published on the game site (cached a few minutes by Cloudflare).
async function loadCase(caseId, env) {
  const res = await fetch(env.CASES_URL + caseId + '.json', { cf: { cacheTtl: CASE_CACHE_SECONDS } });
  if (!res.ok) return null;
  return res.json();
}

async function grade(caseData, index, answer, env) {
  const question = caseData.committee[index];
  const prompt = GraderPrompt.buildPrompt(caseData, index, answer);
  const res = await fetch(env.LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LLM_API_KEY },
    body: JSON.stringify(GraderPrompt.requestBody(prompt, env.LLM_MODEL, env.LLM_REASONING))
  });
  if (!res.ok) return { ok: false, error: 'LLM error ' + res.status };
  const body = await res.json();
  const grading = GraderPrompt.parseGrading(body.choices[0].message.content, question, answer);
  if (!grading.ok) return grading;
  return {
    ok: true,
    ideas: grading.ideas.map((i) => ({ present: i.present, quote: i.quote })),
    feedback: grading.feedback
  };
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    const path = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        }
      });
    }
    if (path !== '/grade' || request.method !== 'POST') return reply(404, { ok: false, error: 'Not found' }, origin);
    if (!origin) return reply(403, { ok: false, error: 'Origin not allowed' }, null);
    if (!env.LLM_API_KEY) return reply(500, { ok: false, error: 'No API key configured' }, origin);

    let input;
    try {
      input = await request.json();
    } catch (e) {
      return reply(400, { ok: false, error: 'Body must be JSON' }, origin);
    }
    const { caseId, question, answer } = input || {};
    if (typeof caseId !== 'string' || !CASE_ID.test(caseId)) return reply(400, { ok: false, error: 'Bad caseId' }, origin);
    if (!Number.isInteger(question) || question < 0) return reply(400, { ok: false, error: 'Bad question' }, origin);
    if (typeof answer !== 'string' || !answer.trim()) return reply(400, { ok: false, error: 'Empty answer' }, origin);
    if (answer.length > GraderPrompt.MAX_ANSWER) return reply(413, { ok: false, error: 'Answer too long' }, origin);

    const caseData = await loadCase(caseId, env);
    if (!caseData || !caseData.committee || !caseData.committee[question]) {
      return reply(404, { ok: false, error: 'Unknown case or question' }, origin);
    }
    try {
      const result = await grade(caseData, question, answer, env);
      return reply(result.ok ? 200 : 502, result, origin);
    } catch (e) {
      return reply(502, { ok: false, error: 'Grading failed' }, origin);
    }
  }
};
