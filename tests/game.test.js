/*
 * Tests for the game rules in js/game.js: outcome, conditions, competition,
 * score out of 20, gauges and the analysis of committee answers.
 * Run with:  node tests/game.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const Rules = require(path.join(__dirname, '..', 'js', 'game.js'));
const caseData = require(path.join(__dirname, '..', 'cases', 'case-01.json'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

const SPONSOR = { yield: 1750, curtailment: 0, tariff: 7.0, opex: 0.75 };
const BANK = { yield: 1430, curtailment: 10, tariff: 7.0, opex: 0.75 };

function proposal(decision, loan, conditionIds, assumptions) {
  const conditions = {};
  (conditionIds || []).forEach((id) => { conditions[id] = true; });
  return { decision, loan, conditions, assumptions };
}

function outcome(decision, loan, ids) {
  return Rules.outcomeKey(caseData, proposal(decision, loan, ids, BANK));
}

const Q = caseData.committee;
function answerPoints(i, text) {
  return Rules.evaluateAnswer(Q[i], text, 2).points;
}

// ---------------------------------------------------------------------
console.log('\nOutcomes');

test('Decline → decline', () => assert.strictEqual(outcome('decline', 28.5, []), 'decline'));
test('Approve as requested → approve', () => assert.strictEqual(outcome('approve', 28.5, []), 'approve'));
test('26.0m + DSRA + sweep + lock-up (weight 5) → right', () =>
  assert.strictEqual(outcome('conditions', 26.0, ['dsra', 'sweep', 'lockup']), 'right'));
test('Loan exactly 26.3 → right', () => assert.strictEqual(outcome('conditions', 26.3, []), 'right'));
test('28.5m + guarantee + DSRA + sweep + lock-up (weight 5) → right', () =>
  assert.strictEqual(outcome('conditions', 28.5, ['guarantee', 'dsra', 'sweep', 'lockup']), 'right'));
test('28.5m + higher margin → weak', () => assert.strictEqual(outcome('conditions', 28.5, ['margin']), 'weak'));
test('26.4m → weak', () => assert.strictEqual(outcome('conditions', 26.4, []), 'weak'));
test('26.0m + guarantee + DSRA + sweep + lock-up (weight 7) → lost to competitor', () =>
  assert.strictEqual(outcome('conditions', 26.0, ['guarantee', 'dsra', 'sweep', 'lockup']), 'lost'));
test('28.5m + completion guarantee + yield study + DSRA (weight 5) → not lost', () =>
  assert.notStrictEqual(outcome('conditions', 28.5, ['completion', 'yieldstudy', 'dsra']), 'lost'));

// ---------------------------------------------------------------------
console.log('\nConditions score (out of 4)');

function condPoints(loan, ids) {
  return Rules.evaluateProposal(caseData, proposal('conditions', loan, ids, BANK)).conditions.points;
}

test('DSRA + sweep + lock-up, nothing useless → 3 + clean bonus = 4', () =>
  assert.strictEqual(condPoints(26.0, ['dsra', 'sweep', 'lockup']), 4));
test('Guarantee at 28.5m is needed: 0 and does not spoil the clean bonus → 4', () =>
  assert.strictEqual(condPoints(28.5, ['guarantee', 'dsra', 'sweep', 'lockup']), 4));
test('Guarantee at 26.0m is redundant: −1, no clean bonus → 2', () =>
  assert.strictEqual(condPoints(26.0, ['guarantee', 'dsra', 'sweep', 'lockup']), 2));
test('DSRA + higher margin → 1 − 1 = 0', () => assert.strictEqual(condPoints(26.0, ['dsra', 'margin']), 0));
test('Only useless conditions → floored at 0', () =>
  assert.strictEqual(condPoints(26.0, ['margin', 'completion', 'yieldstudy']), 0));
test('No conditions counted with "Decline"', () => {
  const r = Rules.evaluateProposal(caseData, proposal('decline', 28.5, ['dsra', 'sweep', 'lockup'], BANK));
  assert.strictEqual(r.conditions.points, 0);
});

// ---------------------------------------------------------------------
console.log('\nNumbers in answers, whatever the format');

function hasNumber(text, value) {
  return Rules.extractNumbers(text).some((n) => Math.abs(n.value - value) < 1e-9);
}

['1,430', '1.430', '1 430', '1430', '1 430', '1430kWh/kWp'].forEach((t) =>
  test(`"${t}" reads as 1430`, () => assert.ok(hasNumber(`yield of ${t}`, 1430))));
['26m', '26 m', '26 million', 'USD 26m', 'USD26m', '26mn', '26,000,000', '26.000.000', '26.0m'].forEach((t) =>
  test(`"${t}" reads as 26`, () => assert.ok(hasNumber(`offer ${t}`, 26))));
['1.20x', '1,20x', '1.2x', '1.20 x'].forEach((t) =>
  test(`"${t}" reads as 1.2`, () => assert.ok(hasNumber(`DSCR ${t}`, 1.2))));
test('"10%" and "10 percent" are percentages', () => {
  assert.ok(Rules.extractNumbers('10%').some((n) => n.value === 10 && n.percent));
  assert.ok(Rules.extractNumbers('10 percent').some((n) => n.value === 10 && n.percent));
});

// ---------------------------------------------------------------------
console.log('\nCommittee answers (0 to 2 each)');

test('Q1 good answer from the case file → 2', () => assert.strictEqual(answerPoints(0, Q[0].goodAnswer), 2));
test('Q1 "I used the IE P90 of 1.430" → 2', () => assert.strictEqual(answerPoints(0, 'I used the IE P90 of 1.430'), 2));
test('Q1 idea without the number → 1', () =>
  assert.strictEqual(answerPoints(0, 'The independent engineer view, not the sponsor.'), 1));
test('Q1 sponsor figure only → 0', () =>
  assert.strictEqual(answerPoints(0, 'The sponsor yield of 1,750 because Ninh Thuan is sunny.'), 0));

test('Q2 good answer from the case file → 2', () => assert.strictEqual(answerPoints(1, Q[1].goodAnswer), 2));
test('Q2 "10% haircut, cash sweep and a DSRA" → 2', () =>
  assert.strictEqual(answerPoints(1, 'We took a 10% haircut, plus a cash sweep and a DSRA.'), 2));
test('Q2 two ideas, no number → 1', () =>
  assert.strictEqual(answerPoints(1, 'We stressed curtailment and added a debt service reserve account.'), 1));
test('Q2 one idea only → 0', () => assert.strictEqual(answerPoints(1, 'EVN is a state utility so it will pay.'), 0));

test('Q3 good answer from the case file → 2', () => assert.strictEqual(answerPoints(2, Q[2].goodAnswer), 2));
test('Q3 "1,20x is below policy, we offer 26 millions" → 2', () =>
  assert.strictEqual(answerPoints(2, '1,20x is below policy, we offer 26 millions'), 2));
test('Q3 firm with a way out, no number → 1', () =>
  assert.strictEqual(answerPoints(2, 'It breaches our minimum, but we can offer a smaller loan.'), 1));
test('Q3 empty answer → 0', () => assert.strictEqual(answerPoints(2, ''), 0));

// ---------------------------------------------------------------------
console.log('\nScore out of 20');

function total(p, answers) {
  const ev = Rules.evaluateProposal(caseData, p);
  return Rules.finalScore(caseData, ev, answers);
}

test('Perfect game → 20 / 20', () => {
  const s = total(proposal('conditions', 26.0, ['dsra', 'sweep', 'lockup'], BANK), Q.map((q) => q.goodAnswer));
  assert.strictEqual(s.max, 20);
  assert.strictEqual(s.total, 20);
});
test('Sponsor case, approve as requested, empty answers → 0 / 20', () =>
  assert.strictEqual(total(proposal('approve', 28.5, [], SPONSOR), ['', '', '']).total, 0));
test('Both traps, decline, good answers → 6 + 1 + 0 + 6 = 13', () =>
  assert.strictEqual(total(proposal('decline', 28.5, [], BANK), Q.map((q) => q.goodAnswer)).total, 13));
test('Trap thresholds: 1450 and 8% count, 1460 and 7.5% do not', () => {
  const edge = Rules.evaluateProposal(caseData, proposal('decline', 28.5, [], { yield: 1450, curtailment: 8 }));
  assert.deepStrictEqual(edge.traps.map((t) => t.hit), [true, true]);
  const miss = Rules.evaluateProposal(caseData, proposal('decline', 28.5, [], { yield: 1460, curtailment: 7.5 }));
  assert.deepStrictEqual(miss.traps.map((t) => t.hit), [false, false]);
});

// ---------------------------------------------------------------------
console.log('\nGauges');

function gaugesAfter(p) {
  const ev = Rules.evaluateProposal(caseData, p);
  return Rules.applyGauges({ revenue: 50, risk: 50, credibility: 50 }, ev.gauges.deltas);
}

test('Right conditions → 70 / 60 / 70', () =>
  assert.deepStrictEqual(gaugesAfter(proposal('conditions', 26.0, ['dsra'], BANK)), { revenue: 70, risk: 60, credibility: 70 }));
test('Weak with higher margin → revenue +2 +1 = 80', () =>
  assert.strictEqual(gaugesAfter(proposal('conditions', 28.5, ['margin'], BANK)).revenue, 80));
test('Right with a useless yield study → credibility +2 −1 = 60', () =>
  assert.strictEqual(gaugesAfter(proposal('conditions', 26.0, ['yieldstudy'], BANK)).credibility, 60));
test('Lost to competitor → 50 / 50 / 30, condition effects ignored', () =>
  assert.deepStrictEqual(gaugesAfter(proposal('conditions', 26.0, ['guarantee', 'dsra', 'sweep', 'margin'], BANK)),
    { revenue: 50, risk: 50, credibility: 30 }));
test('Gauges stay between 0 and 100', () =>
  assert.deepStrictEqual(Rules.applyGauges({ revenue: 90, risk: 5, credibility: 50 }, { revenue: 3, risk: -3, credibility: 0 }),
    { revenue: 100, risk: 0, credibility: 50 }));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
