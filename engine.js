/* ==========================================================
   Agent 2 — engine.js
   Data Processing & Bias Detection Logic
   ========================================================== */

const BiasEngine = (() => {

  // ── Detect the decision column ──
  function findDecisionCol(cols, rows) {
    const hints = ['selected','decision','outcome','result','hired','accepted','status'];
    for (const c of cols) {
      if (hints.includes(c.toLowerCase())) {
        const vals = new Set(rows.slice(0, 50).map(r => String(r[c]).toLowerCase()));
        if (['yes','no','1','0','true','false'].some(v => vals.has(v))) return c;
      }
    }
    for (const c of cols) {
      const sample = rows.slice(0, 50).map(r => String(r[c]).toLowerCase());
      const match = sample.filter(v => ['yes','no','1','0','true','false'].includes(v)).length;
      if (match > sample.length * 0.7) return c;
    }
    return null;
  }

  function isYes(val) {
    const v = String(val).toLowerCase();
    return v === 'yes' || v === '1' || v === 'true';
  }

  // ── Column classification ──
  function isCategorical(rows, col) {
    const uniq = new Set(rows.map(r => r[col]));
    return uniq.size >= 2 && uniq.size <= 15;
  }

  function isNumeric(rows, col) {
    return rows.slice(0, 30).filter(r => r[col] !== '' && r[col] != null).every(r => !isNaN(parseFloat(r[col])));
  }

  function detectScoreCol(numCols) {
    const hints = ['salary','pay','wage','compensation','score','skill','rating','gpa','marks','performance','rank','grade','points'];
    for (const c of numCols) {
      if (hints.some(h => c.toLowerCase().includes(h))) return c;
    }
    return numCols[0] || null;
  }

  // ── 1. Group Bias Detection ──
  function analyzeGroupBias(rows, col, decCol) {
    const groups = {};
    rows.forEach(r => {
      const g = String(r[col]);
      if (!groups[g]) groups[g] = { total: 0, selected: 0 };
      groups[g].total++;
      if (isYes(r[decCol])) groups[g].selected++;
    });
    const entries = Object.entries(groups).map(([name, v]) => ({
      name,
      total: v.total,
      selected: v.selected,
      rate: v.total ? v.selected / v.total : 0
    }));
    const maxRate = Math.max(...entries.map(e => e.rate), 0.001);
    entries.forEach(e => {
      e.impact = maxRate ? e.rate / maxRate : 1;
      e.biased = e.impact < 0.8;
    });
    return {
      column: col,
      groups: entries,
      hasBias: entries.some(e => e.biased)
    };
  }

  // ── 2. Individual Fairness ──
  function findUnfairCases(rows, scoreCol, decCol) {
    const scored = rows
      .map(row => ({ row, score: parseFloat(row[scoreCol]) }))
      .filter(item => Number.isFinite(item.score));
    const selected = scored.filter(item => isYes(item.row[decCol]));
    const flagged = [];
    for (const item of scored) {
      if (flagged.length >= 30) break;
      if (isYes(item.row[decCol])) continue; // only care about rejected candidates

      let bestMatch = null;
      let bestGap = Infinity;

      for (const candidate of selected) {
        const gap = item.score - candidate.score;
        if (gap < 2) continue;
        if (gap < bestGap) {
          bestGap = gap;
          bestMatch = candidate;
        }
      }

      if (!bestMatch) continue;

      flagged.push({
        higher: item.row,
        lower: bestMatch.row,
        hiScore: item.score,
        loScore: bestMatch.score,
        gap: +bestGap.toFixed(1)
      });
    }
    return flagged;
  }

  // ── 3. Fairness Score (0–1) ──
  function computeScore(groupResults, flagged, total) {
    let s = 1;
    groupResults.forEach(gr => {
      gr.groups.forEach(g => {
        if (g.biased) s -= (1 - g.impact) * 0.3;
      });
    });
    if (total > 0) s -= (flagged.length / total) * 2.5;
    return Math.max(0, Math.min(1, +s.toFixed(2)));
  }

  // ── Main entry ──
  function analyze(rows, ignoredCols = []) {
    if (!rows.length) return null;
    const cols = Object.keys(rows[0]);
    const decCol = findDecisionCol(cols, rows);
    if (!decCol) return { error: 'No decision column found (Selected/Decision with Yes/No values).' };

    const active = cols.filter(c => c !== decCol && !ignoredCols.includes(c));
    const catCols = active.filter(c => isCategorical(rows, c));
    const numCols = active.filter(c => isNumeric(rows, c));
    const scoreCol = detectScoreCol(numCols);

    const total = rows.length;
    const selected = rows.filter(r => isYes(r[decCol])).length;
    const rejected = total - selected;
    const selRate = total ? selected / total : 0;

    const groupResults = catCols.map(c => analyzeGroupBias(rows, c, decCol));
    const flagged = scoreCol ? findUnfairCases(rows, scoreCol, decCol) : [];
    const fairness = computeScore(groupResults, flagged, total);

    return {
      decisionCol: decCol,
      columns: cols,
      activeCols: active,
      scoreCol,
      total,
      selected,
      rejected,
      selRate,
      groupResults,
      flagged,
      fairness,
      ignoredCount: ignoredCols.length
    };
  }

  // ── Demo data generator ──
  function generateDemo() {
    const rows = [];
    const names = ['Alex','Jordan','Sam','Taylor','Morgan','Casey','Riley','Quinn','Drew','Avery',
      'Jamie','Harper','Reese','Skyler','Dakota','Finley','Rowan','Cameron','Sage','Blake',
      'Logan','Parker','Hayden','Emerson','Charlie','Bailey','Kendall','Peyton','Marley','Frankie'];
    const genders = ['Male','Female','Non-Binary'];
    const depts = ['Engineering','Marketing','Finance','HR','Sales'];
    const edu = ['Bachelor','Master','PhD'];
    for (let i = 0; i < 80; i++) {
      const gender = genders[i % 3];
      const exp = Math.floor(Math.random() * 15) + 1;
      const skill = Math.floor(Math.random() * 35) + 60;
      const e = edu[Math.floor(Math.random() * 3)];
      const d = depts[Math.floor(Math.random() * 5)];
      let chance = skill / 100;
      if (gender === 'Female') chance *= 0.6;
      if (gender === 'Non-Binary') chance *= 0.5;
      if (e === 'PhD') chance *= 1.12;
      let sel;
      if (i === 3 && skill >= 80) sel = 'No';
      else if (i === 7 && skill <= 70) sel = 'Yes';
      else if (i === 15 && skill >= 85) sel = 'No';
      else sel = Math.random() < chance ? 'Yes' : 'No';
      rows.push({ CandidateID: 'C' + String(i+1).padStart(3,'0'), Name: names[i % names.length],
        Gender: gender, Experience: exp, SkillScore: skill, Education: e, Department: d, Selected: sel });
    }
    return rows;
  }

  return { analyze, generateDemo };
})();
