/*
 * ui.js — everything the player sees.
 *
 * Builds the screens from the case data and redraws numbers and charts.
 * No financial maths here (that lives in model.js) and no game rules
 * (those live in game.js): this file only receives values and shows them.
 */
(function () {
  'use strict';

  var charts = {};

  // ---------- Small helpers ----------

  function $(id) { return document.getElementById(id); }

  // Create an element with optional class and text. Text is always set with
  // textContent, so nothing in the case file can inject HTML.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmt(value, decimals) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  // Number of decimals implied by a slider step (10 → 0, 0.5 → 1, 0.05 → 2).
  function decimalsOf(step) {
    var s = String(step);
    return s.indexOf('.') === -1 ? 0 : s.length - s.indexOf('.') - 1;
  }

  function snap(value, cfg) {
    var clamped = Math.min(cfg.max, Math.max(cfg.min, value));
    var steps = Math.round((clamped - cfg.min) / cfg.step);
    return Number((cfg.min + steps * cfg.step).toFixed(decimalsOf(cfg.step)));
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- Screens ----------

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.hidden = screen.id !== 'screen-' + name;
    });
    $('gauges').hidden = name === 'welcome';
    window.scrollTo(0, 0);
  }

  function renderWelcome(caseData, onStart) {
    var hint = $('welcome-hint');
    hint.textContent = '';
    hint.appendChild(el('strong', null, 'Tip: '));
    hint.appendChild(document.createTextNode(caseData.tutorialHint));

    var btn = $('start-btn');
    btn.disabled = false;
    btn.textContent = 'Start';
    btn.addEventListener('click', onStart);
  }

  function renderLoadError(message) {
    var btn = $('start-btn');
    btn.disabled = true;
    btn.textContent = 'Could not load the case';
    var hint = $('welcome-hint');
    hint.textContent = message;
  }

  function renderCaseHeader(caseData) {
    $('case-eyebrow').textContent = caseData.level + ' · ' + caseData.country + ' · ' + caseData.readingTime;
    $('case-title').textContent = caseData.title;
    $('case-tagline').textContent = caseData.tagline;
  }

  // ---------- Gauges ----------

  function setGauges(gauges) {
    Object.keys(gauges).forEach(function (key) {
      var node = document.querySelector('.gauge[data-gauge="' + key + '"]');
      if (!node) return;
      var value = Math.max(0, Math.min(100, gauges[key]));
      node.querySelector('.gauge-value').textContent = value;
      node.querySelector('.gauge-fill').style.width = value + '%';
    });
  }

  // ---------- Documents ----------

  function renderBlock(block) {
    switch (block.type) {
      case 'heading':
        return el('h4', null, block.text);
      case 'paragraph':
        return el('p', null, block.text);
      case 'quote':
        return el('blockquote', 'doc-quote', block.text);
      case 'list': {
        var ul = el('ul');
        block.items.forEach(function (item) { ul.appendChild(el('li', null, item)); });
        return ul;
      }
      case 'table': {
        var table = el('table', 'doc-table');
        if (block.head) {
          var thead = el('thead');
          var hr = el('tr');
          block.head.forEach(function (h) { hr.appendChild(el('th', null, h)); });
          thead.appendChild(hr);
          table.appendChild(thead);
        }
        var tbody = el('tbody');
        block.rows.forEach(function (row) {
          var tr = el('tr');
          row.forEach(function (cell) { tr.appendChild(el('td', null, cell)); });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
      }
      case 'message': {
        var wrap = el('div', 'message');
        var initials = block.from.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2);
        wrap.appendChild(el('div', 'avatar', initials));
        var bubble = el('div', 'bubble');
        bubble.appendChild(el('div', 'bubble-from', block.from));
        bubble.appendChild(el('p', null, block.text));
        wrap.appendChild(bubble);
        return wrap;
      }
      default:
        return el('p', null, block.text || '');
    }
  }

  function renderDocuments(documents) {
    var tabs = $('doc-tabs');
    var body = $('doc-body');
    tabs.textContent = '';

    function select(index) {
      Array.prototype.forEach.call(tabs.children, function (tab, i) {
        tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
        tab.tabIndex = i === index ? 0 : -1;
      });
      var doc = documents[index];
      body.textContent = '';
      body.setAttribute('aria-labelledby', 'tab-' + doc.id);
      body.appendChild(el('div', 'doc-source', doc.source));
      body.appendChild(el('div', 'doc-title', doc.title));
      doc.blocks.forEach(function (block) { body.appendChild(renderBlock(block)); });
      body.scrollTop = 0;
    }

    documents.forEach(function (doc, i) {
      var tab = el('button', 'tab', doc.tab);
      tab.type = 'button';
      tab.id = 'tab-' + doc.id;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', function () { select(i); });
      // Arrow keys move between tabs.
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var next = (i + (e.key === 'ArrowRight' ? 1 : -1) + documents.length) % documents.length;
        select(next);
        tabs.children[next].focus();
      });
      tabs.appendChild(tab);
    });

    select(0);
  }

  // ---------- Control center: inputs ----------

  // A slider and a number field kept in sync, used for the assumptions and
  // for the loan amount. `onChange(key, value)` is called with the new value;
  // game.js then recomputes and calls setSliderValue to redraw both controls.
  function buildSliderRow(key, cfg, onChange) {
    var decimals = decimalsOf(cfg.step);
    var row = el('div', 'input-row');
    row.dataset.key = key;

    var top = el('div', 'input-top');
    var label = el('label', 'input-label', cfg.label);
    label.htmlFor = 'num-' + key;
    top.appendChild(label);

    var wrap = el('div', 'num-wrap');
    var num = el('input');
    num.type = 'number';
    num.id = 'num-' + key;
    num.min = cfg.min;
    num.max = cfg.max;
    num.step = cfg.step;
    num.inputMode = 'decimal';
    wrap.appendChild(num);
    wrap.appendChild(el('span', 'num-unit', cfg.unit));
    top.appendChild(wrap);
    row.appendChild(top);

    var range = el('input');
    range.type = 'range';
    range.id = 'range-' + key;
    range.min = cfg.min;
    range.max = cfg.max;
    range.step = cfg.step;
    range.setAttribute('aria-label', cfg.label);
    row.appendChild(range);

    var scale = el('div', 'range-scale');
    scale.appendChild(el('span', null, fmt(cfg.min, decimals)));
    scale.appendChild(el('span', null, fmt(cfg.max, decimals)));
    row.appendChild(scale);

    range.addEventListener('input', function () {
      onChange(key, snap(Number(range.value), cfg));
    });

    // While typing: update live as soon as the number is valid.
    num.addEventListener('input', function () {
      var v = Number(num.value);
      if (num.value !== '' && isFinite(v) && v >= cfg.min && v <= cfg.max) {
        onChange(key, v);
      }
    });

    // On Enter or leaving the field: clamp to the range and round to the step.
    num.addEventListener('change', function () {
      var v = Number(num.value);
      if (num.value === '' || !isFinite(v)) v = Number(range.value);
      var snapped = snap(v, cfg);
      num.value = snapped.toFixed(decimals);
      onChange(key, snapped);
    });

    return row;
  }

  function setSliderValue(key, cfg, value) {
    var num = $('num-' + key);
    var range = $('range-' + key);
    range.value = value;
    range.style.setProperty('--fill', ((value - cfg.min) / (cfg.max - cfg.min)) * 100 + '%');
    // Don't rewrite the field the player is typing in.
    if (document.activeElement !== num) num.value = value.toFixed(decimalsOf(cfg.step));
  }

  function renderInputs(config, onChange) {
    var container = $('inputs');
    container.textContent = '';
    Object.keys(config).forEach(function (key) {
      container.appendChild(buildSliderRow(key, config[key], onChange));
    });
  }

  function setInputValues(config, values, sponsorValues) {
    Object.keys(config).forEach(function (key) {
      setSliderValue(key, config[key], values[key]);
      $('num-' + key).closest('.input-row').classList.toggle('changed', values[key] !== sponsorValues[key]);
    });
  }

  function renderFixed(params) {
    var container = $('fixed-params');
    container.textContent = '';
    var chips = [
      ['Capacity', fmt(params.capacity, 0) + ' MWp'],
      ['Total cost', 'USD ' + fmt(params.totalCost, 1) + 'm'],
      ['Loan', 'USD ' + fmt(params.loan, 1) + 'm'],
      ['Tenor', params.tenor + ' years'],
      ['Interest rate', fmt(params.rate * 100, 1) + '%'],
      ['Bank min DSCR', fmt(params.minDSCR, 2) + 'x']
    ];
    chips.forEach(function (c) {
      var chip = el('div', 'chip');
      chip.appendChild(el('span', null, c[0]));
      chip.appendChild(el('strong', null, c[1]));
      container.appendChild(chip);
    });
  }

  // ---------- Control center: metrics ----------

  function metricTile(opts) {
    var tile = el('div', 'metric' + (opts.className ? ' ' + opts.className : ''));
    if (opts.status) tile.dataset.status = opts.status;
    tile.appendChild(el('div', 'metric-label', opts.label));
    var value = el('div', 'metric-value', opts.value);
    if (opts.unit) value.appendChild(el('span', 'metric-unit', opts.unit));
    if (opts.pill) value.appendChild(el('span', 'status-pill', opts.pill));
    tile.appendChild(value);
    if (opts.sub) tile.appendChild(el('div', 'metric-sub', opts.sub));
    return tile;
  }

  var STATUS_TEXT = { good: 'Meets policy', warn: 'Below policy', bad: 'Well below policy' };

  function renderMetrics(current, sponsor, params, status) {
    var container = $('metrics');
    container.textContent = '';
    var tiles = [
      {
        label: 'DSCR', className: 'is-dscr', status: status,
        value: fmt(current.dscr, 2), unit: 'x', pill: STATUS_TEXT[status],
        sub: 'Bank minimum ' + fmt(params.minDSCR, 2) + 'x · Sponsor case ' + fmt(sponsor.dscr, 2) + 'x'
      },
      {
        label: 'Max debt at ' + fmt(params.minDSCR, 2) + 'x', value: fmt(current.maxDebt, 2), unit: 'USD m',
        sub: 'Loan ' + fmt(params.loan, 2)
      },
      {
        label: 'Gearing', value: fmt(current.gearing * 100, 1), unit: '%',
        sub: 'Bank max ' + fmt(params.maxGearing * 100, 0) + '%'
      },
      {
        label: 'Annual production', value: fmt(current.production, 2), unit: 'GWh',
        sub: 'Sponsor ' + fmt(sponsor.production, 2)
      },
      {
        label: 'Revenue', value: fmt(current.revenue, 2), unit: 'USD m',
        sub: 'Sponsor ' + fmt(sponsor.revenue, 2)
      },
      {
        label: 'CFADS', value: fmt(current.cfads, 2), unit: 'USD m',
        sub: 'Sponsor ' + fmt(sponsor.cfads, 2)
      },
      {
        label: 'Annual debt service', value: fmt(current.debtService, 2), unit: 'USD m',
        sub: fmt(params.rate * 100, 1) + '%, ' + params.tenor + '-year annuity'
      }
    ];
    tiles.forEach(function (t) { container.appendChild(metricTile(t)); });
  }

  // ---------- Charts ----------

  function sponsorLine(label, data) {
    return {
      type: 'line',
      label: label,
      data: data,
      borderColor: cssVar('--sponsor'),
      backgroundColor: 'transparent',
      borderDash: [6, 5],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      order: 0
    };
  }

  function baseOptions(yOpts, unit) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 18, boxHeight: 2, font: { size: 11 }, color: cssVar('--muted'),
            sort: function (a, b) { return a.datasetIndex - b.datasetIndex; }
          }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y, 2) + unit; }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: cssVar('--muted') } },
        y: Object.assign({
          grid: { color: cssVar('--border') },
          border: { display: false },
          ticks: { font: { size: 11 }, color: cssVar('--muted') }
        }, yOpts)
      }
    };
  }

  function initCharts(tenor) {
    if (typeof Chart === 'undefined') return; // CDN unreachable: metrics still work.
    Chart.defaults.font.family = '"Inter", system-ui, sans-serif';

    var labels = [];
    for (var y = 1; y <= tenor; y++) labels.push('Y' + y);
    var accent = cssVar('--accent');
    var text = cssVar('--text');
    var empty = labels.map(function () { return 0; });

    charts.cashflow = new Chart($('chart-cashflow'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'Your CFADS', data: empty, backgroundColor: accent, borderRadius: 3, order: 2 },
          { type: 'line', label: 'Your debt service', data: empty, borderColor: text, borderWidth: 2, pointRadius: 0, order: 1 },
          sponsorLine('Sponsor CFADS', empty),
          sponsorLine('Sponsor debt service', empty)
        ]
      },
      options: baseOptions({ min: 0, suggestedMax: 6 }, 'm')
    });

    charts.dscr = new Chart($('chart-dscr'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Your DSCR', data: empty, borderColor: accent, borderWidth: 2.5, pointRadius: 0, order: 1 },
          { label: 'Bank minimum', data: empty, borderColor: cssVar('--bad'), borderWidth: 1.5, pointRadius: 0, order: 2 },
          sponsorLine('Sponsor DSCR', empty)
        ]
      },
      options: baseOptions({ suggestedMin: 0.8, suggestedMax: 2.0 }, 'x')
    });

    charts.balance = new Chart($('chart-balance'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Your case', data: empty, borderColor: accent, borderWidth: 2.5, pointRadius: 0,
            fill: 'origin', backgroundColor: cssVar('--accent-soft'), order: 1
          },
          sponsorLine('Sponsor case', empty)
        ]
      },
      options: baseOptions({ min: 0, suggestedMax: 30 }, 'm')
    });
  }

  var STATUS_COLOUR = { good: '--good', warn: '--warn', bad: '--bad' };

  function updateCharts(current, sponsor, minDSCR, status) {
    if (!charts.cashflow) return;
    function pick(result, field) { return result.years.map(function (y) { return y[field]; }); }

    var cf = charts.cashflow.data.datasets;
    cf[0].data = pick(current, 'cfads');
    cf[1].data = pick(current, 'debtService');
    cf[2].data = pick(sponsor, 'cfads');
    cf[3].data = pick(sponsor, 'debtService');
    charts.cashflow.update();

    var ds = charts.dscr.data.datasets;
    ds[0].data = pick(current, 'dscr');
    ds[0].borderColor = cssVar(STATUS_COLOUR[status]);
    ds[1].data = current.years.map(function () { return minDSCR; });
    ds[1].label = 'Bank minimum ' + fmt(minDSCR, 2) + 'x';
    ds[2].data = pick(sponsor, 'dscr');
    charts.dscr.update();

    var bl = charts.balance.data.datasets;
    bl[0].data = pick(current, 'balance');
    bl[1].data = pick(sponsor, 'balance');
    charts.balance.update();
  }

  // ---------- Proposal to committee ----------

  function renderProposal(cfg, handlers) {
    var decisions = $('decisions');
    decisions.textContent = '';
    cfg.decisions.forEach(function (d) {
      var option = el('label', 'decision-option');
      var radio = el('input');
      radio.type = 'radio';
      radio.name = 'decision';
      radio.value = d.id;
      radio.addEventListener('change', function () { handlers.decision(d.id); });
      option.appendChild(radio);
      var text = el('span', 'decision-text');
      text.appendChild(el('span', 'decision-title', d.label));
      if (d.hint) text.appendChild(el('span', 'decision-hint', d.hint));
      option.appendChild(text);
      decisions.appendChild(option);
    });

    var loanField = $('loan-field');
    loanField.textContent = '';
    var loanCfg = Object.assign({ label: 'Loan amount', unit: 'USD m' }, cfg.loan);
    loanField.appendChild(buildSliderRow('loan', loanCfg, function (key, value) { handlers.loan(value); }));
    loanField.appendChild(el('p', 'field-note', ''));

    var conditions = $('conditions');
    conditions.textContent = '';
    cfg.conditions.forEach(function (c) {
      var option = el('label', 'condition-option');
      var box = el('input');
      box.type = 'checkbox';
      box.value = c.id;
      box.id = 'cond-' + c.id;
      box.addEventListener('change', function () { handlers.condition(c.id, box.checked); });
      option.appendChild(box);
      option.appendChild(el('span', null, c.label));
      conditions.appendChild(option);
    });

    $('justification').addEventListener('input', function (e) { handlers.justification(e.target.value); });

    $('proposal').addEventListener('submit', function (e) {
      e.preventDefault();
      handlers.submit();
    });
  }

  function setProposalState(s) {
    document.querySelectorAll('input[name="decision"]').forEach(function (radio) {
      radio.checked = radio.value === s.decision;
      radio.closest('.decision-option').classList.toggle('selected', radio.checked);
    });

    var loanCfg = Object.assign({ label: 'Loan amount', unit: 'USD m' }, s.loanConfig);
    setSliderValue('loan', loanCfg, s.loan);
    $('num-loan').disabled = !s.editable;
    $('range-loan').disabled = !s.editable;
    var loanField = $('loan-field');
    loanField.classList.toggle('is-disabled', !s.editable);
    loanField.querySelector('.field-note').textContent = s.editable
      ? ''
      : 'The amount can only be changed with "Approve with conditions".';

    document.querySelectorAll('#conditions input[type="checkbox"]').forEach(function (box) {
      box.checked = !!s.conditions[box.value];
      box.disabled = !s.editable;
      box.closest('.condition-option').classList.toggle('is-disabled', !s.editable);
    });
    $('conditions-note').textContent = s.editable ? '' : '(with "Approve with conditions" only)';

    $('submit-proposal').disabled = !s.decision;
    $('submit-note').textContent = s.decision
      ? 'Your score is based on the control center and this proposal as they stand when you send it.'
      : 'Choose a decision first.';
  }

  function renderProposalPreview(decision, current, params, status) {
    var box = $('proposal-preview');
    box.textContent = '';
    box.dataset.status = status;
    var lead = decision === 'decline'
      ? 'For reference, the request at USD ' + fmt(params.loan, 1) + 'm and ' + fmt(params.rate * 100, 1) + '%, on your assumptions:'
      : 'At USD ' + fmt(params.loan, 1) + 'm and ' + fmt(params.rate * 100, 1) + '%, on your assumptions:';
    box.appendChild(el('p', 'preview-lead', lead));
    var line = el('div', 'preview-figures');
    [
      ['DSCR', fmt(current.dscr, 2) + 'x', 'is-dscr'],
      ['Gearing', fmt(current.gearing * 100, 1) + '%'],
      ['Max debt at ' + fmt(params.minDSCR, 2) + 'x', 'USD ' + fmt(current.maxDebt, 2) + 'm']
    ].forEach(function (f) {
      var item = el('div', 'preview-item' + (f[2] ? ' ' + f[2] : ''));
      item.appendChild(el('span', null, f[0]));
      item.appendChild(el('strong', null, f[1]));
      line.appendChild(item);
    });
    box.appendChild(line);
  }

  // ---------- Recap of the proposal (committee and result screens) ----------

  function decisionLabel(caseData, id) {
    var match = caseData.proposal.decisions.filter(function (d) { return d.id === id; })[0];
    return match ? match.label : id;
  }

  function conditionLabels(caseData, conditions) {
    return caseData.proposal.conditions
      .filter(function (c) { return conditions[c.id]; })
      .map(function (c) { return c.label; });
  }

  function recapNode(caseData, proposal) {
    var wrap = el('div', 'recap-body');
    var rows = [['Decision', decisionLabel(caseData, proposal.decision)]];
    if (proposal.decision !== 'decline') {
      rows.push(['Loan', 'USD ' + fmt(proposal.loan, 1) + 'm at ' + fmt(proposal.rate * 100, 1) + '%']);
    }
    if (proposal.decision === 'conditions') {
      var labels = conditionLabels(caseData, proposal.conditions);
      rows.push(['Conditions', labels.length ? labels.join(' · ') : 'None ticked']);
    }
    var dl = el('dl', 'recap-list');
    rows.forEach(function (r) {
      dl.appendChild(el('dt', null, r[0]));
      dl.appendChild(el('dd', null, r[1]));
    });
    wrap.appendChild(dl);
    if (proposal.justification) {
      wrap.appendChild(el('blockquote', 'doc-quote', proposal.justification));
    }
    return wrap;
  }

  function renderRecap(caseData, proposal) {
    var card = $('recap');
    card.textContent = '';
    card.appendChild(el('h2', null, 'Your proposal'));
    card.appendChild(recapNode(caseData, proposal));
  }

  // ---------- Committee ----------

  function initials(name) {
    return name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2);
  }

  function renderQuestion(opts) {
    var q = opts.question;
    var card = $('question');
    card.textContent = '';

    var progress = el('div', 'progress');
    progress.appendChild(el('span', null, 'Question ' + (opts.index + 1) + ' of ' + opts.total));
    var dots = el('span', 'dots');
    for (var i = 0; i < opts.total; i++) {
      dots.appendChild(el('span', 'dot' + (i < opts.index ? ' done' : i === opts.index ? ' current' : '')));
    }
    progress.appendChild(dots);
    card.appendChild(progress);

    var asker = el('div', 'asker');
    asker.appendChild(el('div', 'avatar', initials(q.askedBy)));
    var who = el('div');
    who.appendChild(el('div', 'asker-name', q.askedBy));
    who.appendChild(el('div', 'muted small', q.role));
    asker.appendChild(who);
    card.appendChild(asker);

    card.appendChild(el('p', 'question-text', q.question));

    var area = el('textarea');
    area.id = 'answer';
    area.rows = 5;
    area.placeholder = 'Your answer, in a few lines. Back it with numbers where you can.';
    area.setAttribute('aria-label', 'Your answer');
    card.appendChild(area);

    var actions = el('div', 'question-actions');
    var submit = el('button', 'btn btn-primary', 'Submit answer');
    submit.type = 'button';
    submit.disabled = true;
    actions.appendChild(submit);
    card.appendChild(actions);

    area.addEventListener('input', function () { submit.disabled = area.value.trim() === ''; });

    submit.addEventListener('click', function () {
      area.readOnly = true;
      actions.remove();
      opts.onAnswer(area.value.trim());
      card.appendChild(feedbackNode(opts));
    });

    // From question 2 on, start with the new question at the top of the screen.
    if (opts.index > 0) card.scrollIntoView({ block: 'start' });
    area.focus({ preventScroll: opts.index > 0 });
  }

  function feedbackNode(opts) {
    var wrap = el('div', 'feedback');

    var good = el('div', 'good-answer');
    good.appendChild(el('div', 'good-answer-title', 'What a good answer contains'));
    good.appendChild(el('p', null, opts.question.goodAnswer));
    wrap.appendChild(good);

    var rate = el('div', 'self-rate');
    rate.appendChild(el('p', 'self-rate-title', 'How did your answer compare?'));
    rate.appendChild(el('p', 'muted small', 'For your own reference: this does not change your score.'));
    var buttons = el('div', 'rate-buttons');
    opts.scale.forEach(function (text, score) {
      var b = el('button', 'rate-btn');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      // Scale lines look like "1 = right idea without the numbers".
      var parts = text.split(' = ');
      b.appendChild(el('strong', null, parts[0]));
      b.appendChild(el('span', null, parts[1] || ''));
      b.addEventListener('click', function () {
        buttons.querySelectorAll('.rate-btn').forEach(function (other) { other.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        opts.onSelfScore(score);
      });
      buttons.appendChild(b);
    });
    rate.appendChild(buttons);
    wrap.appendChild(rate);

    var last = opts.index + 1 === opts.total;
    var next = el('button', 'btn btn-primary btn-lg', last ? 'See the outcome' : 'Next question');
    next.type = 'button';
    next.addEventListener('click', opts.onNext);
    var actions = el('div', 'question-actions');
    actions.appendChild(next);
    wrap.appendChild(actions);

    // Bring the good answer, the self-rating and the next button into view.
    setTimeout(function () { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
    return wrap;
  }

  // ---------- Result ----------

  var GAUGES = [
    { key: 'revenue', label: 'Bank revenue', higherIsBetter: true },
    { key: 'risk', label: 'Portfolio risk', higherIsBetter: false },
    { key: 'credibility', label: 'Credibility', higherIsBetter: true }
  ];

  function scoreRow(label, detail, points, max) {
    var row = el('div', 'score-row' + (points === max ? ' full' : points === 0 ? ' zero' : ''));
    var text = el('div');
    text.appendChild(el('div', 'score-label', label));
    if (detail) text.appendChild(el('div', 'muted small', detail));
    row.appendChild(text);
    row.appendChild(el('div', 'score-points', points + ' / ' + max));
    return row;
  }

  function renderResult(opts) {
    var data = opts.caseData;
    var ev = opts.evaluation;
    var root = $('result');
    root.textContent = '';

    // Outcome
    var hero = el('section', 'card result-hero', null);
    hero.dataset.outcome = ev.outcomeKey;
    hero.appendChild(el('p', 'eyebrow', 'Outcome · ' + data.title));
    hero.appendChild(el('h1', null, ev.outcome.label));
    hero.appendChild(el('p', 'lead', ev.outcome.story));
    hero.appendChild(el('p', 'muted small', data.outcomeContext));
    root.appendChild(hero);

    var grid = el('div', 'result-grid');

    // Score
    var score = el('section', 'card');
    score.appendChild(el('h2', null, 'Your score'));
    var big = el('div', 'score-big');
    big.appendChild(el('span', 'score-total', String(ev.total)));
    big.appendChild(el('span', 'score-max', '/ ' + ev.max));
    score.appendChild(big);

    ev.traps.forEach(function (t) {
      var input = data.model.inputs[t.input];
      var sign = t.test === 'max' ? '≤' : '≥';
      var detail = 'You used ' + fmt(t.value, decimalsOf(input.step)) + ' ' + input.unit +
        (t.hit ? '' : ' · needed ' + sign + ' ' + fmt(t.target, decimalsOf(input.step)) + ' ' + input.unit);
      score.appendChild(scoreRow(t.label, detail, t.points, t.max));
    });
    score.appendChild(scoreRow('Decision', ev.outcome.label, ev.decision.points, ev.decision.max));
    var bonusNames = data.rules.score.bonusConditions.map(function (id) {
      return data.proposal.conditions.filter(function (c) { return c.id === id; })[0].label;
    });
    score.appendChild(scoreRow(
      'Protective conditions',
      ev.bonus.ticked.length + ' of ' + bonusNames.length + ': ' + bonusNames.join(' · '),
      ev.bonus.points, ev.bonus.max
    ));

    var rated = opts.selfScores.filter(function (v) { return typeof v === 'number'; });
    if (rated.length) {
      var self = rated.reduce(function (a, b) { return a + b; }, 0);
      score.appendChild(el('p', 'self-total muted small',
        'Committee answers, self-assessed: ' + self + ' / ' + rated.length * 2 + ' (not part of the score)'));
    }
    grid.appendChild(score);

    // Gauges
    var gauges = el('section', 'card');
    gauges.appendChild(el('h2', null, 'Impact on your gauges'));
    GAUGES.forEach(function (g) {
      var before = opts.gaugesBefore[g.key];
      var after = opts.gaugesAfter[g.key];
      var delta = after - before;
      var tone = delta === 0 ? 'neutral' : (delta > 0) === g.higherIsBetter ? 'good' : 'bad';
      var row = el('div', 'gauge-row');
      var head = el('div', 'gauge-row-head');
      var name = el('span', 'gauge-row-name', g.label);
      if (!g.higherIsBetter) name.appendChild(el('small', null, ' higher is worse'));
      head.appendChild(name);
      var change = el('span', 'delta delta-' + tone, (delta > 0 ? '+' : '') + delta);
      head.appendChild(change);
      row.appendChild(head);
      var track = el('div', 'gauge-track');
      var fill = el('div', 'gauge-fill');
      fill.style.width = before + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'muted small', before + ' → ' + after + ' / 100'));
      gauges.appendChild(row);
      setTimeout(function () { fill.style.width = after + '%'; }, 350);
    });
    grid.appendChild(gauges);
    root.appendChild(grid);

    // Proposal recap
    var recap = el('section', 'card');
    recap.appendChild(el('h2', null, 'Your proposal'));
    recap.appendChild(recapNode(data, opts.proposal));
    root.appendChild(recap);

    // Debrief
    var debrief = el('section', 'card debrief');
    debrief.appendChild(el('h2', null, 'Debrief'));
    debrief.appendChild(el('h3', null, 'What you should have spotted'));
    var ol = el('ol');
    data.debrief.spotted.forEach(function (item) { ol.appendChild(el('li', null, item)); });
    debrief.appendChild(ol);
    debrief.appendChild(el('p', null, data.debrief.summary));
    var lesson = el('p', 'lesson');
    lesson.appendChild(el('strong', null, 'Lesson: '));
    lesson.appendChild(document.createTextNode(data.debrief.lesson));
    debrief.appendChild(lesson);
    root.appendChild(debrief);

    // Committee answers, side by side with the good answers
    var answers = el('details', 'card more');
    answers.appendChild(el('summary', null, 'Your committee answers'));
    data.committee.forEach(function (q, i) {
      var block = el('div', 'answer-block');
      block.appendChild(el('p', 'answer-q', q.askedBy + ': ' + q.question));
      block.appendChild(el('div', 'answer-label', 'Your answer'));
      block.appendChild(el('p', null, opts.answers[i] || '—'));
      block.appendChild(el('div', 'answer-label', 'A good answer contains'));
      block.appendChild(el('p', null, q.goodAnswer));
      answers.appendChild(block);
    });
    root.appendChild(answers);

    // Full answer key
    var key = data.answerKey;
    var keyNode = el('details', 'card more');
    keyNode.appendChild(el('summary', null, 'Full answer key'));
    keyNode.appendChild(el('p', null, key.summary));
    key.traps.forEach(function (t) {
      keyNode.appendChild(el('h4', null, t.title));
      keyNode.appendChild(el('p', null, t.text));
    });
    keyNode.appendChild(el('h4', null, key.cases.note));
    keyNode.appendChild(renderBlock({ type: 'table', head: key.cases.head, rows: key.cases.rows }));
    keyNode.appendChild(el('p', null, key.cases.footer));
    keyNode.appendChild(el('h4', null, key.rightDecision.title));
    keyNode.appendChild(el('p', null, key.rightDecision.intro));
    keyNode.appendChild(renderBlock({ type: 'list', items: key.rightDecision.options }));
    keyNode.appendChild(el('p', null, key.extraCredit));
    keyNode.appendChild(el('p', null, key.weakAnswers));
    root.appendChild(keyNode);

    var actions = el('div', 'result-actions');
    var again = el('button', 'btn btn-primary btn-lg', 'Play again');
    again.type = 'button';
    again.addEventListener('click', opts.onRestart);
    actions.appendChild(again);
    root.appendChild(actions);
  }

  window.UI = {
    showScreen: showScreen,
    renderWelcome: renderWelcome,
    renderLoadError: renderLoadError,
    renderCaseHeader: renderCaseHeader,
    setGauges: setGauges,
    renderDocuments: renderDocuments,
    renderInputs: renderInputs,
    setInputValues: setInputValues,
    renderFixed: renderFixed,
    renderMetrics: renderMetrics,
    initCharts: initCharts,
    updateCharts: updateCharts,
    renderProposal: renderProposal,
    setProposalState: setProposalState,
    renderProposalPreview: renderProposalPreview,
    renderRecap: renderRecap,
    renderQuestion: renderQuestion,
    renderResult: renderResult
  };
})();
