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

  // Each assumption gets a slider and a number field kept in sync.
  // `onChange(key, value)` is called with the new value; game.js then
  // recomputes and calls setInputValues to redraw both controls.
  function renderInputs(config, onChange) {
    var container = $('inputs');
    container.textContent = '';

    Object.keys(config).forEach(function (key) {
      var cfg = config[key];
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

      container.appendChild(row);
    });
  }

  function setInputValues(config, values, sponsorValues) {
    Object.keys(config).forEach(function (key) {
      var cfg = config[key];
      var value = values[key];
      var num = $('num-' + key);
      var range = $('range-' + key);
      range.value = value;
      range.style.setProperty('--fill', ((value - cfg.min) / (cfg.max - cfg.min)) * 100 + '%');
      // Don't rewrite the field the player is typing in.
      if (document.activeElement !== num) num.value = value.toFixed(decimalsOf(cfg.step));
      num.closest('.input-row').classList.toggle('changed', value !== sponsorValues[key]);
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
    updateCharts: updateCharts
  };
})();
