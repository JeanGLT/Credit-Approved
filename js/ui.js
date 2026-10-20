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

  // USD amounts: one decimal, or two when needed (69.75 stays 69.75, 26 shows 26.0).
  function money(value) {
    var oneDecimal = Math.abs(Math.round(value * 10) - value * 10) < 1e-6;
    return fmt(value, oneDecimal ? 1 : 2);
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

  // Footer contact link. The address is put together on click, so it never
  // appears in the page source where spam robots could collect it.
  function initFooter() {
    var link = $('contact-link');
    if (!link) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var address = ['jean', 'grollet.com'].join('@');
      window.location.href = 'mailto:' + address + '?subject=' + encodeURIComponent('Credit Approved');
    });
  }

  function showScreen(name) {
    document.body.dataset.screen = name;
    document.querySelectorAll('.screen').forEach(function (screen) {
      screen.hidden = screen.id !== 'screen-' + name;
    });
    $('gauges').hidden = name === 'welcome';
    window.scrollTo(0, 0);
  }

  // One card per case. `onPick(id)` starts that case.
  function renderWelcome(cases, onPick) {
    var list = $('case-list');
    list.textContent = '';
    cases.forEach(function (c, i) {
      var card = el('button', 'case-card');
      card.type = 'button';
      var top = el('div', 'case-card-top');
      top.appendChild(el('span', 'case-number', 'Case ' + (i + 1)));
      top.appendChild(el('span', 'case-level level-' + c.level.toLowerCase(), c.level));
      card.appendChild(top);
      card.appendChild(el('span', 'case-title', c.title));
      if (c.intro) card.appendChild(el('span', 'case-intro', c.intro));
      var bottom = el('div', 'case-card-bottom');
      bottom.appendChild(el('span', 'case-meta', c.readingTime));
      bottom.appendChild(el('span', 'case-start', 'Start →'));
      card.appendChild(bottom);
      card.addEventListener('click', function () {
        list.querySelectorAll('.case-card').forEach(function (b) { b.disabled = true; });
        card.querySelector('.case-start').textContent = 'Loading…';
        onPick(c.id);
      });
      list.appendChild(card);
    });
  }

  function renderLoadError(message) {
    var list = $('case-list');
    list.querySelectorAll('.case-card').forEach(function (b) { b.disabled = true; });
    var error = $('welcome-error');
    error.textContent = message;
    error.hidden = false;
  }

  function renderCaseHeader(caseData) {
    $('case-eyebrow').textContent = caseData.level;
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
      case 'callout':
        return el('p', 'doc-callout', block.text);
      case 'exposure': {
        // Group limit as three plain figures: limit, already used, available.
        var figures = el('div', 'exposure');
        [['Group limit', block.limit], ['Already used', block.outstanding], ['Available', block.limit - block.outstanding]]
          .forEach(function (f) {
            var cell = el('div', 'exposure-figure');
            cell.appendChild(el('div', 'exposure-label', f[0]));
            cell.appendChild(el('div', 'exposure-value', 'USD ' + f[1] + 'm'));
            figures.appendChild(cell);
          });
        return figures;
      }
      case 'orgchart': {
        // Shareholders on top, borrower at the bottom; stakes on the links.
        var chart = el('div', 'orgchart');
        block.levels.forEach(function (level, i) {
          var row = el('div', 'org-row');
          level.forEach(function (node) {
            var item = el('div', 'org-node-wrap');
            var card = el('div', 'org-node' + (node.borrower ? ' is-borrower' : ''));
            card.appendChild(el('div', 'org-name', node.name));
            if (node.note) card.appendChild(el('div', 'org-note', node.note));
            item.appendChild(card);
            if (node.stake) item.appendChild(el('div', 'org-stake', node.stake));
            row.appendChild(item);
          });
          chart.appendChild(row);
          if (i < block.levels.length - 1) chart.appendChild(el('div', 'org-link'));
        });
        return chart;
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
      if (!doc.blocks.length) body.appendChild(el('p', 'doc-empty', doc.empty || 'Nothing here for this case.'));
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

  // Neutral mode (cases that set "neutralMetrics"): each tile shows your value
  // and the sponsor's, nothing else: no colours, no thresholds, no max debt.
  function renderNeutralMetrics(current, sponsor, params, sponsorParams) {
    var container = $('metrics');
    container.textContent = '';
    var varies = current.years.some(function (y) { return Math.abs(y.cfads - current.years[0].cfads) > 1e-9; });
    function sp(v, unit) { return 'Sponsor case ' + v + (unit || ''); }
    [
      { label: varies ? 'Minimum DSCR' : 'DSCR', className: 'is-dscr', value: fmt(current.dscr, 2), unit: 'x', sub: sp(fmt(sponsor.dscr, 2), 'x') },
      { label: 'Loan', value: money(params.loan), unit: 'USD m', sub: sp(money(sponsorParams.loan)) },
      { label: 'Gearing', value: fmt(current.gearing * 100, 1), unit: '%', sub: sp(fmt(sponsor.gearing * 100, 1), '%') },
      { label: 'Annual production', value: fmt(current.production, 2), unit: 'GWh', sub: sp(fmt(sponsor.production, 2)) },
      { label: varies ? 'Revenue, year 1' : 'Revenue', value: fmt(current.revenue, 2), unit: 'USD m', sub: sp(fmt(sponsor.revenue, 2)) },
      { label: varies ? 'CFADS, year 1' : 'CFADS', value: fmt(current.cfads, 2), unit: 'USD m', sub: sp(fmt(sponsor.cfads, 2)) },
      { label: 'Annual debt service', value: fmt(current.debtService, 2), unit: 'USD m', sub: sp(fmt(sponsor.debtService, 2)) }
    ].forEach(function (t) { container.appendChild(metricTile(t)); });
  }

  // policy = Model.policyStatus(): worst year against its own minimum.
  function renderMetrics(current, sponsor, params, policy, sponsorParams) {
    if (params.neutralMetrics) return renderNeutralMetrics(current, sponsor, params, sponsorParams);
    var container = $('metrics');
    container.textContent = '';
    var years = current.years;
    var varies = years.some(function (y) { return Math.abs(y.cfads - years[0].cfads) > 1e-9; });
    var lowestCf = years.reduce(function (m, y) { return y.cfads < m.cfads ? y : m; }, years[0]);

    var dscrSub = varies
      ? 'Lowest in year ' + current.dscrYear + ' · Sponsor case ' + fmt(sponsor.dscr, 2) + 'x'
      : 'Bank minimum ' + fmt(params.minDSCR, 2) + 'x · Sponsor case ' + fmt(sponsor.dscr, 2) + 'x';
    if (policy.status !== 'good' && varies) {
      dscrSub = 'Year ' + policy.year + ': ' + fmt(policy.dscr, 2) + 'x vs ' + fmt(policy.minDSCR, 2) + 'x required · Sponsor case ' + fmt(sponsor.dscr, 2) + 'x';
    }

    var tiles = [
      {
        label: varies ? 'Minimum DSCR' : 'DSCR', className: 'is-dscr', status: policy.status,
        value: fmt(current.dscr, 2), unit: 'x', pill: STATUS_TEXT[policy.status], sub: dscrSub
      },
      {
        label: params.merchantMinDSCR !== undefined ? 'Max debt within policy' : 'Max debt at ' + fmt(params.minDSCR, 2) + 'x',
        value: fmt(current.maxDebt, 2), unit: 'USD m',
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
        label: varies ? 'Revenue, year 1' : 'Revenue', value: fmt(current.revenue, 2), unit: 'USD m',
        sub: 'Sponsor ' + fmt(sponsor.revenue, 2)
      },
      {
        label: varies ? 'CFADS, year 1' : 'CFADS', value: fmt(current.cfads, 2), unit: 'USD m',
        sub: varies ? 'Lowest ' + fmt(lowestCf.cfads, 2) + ' in year ' + lowestCf.year : 'Sponsor ' + fmt(sponsor.cfads, 2)
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
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      order: 5 // drawn underneath: your line stays visible when both are equal
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

  function initCharts(maxYears) {
    if (typeof Chart === 'undefined') return; // CDN unreachable: metrics still work.
    Chart.defaults.font.family = '"Inter", system-ui, sans-serif';

    var labels = [];
    for (var y = 1; y <= maxYears; y++) labels.push('Y' + y);
    var accent = cssVar('--accent');
    var empty = labels.map(function () { return 0; });

    charts.cashflow = new Chart($('chart-cashflow'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { type: 'bar', label: 'Your CFADS', data: empty, backgroundColor: accent, borderRadius: 4, barPercentage: 0.7, order: 3 },
          { type: 'line', label: 'Your debt service', data: empty, borderColor: cssVar('--text'), borderWidth: 2.5, pointRadius: 0, stepped: 'middle', order: 1 },
          sponsorLine('Sponsor CFADS', empty)
        ]
      },
      options: baseOptions({ min: 0 }, 'm')
    });

    charts.dscr = new Chart($('chart-dscr'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Your DSCR', data: empty, borderColor: accent, borderWidth: 2.5, pointRadius: 0, order: 1 },
          { label: 'Bank minimum', data: empty, borderColor: cssVar('--bad'), borderWidth: 1.5, pointRadius: 0, stepped: 'middle', order: 2 },
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
            label: 'Your case', data: empty, borderColor: accent, borderWidth: 2.5, pointRadius: 0, order: 1
          },
          sponsorLine('Sponsor case', empty)
        ]
      },
      options: baseOptions({ min: 0 }, 'm')
    });
  }

  function updateCharts(current, sponsor) {
    if (!charts.dscr) return;
    // The tenor can change: show the longest of the two cases, blank after the end.
    var length = Math.max(current.years.length, sponsor.years.length);
    var labels = [];
    for (var y = 1; y <= length; y++) labels.push('Y' + y);
    function pick(result, field) {
      var values = result.years.map(function (yr) { return yr[field]; });
      while (values.length < length) values.push(null);
      return values;
    }

    var cf = charts.cashflow.data.datasets;
    charts.cashflow.data.labels = labels;
    cf[0].data = pick(current, 'cfads');
    cf[1].data = pick(current, 'debtService');
    cf[2].data = pick(sponsor, 'cfads');
    // Keep the scale steady around the sponsor case so changes are easy to see.
    charts.cashflow.options.scales.y.suggestedMax = Math.ceil(sponsor.cfads * 1.25);
    charts.cashflow.update();

    var ds = charts.dscr.data.datasets;
    charts.dscr.data.labels = labels;
    // Your DSCR stays in the accent colour so it never blends with the red minimum line;
    // the green / amber / red status is shown on the DSCR tile.
    ds[0].data = pick(current, 'dscr');
    ds[1].data = pick(current, 'minDSCR');
    var minimums = current.years.map(function (yr) { return yr.minDSCR; });
    var lo = Math.min.apply(null, minimums), hi = Math.max.apply(null, minimums);
    ds[1].label = lo === hi ? 'Bank minimum ' + fmt(lo, 2) + 'x' : 'Bank minimum ' + fmt(lo, 2) + 'x / ' + fmt(hi, 2) + 'x';
    ds[2].data = pick(sponsor, 'dscr');
    charts.dscr.update();

    var bl = charts.balance.data.datasets;
    charts.balance.data.labels = labels;
    bl[0].data = pick(current, 'balance');
    bl[1].data = pick(sponsor, 'balance');
    charts.balance.options.scales.y.suggestedMax = Math.ceil(Math.max(sponsor.years[0].balance + sponsor.debtService, current.years[0].balance + current.debtService) * 1.1);
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

  var lastLoanReset = false;

  function setProposalState(s) {
    document.querySelectorAll('input[name="decision"]').forEach(function (radio) {
      radio.checked = radio.value === s.decision;
      radio.disabled = s.locked;
      radio.closest('.decision-option').classList.toggle('selected', radio.checked);
    });
    $('proposal').classList.toggle('is-locked', s.locked);

    // Loan amount (in the control center)
    var loanCfg = Object.assign({ label: 'Loan amount', unit: 'USD m' }, s.loanConfig);
    setSliderValue('loan', loanCfg, s.loan);
    $('num-loan').disabled = !s.loanEditable;
    $('range-loan').disabled = !s.loanEditable;
    var loanField = $('loan-field');
    loanField.classList.toggle('is-disabled', !s.loanEditable && !s.locked);
    var requested = 'USD ' + money(s.requestedLoan) + 'm' +
      (s.requestedTenor !== undefined ? ' over ' + s.requestedTenor + ' years' : '');

    // Tenor, when the case lets the player change it: same lock as the amount.
    if ($('num-tenor')) {
      $('num-tenor').disabled = s.tenorLocked;
      $('range-tenor').disabled = s.tenorLocked;
      $('num-tenor').closest('.input-row').classList.toggle('is-disabled', s.tenorLocked && !s.locked);
    }
    var loanNote = s.locked
      ? 'Sent to the committee.'
      : s.decision === 'approve'
        ? 'Locked at the ' + requested + ' requested by the sponsor. Choose "Approve with conditions" to change it.'
        : s.decision === 'conditions'
          ? 'This is the amount in your proposal.'
          : s.decision === 'decline'
            ? 'Not used if you decline. You can still test other amounts.'
            : 'Test other amounts. It becomes your proposal if you approve with conditions.';
    loanField.querySelector('.field-note').textContent = loanNote;

    // Tell the player when "Approve as requested" put the amount back to the request.
    var notice = $('decision-notice');
    notice.hidden = !s.loanWasReset || s.locked;
    notice.textContent = (s.requestedTenor !== undefined ? 'The loan amount and tenor were' : 'The loan amount was') +
      ' reset to the ' + requested + ' requested by the sponsor: "Approve as requested" lends exactly what was asked.';
    if (s.loanWasReset && !lastLoanReset) {
      loanField.classList.remove('flash');
      void loanField.offsetWidth;
      loanField.classList.add('flash');
    }
    lastLoanReset = s.loanWasReset;

    document.querySelectorAll('#conditions input[type="checkbox"]').forEach(function (box) {
      box.checked = !!s.conditions[box.value];
      box.disabled = !s.editable;
      box.closest('.condition-option').classList.toggle('is-disabled', !s.editable && !s.locked);
    });

    // Once the proposal is sent, every control center input is locked.
    document.querySelectorAll('#inputs input').forEach(function (input) {
      if (s.locked) input.disabled = true;
      else if (input.id !== 'num-tenor' && input.id !== 'range-tenor') input.disabled = false;
    });
    $('reset-btn').disabled = s.locked;
    $('control-note').textContent = s.locked
      ? 'Locked: your proposal is with the committee. You can still read every figure while you answer.'
      : 'Opens on the sponsor\'s assumptions. Change them and watch the numbers move.';
    document.querySelector('.control').classList.toggle('is-locked', s.locked);

    $('justification').readOnly = s.locked;
    $('skip-link').hidden = s.locked;
    var submit = $('submit-proposal');
    submit.disabled = !s.decision || s.locked;
    submit.textContent = s.locked ? 'Sent to committee' : 'Send to committee';
    $('submit-note').textContent = s.finished
      ? 'The committee has finished. See the results at the bottom of the screen.'
      : s.locked
      ? 'Sent. The control center is locked; the committee will message you in the chat (bottom right).'
      : s.decision
        ? 'Once sent, your proposal and the control center are locked, and your score is based on them as they stand. The committee will then question you in the chat.'
        : 'Choose a decision first.';
  }

  // ---------- Recap of the proposal (result screen) ----------

  function decisionLabel(caseData, id) {
    var match = caseData.proposal.decisions.filter(function (d) { return d.id === id; })[0];
    return match ? match.label : id;
  }



  // ---------- Messages (chat in the bottom-right corner) ----------

  function initials(name) {
    return name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2);
  }

  // One conversation per person. Each has a tab at the top of the panel,
  // its own message log and an unread counter.
  var chat = (function () {
    var threads = {};    // name → { name, role, tab, badge, log, unread }
    var order = [];      // names, in order of first message
    var active = null;   // name of the conversation on screen
    var awaiting = null; // name of the person waiting for a reply
    var closedText = 'Replies open once your proposal is with the committee.';
    var onSend = null;

    function isOpen() { return !$('chat-panel').hidden; }

    function scrollToEnd(thread) { thread.log.scrollTop = thread.log.scrollHeight; }

    function totalUnread() {
      return order.reduce(function (sum, n) { return sum + threads[n].unread; }, 0);
    }

    function refreshBadges() {
      order.forEach(function (n) {
        var t = threads[n];
        t.badge.hidden = t.unread === 0;
        t.badge.textContent = t.unread;
      });
      var total = totalUnread();
      $('chat-badge').hidden = total === 0;
      $('chat-badge').textContent = total;
    }

    // The reply box is only open in the conversation that is waiting for an answer.
    function refreshInput() {
      var input = $('chat-input');
      var enabled = awaiting !== null && awaiting === active;
      input.disabled = !enabled;
      if (enabled) {
        input.placeholder = 'Reply to ' + awaiting.split(' ')[0] + '…';
      } else if (awaiting) {
        input.placeholder = awaiting + ' is waiting for your answer in the other conversation.';
      } else {
        input.placeholder = closedText;
      }
      $('chat-send').disabled = !enabled || input.value.trim() === '';
      if (enabled && isOpen()) input.focus();
    }

    function thread(name, role) {
      if (threads[name]) return threads[name];
      var tab = el('button', 'thread-tab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.appendChild(el('span', 'avatar', initials(name)));
      var text = el('span', 'thread-text');
      text.appendChild(el('span', 'thread-name', name));
      if (role) text.appendChild(el('span', 'thread-role', role));
      tab.appendChild(text);
      var badge = el('span', 'badge thread-badge');
      badge.hidden = true;
      tab.appendChild(badge);
      tab.addEventListener('click', function () { select(name); });
      $('chat-threads').appendChild(tab);

      var log = el('div', 'chat-log');
      log.hidden = true;
      $('chat-logs').appendChild(log);

      threads[name] = { name: name, role: role, tab: tab, badge: badge, log: log, unread: 0 };
      order.push(name);
      return threads[name];
    }

    function select(name) {
      active = name;
      order.forEach(function (n) {
        var t = threads[n];
        var on = n === name;
        t.log.hidden = !on;
        t.tab.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) t.unread = 0;
      });
      refreshBadges();
      scrollToEnd(threads[name]);
      refreshInput();
    }

    function open(name) {
      $('chat-panel').hidden = false;
      $('chat-launcher').hidden = true;
      $('chat-toast').hidden = true;
      select(name || active || order[0]);
    }

    function minimise() {
      $('chat-panel').hidden = true;
      $('chat-launcher').hidden = false;
    }

    var toastTarget = null;
    function showToast(msg) {
      toastTarget = msg.from;
      $('toast-avatar').textContent = initials(msg.from);
      $('toast-name').textContent = msg.from + (msg.role ? ' · ' + msg.role : '');
      $('toast-preview').textContent = msg.text.length > 90 ? msg.text.slice(0, 90).trim() + '…' : msg.text;
      var toast = $('chat-toast');
      toast.hidden = false;
      // Restart the slide-in animation for each new message.
      toast.classList.remove('pop');
      void toast.offsetWidth;
      toast.classList.add('pop');
      $('chat-launcher').hidden = true;
    }

    function init(sendHandler) {
      onSend = sendHandler;
      $('chat').hidden = false;
      $('chat-toast').addEventListener('click', function () { open(toastTarget); });
      $('chat-launcher').addEventListener('click', function () { open(); });
      $('chat-min').addEventListener('click', minimise);

      var input = $('chat-input');
      function send() {
        var text = input.value.trim();
        if (!text || input.disabled || awaiting !== active) return;
        var to = awaiting;
        input.value = '';
        var bubble = el('div', 'msg msg-own');
        bubble.appendChild(el('div', 'msg-text', text));
        threads[to].log.appendChild(bubble);
        scrollToEnd(threads[to]);
        awaiting = null;
        refreshInput();
        onSend(to, text);
      }
      $('chat-form').addEventListener('submit', function (e) { e.preventDefault(); send(); });
      // Enter sends, Shift+Enter adds a line.
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      input.addEventListener('input', function () {
        $('chat-send').disabled = input.disabled || input.value.trim() === '';
      });
      refreshInput();
    }

    function receive(msg) {
      var t = thread(msg.from, msg.role);
      var row = el('div', 'msg msg-other');
      row.appendChild(el('div', 'avatar', initials(msg.from)));
      var body = el('div', 'msg-body');
      body.appendChild(el('div', 'msg-text', msg.text));
      row.appendChild(body);
      t.log.appendChild(row);
      scrollToEnd(t);

      if (active === null) select(msg.from);
      var seen = isOpen() && active === msg.from;
      if (!seen) {
        t.unread++;
        refreshBadges();
        if (!isOpen()) showToast(msg);
      }
    }

    function typing(name, role, delay, done) {
      var t = thread(name, role);
      var row = el('div', 'msg-typing', name + ' is typing');
      row.appendChild(el('span', 'typing-dots', '…'));
      t.log.appendChild(row);
      scrollToEnd(t);
      setTimeout(function () {
        row.remove();
        done();
      }, delay);
    }

    function divider(name, role, text) {
      var t = thread(name, role);
      t.log.appendChild(el('div', 'msg-divider', text));
      scrollToEnd(t);
    }

    function awaitReply(name) {
      awaiting = name;
      refreshInput();
    }

    function closeReplies(text) {
      awaiting = null;
      closedText = text;
      refreshInput();
    }

    function hide() { $('chat').hidden = true; }

    return {
      init: init, receive: receive, typing: typing, divider: divider,
      awaitReply: awaitReply, closeReplies: closeReplies, open: open, hide: hide
    };
  })();

  // ---------- "See the results" bar ----------

  // labels (optional): { title, text, button } to reuse the bar elsewhere.
  function showResultsBar(onClick, labels) {
    labels = labels || {};
    var bar = $('results-bar');
    bar.hidden = false;
    $('results-bar-title').textContent = labels.title || 'The committee has finished.';
    $('results-bar-sub').textContent = labels.text || 'Your results are ready.';
    var btn = $('results-btn');
    btn.textContent = (labels.button || 'See the results') + ' →';
    btn.onclick = function () {
      bar.hidden = true;
      onClick();
    };
    setTimeout(function () { btn.focus({ preventScroll: true }); }, 400);
  }

  // ---------- Result ----------

  var GAUGES = [
    { key: 'revenue', label: 'Bank revenue', higherIsBetter: true },
    { key: 'risk', label: 'Portfolio risk', higherIsBetter: false },
    { key: 'credibility', label: 'Credibility', higherIsBetter: true }
  ];

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }





  // What the player did for a trap, and (if missed) what would have counted.
  function trapDetail(data, trap) {
    function conditionName(id) {
      var c = data.proposal.conditions.filter(function (x) { return x.id === id; })[0];
      return c ? '"' + c.label + '"' : id;
    }
    function describe(t, withTarget) {
      if (t.kind === 'condition') return (t.hit ? 'You ticked ' : 'tick ') + conditionName(t.condition);
      if (t.kind === 'loan') {
        return withTarget ? 'a loan of USD ' + fmt(t.target, 0) + 'm or less' : 'Your loan: USD ' + fmt(t.value, 2) + 'm';
      }
      var input = data.model.inputs[t.input];
      var d = decimalsOf(input.step);
      var name = input.label.charAt(0).toLowerCase() + input.label.slice(1);
      if (withTarget && t.test === 'range') return name + ' between ' + fmt(t.min, d) + ' and ' + fmt(t.max, d) + ' ' + input.unit;
      if (withTarget) return name + ' ' + (t.test === 'max' ? '≤' : '≥') + ' ' + fmt(t.target, d) + ' ' + input.unit;
      return 'You used ' + fmt(t.value, d) + ' ' + input.unit + ' (' + name + ')';
    }
    var hits = trap.tests.filter(function (t) { return t.hit; });
    if (hits.length) return describe(hits[0], false);
    var used = trap.tests.filter(function (t) { return t.kind !== 'condition'; }).map(function (t) { return describe(t, false); });
    var needed = trap.tests.map(function (t) { return describe(t, true); });
    return (used.length ? used.join(' · ') + ' · ' : '') + 'needed: ' + needed.join(', or ');
  }

  // ---------- Result: your answer next to the best answer ----------

  function inputValue(cfg, value) {
    return fmt(value, decimalsOf(cfg.step)) + ' ' + cfg.unit;
  }

  // Marks: true = ✓ (best answer), 'partial' = ≈ (acceptable), false = ✗.
  function mark(ok) {
    if (ok === 'partial') return el('span', 'mark mark-partial', '≈');
    return el('span', 'mark ' + (ok ? 'mark-ok' : 'mark-no'), ok ? '✓' : '✗');
  }

  // A control center value against the best answer: a range when the case
  // gives one (e.g. 5.5 to 6.2, best 6.0), otherwise the exact value.
  function judgeInput(cfg, value, best, range) {
    var d = decimalsOf(cfg.step);
    var eps = cfg.step / 2;
    if (!range) {
      return { text: inputValue(cfg, best), ok: Math.abs(value - best) <= eps + 1e-9 };
    }
    var text = fmt(range.min, d) + ' – ' + fmt(range.max, d) + ' ' + cfg.unit + ' (best ' + fmt(best, d) + ')';
    if (value >= range.min - 1e-9 && value <= range.max + 1e-9) return { text: text, ok: true };
    if (range.okMin !== undefined && value >= range.okMin - 1e-9 && value <= range.okMax + 1e-9) {
      return { text: text, ok: 'partial', note: range.okNote };
    }
    return { text: text, ok: false, note: range.offNote };
  }

  function compareTable(data, proposal, best, evaluation, loanRange, bestRange) {
    var table = el('table', 'compare');
    var head = el('tr');
    ['', 'You', 'Best answer', ''].forEach(function (h) { head.appendChild(el('th', null, h)); });
    var thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el('tbody');

    function row(label, yours, bestValue, ok, note) {
      var tr = el('tr', ok === true ? null : 'is-off');
      var th = el('td', 'compare-label');
      th.appendChild(el('div', null, label));
      if (note && ok !== true) th.appendChild(el('div', 'compare-note', note));
      tr.appendChild(th);
      tr.appendChild(el('td', null, yours));
      var bestCell = el('td');
      if (typeof bestValue === 'string') bestCell.textContent = bestValue;
      else bestCell.appendChild(bestValue);
      tr.appendChild(bestCell);
      var td = el('td', 'compare-mark');
      td.appendChild(mark(ok));
      tr.appendChild(td);
      body.appendChild(tr);
    }
    function section(title) {
      var tr = el('tr', 'compare-section');
      var td = el('td', null, title);
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }

    section('Decision');
    row('Decision', decisionLabel(data, proposal.decision), decisionLabel(data, best.decision), proposal.decision === best.decision);

    section('Control center');
    var ranges = best.ranges || {};
    Object.keys(data.model.inputs).forEach(function (key) {
      var cfg = data.model.inputs[key];
      var yours = proposal.assumptions[key];
      var target = best.assumptions[key];
      if (target === undefined) return;
      var j = judgeInput(cfg, yours, target, ranges[key]);
      row(cfg.label, inputValue(cfg, yours), j.text, j.ok, j.note);
    });
    // Loan: from the "too conservative" floor to the largest loan within policy,
    // for the tenor the player chose.
    // Best column: the best answer's own range first, then (if different) the
    // range that was possible with the player's tenor. The mark follows the
    // player's tenor, since that is what the policy allows for it.
    function rangeText(r) {
      return 'USD ' + money(Math.round(r.min * 10) / 10) + 'm – ' + money(Math.round(r.max * 10) / 10) + 'm';
    }
    var bestTenor = best.assumptions.tenor !== undefined ? best.assumptions.tenor : data.model.fixed.tenor;
    var cell = el('div');
    cell.appendChild(el('div', null, rangeText(bestRange) + (data.model.inputs.tenor ? ' over ' + bestTenor + ' years' : '')));
    var same = !loanRange.tenorRefused && Math.abs(loanRange.min - bestRange.min) < 0.05 && Math.abs(loanRange.max - bestRange.max) < 0.05;
    if (!same) {
      var label = proposal.tenor !== bestTenor ? 'With your ' + proposal.tenor + '-year tenor: ' : 'With your conditions: ';
      cell.appendChild(el('div', 'compare-sub', label + (loanRange.tenorRefused ? 'not possible' : rangeText(loanRange))));
    }
    if (loanRange.tenorRefused) {
      row('Loan amount', 'USD ' + money(proposal.loan) + 'm', cell, false,
        'The bank does not lend over this tenor, whatever the amount.');
    } else {
      var loanOk = proposal.loan >= loanRange.min - 0.05 && proposal.loan <= loanRange.max + 0.05;
      row('Loan amount', 'USD ' + money(proposal.loan) + 'm', cell, loanOk,
        proposal.loan > loanRange.max ? 'Above what the bank case supports for this tenor.' : 'Well below what the bank could lend for this tenor.');
    }

    section('Conditions');
    var bestSet = {};
    best.conditions.forEach(function (id) { bestSet[id] = true; });
    var yourSet = proposal.decision === 'conditions' ? proposal.conditions : {};
    data.proposal.conditions.forEach(function (c) {
      var yours = !!yourSet[c.id];
      // Conditions that depend on the amount (syndication, sponsor guarantee)
      // are only wanted when the player's loan is above their threshold.
      var wanted = c.redundantIfLoanAtMost !== undefined
        ? proposal.loan > c.redundantIfLoanAtMost + 1e-9
        : !!bestSet[c.id];
      if (!yours && !wanted) return;
      var item = evaluation.conditions.items.filter(function (i) { return i.id === c.id; })[0];
      row(c.label, yours ? 'Ticked' : '—', wanted ? 'Ticked' : '—', yours === wanted, item ? item.reason : c.reason);
    });

    if (proposal.decision === 'conditions') {
      section('Weight on the sponsor');
      var b = evaluation.burden;
      row('Total weight (maximum ' + b.max + ')', String(b.total), '—', b.total <= b.max,
        'Too heavy: the sponsor takes the competitor\'s offer.');
    }

    table.appendChild(body);
    return table;
  }

  function renderResult(opts) {
    var data = opts.caseData;
    var ev = opts.evaluation;
    var score = opts.score;
    var best = data.answerKey.best;
    var root = $('result');
    root.textContent = '';
    root.appendChild(resultNav(opts, true));

    // 1. Outcome, score and gauges
    var hero = el('section', 'card result-hero');
    hero.dataset.outcome = ev.outcomeKey;
    var top = el('div', 'hero-top');
    var text = el('div');
    text.appendChild(el('p', 'eyebrow', 'Outcome · ' + data.title));
    text.appendChild(el('h1', null, ev.outcome.label));
    text.appendChild(el('p', 'lead', ev.outcome.story));
    if (ev.decision.unbacked) {
      text.appendChild(el('p', 'hero-note',
        'Right decision, but not backed by your analysis: the traps that size the debt were not fixed in your control center, so the decision earns ' +
        ev.decision.points + ' / ' + ev.decision.max + '.'));
    }
    top.appendChild(text);
    var big = el('div', 'hero-score');
    big.appendChild(el('span', 'score-total', String(score.total)));
    big.appendChild(el('span', 'score-max', '/ ' + score.max));
    top.appendChild(big);
    hero.appendChild(top);

    var gauges = el('div', 'hero-gauges');
    GAUGES.forEach(function (g) {
      var before = opts.gaugesBefore[g.key];
      var after = opts.gaugesAfter[g.key];
      var delta = after - before;
      var tone = delta === 0 ? 'neutral' : (delta > 0) === g.higherIsBetter ? 'good' : 'bad';
      var chip = el('div', 'gauge-chip');
      chip.appendChild(el('span', 'gauge-chip-name', g.label));
      chip.appendChild(el('span', 'delta delta-' + tone, signed(delta)));
      chip.appendChild(el('span', 'muted small', before + ' → ' + after));
      gauges.appendChild(chip);
    });
    hero.appendChild(gauges);
    root.appendChild(hero);

    // 2. Your answer next to the best answer
    var compare = el('section', 'card');
    compare.appendChild(el('h2', null, 'Your answer vs the best answer'));
    compare.appendChild(compareTable(data, opts.proposal, best, ev, opts.loanRange, opts.bestLoanRange));
    if (best.note) compare.appendChild(el('p', 'best-note', best.note));
    if (opts.proposal.justification) {
      compare.appendChild(el('div', 'answer-label', 'Your justification'));
      compare.appendChild(el('blockquote', 'doc-quote', opts.proposal.justification));
    }
    root.appendChild(compare);

    // 3. Score: traps, decision, conditions, committee
    var card = el('section', 'card');
    card.appendChild(el('h2', null, 'Your score'));
    var trapPoints = ev.traps.reduce(function (s, t) { return s + t.points; }, 0);
    var trapMax = ev.traps.reduce(function (s, t) { return s + t.max; }, 0);
    var parts = el('div', 'score-parts');
    [['Traps spotted', trapPoints, trapMax], ['Decision', ev.decision.points, ev.decision.max],
      ['Conditions', ev.conditions.points, ev.conditions.max], ['Committee', score.committeePoints, score.committeeMax]
    ].forEach(function (p) {
      var part = el('div', 'score-part');
      part.appendChild(el('div', 'score-part-label', p[0]));
      var val = el('div', 'score-part-value', String(p[1]));
      val.appendChild(el('span', null, ' / ' + p[2]));
      part.appendChild(val);
      parts.appendChild(part);
    });
    card.appendChild(parts);

    ev.traps.forEach(function (t, i) {
      var trap = el('div', 'trap-line' + (t.hit ? ' is-hit' : ''));
      trap.appendChild(mark(t.hit));
      var body = el('div');
      var head = el('div', 'trap-head');
      head.appendChild(el('span', 'score-label', t.label.replace(/ spotted/, '')));
      head.appendChild(el('span', 'score-points', t.points + ' / ' + t.max));
      body.appendChild(head);
      if (data.debrief.spotted[i]) body.appendChild(el('p', 'trap-text', data.debrief.spotted[i]));
      if (!t.hit) body.appendChild(el('p', 'muted small', trapDetail(data, t)));
      trap.appendChild(body);
      card.appendChild(trap);
    });
    root.appendChild(card);

    // 4. Committee: your answer next to what was expected
    var committee = el('section', 'card');
    committee.appendChild(el('h2', null, 'Committee'));
    data.committee.forEach(function (q, i) {
      var c = score.committee[i];
      var block = el('div', 'qa');
      var head = el('div', 'qa-head');
      var who = el('div');
      who.appendChild(el('div', 'qa-who', q.askedBy + ' · ' + q.role));
      who.appendChild(el('div', 'qa-question', q.question));
      head.appendChild(who);
      head.appendChild(el('span', 'qa-points points-' + c.points, c.points + ' / ' + c.max));
      block.appendChild(head);
      var cols = el('div', 'qa-cols');
      var yours = el('div', 'qa-col');
      yours.appendChild(el('div', 'answer-label', 'Your answer'));
      yours.appendChild(el('p', 'answer-text', opts.answers[i] || '—'));
      cols.appendChild(yours);
      var expected = el('div', 'qa-col qa-expected');
      expected.appendChild(el('div', 'answer-label', 'What was expected'));
      expected.appendChild(el('p', null, q.goodAnswer));
      cols.appendChild(expected);
      block.appendChild(cols);
      var missing = c.ideas.filter(function (x) { return !x.hit; }).map(function (x) { return x.label; });
      var noNumber = !c.numbers.some(function (n) { return n.hit; });
      var hints = [];
      if (c.points < 2 && missing.length) hints.push('Missing idea: ' + missing.join('; '));
      if (c.points < 2 && noNumber) hints.push('No supporting number found');
      if (hints.length) block.appendChild(el('p', 'qa-hint', hints.join(' · ')));
      committee.appendChild(block);
    });
    root.appendChild(committee);

    // 5. Lesson
    var lesson = lessonCard(data);
    if (lesson) root.appendChild(lesson);

    // 6. Full answer key, folded
    var key = data.answerKey;
    var keyNode = el('details', 'card more');
    keyNode.appendChild(el('summary', null, 'Full answer key'));
    keyNode.appendChild(el('p', null, key.summary));
    key.traps.forEach(function (t) {
      keyNode.appendChild(el('h4', null, t.title));
      keyNode.appendChild(el('p', null, t.text));
    });
    (key.tables || [key.cases]).forEach(function (t) {
      keyNode.appendChild(el('h4', null, t.note));
      keyNode.appendChild(renderBlock({ type: 'table', head: t.head, rows: t.rows }));
      if (t.footer) keyNode.appendChild(el('p', null, t.footer));
    });
    keyNode.appendChild(el('h4', null, key.rightDecision.title));
    keyNode.appendChild(el('p', null, key.rightDecision.intro));
    keyNode.appendChild(renderBlock({ type: 'list', items: key.rightDecision.options }));
    keyNode.appendChild(el('h4', null, 'How each condition counts'));
    keyNode.appendChild(renderBlock({
      type: 'table',
      head: ['Condition', 'Points', 'Why'],
      rows: data.proposal.conditions.map(function (c) {
        var pts = c.redundantPoints !== undefined ? '+1 (−1 if not needed)' : (c.points > 0 ? '+' : '') + c.points;
        var why = c.reason + (c.redundantReason ? ' ' + c.redundantReason : '');
        return [c.label, pts, why];
      })
    }));
    keyNode.appendChild(el('p', null, data.rules.competition.explain));
    keyNode.appendChild(el('p', null, key.extraCredit));
    keyNode.appendChild(el('p', null, key.weakAnswers));
    root.appendChild(keyNode);

    root.appendChild(resultNav(opts, false));
  }

  // Summary and lesson of the debrief, when the case has them.
  function lessonCard(data) {
    if (!data.debrief.summary && !data.debrief.lesson) return null;
    var card = el('section', 'card lesson-card');
    if (data.debrief.summary) card.appendChild(el('p', null, data.debrief.summary));
    if (data.debrief.lesson) {
      var l = el('p', 'lesson');
      l.appendChild(el('strong', null, 'Lesson: '));
      l.appendChild(document.createTextNode(data.debrief.lesson));
      card.appendChild(l);
    }
    return card;
  }

  // Buttons shown above and below the result: back to the case (when there
  // is one to review), all cases, play again.
  function resultNav(opts, top) {
    var nav = el('div', top ? 'result-nav' : 'result-actions');
    if (top && opts.onReview) {
      var back = el('button', 'back-link', '← Back to the case');
      back.type = 'button';
      back.addEventListener('click', opts.onReview);
      nav.appendChild(back);
    }
    var group = el('div', 'result-nav-group');
    var all = el('button', 'btn btn-ghost' + (top ? '' : ' btn-lg'), 'All cases');
    all.type = 'button';
    all.addEventListener('click', opts.onAllCases);
    group.appendChild(all);
    var again = el('button', 'btn btn-primary' + (top ? '' : ' btn-lg'), 'Play again');
    again.type = 'button';
    again.addEventListener('click', opts.onRestart);
    group.appendChild(again);
    nav.appendChild(group);
    return nav;
  }

  // Case skipped: the answer key and the best answer, without a score.
  function renderSkipped(opts) {
    var data = opts.caseData;
    var best = data.answerKey.best;
    var root = $('result');
    root.textContent = '';
    root.appendChild(resultNav(opts, true));

    var hero = el('section', 'card result-hero');
    hero.dataset.outcome = 'skipped';
    hero.appendChild(el('p', 'eyebrow', 'Answer key · ' + data.title));
    hero.appendChild(el('h1', null, 'Case skipped'));
    hero.appendChild(el('p', 'lead', 'No score and no change to your gauges. Here is what the case was testing, and the best answer.'));
    root.appendChild(hero);

    // Best answer: the control center and the conditions
    var card = el('section', 'card');
    card.appendChild(el('h2', null, 'The best answer'));
    var rows = [['Decision', decisionLabel(data, best.decision)]];
    Object.keys(data.model.inputs).forEach(function (key) {
      if (best.assumptions[key] === undefined) return;
      var cfg = data.model.inputs[key];
      var range = (best.ranges || {})[key];
      var d = decimalsOf(cfg.step);
      rows.push([cfg.label, range
        ? fmt(range.min, d) + ' – ' + fmt(range.max, d) + ' ' + cfg.unit + ' (best ' + fmt(best.assumptions[key], d) + ')'
        : inputValue(cfg, best.assumptions[key])]);
    });
    rows.push(['Loan amount', 'USD ' + money(best.loan) + 'm']);
    rows.push(['Conditions', data.proposal.conditions
      .filter(function (c) { return best.conditions.indexOf(c.id) !== -1; })
      .map(function (c) { return c.label; }).join(' · ')]);
    card.appendChild(renderBlock({ type: 'table', head: ['', 'Best answer'], rows: rows }));
    if (best.note) card.appendChild(el('p', 'best-note', best.note));
    root.appendChild(card);

    // The traps
    var traps = el('section', 'card');
    traps.appendChild(el('h2', null, 'The traps'));
    data.rules.score.traps.forEach(function (t, i) {
      var line = el('div', 'trap-line');
      line.appendChild(el('span', 'mark mark-partial', String(i + 1)));
      var body = el('div');
      body.appendChild(el('div', 'score-label', t.label.replace(/ spotted/, '')));
      if (data.debrief.spotted[i]) body.appendChild(el('p', 'trap-text', data.debrief.spotted[i]));
      line.appendChild(body);
      traps.appendChild(line);
    });
    root.appendChild(traps);

    // The committee questions and what a good answer contains
    var committee = el('section', 'card');
    committee.appendChild(el('h2', null, 'Committee'));
    data.committee.forEach(function (q) {
      var block = el('div', 'qa');
      var who = el('div');
      who.appendChild(el('div', 'qa-who', q.askedBy + ' · ' + q.role));
      who.appendChild(el('div', 'qa-question', q.question));
      block.appendChild(who);
      var expected = el('div', 'qa-col qa-expected');
      expected.style.marginTop = '10px';
      expected.appendChild(el('div', 'answer-label', 'What a good answer contains'));
      expected.appendChild(el('p', null, q.goodAnswer));
      block.appendChild(expected);
      committee.appendChild(block);
    });
    root.appendChild(committee);

    var lesson = lessonCard(data);
    if (lesson) root.appendChild(lesson);

    root.appendChild(resultNav(opts, false));
  }

  window.UI = {
    showScreen: showScreen,
    initFooter: initFooter,
    renderWelcome: renderWelcome,
    renderLoadError: renderLoadError,
    renderCaseHeader: renderCaseHeader,
    setGauges: setGauges,
    renderDocuments: renderDocuments,
    renderInputs: renderInputs,
    setInputValues: setInputValues,
    renderMetrics: renderMetrics,
    initCharts: initCharts,
    updateCharts: updateCharts,
    renderProposal: renderProposal,
    setProposalState: setProposalState,
    renderResult: renderResult,
    renderSkipped: renderSkipped,
    showResultsBar: showResultsBar,
    chat: chat
  };
})();
