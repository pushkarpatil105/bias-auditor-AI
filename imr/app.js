/* ==========================================================
   Agent 1 — app.js
   UI Dashboard Controller & Rendering
   ========================================================== */

(() => {
  // ── State ──
  let csvRows = [];
  let ignored = new Set();
  let charts = [];
  let lastResult = null;

  // ── Refs ──
  const el = id => document.getElementById(id);

  // ── Page navigation ──
  const pages = { home: el('pageHome'), upload: el('pageUpload'), dashboard: el('pageDash') };
  const navBtns = { home: el('navHome'), upload: el('navUpload'), dashboard: el('navDash') };

  function goTo(page) {
    Object.values(pages).forEach(p => p.classList.remove('active'));
    Object.values(navBtns).forEach(b => b.classList.remove('active'));
    pages[page].classList.add('active');
    navBtns[page].classList.add('active');
    window.scrollTo({ top: 0 });
  }

  navBtns.home.onclick = () => goTo('home');
  navBtns.upload.onclick = () => goTo('upload');
  navBtns.dashboard.onclick = () => { if (lastResult) goTo('dashboard'); };

  // ── Home buttons ──
  el('heroUploadBtn').onclick = () => goTo('upload');
  el('heroDemoBtn').onclick = loadDemo;
  el('uploadDemoBtn').onclick = loadDemo;

  // ── Upload / drag-drop ──
  const dropZone = el('dropZone');
  const csvInput = el('csvInput');
  dropZone.onclick = () => csvInput.click();
  dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('over'); };
  dropZone.ondragleave = () => dropZone.classList.remove('over');
  dropZone.ondrop = e => { e.preventDefault(); dropZone.classList.remove('over'); if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]); };
  csvInput.onchange = e => { if (e.target.files[0]) parseFile(e.target.files[0]); };

  function parseFile(file) {
    if (!file.name.endsWith('.csv')) return alert('Please select a .csv file.');
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: res => {
        csvRows = res.data;
        el('fileInfo').style.display = 'flex';
        el('fileName').textContent = file.name;
        el('fileRows').textContent = `${csvRows.length} rows`;
        setTimeout(runAnalysis, 150);
      },
      error: () => alert('Failed to parse CSV.')
    });
  }

  el('analyzeBtn').onclick = () => runAnalysis();

  function loadDemo() {
    csvRows = BiasEngine.generateDemo();
    goTo('upload');
    el('fileInfo').style.display = 'flex';
    el('fileName').textContent = 'demo_dataset.csv';
    el('fileRows').textContent = '80 rows';
    setTimeout(runAnalysis, 300);
  }

  // ── Re-analyze ──
  el('rerunBtn').onclick = () => runAnalysis();

  // ── Run analysis ──
  function runAnalysis() {
    if (!csvRows.length) return alert('No data loaded.');
    el('loader').classList.add('on');
    setTimeout(() => {
      const result = BiasEngine.analyze(csvRows, [...ignored]);
      if (result.error) { el('loader').classList.remove('on'); return alert(result.error); }
      lastResult = result;
      navBtns.dashboard.disabled = false;
      buildChips(result.columns, result.decisionCol);
      renderStats(result);
      renderScore(result.fairness);
      renderAlert(result);
      renderCharts(result.groupResults);
      renderFlagged(result);
      renderInsights(result);
      renderSuggestions(result);
      goTo('dashboard');
      el('loader').classList.remove('on');
    }, 450);
  }

  // ── Chips ──
  function buildChips(cols, decCol) {
    const wrap = el('chips');
    wrap.innerHTML = '';
    cols.forEach(c => {
      if (c === decCol) return;
      const sp = document.createElement('span');
      sp.className = 'chip' + (ignored.has(c) ? ' off' : '');
      sp.textContent = c;
      sp.onclick = () => { ignored.has(c) ? ignored.delete(c) : ignored.add(c); sp.classList.toggle('off'); };
      wrap.appendChild(sp);
    });
  }

  // ── Stats ──
  function renderStats(r) {
    el('statsRow').innerHTML = [
      mk('Total Candidates', r.total, '', 'c1'),
      mk('Selected', r.selected, `${(r.selRate*100).toFixed(1)}% rate`, 'c2'),
      mk('Rejected', r.rejected, `${((1-r.selRate)*100).toFixed(1)}% rate`, 'c3'),
      mk('Columns Analyzed', r.activeCols.length, `${r.ignoredCount} ignored`, 'c4'),
      mk('Fairness Score', r.fairness, 'out of 1.0', 'c5')
    ].join('');
  }
  function mk(label, val, sub, cls) {
    return `<div class="card stat ${cls}"><div class="stat-lbl">${label}</div><div class="stat-val">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  }

  // ── Score ring ──
  function renderScore(score) {
    const circ = 2 * Math.PI * 68;
    const ring = el('ringFg');
    ring.style.strokeDasharray = circ;
    requestAnimationFrame(() => { ring.style.strokeDashoffset = circ * (1 - score); });
    const color = score >= .8 ? '#10b981' : score >= .5 ? '#f59e0b' : '#ef4444';
    ring.style.stroke = color;
    el('scoreVal').textContent = score.toFixed(2);
    el('scoreVal').style.color = color;
    let label, cls;
    if (score >= .8) { label = '✅ Fair'; cls = 'fair'; }
    else if (score >= .5) { label = '⚠️ Marginal'; cls = 'warn'; }
    else { label = '🚨 Biased'; cls = 'bias'; }
    el('verdict').innerHTML = `<span class="badge ${cls}">${label}</span>`;
  }

  // ── Alert card ──
  function renderAlert(r) {
    const biased = r.groupResults.filter(g => g.hasBias);
    if (r.fairness >= .8 && r.flagged.length === 0) {
      el('alertEmoji').textContent = '✅';
      el('alertTitle').textContent = 'No Significant Bias Detected';
      el('alertMsg').textContent = 'Selection rates are balanced across groups. No individual fairness issues found.';
    } else {
      el('alertEmoji').textContent = '🚨';
      el('alertTitle').textContent = 'Potential Bias Detected';
      const parts = [];
      if (biased.length) parts.push('Group bias in: ' + biased.map(g => g.column).join(', '));
      if (r.flagged.length) parts.push(r.flagged.length + ' individual fairness violation(s)');
      el('alertMsg').textContent = parts.join('. ') + '.';
    }
  }

  // ── Charts ──
  function renderCharts(groupResults) {
    charts.forEach(c => c.destroy());
    charts = [];
    const grid = el('chartGrid');
    grid.innerHTML = '';
    if (!groupResults.length) { grid.innerHTML = '<p style="color:var(--t3);padding:1rem">No categorical columns to chart.</p>'; return; }
    groupResults.forEach(gr => {
      const div = document.createElement('div');
      div.className = 'card chart-c';
      const uid = 'ch_' + gr.column.replace(/\W/g, '_');
      div.innerHTML = `<h4>Selection Rate by ${gr.column}</h4><canvas id="${uid}"></canvas>`;
      grid.appendChild(div);
      requestAnimationFrame(() => {
        const ctx = document.getElementById(uid).getContext('2d');
        const ch = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: gr.groups.map(g => g.name),
            datasets: [{
              label: 'Selection Rate (%)',
              data: gr.groups.map(g => +(g.rate * 100).toFixed(1)),
              backgroundColor: gr.groups.map(g => g.biased ? 'rgba(239,68,68,.65)' : 'rgba(59,130,246,.65)'),
              borderColor: gr.groups.map(g => g.biased ? '#ef4444' : '#3b82f6'),
              borderWidth: 1, borderRadius: 6, barPercentage: .55
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '%' } } },
            scales: {
              y: { beginAtZero: true, max: 100, ticks: { color: '#4b5e78', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,.03)' } },
              x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
            }
          }
        });
        charts.push(ch);
      });
    });
  }

  // ── Flagged table ──
  function renderFlagged(r) {
    const head = el('flagHead');
    const body = el('flagBody');
    if (!r.flagged.length) {
      head.innerHTML = '<tr><th>Status</th></tr>';
      body.innerHTML = '<tr><td style="padding:1.2rem;text-align:center;color:var(--t3)">✅ No individual fairness violations.</td></tr>';
      return;
    }
    const show = r.activeCols.filter(c => c !== r.decisionCol).slice(0, 4);
    head.innerHTML = '<tr><th>#</th>' + show.map(c => `<th>${c}</th>`).join('') +
      '<th>Score</th><th>Decision</th><th>⇄</th>' + show.map(c => `<th>${c}</th>`).join('') +
      '<th>Score</th><th>Decision</th><th>Gap</th></tr>';
    body.innerHTML = r.flagged.slice(0, 20).map((f, i) => {
      const hc = show.map(c => `<td>${f.higher[c] ?? '-'}</td>`).join('');
      const lc = show.map(c => `<td>${f.lower[c] ?? '-'}</td>`).join('');
      return `<tr><td>${i+1}</td>${hc}<td><b>${f.hiScore}</b></td><td><span class="tag rej">Rejected</span></td>` +
        `<td style="text-align:center">↔</td>${lc}<td>${f.loScore}</td><td><span class="tag sel">Selected</span></td>` +
        `<td><b>${f.gap}</b></td></tr>`;
    }).join('');
  }

  // ── Insights ──
  function renderInsights(r) {
    const cards = [];
    r.groupResults.filter(g => g.hasBias).forEach(gr => {
      gr.groups.filter(g => g.biased).forEach(g => {
        const best = Math.max(...gr.groups.map(x => x.rate));
        cards.push({ i: '⚠️', t: `"${g.name}" has lower selection in ${gr.column}`,
          p: `Selection rate is ${(g.rate*100).toFixed(1)}% vs the highest group at ${(best*100).toFixed(1)}%. Disparate impact ratio: ${g.impact.toFixed(2)} (below 0.80 threshold).` });
      });
    });
    if (r.flagged.length) {
      cards.push({ i: '🔍', t: `${r.flagged.length} individual fairness issue(s)`,
        p: `Higher-scoring candidates were rejected while lower-scoring ones were selected. This suggests inconsistent or biased decision criteria on "${r.scoreCol}".` });
    }
    if (!cards.length) cards.push({ i: '✅', t: 'Decisions appear fair', p: 'No significant group bias or individual violations detected in the analyzed columns.' });
    el('insightGrid').innerHTML = cards.map(c => `<div class="card ins"><span class="ins-icon">${c.i}</span><h4>${c.t}</h4><p>${c.p}</p></div>`).join('');
  }

  // ── Suggestions ──
  function renderSuggestions(r) {
    const s = [];
    const biased = r.groupResults.filter(g => g.hasBias);
    if (biased.length) {
      s.push({ t: 'Review sensitive attributes', p: `"${biased.map(b => b.column).join('", "')}" show disparate impact. Consider removing from the decision process or applying bias correction.` });
      s.push({ t: 'Balance your dataset', p: 'Ensure underrepresented groups have sufficient representation in training data.' });
    }
    if (r.flagged.length) {
      s.push({ t: 'Standardize decision criteria', p: 'Individual violations suggest inconsistent scoring. Use clear, transparent rules.' });
      s.push({ t: 'Add human review', p: 'Implement human-in-the-loop checkpoints for borderline cases.' });
    }
    s.push({ t: 'Run periodic audits', p: 'Schedule regular fairness checks to catch emerging bias patterns.' });
    s.push({ t: 'Use "Ignore Column"', p: 'Toggle a suspect column off above, re-analyze, and see if the fairness score improves.' });
    el('sugList').innerHTML = s.map((x, i) => `<div class="card sug"><div class="sug-n">${i+1}</div><div><h4>${x.t}</h4><p>${x.p}</p></div></div>`).join('');
  }
})();
