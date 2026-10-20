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
test('Approve as requested (DSCR 1.20x on the bank case) → rejected by Risk', () => assert.strictEqual(outcome('approve', 28.5, []), 'risk'));
test('26.0m + DSRA + sweep + lock-up (weight 5) → right', () =>
  assert.strictEqual(outcome('conditions', 26.0, ['dsra', 'sweep', 'lockup']), 'right'));
test('Loan exactly 26.3 → right', () => assert.strictEqual(outcome('conditions', 26.3, []), 'right'));
test('28.5m + guarantee + DSRA + sweep + lock-up (weight 5) → right', () =>
  assert.strictEqual(outcome('conditions', 28.5, ['guarantee', 'dsra', 'sweep', 'lockup']), 'right'));
test('28.5m + DSRA, no guarantee → rejected by Risk', () => assert.strictEqual(outcome('conditions', 28.5, ['dsra']), 'risk'));
test('26.4m → rejected by Risk', () => assert.strictEqual(outcome('conditions', 26.4, []), 'risk'));
test('30.4m (80% gearing) even with the guarantee → rejected by Risk', () => assert.strictEqual(outcome('conditions', 30.4, ['guarantee']), 'risk'));
test('20.0m (76% of the 26.3m allowed) → too conservative', () => assert.strictEqual(outcome('conditions', 20.0, ['dsra']), 'conservative'));
test('22.5m (86% of the 26.3m allowed) → right', () => assert.strictEqual(outcome('conditions', 22.5, ['dsra']), 'right'));
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
test('Guarantee at 28.5m is needed: +1, capped at 4', () =>
  assert.strictEqual(condPoints(28.5, ['guarantee', 'dsra', 'sweep', 'lockup']), 4));
test('Guarantee at 26.0m is redundant: −1, no clean bonus → 2', () =>
  assert.strictEqual(condPoints(26.0, ['guarantee', 'dsra', 'sweep', 'lockup']), 2));
test('DSRA + matching 80% gearing → 1 − 1 = 0', () => assert.strictEqual(condPoints(26.0, ['dsra', 'gearing80']), 0));
test('Only useless conditions → floored at 0', () =>
  assert.strictEqual(condPoints(26.0, ['gearing80', 'completion', 'yieldstudy']), 0));
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
test('Rejected by Risk → 50 / 50 / 30, condition effects ignored', () =>
  assert.deepStrictEqual(gaugesAfter(proposal('conditions', 28.5, ['dsra', 'gearing80'], BANK)), { revenue: 50, risk: 50, credibility: 30 }));
test('Right with a useless yield study → credibility +2 −1 = 60', () =>
  assert.strictEqual(gaugesAfter(proposal('conditions', 26.0, ['yieldstudy'], BANK)).credibility, 60));
test('Lost to competitor → 50 / 50 / 30, condition effects ignored', () =>
  assert.deepStrictEqual(gaugesAfter(proposal('conditions', 26.0, ['guarantee', 'dsra', 'sweep'], BANK)),
    { revenue: 50, risk: 50, credibility: 30 }));
test('Gauges stay between 0 and 100', () =>
  assert.deepStrictEqual(Rules.applyGauges({ revenue: 90, risk: 5, credibility: 50 }, { revenue: 3, risk: -3, credibility: 0 }),
    { revenue: 100, risk: 0, credibility: 50 }));

// ---------------------------------------------------------------------
// Case 02: outcome checks in order, traps found by conditions, policy sizing
const case2 = require(path.join(__dirname, '..', 'cases', 'case-02.json'));
const BANK2 = { yield: 2803, tariff: 7.6, merchantPrice: 6.0, opex: 1.8, opexAfter: 3.0 };
const SPONSOR2 = { yield: 2803, tariff: 7.6, merchantPrice: 7.6, opex: 1.8, opexAfter: 1.8, tenor: 18 };

function p2(decision, loan, tenor, ids, assumptions) {
  const conditions = {};
  (ids || []).forEach((id) => { conditions[id] = true; });
  return { decision, loan, rate: 0.075, conditions, assumptions: Object.assign({}, assumptions || BANK2, { tenor }) };
}
function out2(...args) { return Rules.outcomeKey(case2, p2(...args)); }
function ev2(...args) { return Rules.evaluateProposal(case2, p2(...args)); }

