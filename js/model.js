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

  // ---------- Assumptions that change over time ----------
  // A case can say that some assumptions change after a given year:
  //   ppaYears + merchantPrice   tariff after the power purchase agreement ends
  //   warrantyYears + opexAfter  operating costs after the warranty ends
  //   merchantMinDSCR            the bank's minimum DSCR on merchant years
  // Without them, assumptions are constant over the tenor (case 01).

  function isMerchantYear(inputs, year) {
    return inputs.ppaYears !== undefined && year > inputs.ppaYears;
  }

  function tariffInYear(inputs, year) {
    return isMerchantYear(inputs, year) ? inputs.merchantPrice : inputs.tariff;
  }

  function opexInYear(inputs, year) {
    var after = inputs.warrantyYears !== undefined && year > inputs.warrantyYears;
    return after ? inputs.opexAfter : inputs.opex;
  }

  function minDSCRInYear(inputs, year) {
    var merchant = isMerchantYear(inputs, year) && inputs.merchantMinDSCR !== undefined;
    return merchant ? inputs.merchantMinDSCR : inputs.minDSCR;
  }

  /*
   * Full case: key metrics plus year-by-year series for the charts.
   *
   * inputs = { capacity, yield, curtailment, tariff, opex,
   *            loan, rate, tenor, totalCost, minDSCR,
   *            optional: ppaYears, merchantPrice, warrantyYears, opexAfter, merchantMinDSCR }
   *
   * dscr is the lowest DSCR over the tenor (dscrYear says when).
   * maxDebt is the largest loan that meets the bank's minimum DSCR in every year.
   */
  function computeCase(inputs) {
    var prod = production(inputs.capacity, inputs.yield, inputs.curtailment || 0);
    var ds = debtService(inputs.loan, inputs.rate, inputs.tenor);
    var schedule = amortisation(inputs.loan, inputs.rate, inputs.tenor);

    var lowest = Infinity;
    var lowestYear = 1;
    var debtServiceCap = Infinity; // highest debt service every year can carry

    var years = schedule.map(function (row) {
      var y = row.year;
      var rev = revenue(prod, tariffInYear(inputs, y));
      var cf = cfads(rev, opexInYear(inputs, y));
      var minimum = minDSCRInYear(inputs, y);
      var dscr = cf / row.debtService;
      if (dscr < lowest - 1e-12) { lowest = dscr; lowestYear = y; }
      debtServiceCap = Math.min(debtServiceCap, cf / minimum);
      return {
        year: y,
        revenue: rev,
        cfads: cf,
        debtService: row.debtService,
        dscr: dscr,
        minDSCR: minimum,
        merchant: isMerchantYear(inputs, y),
        balance: row.closing
      };
    });

    return {
      production: prod,
      revenue: years[0].revenue,
      cfads: years[0].cfads,
      debtService: ds,
      dscr: lowest,
      dscrYear: lowestYear,
      maxDebt: debtServiceCap * annuityFactor(inputs.rate, inputs.tenor),
      gearing: inputs.loan / inputs.totalCost,
      years: years
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

  // Worst status over the tenor, each year against its own minimum.
  // The amber band is the same width below every minimum (e.g. 0.10x).
  function policyStatus(result, warnGap) {
    var rank = { good: 0, warn: 1, bad: 2 };
    var worst = { status: 'good', year: result.years[0].year, dscr: result.years[0].dscr, minDSCR: result.years[0].minDSCR };
    result.years.forEach(function (y) {
      var status = dscrStatus(y.dscr, y.minDSCR, y.minDSCR - warnGap);
      if (rank[status] > rank[worst.status]) {
        worst = { status: status, year: y.year, dscr: y.dscr, minDSCR: y.minDSCR };
      }
    });
    return worst;
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
    dscrStatus: dscrStatus,
    policyStatus: policyStatus
  };

  // Works both in the browser (window.Model) and in Node (require).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Model;
  } else {
    root.Model = Model;
  }
})(typeof window !== 'undefined' ? window : this);
