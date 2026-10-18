/*
 * Tests for js/model.js. Run with:  node tests/model.test.js
 * Uses only Node's built-in assert module: nothing to install.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const Model = require(path.join(__dirname, '..', 'js', 'model.js'));

const TOLERANCE = 0.01;
let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) <= TOLERANCE;
  const line = `${label.padEnd(16)} expected ${expected.toFixed(2).padStart(6)}  got ${actual.toFixed(4).padStart(8)}`;
  if (ok) {
    passed++;
    console.log(`  ✓ ${line}`);
  } else {
    failed++;
    console.log(`  ✗ ${line}`);
  }
}

// Fixed inputs from the brief: tariff 7.0, opex 0.75, rate 7%.
const base = {
  capacity: 50,
  tariff: 7.0,
  opex: 0.75,
  rate: 0.07,
  tenor: 15,
  totalCost: 38.0,
  minDSCR: 1.30
};

const rows = [
  { name: 'Sponsor case',          yield: 1750, curtailment: 0.00, loan: 28.5, production: 87.50, revenue: 6.13, cfads: 5.38, debtService: 3.13, dscr: 1.72 },
  { name: 'Engineer P90',          yield: 1430, curtailment: 0.00, loan: 28.5, production: 71.50, revenue: 5.01, cfads: 4.26, debtService: 3.13, dscr: 1.36 },
  { name: 'Bank case at 28.5m',    yield: 1430, curtailment: 0.10, loan: 28.5, production: 64.35, revenue: 4.50, cfads: 3.75, debtService: 3.13, dscr: 1.20, maxDebt: 26.30 },
  { name: 'Bank case at 26.0m',    yield: 1430, curtailment: 0.10, loan: 26.0, production: 64.35, revenue: 4.50, cfads: 3.75, debtService: 2.85, dscr: 1.32 }
];

rows.forEach((row) => {
  console.log(`\n${row.name} (yield ${row.yield}, curtailment ${row.curtailment * 100}%, loan ${row.loan})`);
  const result = Model.computeCase(Object.assign({}, base, {
    yield: row.yield,
    curtailment: row.curtailment,
    loan: row.loan
  }));
  check('Production', result.production, row.production);
  check('Revenue', result.revenue, row.revenue);
  check('CFADS', result.cfads, row.cfads);
  check('Debt service', result.debtService, row.debtService);
  check('DSCR', result.dscr, row.dscr);
  if (row.maxDebt !== undefined) check('Max debt 1.30x', result.maxDebt, row.maxDebt);
});

// Sanity checks on the amortisation schedule.
console.log('\nAmortisation schedule (28.5m, 7%, 15 years)');
const schedule = Model.amortisation(28.5, 0.07, 15);
check('Years', schedule.length, 15);
check('Year 1 interest', schedule[0].interest, 1.995);
check('Final balance', schedule[14].closing, 0);
const totalPrincipal = schedule.reduce((sum, r) => sum + r.principal, 0);
check('Total repaid', totalPrincipal, 28.5);

// DSCR traffic light.
console.log('\nDSCR colour');
assert.strictEqual(Model.dscrStatus(1.32, 1.30, 1.20), 'good');
assert.strictEqual(Model.dscrStatus(1.30, 1.30, 1.20), 'good');
assert.strictEqual(Model.dscrStatus(1.25, 1.30, 1.20), 'warn');
assert.strictEqual(Model.dscrStatus(1.19, 1.30, 1.20), 'bad');
// The bank case DSCR is 1.1998x, shown as "1.20x": it must be amber, not red.
assert.strictEqual(Model.dscrStatus(1.1998, 1.30, 1.20), 'warn');
passed++;
console.log('  ✓ green ≥ 1.30x, amber 1.20–1.30x, red < 1.20x (on the rounded figure)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
