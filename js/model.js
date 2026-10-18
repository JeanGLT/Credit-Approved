/*
 * model.js — financial calculations for Credit-Approved.
 *
 * Pure functions only: no DOM, no game state. Every number the player sees
 * in the control center comes from here, so this file is covered by
 * tests/model.test.js.
 *
 * Units:
 *   capacity     MWp
 *   yield        kWh/kWp per year
 *   curtailment  fraction (0.10 = 10%)
 *   tariff       US cents per kWh
 *   opex, loan   USD m
 *   rate         fraction (0.07 = 7%)
 *   production   GWh
 */
(function (root) {
  'use strict';

  // Present value of 1 per year over `years` years: (1 - (1 + r)^-n) / r
  function annuityFactor(rate, years) {
    if (rate === 0) return years;
    return (1 - Math.pow(1 + rate, -years)) / rate;
  }

  // Constant annual payment (interest + principal) that repays `loan` over `years`.
  function debtService(loan, rate, years) {
    return loan / annuityFactor(rate, years);
  }

  function production(capacity, specificYield, curtailment) {
    return (capacity * specificYield * (1 - curtailment)) / 1000;
  }

  function revenue(productionGWh, tariff) {
    return (productionGWh * tariff) / 100;
  }

  // Cash flow available for debt service (tax ignored in this version).
  function cfads(revenueUSDm, opex) {
    return revenueUSDm - opex;
  }

  // Largest loan whose debt service keeps the DSCR at `minDSCR`.
  function maxDebt(cfadsUSDm, minDSCR, rate, years) {
    return (cfadsUSDm / minDSCR) * annuityFactor(rate, years);
  }

  // Year-by-year loan balance for an annuity loan.
  function amortisation(loan, rate, years) {
    var payment = debtService(loan, rate, years);
    var balance = loan;
    var rows = [];
    for (var year = 1; year <= years; year++) {
      var interest = balance * rate;
      var principal = payment - interest;
      var closing = balance - principal;
      // Clear floating-point dust on the final repayment.
      if (year === years) closing = 0;
      rows.push({
        year: year,
        opening: balance,
        interest: interest,
        principal: principal,
        debtService: payment,
        closing: closing
      });
      balance = closing;
    }
    return rows;
  }

  /*
   * Full case: key metrics plus 15-year series for the charts.
   * Assumptions are constant over the tenor in this version.
   *
   * inputs = { capacity, yield, curtailment, tariff, opex,
   *            loan, rate, tenor, totalCost, minDSCR }
   */
  function computeCase(inputs) {
    var prod = production(inputs.capacity, inputs.yield, inputs.curtailment);
    var rev = revenue(prod, inputs.tariff);
    var cf = cfads(rev, inputs.opex);
    var ds = debtService(inputs.loan, inputs.rate, inputs.tenor);
    var schedule = amortisation(inputs.loan, inputs.rate, inputs.tenor);

    return {
      production: prod,
      revenue: rev,
      cfads: cf,
      debtService: ds,
      dscr: cf / ds,
      maxDebt: maxDebt(cf, inputs.minDSCR, inputs.rate, inputs.tenor),
      gearing: inputs.loan / inputs.totalCost,
      years: schedule.map(function (row) {
        return {
          year: row.year,
          cfads: cf,
          debtService: row.debtService,
          dscr: cf / row.debtService,
          balance: row.closing
        };
      })
    };
  }

  // Traffic-light status for a DSCR: green at or above the minimum,
  // amber between `warnFloor` and the minimum, red below.
  // Rounded to 2 decimals first so the colour always matches the figure shown.
  function dscrStatus(dscr, minDSCR, warnFloor) {
    var shown = Math.round(dscr * 100) / 100;
    if (shown >= minDSCR) return 'good';
    if (shown >= warnFloor) return 'warn';
    return 'bad';
  }

  var Model = {
    annuityFactor: annuityFactor,
    debtService: debtService,
    production: production,
    revenue: revenue,
    cfads: cfads,
    maxDebt: maxDebt,
    amortisation: amortisation,
    computeCase: computeCase,
    dscrStatus: dscrStatus
  };

  // Works both in the browser (window.Model) and in Node (require).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
  } else {
    root.Model = Model;
  }
})(typeof window !== 'undefined' ? window : this);
