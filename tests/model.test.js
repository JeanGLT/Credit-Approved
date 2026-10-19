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

// Case 02: assumptions that change over time (content/case-02.md).
const wind = {
  capacity: 60, yield: 2803, tariff: 7.6, opex: 1.8, rate: 0.075, totalCost: 93.0,
  minDSCR: 1.30, merchantMinDSCR: 1.50, ppaYears: 12, warrantyYears: 5
};
function windCase(extra) { return Model.computeCase(Object.assign({}, wind, extra)); }

console.log('\nCase 02: sponsor case (69.75m, 18 years, same price and costs forever, meets policy)');
const sponsor2 = windCase({ loan: 69.75, tenor: 18, merchantPrice: 7.6, opexAfter: 1.8 });
check('Production', sponsor2.production, 168.19);
check('Revenue yr 1', sponsor2.revenue, 12.78);
check('CFADS yr 1', sponsor2.cfads, 10.98);
check('Debt service', sponsor2.debtService, 7.19);
check('Min DSCR', sponsor2.dscr, 1.53);
assert.strictEqual(Model.policyStatus(sponsor2, 0.10).status, 'good');

console.log('\nCase 02: bank case at 69.75m over 18 years (merchant 6.0, opex 3.0 from year 6)');
const bank18 = windCase({ loan: 69.75, tenor: 18, merchantPrice: 6.0, opexAfter: 3.0 });
check('DSCR yr 1-5', bank18.years[0].dscr, 1.53);
check('DSCR yr 6-12', bank18.years[5].dscr, 1.36);
check('DSCR yr 13-18', bank18.years[12].dscr, 0.99);
check('Lowest in year', bank18.dscrYear, 13);
check('CFADS yr 13', bank18.years[12].cfads, 7.09);
check('Minimum yr 13', bank18.years[12].minDSCR, 1.50);
check('Max debt 18y', bank18.maxDebt, 45.88);

console.log('\nCase 02: maximum debt by tenor on the bank case');
check('Max debt 12y', windCase({ loan: 56, tenor: 12, merchantPrice: 6.0, opexAfter: 3.0 }).maxDebt, 58.20);
check('Max debt 15y', windCase({ loan: 56, tenor: 15, merchantPrice: 6.0, opexAfter: 3.0 }).maxDebt, 41.73);
check('Only trap 1, 12y', windCase({ loan: 56, tenor: 12, merchantPrice: 6.0, opexAfter: 1.8 }).maxDebt, 65.34);
const best = windCase({ loan: 58, tenor: 12, merchantPrice: 6.0, opexAfter: 3.0 });
check('58m/12y DS', best.debtService, 7.50);
check('58m/12y DSCR', best.dscr, 1.30);
check('58m/12y gearing %', best.gearing * 100, 62.37);

console.log('\nCase 02: policy status, each year against its own minimum');
assert.strictEqual(Model.policyStatus(bank18, 0.10).status, 'bad');
assert.strictEqual(Model.policyStatus(bank18, 0.10).year, 13);
assert.strictEqual(Model.policyStatus(best, 0.10).status, 'good');
// 1.40x is fine on contracted years but amber on merchant years (minimum 1.50x).
const merchantAmber = windCase({ loan: 45.88 * 1.50 / 1.40, tenor: 18, merchantPrice: 6.0, opexAfter: 3.0 });
assert.strictEqual(Model.policyStatus(merchantAmber, 0.10).status, 'warn');
passed++;
console.log('  ✓ worst year decides: red at 0.99x vs 1.50x, amber at 1.40x on merchant years, green at 58m/12y');

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
