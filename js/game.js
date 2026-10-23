/*
 * game.js — game rules, state and flow.
 *
 * Part 1 (pure functions): outcome, score, gauges and the analysis of the
 * committee answers. Every threshold comes from the case file, so a new
 * case brings its own rules. Covered by tests/game.test.js.
 *
 * Part 2 (browser only): loads the case file, keeps track of what the
 * player has chosen, runs the committee chat, and connects model.js
 * (numbers) to ui.js (display).
 */
(function (root) {
  'use strict';

  // ======================================================================
  // Part 1 — rules
  // ======================================================================

  var GAUGE_START = 50;
  var GAUGE_POINT = 10; // one gauge point in the case file = 10 out of 100

  // The financial model, in the browser (window.Model) or in Node (tests).
  var ModelLib = typeof module !== 'undefined' && module.exports ? require('./model.js') : root.Model;

  // ---------- The proposal as the rules see it ----------

  // Tenor: an input in some cases (case 02), fixed in others (case 01).
  function requestedTenor(caseData) {
    var s = caseData.model.sponsorCase;
    return s.tenor !== undefined ? s.tenor : caseData.model.fixed.tenor;
  }

  function proposalTenor(caseData, proposal) {
    return proposal.assumptions.tenor !== undefined ? proposal.assumptions.tenor : caseData.model.fixed.tenor;
  }

  function ticked(proposal, id) {
    return proposal.decision === 'conditions' && !!proposal.conditions[id];
  }

  // ---------- Conditions ----------

  // How each ticked condition counts, given the loan amount.
  function conditionItems(caseData, proposal) {
    if (proposal.decision !== 'conditions') return [];
    return caseData.proposal.conditions
      .filter(function (c) { return proposal.conditions[c.id]; })
      .map(function (c) {
        var redundant = c.redundantIfLoanAtMost !== undefined && proposal.loan <= c.redundantIfLoanAtMost + 1e-9;
        return {
          id: c.id,
          label: c.label,
          role: redundant ? 'redundant' : c.role,
          points: redundant ? c.redundantPoints : c.points,
          burden: c.burden || 0,
          gauges: c.gauges || {},
          reason: redundant ? c.redundantReason : c.reason
        };
      });
  }

  /*
   * Conditions score: points of each ticked condition (+1 good, −1 useless),
   * plus a "clean structure" bonus when at least one good condition and no
   * useless one are ticked (if the case gives one). Kept between 0 and the max.
   */
  function scoreConditions(caseData, items) {
    var rules = caseData.rules.score.conditions;
    var raw = items.reduce(function (sum, i) { return sum + i.points; }, 0);
    var anyGood = items.some(function (i) { return i.points > 0; });
    var anyBad = items.some(function (i) { return i.points < 0; });
    var clean = !!rules.cleanBonus && anyGood && !anyBad;
    if (clean) raw += rules.cleanBonus;
    return { points: Math.max(0, Math.min(rules.max, raw)), max: rules.max, clean: clean, items: items };
  }

  // Weight of the term sheet for the sponsor: conditions, plus any cut to the
  // amount or to the tenor requested.
  function burden(caseData, proposal, items) {
    var comp = caseData.rules.competition;
    var lines = items.filter(function (i) { return i.burden; }).map(function (i) {
      return { label: i.label, burden: i.burden };
    });
    if (proposal.decision === 'conditions') {
      var tenor = proposalTenor(caseData, proposal);
      if (comp.tenorCutBurden && tenor < requestedTenor(caseData)) {
        lines.unshift({ label: 'Tenor cut below ' + requestedTenor(caseData) + ' years', burden: comp.tenorCutBurden });
      }
      if (proposal.loan < caseData.proposal.requestedLoan - 1e-9) {
        lines.unshift({ label: 'Loan cut below USD ' + caseData.proposal.requestedLoan + 'm', burden: comp.loanCutBurden });
      }
    }
    var total = lines.reduce(function (sum, l) { return sum + l.burden; }, 0);
    return { total: total, max: comp.maxBurden, lines: lines, explain: comp.explain };
  }

  // ---------- Outcome ----------

  // Largest loan within the bank's policy on the case's official bank case,
  // for the tenor and rate of the proposal.
  function policyMaxDebt(caseData, proposal, bankCase) {
    var inputs = Object.assign({}, caseData.model.fixed, bankCase, {
      tenor: proposalTenor(caseData, proposal),
      rate: proposal.rate !== undefined ? proposal.rate : caseData.model.fixed.rate,
      loan: proposal.loan
    });
    return ModelLib.computeCase(inputs).maxDebt;
  }

  function anyTicked(proposal, ids) {
    return (ids || []).some(function (id) { return ticked(proposal, id); });
  }

  // Does one outcome check fail for this proposal? (A failing check decides the outcome.)
  function checkFails(caseData, proposal, check, items) {
    switch (check.type) {
      case 'policy': {
        // Risk: gearing above the bank's maximum, a tenor beyond what the bank
        // accepts, or debt too large for the bank's minimum DSCR on the official
        // bank case (unless a condition covers it).
        var gearing = proposal.loan / caseData.model.fixed.totalCost;
        if (gearing > caseData.model.fixed.maxGearing + 1e-9) return true;
        if (check.maxTenor !== undefined && proposalTenor(caseData, proposal) > check.maxTenor) return true;
        if (anyTicked(proposal, check.unlessAny)) return false;
        return proposal.loan > policyMaxDebt(caseData, proposal, check.bankCase) + 1e-6;
      }
      case 'conservative':
        // The bank could lend much more within policy: the sponsor takes the competitor's offer.
        return proposal.loan < check.minShare * policyMaxDebt(caseData, proposal, check.bankCase) - 1e-6;
      case 'burden':
        return burden(caseData, proposal, items).total > caseData.rules.competition.maxBurden;
      case 'requireCondition':
        return !ticked(proposal, check.condition);
      case 'maxLoan':
        return proposal.loan > check.max + 1e-9 && !anyTicked(proposal, check.unlessAny);
      default:
        throw new Error('Unknown outcome check: ' + check.type);
    }
  }

  /*
   * decline, or the first check that fails, in the order of a real deal
   * (Risk, Portfolio Management, the sponsor, Compliance), or right
   * ("approve" when the request itself passes every check).
   */
  function outcomeKey(caseData, proposal) {
    if (proposal.decision === 'decline') return 'decline';
    var items = conditionItems(caseData, proposal);
    var checks = caseData.rules.outcomeChecks;
    for (var i = 0; i < checks.length; i++) {
      if (checkFails(caseData, proposal, checks[i], items)) return checks[i].outcome;
    }
    return proposal.decision === 'approve' ? 'approve' : 'right';
  }

  /*
   * Loan range shown as the best answer on the result screen, for the tenor
   * the player chose: from the "too conservative" floor to the largest loan
   * within policy (higher when a condition such as a sponsor guarantee
   * lifts the sizing limit, never above the maximum gearing).
   */
  function bestLoanRange(caseData, proposal) {
    var checks = caseData.rules.outcomeChecks;
    var policy = checks.filter(function (c) { return c.type === 'policy'; })[0];
    var floor = checks.filter(function (c) { return c.type === 'conservative'; })[0];
    var fixed = caseData.model.fixed;
    var cap = fixed.maxGearing * fixed.totalCost;
    if (policy.maxTenor !== undefined && proposalTenor(caseData, proposal) > policy.maxTenor) {
      return { min: 0, max: 0, tenorRefused: true }; // no amount is acceptable over this tenor
    }
    var max = Math.min(policyMaxDebt(caseData, proposal, policy.bankCase), cap);
    var min = floor ? floor.minShare * max : 0;
    if (anyTicked(proposal, policy.unlessAny)) max = Math.min(Math.max(max, caseData.proposal.requestedLoan), cap);
    return { min: min, max: max };
  }

  // Gauge moves: the outcome, plus the conditions' own effects if the deal closes.
  function gaugeDeltas(caseData, key, items) {
    var outcome = caseData.outcomes[key];
    var deltas = Object.assign({ revenue: 0, risk: 0, credibility: 0 }, outcome.gauges);
    var sources = [];
    if (outcome.closes) {
      items.forEach(function (i) {
        Object.keys(i.gauges).forEach(function (g) {
          deltas[g] += i.gauges[g];
          sources.push({ gauge: g, delta: i.gauges[g], label: i.label });
        });
      });
    }
    return { deltas: deltas, sources: sources };
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

  // ---------- Traps ----------

  /*
   * A trap is spotted when any of its tests passes:
   *   { input, test: "range", min, max }     a control center value in a range
   *   { input, test: "max" | "min", value }  a control center value
   *   { condition }                          a condition ticked
   *   { loanAtMost }                         the loan amount
   */
  function runTrapTest(caseData, proposal, t) {
    if (t.condition) return { kind: 'condition', condition: t.condition, hit: ticked(proposal, t.condition) };
    if (t.loanAtMost !== undefined) {
      return { kind: 'loan', target: t.loanAtMost, value: proposal.loan, hit: proposal.loan <= t.loanAtMost + 1e-9 };
    }
    var value = t.input === 'tenor' ? proposalTenor(caseData, proposal) : proposal.assumptions[t.input];
    if (t.test === 'range') {
      return { kind: 'input', input: t.input, test: 'range', min: t.min, max: t.max, value: value,
        hit: value >= t.min - 1e-9 && value <= t.max + 1e-9 };
    }
    var hit = t.test === 'max' ? value <= t.value + 1e-9 : value >= t.value - 1e-9;
    return { kind: 'input', input: t.input, test: t.test, target: t.value, value: value, hit: hit };
  }

  function evaluateTrap(caseData, proposal, trap) {
    var tests = (trap.any || [{ input: trap.input, test: trap.test, value: trap.value }]).map(function (t) {
      return runTrapTest(caseData, proposal, t);
    });
    var hit = tests.some(function (t) { return t.hit; });
    return { id: trap.id, label: trap.label, tests: tests, hit: hit, points: hit ? trap.points : 0, max: trap.points };
  }

  // ---------- Proposal score ----------

  /*
   * Everything decided when the player sends the proposal: traps (from the
   * control center at that moment), decision, conditions, outcome, gauges.
   *
   * proposal = { decision, loan, rate, conditions: { id: true }, assumptions: { yield, tenor, ... } }
   */
  function evaluateProposal(caseData, proposal) {
    var rules = caseData.rules.score;
    var key = outcomeKey(caseData, proposal);
    var items = conditionItems(caseData, proposal);
    var decisionMax = Math.max.apply(null, Object.keys(rules.decision).map(function (k) { return rules.decision[k]; }));
    var traps = rules.traps.map(function (trap) { return evaluateTrap(caseData, proposal, trap); });

    // A right decision that the player's own analysis does not support
    // (the traps that size the debt were missed) earns fewer points.
    var decision = { points: rules.decision[key], max: decisionMax, unbacked: false };
    if (key === 'right' && rules.decisionNeedsTraps) {
      var backed = rules.decisionNeedsTraps.every(function (id) {
        return traps.some(function (t) { return t.id === id && t.hit; });
      });
      if (!backed) decision = { points: rules.decisionWithoutTraps, max: decisionMax, unbacked: true };
    }

    return {
      outcomeKey: key,
      outcome: caseData.outcomes[key],
      traps: traps,
      decision: decision,
      conditions: scoreConditions(caseData, items),
      burden: burden(caseData, proposal, items),
      gauges: gaugeDeltas(caseData, key, items),
      tenor: proposalTenor(caseData, proposal)
    };
  }

  // ---------- Committee answers ----------

  // Lower case, no accents, straight quotes, single spaces.
  function normalizeText(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // A variant matches as a whole word or phrase ("ie" does not match "field").
  function containsPhrase(text, phrase) {
    var pattern = escapeRegex(normalizeText(phrase)).replace(/ /g, '\\s+');
    return new RegExp('(^|[^a-z0-9])' + pattern + '($|[^a-z0-9])').test(text);
  }

  /*
   * All numbers written in an answer, whatever the format:
   *   "1,430" "1.430" "1 430" "1430"     → 1430
   *   "1.20x" "1,20x" "1.2"               → 1.2
   *   "26m" "26 m" "26 million" "USD 26m" → 26
   *   "26,000,000"                        → 26000000 and 26 (in millions)
   *   "10%" "10 %" "10 percent"           → 10, marked as a percentage
   */
  function extractNumbers(text) {
    var s = normalizeText(text);
    var prev;
    // Thousands separators: comma, dot or space followed by exactly 3 digits.
    do {
      prev = s;
      s = s.replace(/(\d)[,.](\d{3})(?!\d)/g, '$1$2');
      s = s.replace(/(^|[^\d.,])(\d{1,3})[   ](\d{3})(?![\d.,])/g, '$1$2$3');
    } while (s !== prev);
    // Decimal comma: "1,20" → "1.20".
    s = s.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');

    var found = [];
    var re = /(\d+(?:\.\d+)?)\s*(%|percent|per cent|pct)?/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var value = parseFloat(m[1]);
      var percent = !!m[2];
      found.push({ value: value, percent: percent });
      if (value >= 100000) found.push({ value: value / 1e6, percent: false });
    }
    return found;
  }

  function numberMatches(spec, numbers) {
    return spec.values.some(function (target) {
      var tol = spec.tol !== undefined ? spec.tol : (Math.abs(target) < 10 ? 0.005 : 0.05);
      return numbers.some(function (n) {
        if (spec.unit === '%' && !n.percent) return false;
        return Math.abs(n.value - target) <= tol;
      });
    });
  }

  /*
   * Score one committee answer, using the case's rubric:
   *   0 = misses the point (not enough of the expected ideas)
   *   1 = right idea without the numbers
   *   2 = right idea backed by at least one expected number
   */
  // The first accepted wording of an idea found in the answer, or null.
  function keywordFound(text, idea) {
    for (var i = 0; i < idea.any.length; i++) {
      if (containsPhrase(text, idea.any[i])) return idea.any[i];
    }
    return null;
  }

  function expectedNumbers(analysis, numbers) {
    return analysis.numbers.map(function (spec) {
      return { label: spec.label, hit: numberMatches(spec, numbers) };
    });
  }

  // Same rubric for both methods, once the ideas are decided.
  function answerResult(analysis, ideas, nums, maxPoints) {
    var max = maxPoints === undefined ? 2 : maxPoints;
    var ideasHit = ideas.filter(function (i) { return i.hit; }).length;
    var enoughIdeas = ideasHit >= analysis.minIdeas;
    var anyNumber = nums.some(function (n) { return n.hit; });
    var points = !enoughIdeas ? 0 : anyNumber ? 2 : 1;
    return { points: Math.min(points, max), max: max, ideas: ideas, ideasNeeded: analysis.minIdeas, numbers: nums };
  }

  function evaluateAnswer(question, answer, maxPoints) {
    var analysis = question.analysis;
    var text = normalizeText(answer || '');
    var ideas = analysis.ideas.map(function (idea) {
      return { label: idea.label, hit: keywordFound(text, idea) !== null };
    });
    return answerResult(analysis, ideas, expectedNumbers(analysis, extractNumbers(answer || '')), maxPoints);
  }

  // ---------- Committee answers, semantic method (observation only) ----------

  var SEMANTIC_DEFAULTS = { high: 0.55, low: 0.35 };

  // Global default, then the case's `semantic`, then the question's `analysis.semantic`.
  function semanticThresholds(caseData, question) {
    var t = { high: SEMANTIC_DEFAULTS.high, low: SEMANTIC_DEFAULTS.low };
    [caseData && caseData.semantic, question.analysis.semantic].forEach(function (o) {
      if (!o) return;
      if (o.high !== undefined) t.high = o.high;
      if (o.low !== undefined) t.low = o.low;
    });
    return t;
  }

  // A trap fires when the answer quotes one of its values and none of `unlessAny`.
  function trapNumberResults(analysis, numbers) {
    return (analysis.trapNumbers || []).map(function (trap) {
      var quoted = numberMatches({ values: trap.values, unit: trap.unit, tol: trap.tol }, numbers);
      var excused = numberMatches({ values: trap.unlessAny || [], unit: trap.unit, tol: trap.tol }, numbers);
      return { label: trap.label, fired: quoted && !excused, ideas: trap.ideas || [], feedback: trap.feedback };
    });
  }

  /*
   * Score one committee answer from similarity scores computed elsewhere
   * (js/semantic.js), so this stays a pure function.
   *   similarities: one number per idea (the best match between a sentence of
   *     the answer and the idea's examples), or null when the model is not
   *     available. An idea without a number (no examples) uses keywords alone.
   * Per idea: score ≥ high → found; between low and high → found only with a
   * keyword; below low → missing. Then trap numbers veto the ideas they list.
   */
  function evaluateAnswerSemantic(question, answer, similarities, thresholds, maxPoints) {
    var analysis = question.analysis;
    var t = thresholds || SEMANTIC_DEFAULTS;
    var text = normalizeText(answer || '');
    var numbers = extractNumbers(answer || '');
    var traps = trapNumberResults(analysis, numbers);

    var ideas = analysis.ideas.map(function (idea, i) {
      var keyword = keywordFound(text, idea);
      var score = similarities ? similarities[i] : undefined;
      var zone = typeof score !== 'number' ? null : score >= t.high ? 'high' : score >= t.low ? 'middle' : 'low';
      var hit = zone === null ? keyword !== null : zone === 'high' || (zone === 'middle' && keyword !== null);
      var veto = traps.filter(function (tr) { return tr.fired && tr.ideas.indexOf(i) !== -1; })[0];
      return {
        label: idea.label,
        similarity: zone === null ? null : score,
        zone: zone,
        keyword: keyword,
        vetoedBy: veto ? veto.label : null,
        hit: hit && !veto
      };
    });

    var result = answerResult(analysis, ideas, expectedNumbers(analysis, numbers), maxPoints);
    result.method = similarities ? 'semantic' : 'keywords';
    result.thresholds = t;
    result.trapNumbers = traps;
    return result;
  }

  /*
   * Score one committee answer from an LLM grading (js/grader-prompt.js,
   * parseGrading). The LLM has the last word on ideas: trap numbers do not
   * veto them, since it already tells "1,750 is not credible" from "I used
   * 1,750". Expected numbers, minIdeas and the 0 to 2 scale stay the same.
   * Without a usable grading, falls back on keywords with trap numbers.
   */
  function evaluateAnswerLLM(question, answer, grading, maxPoints) {
    if (!grading || !grading.ok) return evaluateAnswerSemantic(question, answer, null, null, maxPoints);
    var analysis = question.analysis;
    var numbers = extractNumbers(answer || '');
    var ideas = analysis.ideas.map(function (idea, i) {
      var g = grading.ideas[i] || {};
      return { label: idea.label, hit: g.present === true, quote: g.quote || '' };
    });
    var result = answerResult(analysis, ideas, expectedNumbers(analysis, numbers), maxPoints);
    result.method = 'llm';
    result.feedback = grading.feedback || '';
    result.trapNumbers = trapNumberResults(analysis, numbers);
    return result;
  }

  // ---------- Final score ----------

  function finalScore(caseData, evaluation, answers) {
    var per = caseData.rules.score.committeePerQuestion;
    var committee = caseData.committee.map(function (q, i) { return evaluateAnswer(q, answers[i], per); });
    var committeePoints = committee.reduce(function (sum, c) { return sum + c.points; }, 0);
    var trapPoints = evaluation.traps.reduce(function (sum, t) { return sum + t.points; }, 0);
    var trapMax = evaluation.traps.reduce(function (sum, t) { return sum + t.max; }, 0);

    return {
      committee: committee,
      committeePoints: committeePoints,
      committeeMax: caseData.committee.length * per,
      total: trapPoints + evaluation.decision.points + evaluation.conditions.points + committeePoints,
      max: trapMax + evaluation.decision.max + evaluation.conditions.max + caseData.committee.length * per
    };
  }

  var Rules = {
    GAUGE_START: GAUGE_START,
    GAUGE_POINT: GAUGE_POINT,
    outcomeKey: outcomeKey,
    policyMaxDebt: policyMaxDebt,
    bestLoanRange: bestLoanRange,
    evaluateProposal: evaluateProposal,
    applyGauges: applyGauges,
    extractNumbers: extractNumbers,
    evaluateAnswer: evaluateAnswer,
    SEMANTIC_DEFAULTS: SEMANTIC_DEFAULTS,
    semanticThresholds: semanticThresholds,
    evaluateAnswerSemantic: evaluateAnswerSemantic,
    evaluateAnswerLLM: evaluateAnswerLLM,
    finalScore: finalScore
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Rules;
    return; // Node (tests): stop here, no browser below.
  }

  // ======================================================================
  // Part 2 — browser game
  // ======================================================================

  // The welcome screen lists the cases in cases/index.json.
  // ?case=case-02 in the address shows only that case (handy for a class).
  // Only letters, digits and dashes are allowed in a case name.
  var INDEX_URL = 'cases/index.json';

  function requestedCase() {
    var id = new URLSearchParams(window.location.search).get('case');
    return id && /^[a-z0-9-]+$/i.test(id) ? id : null;
  }

  function fetchJson(url) {
    // 'no-cache': always check for a newer version, so an updated case is never mixed with old code.
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }
  var TYPING_DELAY = 1400; // ms before the next committee message arrives

  var state = {
    caseData: null,
    assumptions: null,     // control center values, keyed like model.inputs (e.g. yield, tenor)
    decision: null,        // 'approve' | 'conditions' | 'decline'
    loan: null,            // loan amount set in the control center (USD m)
    loanWasReset: false,   // true right after "Approve as requested" put it back to the request
    conditions: {},        // condition id → true when ticked
    justification: '',
    submitted: null,       // frozen copy of the proposal when sent to committee
    questionIndex: -1,     // committee question waiting for an answer
    answers: [],           // committee answers
    committeeFinished: false,
    finished: false,       // the result screen has been shown (no confirmation needed to leave)
    gauges: { revenue: GAUGE_START, risk: GAUGE_START, credibility: GAUGE_START }
  };

  // ---------- Semantic analysis (observation only) ----------
  // A second committee score, computed next to the official one and shown
  // only with ?debug=1. The model loads only in that mode while the official
  // score does not use it; the game never waits for it nor breaks without it.

  var DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';
  var semantic = {
    enabled: DEBUG && !!window.Semantic,
    matches: []            // per question: promise of the best match per idea, or of null
  };

  // Load the model and embed every reference sentence once, while the player reads.
  function prepareSemantic() {
    if (!semantic.enabled) return;
    var examples = [];
    state.caseData.committee.forEach(function (q) {
      q.analysis.ideas.forEach(function (idea) { examples = examples.concat(idea.examples || []); });
    });
    Semantic.embed(examples).catch(function () {});
  }

  function matchAnswer(index, text) {
    if (!semantic.enabled) return;
    semantic.matches[index] = Semantic.matchIdeas(text, state.caseData.committee[index].analysis.ideas)
      .catch(function () { return null; });
  }

  // Both scores for every answer, for the debug panel and its export.
  function semanticReport(score) {
    var data = state.caseData;
    var per = data.rules.score.committeePerQuestion;
    return Promise.all(data.committee.map(function (q, i) {
      return semantic.matches[i] || null;
    })).then(function (allMatches) {
      return {
        caseId: data.id,
        model: window.Semantic ? Semantic.MODEL : null,
        modelStatus: window.Semantic ? Semantic.status() : 'unavailable',
        answers: data.committee.map(function (q, i) {
          var matches = allMatches[i];
          var scores = matches ? matches.map(function (m) { return m ? m.score : undefined; }) : null;
          return {
            question: q,
            text: state.answers[i] || '',
            official: score.committee[i],
            semantic: evaluateAnswerSemantic(q, state.answers[i], scores, semanticThresholds(data, q), per),
            matches: matches
          };
        })
      };
    });
  }

  // Same shape as tests/answers/*.json: fill `expected` with your own grading.
  function exportReport(report) {
    var file = {
      case: report.caseId,
      exportedAt: new Date().toISOString(),
      model: report.model,
      modelStatus: report.modelStatus,
      answers: report.answers.map(function (a, i) {
        return {
          question: i,
          text: a.text,
          expected: { points: null, ideas: a.question.analysis.ideas.map(function () { return null; }) },
          official: { points: a.official.points, ideas: a.official.ideas.map(function (x) { return x.hit; }) },
          semantic: {
            method: a.semantic.method,
            points: a.semantic.points,
            ideas: a.semantic.ideas.map(function (x) {
              return { similarity: x.similarity, zone: x.zone, keyword: x.keyword, vetoedBy: x.vetoedBy, hit: x.hit };
            }),
            trapNumbers: a.semantic.trapNumbers.filter(function (t) { return t.fired; }).map(function (t) { return t.label; })
          }
        };
      })
    };
    var stamp = file.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
    UI.downloadJson(report.caseId + '-answers-' + stamp + '.json', file);
  }

  function showSemanticPanel(score) {
    if (!DEBUG) return;
    UI.renderDebugPanel(null);
    semanticReport(score).then(function (report) {
      UI.renderDebugPanel(report, function () { exportReport(report); });
    });
  }

  // ---------- Model inputs ----------

  // The sponsor's value for every control center input.
  function sponsorAssumptions() {
    var s = state.caseData.model.sponsorCase;
    var values = {};
    Object.keys(state.caseData.model.inputs).forEach(function (key) { values[key] = s[key]; });
    return values;
  }

  function hasTenorInput() { return !!state.caseData.model.inputs.tenor; }

  function requestedTenorValue() {
    return hasTenorInput() ? state.caseData.model.sponsorCase.tenor : state.caseData.model.fixed.tenor;
  }

  // After sending, the proposal panel keeps what was sent, while the control
  // center stays free for testing other numbers (the score does not change).
  function proposalView() {
    if (state.submitted) {
      return { decision: state.submitted.decision, loan: state.loan, conditions: state.submitted.conditions };
    }
    return {
      decision: state.decision,
      loan: state.decision === 'approve' ? state.caseData.proposal.requestedLoan : state.loan,
      conditions: state.decision === 'conditions' ? state.conditions : {}
    };
  }

  // Interest rate: base rate plus any margin added by a ticked condition.
  function rateFor(conditions) {
    var rate = state.caseData.model.fixed.rate;
    state.caseData.proposal.conditions.forEach(function (c) {
      if (c.rateIncrease && conditions[c.id]) rate += c.rateIncrease;
    });
    return rate;
  }

  // Fixed parameters plus control center values, in the units model.js
  // expects (inputs marked "percent" are typed in %, e.g. curtailment 10 → 0.10).
  function modelInputs(assumptions, loan, rate) {
    var config = state.caseData.model.inputs;
    var inputs = Object.assign({}, state.caseData.model.fixed, { loan: loan, rate: rate });
    Object.keys(assumptions).forEach(function (key) {
      inputs[key] = config[key] && config[key].percent ? assumptions[key] / 100 : assumptions[key];
    });
    return inputs;
  }

  // ---------- Redraw ----------

  // Called after every change: recompute both cases and refresh the screen.
  function refresh() {
    var data = state.caseData;
    var fixed = data.model.fixed;
    var view = proposalView();
    var rate = rateFor(view.conditions);

    var inputs = modelInputs(state.assumptions, view.loan, rate);
    var current = Model.computeCase(inputs);
    var sponsor = Model.computeCase(modelInputs(sponsorAssumptions(), data.model.sponsorCase.loan, fixed.rate));
    // The proposal as sent, drawn as a ghost line once the player explores.
    var sent = state.submitted
      ? Model.computeCase(modelInputs(state.submitted.assumptions, state.submitted.loan, state.submitted.rate))
      : null;
    var policy = Model.policyStatus(current, fixed.minDSCR - fixed.warnDSCR);

    var params = Object.assign({}, fixed, { loan: view.loan, rate: rate, tenor: inputs.tenor });

    UI.setInputValues(data.model.inputs, state.assumptions, sponsorAssumptions());
    UI.renderMetrics(current, sponsor, params, policy, { loan: data.model.sponsorCase.loan });
    UI.updateCharts(current, sponsor, sent);
    UI.setProposalState({
      decision: view.decision,
      loan: view.loan,
      loanConfig: data.proposal.loan,
      conditions: state.submitted ? state.submitted.conditions : state.conditions,
      editable: !state.submitted && state.decision === 'conditions',
      loanEditable: !!state.submitted || state.decision !== 'approve',
      sentLoan: state.submitted ? state.submitted.loan : null,
      loanWasReset: state.loanWasReset,
      requestedLoan: data.proposal.requestedLoan,
      requestedTenor: hasTenorInput() ? requestedTenorValue() : undefined,
      tenorLocked: !state.submitted && state.decision === 'approve',
      locked: !!state.submitted,
      finished: !!state.committeeFinished
    });
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
    decision: function (id) {
      var requested = state.caseData.proposal.requestedLoan;
      // "Approve as requested" means the amount (and tenor) the sponsor asked for.
      var tenorChanged = hasTenorInput() && state.assumptions.tenor !== requestedTenorValue();
      state.loanWasReset = id === 'approve' && (Math.abs(state.loan - requested) > 1e-9 || tenorChanged);
      if (id === 'approve') {
        state.loan = requested;
        if (hasTenorInput()) state.assumptions.tenor = requestedTenorValue();
      }
      state.decision = id;
      refresh();
    },
    loan: function (value) { state.loan = value; refresh(); },
    condition: function (id, checked) { state.conditions[id] = checked; refresh(); },
    justification: function (text) { state.justification = text; },
    submit: submitProposal
  };

  function submitProposal() {
    if (!state.decision || state.submitted) return;
    var view = proposalView();
    var proposal = {
      decision: view.decision,
      loan: view.loan,
      rate: rateFor(view.conditions),
      conditions: Object.assign({}, view.conditions),
      assumptions: Object.assign({}, state.assumptions),
      tenor: hasTenorInput() ? state.assumptions.tenor : state.caseData.model.fixed.tenor,
      justification: state.justification.trim()
    };
    // The proposal part of the score is fixed now, from what was on screen.
    proposal.evaluation = evaluateProposal(state.caseData, proposal);
    state.submitted = proposal;
    state.answers = [];
    refresh();
    startCommittee();
  }

  // ---------- Committee chat ----------

  // Each committee member writes in their own conversation.
  function startCommittee() {
    var seen = {};
    state.caseData.committee.forEach(function (q) {
      if (seen[q.askedBy]) return;
      seen[q.askedBy] = true;
      UI.chat.divider(q.askedBy, q.role, 'Credit committee · ' + state.caseData.title);
    });
    UI.chat.closeReplies('Waiting for the committee…');
    askQuestion(0);
  }

  function askQuestion(index) {
    var q = state.caseData.committee[index];
    state.questionIndex = index;
    UI.chat.typing(q.askedBy, q.role, TYPING_DELAY, function () {
      UI.chat.receive({ from: q.askedBy, role: q.role, text: q.question });
      UI.chat.awaitReply(q.askedBy);
    });
  }

  function onChatSend(to, text) {
    var index = state.questionIndex;
    if (index < 0) return;
    state.answers[index] = text;
    state.questionIndex = -1;
    matchAnswer(index, text);

    if (index + 1 < state.caseData.committee.length) {
      UI.chat.closeReplies('Waiting for the committee…');
      askQuestion(index + 1);
      return;
    }
    UI.chat.closeReplies('The committee is deliberating.');
    var closing = state.caseData.messages.committeeClosing;
    UI.chat.typing(closing.from, closing.role, TYPING_DELAY, function () {
      UI.chat.receive(closing);
      state.committeeFinished = true;
      refresh();
      UI.showResultsBar(showResult);
    });
  }

  // ---------- Navigation ----------

  // The page address for one case (or the welcome screen), keeping ?debug=1.
  function pageUrl(caseId) {
    var params = [];
    if (caseId) params.push('case=' + encodeURIComponent(caseId));
    if (DEBUG) params.push('debug=1');
    return window.location.pathname + (params.length ? '?' + params.join('&') : '');
  }

  function goHome() {
    window.location.href = pageUrl(null);
  }

  // Leaving a case in progress loses it: ask first.
  function leaveCase() {
    if (state.caseData && !state.finished &&
        !window.confirm('Leave this case? Your progress will be lost.')) return;
    goHome();
  }

  // Skip the whole case: straight to the answer key, without a score.
  function skipCase() {
    if (!window.confirm('Skip this case and go straight to the results and the answer key? There will be no score.')) return;
    state.finished = true;
    UI.chat.hide();
    UI.renderSkipped({
      caseData: state.caseData,
      onRestart: function () { window.location.href = pageUrl(state.caseData.id); },
      onAllCases: goHome
    });
    UI.showScreen('result');
  }

  // From the result, look at the case again, starting from the proposal as
  // sent (the player can still test numbers), then come back.
  function reviewCase() {
    state.assumptions = Object.assign({}, state.submitted.assumptions);
    state.loan = state.submitted.loan;
    refresh();
    UI.showScreen('case');
    UI.showResultsBar(function () { UI.showScreen('result'); }, {
      title: 'You are reviewing your case.',
      text: 'It opens on your proposal. You can still test other numbers.',
      button: 'Back to the results'
    });
  }

  // ---------- Result ----------

  // Loan range of the best answer itself (its tenor and conditions), to show
  // next to the range that was possible with the player's own structure.
  function bestAnswerLoanRange(caseData) {
    var best = caseData.answerKey.best;
    var conditions = {};
    best.conditions.forEach(function (id) { conditions[id] = true; });
    return bestLoanRange(caseData, {
      decision: best.decision, loan: best.loan, rate: caseData.model.fixed.rate,
      conditions: conditions, assumptions: Object.assign({}, best.assumptions)
    });
  }

  function showResult() {
    var evaluation = state.submitted.evaluation;
    var score = finalScore(state.caseData, evaluation, state.answers);
    var before = Object.assign({}, state.gauges);
    state.gauges = applyGauges(state.gauges, evaluation.gauges.deltas);
    state.finished = true;

    UI.chat.hide();
    UI.renderResult({
      caseData: state.caseData,
      proposal: state.submitted,
      evaluation: evaluation,
      score: score,
      loanRange: bestLoanRange(state.caseData, state.submitted),
      bestLoanRange: bestAnswerLoanRange(state.caseData),
      gaugesBefore: before,
      gaugesAfter: state.gauges,
      answers: state.answers,
      onRestart: function () { window.location.href = pageUrl(state.caseData.id); },
      onAllCases: goHome,
      onReview: reviewCase
    });
    UI.showScreen('result');
    // Let the screen appear first so the gauges visibly move.
    setTimeout(function () { UI.setGauges(state.gauges); }, 300);
    showSemanticPanel(score);
  }

  // ---------- Start ----------

  function startCase() {
    var data = state.caseData;
    state.assumptions = sponsorAssumptions();
    state.loan = data.proposal.requestedLoan;

    UI.renderCaseHeader(data);
    UI.renderDocuments(data.documents);
    UI.renderInputs(data.model.inputs, setAssumption);
    UI.renderProposal(data.proposal, proposalHandlers);
    UI.setGauges(state.gauges);
    UI.showScreen('case');
    UI.initCharts(hasTenorInput() ? data.model.inputs.tenor.max : data.model.fixed.tenor);
    UI.chat.init(onChatSend);
    refresh();
    prepareSemantic();

    document.getElementById('reset-btn').addEventListener('click', resetToSponsor);
    document.getElementById('back-to-cases').addEventListener('click', leaveCase);
    document.getElementById('skip-link').addEventListener('click', skipCase);

    // Messages that arrive while the player reads the case (e.g. the front office).
    (data.messages.onStart || []).forEach(function (msg) {
      setTimeout(function () { UI.chat.receive(msg); }, msg.delay || 0);
    });
  }

  function loadCase(id) {
    fetchJson('cases/' + id + '.json')
      .then(function (data) {
        state.caseData = data;
        startCase();
      })
      .catch(function () {
        UI.renderLoadError('This case could not be loaded. Check its file in the cases folder (see README).');
      });
  }

  function init() {
    UI.initFooter();
    document.getElementById('home-link').addEventListener('click', function (e) {
      e.preventDefault();
      leaveCase();
    });
    fetchJson(INDEX_URL)
      .then(function (index) {
        var only = requestedCase();
        var cases = only ? index.cases.filter(function (c) { return c.id === only; }) : index.cases;
        if (!cases.length) throw new Error('Unknown case');
        UI.renderWelcome(cases, loadCase);
      })
      .catch(function () {
        UI.renderLoadError(
          'The cases could not be loaded. Check the case name in the address, ' +
          'or, if you opened index.html directly, start a local server instead (see README).'
        );
      });
  }

  // Exposed for debugging in the browser console.
  root.Game = { state: state, refresh: refresh, rules: Rules };

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : this);
