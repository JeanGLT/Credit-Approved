/*
 * Evaluation of the semantic method against your own grading.
 * Loads the real model, so unlike the other tests it needs one install:
 *   npm install
 *   node tests/semantic.eval.js                       (tests/answers/case-01.json)
 *   node tests/semantic.eval.js tests/answers/case-02.json
 *
 * Answer file: { "case": "case-01", "answers": [ { "question": 0, "text": "...",
 *   "expected": { "points": 0-2, "ideas": [true | false | null, ...] }, "note": "..." } ] }
 * One entry in `ideas` per idea of the question, in order; null = not graded.
 * The debug panel's JSON export (?debug=1) has the same shape: fill `expected`.
 *
 * Prints, for the keyword method (official) and the semantic method:
 * answers with the wrong points, ideas wrongly found / wrongly missed, then
 * the similarity spread and the thresholds with the fewest errors.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Rules = require(path.join(__dirname, '..', 'js', 'game.js'));
const Semantic = require(path.join(__dirname, '..', 'js', 'semantic.js'));

const file = path.resolve(process.argv[2] || path.join(__dirname, 'answers', 'case-01.json'));
const FEW_ANSWERS = 30;

function shorten(text, n) {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

// Points wrong, ideas wrongly found (false positives), wrongly missed (false negatives).
function errors(rows, evaluate) {
  const e = { points: 0, graded: 0, found: 0, missed: 0, ideas: 0 };
  rows.forEach((row) => {
    const r = evaluate(row);
    if (typeof row.expected.points === 'number') {
      e.graded++;
      if (r.points !== row.expected.points) e.points++;
    }
    (row.expected.ideas || []).forEach((want, i) => {
      if (want === null || want === undefined) return;
      e.ideas++;
      if (r.ideas[i].hit && !want) e.found++;
      if (!r.ideas[i].hit && want) e.missed++;
    });
  });
  return e;
}

function spread(values) {
  if (!values.length) return '—';
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return `min ${Math.min(...values).toFixed(2)} · avg ${avg.toFixed(2)} · max ${Math.max(...values).toFixed(2)} (${values.length})`;
}

async function main() {
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  const caseData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cases', set.case + '.json'), 'utf8'));
  const per = caseData.rules.score.committeePerQuestion;

  let lib;
  try {
    lib = await import('@huggingface/transformers');
  } catch (err) {
    console.error('The model library is not installed. Run "npm install" in the project folder first.');
    process.exit(1);
  }
  console.log(`Loading ${Semantic.MODEL} (downloaded once, then cached)…`);
  await Semantic.load({ lib, timeout: 10 * 60 * 1000 });

  const rows = [];
  for (const a of set.answers) {
    const question = caseData.committee[a.question];
    if (!question) throw new Error(`No question ${a.question} in ${set.case}`);
    const matches = await Semantic.matchIdeas(a.text, question.analysis.ideas);
    rows.push({
      question,
      index: a.question,
      text: a.text,
      expected: a.expected || {},
      scores: matches.map((m) => (m ? m.score : undefined))
    });
  }

  const oldMethod = (row) => Rules.evaluateAnswer(row.question, row.text, per);
  const newMethod = (t) => (row) =>
    Rules.evaluateAnswerSemantic(row.question, row.text, row.scores, t || Rules.semanticThresholds(caseData, row.question), per);

  console.log(`\n${set.case}: ${rows.length} answers from ${path.relative(process.cwd(), file)}\n`);
  console.log('Q   Expected  Old  New  Answer');
  rows.forEach((row) => {
    const o = oldMethod(row).points;
    const n = newMethod()(row).points;
    const want = typeof row.expected.points === 'number' ? row.expected.points : '–';
    const flag = (p) => (want !== '–' && p !== want ? `${p}✗` : `${p} `);
    console.log(`Q${row.index + 1}  ${String(want).padEnd(8)}  ${flag(o).padEnd(3)}  ${flag(n).padEnd(3)}  ${shorten(row.text, 70)}`);
  });

  const show = (name, e) =>
    console.log(`${name.padEnd(22)} ${String(e.points).padStart(2)} / ${e.graded} answers   ` +
      `${String(e.found).padStart(2)} wrongly found · ${String(e.missed).padStart(2)} wrongly missed (of ${e.ideas} ideas)`);
  console.log('\nErrors against your grading');
  show('Keywords (official)', errors(rows, oldMethod));
  show('Semantic (current)', errors(rows, newMethod()));

  const yes = [];
  const no = [];
  rows.forEach((row) => (row.expected.ideas || []).forEach((want, i) => {
    if (typeof row.scores[i] !== 'number' || want === null || want === undefined) return;
    (want ? yes : no).push(row.scores[i]);
  }));
  console.log('\nSimilarity of ideas you graded');
  console.log(`  present: ${spread(yes)}`);
  console.log(`  absent:  ${spread(no)}`);

  // Every pair of thresholds on a 0.05 grid; fewest idea errors, then fewest
  // points errors, then closest to the defaults.
  const d = Rules.SEMANTIC_DEFAULTS;
  const grid = [];
  for (let h = 30; h <= 90; h += 5) {
    for (let l = 10; l <= h; l += 5) {
      const t = { high: h / 100, low: l / 100 };
      const e = errors(rows, newMethod(t));
      grid.push({ t, e, cost: e.found + e.missed, distance: Math.abs(t.high - d.high) + Math.abs(t.low - d.low) });
    }
  }
  grid.sort((a, b) => a.cost - b.cost || a.e.points - b.e.points || a.distance - b.distance);
  console.log('\nSuggested thresholds (same thresholds for every question)');
  grid.slice(0, 5).forEach((g) =>
    console.log(`  high ${g.t.high.toFixed(2)} · low ${g.t.low.toFixed(2)}   ` +
      `${g.e.found + g.e.missed} idea errors · ${g.e.points} points errors`));
  if (rows.length < FEW_ANSWERS) {
    console.log(`\nOnly ${rows.length} answers: too few to trust these thresholds (aim for ${FEW_ANSWERS} or more, good and bad).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
