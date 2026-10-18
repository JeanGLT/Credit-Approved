/*
 * Tests for the game rules in js/game.js (outcome, score, gauges).
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

console.log('\nOutcomes');

test('Decline → decline', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('decline', 28.5, [], BANK)), 'decline');
});
test('Approve as requested → approve', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('approve', 28.5, [], BANK)), 'approve');
});
test('Conditions, loan 26.0 → right', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('conditions', 26.0, [], BANK)), 'right');
});
test('Conditions, loan exactly 26.3 → right', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('conditions', 26.3, [], BANK)), 'right');
});
test('Conditions, loan 28.5 + sponsor guarantee → right', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('conditions', 28.5, ['guarantee'], BANK)), 'right');
});
test('Conditions, loan 28.5 + higher margin only → weak', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('conditions', 28.5, ['margin'], BANK)), 'weak');
});
test('Conditions, loan 26.4 → weak', () => {
  assert.strictEqual(Rules.outcomeKey(caseData, proposal('conditions', 26.4, [], BANK)), 'weak');
});

console.log('\nScore');

test('Best answer: bank case, 26.0m, DSRA + sweep + lock-up → 10/10', () => {
  const r = Rules.evaluateProposal(caseData, proposal('conditions', 26.0, ['dsra', 'sweep', 'lockup'], BANK));
  assert.strictEqual(r.total, 10);
  assert.strictEqual(r.max, 10);
});
test('Sponsor case, approve as requested → 0/10', () => {
  const r = Rules.evaluateProposal(caseData, proposal('approve', 28.5, [], SPONSOR));
  assert.strictEqual(r.total, 0);
});
test('Both traps found, decline → 2 + 2 + 1 = 5', () => {
  const r = Rules.evaluateProposal(caseData, proposal('decline', 28.5, [], BANK));
  assert.strictEqual(r.total, 5);
});
test('Both traps found, weak conditions (margin + DSRA) → 2 + 2 + 1 + 1 = 6', () => {
  const r = Rules.evaluateProposal(caseData, proposal('conditions', 28.5, ['margin', 'dsra'], BANK));
  assert.strictEqual(r.outcomeKey, 'weak');
  assert.strictEqual(r.total, 6);
});
test('Trap thresholds: yield 1450 and curtailment 8% count, 1460 and 7.5% do not', () => {
  const edge = Rules.evaluateProposal(caseData, proposal('decline', 28.5, [], { yield: 1450, curtailment: 8 }));
  assert.deepStrictEqual(edge.traps.map((t) => t.hit), [true, true]);
  const miss = Rules.evaluateProposal(caseData, proposal('decline', 28.5, [], { yield: 1460, curtailment: 7.5 }));
  assert.deepStrictEqual(miss.traps.map((t) => t.hit), [false, false]);
});
test('Bonus conditions only count with "Approve with conditions"', () => {
  const r = Rules.evaluateProposal(caseData, proposal('decline', 28.5, ['dsra', 'sweep', 'lockup'], BANK));
  assert.strictEqual(r.bonus.points, 0);
});

console.log('\nGauges');

test('Right conditions: 50/50/50 → 70/60/70', () => {
  const g = Rules.applyGauges({ revenue: 50, risk: 50, credibility: 50 }, caseData.outcomes.right.gauges);
  assert.deepStrictEqual(g, { revenue: 70, risk: 60, credibility: 70 });
});
test('Approve as requested: 50/50/50 → 70/80/30', () => {
  const g = Rules.applyGauges({ revenue: 50, risk: 50, credibility: 50 }, caseData.outcomes.approve.gauges);
  assert.deepStrictEqual(g, { revenue: 70, risk: 80, credibility: 30 });
});
test('Gauges stay between 0 and 100', () => {
  const g = Rules.applyGauges({ revenue: 90, risk: 5, credibility: 50 }, { revenue: 3, risk: -3, credibility: 0 });
  assert.deepStrictEqual(g, { revenue: 100, risk: 0, credibility: 50 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
