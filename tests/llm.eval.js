/*
 * Evaluation of LLM grading against graded answers. Calls a real LLM, so it
 * needs an API key in a .env file at the project root (never committed):
 *   GROQ_API_KEY=...
 * Run:
 *   node --env-file=.env tests/llm.eval.js                          (tests/answers/case-01.json)
 *   node --env-file=.env tests/llm.eval.js tests/answers/claude-probes-case-01.json tests/answers/claude-probes-case-02.json
 *
 * Any provider with the OpenAI chat format works; change it with
 *   LLM_URL, LLM_MODEL and LLM_API_KEY in .env (Groq by default).
 *
 * The LLM only says which ideas each answer asserts. The points come from the
 * game rules (js/game.js): expected numbers, trap numbers, minIdeas, 0 to 2.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Rules = require(path.join(__dirname, '..', 'js', 'game.js'));
const G = require(path.join(__dirname, '..', 'js', 'grader-prompt.js'));

const URL = process.env.LLM_URL || 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'openai/gpt-oss-120b';
const KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
const PAUSE_MS = 2500; // stays under free-tier limits of about 30 requests per minute

const files = process.argv.slice(2);
if (!files.length) files.push(path.join(__dirname, 'answers', 'case-01.json'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callLLM(messages) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0, response_format: { type: 'json_object' } })
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) || 10;
      console.log(`  (rate limit: waiting ${wait} s)`);
      await sleep(wait * 1000);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(body.error && body.error.message) || 'no details'}`);
    return { text: body.choices[0].message.content, tokens: (body.usage && body.usage.total_tokens) || 0 };
  }
}

function shorten(text, n) {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

async function main() {
  if (!KEY) {
    console.error('No API key. Create a .env file with GROQ_API_KEY=... and run with: node --env-file=.env tests/llm.eval.js');
    process.exit(1);
  }
  console.log(`Model ${MODEL} at ${URL}\n`);

  const rows = [];
  let tokens = 0;
  for (const file of files) {
    const set = JSON.parse(fs.readFileSync(file, 'utf8'));
    const caseData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cases', set.case + '.json'), 'utf8'));
    const per = caseData.rules.score.committeePerQuestion;
    for (const a of set.answers) {
      const q = caseData.committee[a.question];
      const prompt = G.buildPrompt(caseData, a.question, a.text);
      let grading;
      try {
        const reply = await callLLM(prompt.messages);
        tokens += reply.tokens;
        grading = G.parseGrading(reply.text, q, a.text);
      } catch (err) {
        grading = { ok: false, error: err.message };
      }
      // 1 = present, 0 = absent, so that the game rules treat the LLM like a sure similarity.
      const scores = grading.ok ? grading.ideas.map((i) => (i.present ? 1 : 0)) : null;
      rows.push({
        caseId: set.case, index: a.question, text: a.text, note: a.note || '',
        expected: a.expected || {}, grading,
        old: Rules.evaluateAnswer(q, a.text, per),
        llm: Rules.evaluateAnswerSemantic(q, a.text, scores, { high: 0.5, low: 0.5 }, per)
      });
      process.stdout.write('.');
      await sleep(PAUSE_MS);
    }
  }
  console.log('\n');

  console.log('Case     Q   Expected  Keywords  LLM   Answer');
  rows.forEach((r) => {
    const want = typeof r.expected.points === 'number' ? r.expected.points : '–';
    const mark = (p) => (want !== '–' && p !== want ? `${p}✗` : `${p} `);
    const fail = r.grading.ok ? '' : ` [LLM failed: ${r.grading.error}]`;
    console.log(`${r.caseId}  Q${r.index + 1}  ${String(want).padEnd(8)}  ${mark(r.old.points).padEnd(8)}  ${mark(r.llm.points).padEnd(4)}  ${shorten(r.text, 60)}${fail}`);
  });

  const count = (method) => {
    const e = { points: 0, graded: 0, found: 0, missed: 0, ideas: 0 };
    rows.forEach((r) => {
      const res = r[method];
      if (typeof r.expected.points === 'number') { e.graded++; if (res.points !== r.expected.points) e.points++; }
      (r.expected.ideas || []).forEach((want, i) => {
        if (want === null || want === undefined) return;
        e.ideas++;
        if (res.ideas[i].hit && !want) e.found++;
        if (!res.ideas[i].hit && want) e.missed++;
      });
    });
    return e;
  };
  const show = (name, e) => console.log(`${name.padEnd(10)} ${String(e.points).padStart(2)} / ${e.graded} answers wrong   ${e.found} ideas wrongly found · ${e.missed} wrongly missed (of ${e.ideas})`);
  console.log('\nErrors against the expected grades');
  show('Keywords', count('old'));
  show('LLM', count('llm'));

  const failures = rows.filter((r) => !r.grading.ok).length;
  const refused = rows.reduce((n, r) => n + (r.grading.ok ? r.grading.ideas.filter((i) => i.said && !i.quoteFound).length : 0), 0);
  console.log(`\nLLM calls failed: ${failures} (keywords used instead) · ideas refused for a quote not in the answer: ${refused} · tokens used: ${tokens}`);

  const wrong = rows.filter((r) => typeof r.expected.points === 'number' && r.llm.points !== r.expected.points);
  if (wrong.length) {
    console.log('\nWhere the LLM disagrees with the expected grade:');
    wrong.forEach((r) => {
      console.log(`\n  ${r.caseId} Q${r.index + 1} (${r.note}) expected ${r.expected.points}, LLM ${r.llm.points}: "${shorten(r.text, 90)}"`);
      if (r.grading.ok) {
        r.grading.ideas.forEach((i, j) => {
          const veto = r.llm.ideas[j].vetoedBy ? ` · vetoed by ${r.llm.ideas[j].vetoedBy}` : '';
          console.log(`    idea ${j}: ${i.present ? 'present' : 'absent'}${i.said && !i.quoteFound ? ' (quote not found)' : ''}${i.quote ? ` "${shorten(i.quote, 60)}"` : ''}${veto}`);
        });
        console.log(`    feedback: ${r.grading.feedback}`);
      }
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
