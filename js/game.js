/*
 * game.js — game rules, state and screen flow.
 *
 * Part 1 (pure functions): outcome, score and gauge rules. They read their
 * thresholds from the case file, so a new case brings its own rules.
 * They are covered by tests/game.test.js.
 *
 * Part 2 (browser only): loads the case file, keeps track of what the
 * player has chosen, and connects model.js (numbers) to ui.js (display).
 */
(function (root) {
  'use strict';

  // ======================================================================
  // Part 1 — rules
  // ======================================================================

  var GAUGE_START = 50;
  var GAUGE_POINT = 10; // one gauge point in the case file = 10 out of 100

  /*
   * Which outcome does a proposal lead to?
   *   decline / approve (as requested) / right (conditions that fix sizing) / weak
   */
  function outcomeKey(caseData, proposal) {
    if (proposal.decision === 'decline') return 'decline';
    if (proposal.decision === 'approve') return 'approve';
    var rule = caseData.rules.rightConditions;
    var smallEnough = proposal.loan <= rule.maxLoan + 1e-9;
    var supported = rule.orAnyCondition.some(function (id) { return proposal.conditions[id]; });
    return smallEnough || supported ? 'right' : 'weak';
  }

  /*
   * Score out of 10, based on what the player had in the control center
   * and in the proposal at the moment they sent it.
   *
   * proposal = { decision, loan, conditions: { id: true }, assumptions: { yield, curtailment, ... } }
   */
  function evaluateProposal(caseData, proposal) {
    var rules = caseData.rules.score;
    var key = outcomeKey(caseData, proposal);

    var traps = rules.traps.map(function (trap) {
      var value = proposal.assumptions[trap.input];
      var hit = trap.test === 'max' ? value <= trap.value : value >= trap.value;
      return {
        id: trap.id,
        label: trap.label,
        input: trap.input,
        test: trap.test,
        target: trap.value,
        value: value,
        hit: hit,
        points: hit ? trap.points : 0,
        max: trap.points
      };
    });

    var decisionMax = Math.max.apply(null, Object.keys(rules.decision).map(function (k) { return rules.decision[k]; }));
    var decision = { points: rules.decision[key], max: decisionMax };

    // Extra-credit conditions only count when the player approves with conditions.
    var ticked = proposal.decision === 'conditions'
      ? rules.bonusConditions.filter(function (id) { return proposal.conditions[id]; })
      : [];
    var bonus = {
      ticked: ticked,
      points: ticked.length * rules.bonusPerCondition,
      max: rules.bonusConditions.length * rules.bonusPerCondition
    };

    var total = traps.reduce(function (sum, t) { return sum + t.points; }, 0) + decision.points + bonus.points;
    var max = traps.reduce(function (sum, t) { return sum + t.max; }, 0) + decision.max + bonus.max;

    return {
      outcomeKey: key,
      outcome: caseData.outcomes[key],
      traps: traps,
      decision: decision,
      bonus: bonus,
      total: total,
      max: max
    };
  }

  // New gauge values after an outcome, kept between 0 and 100.
  function applyGauges(gauges, deltas) {
    var next = {};
    Object.keys(gauges).forEach(function (k) {
      var value = gauges[k] + (deltas[k] || 0) * GAUGE_POINT;
      next[k] = Math.max(0, Math.min(100, value));
    });
    return next;
  }

  var Rules = {
    GAUGE_START: GAUGE_START,
    GAUGE_POINT: GAUGE_POINT,
    outcomeKey: outcomeKey,
    evaluateProposal: evaluateProposal,
    applyGauges: applyGauges
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Rules;
    return; // Node (tests): stop here, no browser below.
  }

  // ======================================================================
  // Part 2 — browser game
  // ======================================================================

  var CASE_URL = 'cases/case-01.json';

  var state = {
    caseData: null,
    assumptions: null,   // { yield, curtailment (%), tariff, opex } — control center values
    decision: null,      // 'approve' | 'conditions' | 'decline'
    conditionalLoan: null, // amount typed with "Approve with conditions"
    conditions: {},      // condition id → true when ticked
    justification: '',
    submitted: null,     // frozen copy of the proposal when sent to committee
    answers: [],         // committee answers
    selfScores: [],      // committee self-assessment (0–2), not part of the score
    gauges: { revenue: GAUGE_START, risk: GAUGE_START, credibility: GAUGE_START }
  };

  // ---------- Model inputs ----------

  function sponsorAssumptions() {
    var s = state.caseData.model.sponsorCase;
    return { yield: s.yield, curtailment: s.curtailment, tariff: s.tariff, opex: s.opex };
  }

  // Conditions only apply with "Approve with conditions".
  function activeConditions() {
    if (state.decision !== 'conditions') return {};
    return state.conditions;
  }

  // Loan: editable only with "Approve with conditions", otherwise the amount requested.
  function currentLoan() {
    return state.decision === 'conditions' ? state.conditionalLoan : state.caseData.proposal.requestedLoan;
  }

  // Interest rate: base rate plus any margin added by a ticked condition.
  function currentRate() {
    var rate = state.caseData.model.fixed.rate;
    var active = activeConditions();
    state.caseData.proposal.conditions.forEach(function (c) {
      if (c.rateIncrease && active[c.id]) rate += c.rateIncrease;
    });
    return rate;
  }

  // Turn screen values into the units model.js expects (curtailment % → fraction).
  function modelInputs(assumptions, loan, rate) {
    var fixed = state.caseData.model.fixed;
    return {
      capacity: fixed.capacity,
      totalCost: fixed.totalCost,
      tenor: fixed.tenor,
      minDSCR: fixed.minDSCR,
      yield: assumptions.yield,
      curtailment: assumptions.curtailment / 100,
      tariff: assumptions.tariff,
      opex: assumptions.opex,
      loan: loan,
      rate: rate
    };
  }

  // ---------- Redraw ----------

  // Called after every change: recompute both cases and refresh the screen.
  function refresh() {
    var data = state.caseData;
    var fixed = data.model.fixed;
    var rate = currentRate();
    var loan = currentLoan();

    var current = Model.computeCase(modelInputs(state.assumptions, loan, rate));
    var sponsor = Model.computeCase(modelInputs(sponsorAssumptions(), data.model.sponsorCase.loan, fixed.rate));
    var status = Model.dscrStatus(current.dscr, fixed.minDSCR, fixed.warnDSCR);

    var params = Object.assign({}, fixed, { loan: loan, rate: rate });

    UI.setInputValues(data.model.inputs, state.assumptions, sponsorAssumptions());
    UI.renderFixed(params);
    UI.renderMetrics(current, sponsor, params, status);
    UI.updateCharts(current, sponsor, fixed.minDSCR, status);
    UI.setProposalState({
      decision: state.decision,
      loan: loan,
      loanConfig: data.proposal.loan,
      conditions: state.conditions,
      editable: state.decision === 'conditions'
    });
    UI.renderProposalPreview(state.decision, current, params, status);
  }

  function setAssumption(key, value) {
    state.assumptions[key] = value;
    refresh();
  }

  function resetToSponsor() {
    state.assumptions = sponsorAssumptions();
    refresh();
  }

  // ---------- Proposal ----------

  var proposalHandlers = {
    decision: function (id) { state.decision = id; refresh(); },
    loan: function (value) { state.conditionalLoan = value; refresh(); },
    condition: function (id, checked) { state.conditions[id] = checked; refresh(); },
    justification: function (text) { state.justification = text; },
    submit: submitProposal
  };

  function submitProposal() {
    if (!state.decision) return;
    var proposal = {
      decision: state.decision,
      loan: currentLoan(),
      rate: currentRate(),
      conditions: Object.assign({}, activeConditions()),
      assumptions: Object.assign({}, state.assumptions),
      justification: state.justification.trim()
    };
    // The score is fixed now, from what the player had on screen.
    proposal.evaluation = evaluateProposal(state.caseData, proposal);
    state.submitted = proposal;
    state.answers = [];
    state.selfScores = [];

    UI.renderRecap(state.caseData, proposal);
    UI.showScreen('committee');
    askQuestion(0);
  }

  // ---------- Committee ----------

  function askQuestion(index) {
    var questions = state.caseData.committee;
    UI.renderQuestion({
      question: questions[index],
      index: index,
      total: questions.length,
      scale: state.caseData.committeeScale,
      onAnswer: function (text) { state.answers[index] = text; },
      onSelfScore: function (score) { state.selfScores[index] = score; },
      onNext: function () {
        if (index + 1 < questions.length) askQuestion(index + 1);
        else showResult();
      }
    });
  }

  // ---------- Result ----------

  function showResult() {
    var evaluation = state.submitted.evaluation;
    var before = Object.assign({}, state.gauges);
    state.gauges = applyGauges(state.gauges, evaluation.outcome.gauges);

    UI.renderResult({
      caseData: state.caseData,
      proposal: state.submitted,
      evaluation: evaluation,
      gaugesBefore: before,
      gaugesAfter: state.gauges,
      gaugePoint: GAUGE_POINT,
      answers: state.answers,
      selfScores: state.selfScores,
      onRestart: function () { window.location.reload(); }
    });
    UI.showScreen('result');
    // Let the screen appear first so the gauges visibly move.
    setTimeout(function () { UI.setGauges(state.gauges); }, 300);
  }

  // ---------- Start ----------

  function startCase() {
    var data = state.caseData;
    state.assumptions = sponsorAssumptions();
    state.conditionalLoan = data.proposal.requestedLoan;

    UI.renderCaseHeader(data);
    UI.renderDocuments(data.documents);
    UI.renderInputs(data.model.inputs, setAssumption);
    UI.renderProposal(data.proposal, proposalHandlers);
    UI.setGauges(state.gauges);
    UI.showScreen('case');
    UI.initCharts(data.model.fixed.tenor);
    refresh();

    document.getElementById('reset-btn').addEventListener('click', resetToSponsor);
  }

  function init() {
    fetch(CASE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.caseData = data;
        UI.renderWelcome(data, startCase);
      })
      .catch(function () {
        UI.renderLoadError(
          'The case file could not be loaded. If you opened index.html directly, ' +
          'start a local server instead (see README).'
        );
      });
  }

  // Exposed for debugging in the browser console.
  root.Game = { state: state, refresh: refresh, rules: Rules };

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : this);
