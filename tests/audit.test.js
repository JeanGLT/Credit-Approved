/*
 * Consistency audit of every case: tries tens of thousands of proposals
 * (decisions, amounts, tenors, assumptions, every set of conditions) and
 * checks that the outcome, the score, the result table and the answer key
 * agree. Run with:  node tests/audit.test.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'js/game.js'));
const M = require(path.join(ROOT, 'js/model.js'));
const cases = { 'case-01': require(path.join(ROOT, 'cases/case-01.json')), 'case-02': require(path.join(ROOT, 'cases/case-02.json')) };
const issues = {};
function flag(caseId, kind, detail) {
  const key = caseId + ' · ' + kind;
  if (!issues[key]) issues[key] = { count: 0, examples: [] };
  issues[key].count++;
  if (issues[key].examples.length < 3) issues[key].examples.push(detail);
}
function subsets(ids) { const out = []; for (let m = 0; m < (1 << ids.length); m++) out.push(ids.filter((_, i) => m & (1 << i))); return out; }

// Same judging as the result table (ui.js), reproduced here
function judgeInput(cfg, value, best, range) {
  const eps = cfg.step / 2;
  if (!range) return Math.abs(value - best) <= eps + 1e-9;
  if (value >= range.min - 1e-9 && value <= range.max + 1e-9) return true;
  if (range.okMin !== undefined && value >= range.okMin - 1e-9 && value <= range.okMax + 1e-9) return 'partial';
  return false;
}

for (const [id, c] of Object.entries(cases)) {
  const fixed = c.model.fixed;
  const hasTenor = !!c.model.inputs.tenor;
  const policy = c.rules.outcomeChecks.find((x) => x.type === 'policy');
  const bank = policy.bankCase;
  const toUi = (a) => { const o = Object.assign({}, a); if (c.model.inputs.curtailment) o.curtailment = (a.curtailment ?? 0) * (c.model.inputs.curtailment.percent ? 100 : 1); return o; };
  const sponsorA = {}; Object.keys(c.model.inputs).forEach((k) => { sponsorA[k] = c.model.sponsorCase[k]; });
  const bankA = Object.assign({}, sponsorA, toUi(bank));
  const condIds = c.proposal.conditions.map((x) => x.id);
  const tenors = hasTenor ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 18] : [fixed.tenor];
  const loans = id === 'case-01'
    ? [15, 20, 22, 22.4, 23, 25, 26, 26.3, 26.4, 27, 28.5, 28.6, 30.4]
    : [20, 30, 34, 38, 40, 40.1, 41, 44, 45, 46, 49, 50, 52, 55, 58, 58.2, 58.3, 60, 65, 69.75];
  const prudent = id === 'case-01' ? { yield: 1300, curtailment: 15 } : { merchantPrice: 5.0, opexAfter: 3.5 };
  const half = id === 'case-01' ? { yield: 1430 } : { merchantPrice: 6.0 };
  const assumptionSets = { bank: bankA, sponsor: sponsorA, prudent: Object.assign({}, bankA, prudent), oneTrap: Object.assign({}, sponsorA, half) };
  let n = 0;
  for (const [aName, A] of Object.entries(assumptionSets)) for (const tenor of tenors) for (const loan of loans) for (const decision of ['approve', 'conditions', 'decline']) {
    const condSets = decision === 'conditions' ? subsets(condIds) : [[]];
    for (const ids of condSets) {
      n++;
      const conditions = {}; ids.forEach((x) => { conditions[x] = true; });
      const effLoan = decision === 'approve' ? c.proposal.requestedLoan : loan;
      const effTenor = decision === 'approve' ? (hasTenor ? c.model.sponsorCase.tenor : fixed.tenor) : tenor;
      if (decision === 'approve' && (loan !== loans[0] || tenor !== tenors[0])) continue;
      const assumptions = Object.assign({}, A, hasTenor ? { tenor: effTenor } : {});
      let rate = fixed.rate; c.proposal.conditions.forEach((x) => { if (x.rateIncrease && conditions[x.id]) rate += x.rateIncrease; });
      const p = { decision, loan: effLoan, rate, conditions, assumptions, tenor: effTenor };
      const ev = R.evaluateProposal(c, p);
      const sc = R.finalScore(c, ev, c.committee.map((q) => q.goodAnswer));
      const tag = `${aName} ${decision} ${effLoan}m/${effTenor}y [${ids.join(',')}] → ${ev.outcomeKey} ${sc.total}/${sc.max}`;

      if (sc.max !== 20) flag(id, 'max score is not 20', tag);
      if (sc.total < 0 || sc.total > 20) flag(id, 'score out of range', tag);
      if (!c.outcomes[ev.outcomeKey]) flag(id, 'outcome without text', tag);
      if (c.rules.score.decision[ev.outcomeKey] === undefined) flag(id, 'outcome without decision points', tag);

      // Independent recomputation of each policy criterion
      const maxDebt = R.policyMaxDebt(c, p, bank);
      const covered = (policy.unlessAny || []).some((x) => conditions[x] && decision === 'conditions');
      const gearingOk = effLoan / fixed.totalCost <= fixed.maxGearing + 1e-9;
      const tenorOk = policy.maxTenor === undefined || effTenor <= policy.maxTenor;
      const sizingOk = covered || effLoan <= maxDebt + 1e-6;
      const limit = c.rules.outcomeChecks.find((x) => x.type === 'maxLoan');
      const limitOk = !limit || effLoan <= limit.max + 1e-9 || (decision === 'conditions' && limit.unlessAny.some((x) => conditions[x]));
      const kyc = c.rules.outcomeChecks.find((x) => x.type === 'requireCondition');
      const kycOk = !kyc || (decision === 'conditions' && conditions[kyc.condition]);
      const burdenOk = ev.burden.total <= c.rules.competition.maxBurden;
      const cons = c.rules.outcomeChecks.find((x) => x.type === 'conservative');
      const consOk = !cons || effLoan >= cons.minShare * maxDebt - 1e-6;
      const allOk = gearingOk && tenorOk && sizingOk && limitOk && kycOk && burdenOk && consOk;
      if (decision !== 'decline') {
        if (allOk && ev.outcomeKey !== 'right' && ev.outcomeKey !== 'approve') flag(id, 'all criteria met but not right', tag);
        if (!allOk && (ev.outcomeKey === 'right' || ev.outcomeKey === 'approve')) flag(id, 'right although a criterion fails', tag);
        if (!(gearingOk && tenorOk && sizingOk) && ev.outcomeKey !== 'risk') flag(id, 'policy breach not rejected by Risk', tag);
      }
      if (sc.total === 20 && ev.outcomeKey !== 'right') flag(id, '20/20 without the right outcome', tag);
      if (sc.total === 20 && ev.traps.some((t) => !t.hit)) flag(id, '20/20 with a trap missed', tag);
      if (ev.outcomeKey === 'right' && ev.decision.points === 4 && (c.rules.score.decisionNeedsTraps || []).some((tid) => !ev.traps.find((t) => t.id === tid).hit)) flag(id, 'decision 4/4 without the sizing traps', tag);
      // Trap points vs ✓ in the table for the same control center value
      ev.traps.forEach((t) => t.tests.filter((x) => x.kind === 'input').forEach((x) => {
        const best = c.answerKey.best;
        const tick = judgeInput(c.model.inputs[x.input], x.value, best.assumptions[x.input], (best.ranges || {})[x.input]);
        if ((tick === true) !== x.hit) flag(id, 'trap points and table mark disagree', tag + ' ' + x.input + '=' + x.value);
      }));

      // Result table vs outcome
      if (decision === 'conditions') {
        const range = R.bestLoanRange(c, p);
        const loanTick = !range.tenorRefused && effLoan >= range.min - 0.05 && effLoan <= range.max + 0.05;
        if (ev.outcomeKey === 'right' && !loanTick) flag(id, 'right outcome but loan ✗ in table', tag + ` range ${range.min.toFixed(2)}-${range.max.toFixed(2)}`);
        if ((ev.outcomeKey === 'risk' && !sizingOk && gearingOk && tenorOk) && loanTick) flag(id, 'rejected for sizing but loan ✓ in table', tag);
        if (ev.outcomeKey === 'conservative' && loanTick) flag(id, 'too conservative but loan ✓ in table', tag);
        const ranges = (c.answerKey.best.ranges || {});
        if (hasTenor) {
          const t = judgeInput(c.model.inputs.tenor, effTenor, c.answerKey.best.assumptions.tenor, ranges.tenor);
          if (ev.outcomeKey === 'right' && t !== true) flag(id, 'right outcome but tenor not ✓', tag);
          if (t === true && !tenorOk) flag(id, 'tenor ✓ in table but refused by Risk', tag);
        }
        // Conditions the table expects vs their points
        ev.conditions.items.forEach((it) => {
          const cfg = c.proposal.conditions.find((x) => x.id === it.id);
          const wanted = cfg.redundantIfLoanAtMost !== undefined ? effLoan > cfg.redundantIfLoanAtMost + 1e-9 : c.answerKey.best.conditions.includes(it.id);
          if (wanted && it.points < 0) flag(id, 'condition expected in table but scored −1', tag + ' ' + it.id);
          if (!wanted && it.points > 0) flag(id, 'condition scored +1 but not expected in table', tag + ' ' + it.id);
        });
      }
    }
  }
  console.log(id, 'combinations tried:', n);

  // Best answer of the answer key
  const best = c.answerKey.best;
  const bc = {}; best.conditions.forEach((x) => { bc[x] = true; });
  const bp = { decision: best.decision, loan: best.loan, rate: fixed.rate, conditions: bc, assumptions: Object.assign({}, best.assumptions), tenor: best.assumptions.tenor ?? fixed.tenor };
  const bev = R.evaluateProposal(c, bp);
  const bsc = R.finalScore(c, bev, c.committee.map((q) => q.goodAnswer));
  console.log(id, 'best answer →', bev.outcomeKey, bsc.total + '/' + bsc.max, 'weight', bev.burden.total + '/' + bev.burden.max);
  if (bev.outcomeKey !== 'right' || bsc.total !== 20) flag(id, 'best answer is not right 20/20', JSON.stringify(bp));
  Object.keys(best.assumptions).forEach((k) => {
    const j = judgeInput(c.model.inputs[k], best.assumptions[k], best.assumptions[k], (best.ranges || {})[k]);
    if (j !== true) flag(id, 'best answer value not ✓ in its own table', k);
  });
  const br = R.bestLoanRange(c, bp);
  if (!(best.loan >= br.min - 0.05 && best.loan <= br.max + 0.05)) flag(id, 'best loan outside its own range', `${best.loan} vs ${br.min}-${br.max}`);
  // Committee: every good answer scores 2, an empty answer 0
  c.committee.forEach((q, i) => {
    if (R.evaluateAnswer(q, q.goodAnswer, 2).points !== 2) flag(id, 'good answer does not score 2', 'Q' + (i + 1));
    if (R.evaluateAnswer(q, '', 2).points !== 0) flag(id, 'empty answer scores', 'Q' + (i + 1));
  });
}
console.log('\n=== ISSUES ===');
const keys = Object.keys(issues);
if (!keys.length) console.log('none');
keys.forEach((k) => { console.log(`\n${k}  (${issues[k].count})`); issues[k].examples.forEach((e) => console.log('   e.g. ' + e)); });
process.exit(keys.length ? 1 : 0);
