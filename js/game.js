/*
 * game.js — game flow and state.
 *
 * Loads the case file, keeps track of what the player has chosen, and
 * connects the two other files: it asks model.js for the numbers and
 * hands them to ui.js to display.
 */
(function () {
  'use strict';

  var CASE_URL = 'cases/case-01.json';

  var state = {
    caseData: null,
    assumptions: null,  // { yield, curtailment (%), tariff, opex } — what the player has typed
    loan: null,         // USD m, set by the proposal panel (step 3)
    conditions: {},     // condition id → true when ticked (step 3)
    gauges: { revenue: 50, risk: 50, credibility: 50 }
  };

  // ---------- Model inputs ----------

  function sponsorAssumptions() {
    var s = state.caseData.model.sponsorCase;
    return { yield: s.yield, curtailment: s.curtailment, tariff: s.tariff, opex: s.opex };
  }

  // Interest rate: base rate plus any margin added by a ticked condition.
  function currentRate() {
    var rate = state.caseData.model.fixed.rate;
    state.caseData.proposal.conditions.forEach(function (c) {
      if (c.rateIncrease && state.conditions[c.id]) rate += c.rateIncrease;
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

    var current = Model.computeCase(modelInputs(state.assumptions, state.loan, rate));
    var sponsor = Model.computeCase(modelInputs(sponsorAssumptions(), data.model.sponsorCase.loan, fixed.rate));
    var status = Model.dscrStatus(current.dscr, fixed.minDSCR, fixed.warnDSCR);

    var params = Object.assign({}, fixed, { loan: state.loan, rate: rate });

    UI.setInputValues(data.model.inputs, state.assumptions, sponsorAssumptions());
    UI.renderFixed(params);
    UI.renderMetrics(current, sponsor, params, status);
    UI.updateCharts(current, sponsor, fixed.minDSCR, status);
  }

  function setAssumption(key, value) {
    state.assumptions[key] = value;
    refresh();
  }

  function resetToSponsor() {
    state.assumptions = sponsorAssumptions();
    refresh();
  }

  // ---------- Screens ----------

  function startCase() {
    var data = state.caseData;
    state.assumptions = sponsorAssumptions();
    state.loan = data.proposal.requestedLoan;

    UI.renderCaseHeader(data);
    UI.renderDocuments(data.documents);
    UI.renderInputs(data.model.inputs, setAssumption);
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

  // Exposed for the proposal panel (step 3) and for debugging in the console.
  window.Game = { state: state, refresh: refresh };

  document.addEventListener('DOMContentLoaded', init);
})();