console.log('\nCase 02: outcomes');
test('Policy max debt on the bank case: 58.20 over 12 years, 45.88 over 18', () => {
  assert.ok(Math.abs(Rules.policyMaxDebt(case2, p2('conditions', 58, 12), case2.rules.outcomeChecks[3].bankCase) - 58.20) < 0.01);
  assert.ok(Math.abs(Rules.policyMaxDebt(case2, p2('conditions', 45, 18), case2.rules.outcomeChecks[3].bankCase) - 45.88) < 0.01);
});
test('58m / 12y + syndication + full KYC + DSRA → right', () =>
  assert.strictEqual(out2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra']), 'right'));
test('45m / 18y + full KYC + DSRA + lock-up → right (acceptable)', () =>
  assert.strictEqual(out2('conditions', 45, 18, ['kycfull', 'dsra', 'lockup']), 'right'));
test('58m / 12y + full KYC, no syndication → sent back by Portfolio Management', () =>
  assert.strictEqual(out2('conditions', 58, 12, ['kycfull']), 'limit'));
test('58m / 12y + syndication + KYC on the parent only → blocked by Compliance', () =>
  assert.strictEqual(out2('conditions', 58, 12, ['syndicate', 'kycparent']), 'compliance'));
test('58m / 18y + syndication + full KYC → rejected by Risk (policy max 45.9 over 18 years)', () =>
  assert.strictEqual(out2('conditions', 58, 18, ['syndicate', 'kycfull']), 'risk'));
test('65m / 12y (only trap 1 found) + syndication + full KYC → rejected by Risk', () =>
  assert.strictEqual(out2('conditions', 65, 12, ['syndicate', 'kycfull']), 'risk'));
test('45m / 12y + full KYC → too conservative (58.2m allowed over 12 years)', () =>
  assert.strictEqual(out2('conditions', 45, 12, ['kycfull']), 'conservative'));
test('Risk comes first: 69.75m / 18y with every condition → rejected by Risk', () =>
  assert.strictEqual(out2('conditions', 69.75, 18, ['syndicate', 'kycfull', 'dsra']), 'risk'));
test('Best answer + lock-up (weight 7) → still right', () =>
  assert.strictEqual(out2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'lockup']), 'right'));
test('Best answer + comfort letter → still right, but the letter costs a point', () => {
  assert.strictEqual(out2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'comfort']), 'right');
  assert.strictEqual(ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'comfort']).conditions.points, 2);
});
test('Best answer + lock-up + comfort letter (weight 8) → lost to competitor', () =>
  assert.strictEqual(out2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'lockup', 'comfort']), 'lost'));
test('Dividends from year 1 → −1 and credibility −1', () => {
  const ev = ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dividends']);
  assert.strictEqual(ev.conditions.items.find((i) => i.id === 'dividends').points, -1);
  assert.strictEqual(ev.gauges.deltas.credibility, 1);
});
test('Approve as requested → rejected by Risk; decline → decline', () => {
  assert.strictEqual(out2('approve', 69.75, 18, [], SPONSOR2), 'risk');
  assert.strictEqual(out2('decline', 69.75, 18, []), 'decline');
});

console.log('\nCase 02: traps, conditions and score');
test('All four traps found → 5 / 5', () => {
  const ev = ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra']);
  assert.deepStrictEqual(ev.traps.map((t) => t.points), [2, 1, 1, 1]);
});
test('Trap 1 also counts with a 12-year tenor and the sponsor\'s merchant price', () => {
  const ev = ev2('conditions', 58, 12, [], Object.assign({}, BANK2, { merchantPrice: 7.6 }));
  assert.strictEqual(ev.traps[0].hit, true);
});
test('Sponsor case, approve as requested → no trap found', () => {
  const ev = ev2('approve', 69.75, 18, [], SPONSOR2);
  assert.deepStrictEqual(ev.traps.map((t) => t.hit), [false, false, false, false]);
});
test('Trap 3 counts with a loan of USD 45m, without syndication', () =>
  assert.strictEqual(ev2('conditions', 45, 18, ['kycfull']).traps[2].hit, true));
test('Syndication is redundant at USD 45m → −1', () => {
  const item = ev2('conditions', 45, 18, ['syndicate', 'kycfull']).conditions.items.find((i) => i.id === 'syndicate');
  assert.strictEqual(item.points, -1);
});
test('Conditions: syndication + full KYC + DSRA + lock-up → 4, capped at 3', () =>
  assert.strictEqual(ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'lockup']).conditions.points, 3));
test('Syndication above the limit → +1', () => {
  const item = ev2('conditions', 58, 12, ['syndicate', 'kycfull']).conditions.items.find((i) => i.id === 'syndicate');
  assert.strictEqual(item.points, 1);
});
test('Tenor cut weighs 1 on the sponsor, loan cut 2', () => {
  const b = ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra']).burden;
  assert.strictEqual(b.total, 6);
});
test('Perfect game → 20 / 20', () => {
  const ev = ev2('conditions', 58, 12, ['syndicate', 'kycfull', 'dsra', 'lockup']);
  const s = Rules.finalScore(case2, ev, case2.committee.map((q) => q.goodAnswer));
  assert.strictEqual(s.max, 20);
  assert.strictEqual(s.total, 20);
});
test('Committee good answers each score 2', () =>
  case2.committee.forEach((q) => assert.strictEqual(Rules.evaluateAnswer(q, q.goodAnswer, 2).points, 2, q.question)));
test('Q4 "Sure, let\'s skip it" → 0', () =>
  assert.strictEqual(Rules.evaluateAnswer(case2.committee[3], "Sure, let's keep it simple and close.", 2).points, 0));
test('Q3 "We can hold 45m and syndicate the rest" → 2', () =>
  assert.strictEqual(Rules.evaluateAnswer(case2.committee[2], 'Only up to the group limit: we hold 45m and syndicate the rest.', 2).points, 2));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
