'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const DEG = 180 / Math.PI, LN10 = Math.LN10;

  const fmt = (x, p = 4) => {
    if (x == null || Number.isNaN(x)) return '—';
    if (!isFinite(x)) return x > 0 ? '∞' : '−∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    const s = (a >= 1e5 || a < 1e-3) ? x.toExponential(p - 1) : String(+x.toPrecision(p));
    return s.replace(/-/g, '−').replace('e+', 'e');
  };
  const cpx = (a, b, op) => (a === 0 ? (op === '+' ? '' : op) : fmt(a) + ' ' + op + ' ') + 'j' + fmt(b);
  function rootsStr(rs) {
    if (!rs.length) return '无';
    const out = [], used = new Array(rs.length).fill(false);
    for (let i = 0; i < rs.length; i++) {
      if (used[i]) continue;
      const r = rs[i];
      used[i] = true;
      if (Math.abs(r[1]) < 1e-9 * (1 + Math.abs(r[0]))) { out.push(fmt(r[0])); continue; }
      const j = rs.findIndex((q, k) => !used[k] && Math.abs(q[0] - r[0]) < 1e-6 * (1 + Math.abs(r[0])) && Math.abs(q[1] + r[1]) < 1e-6 * (1 + Math.abs(r[1])));
      if (j >= 0) { used[j] = true; out.push(cpx(r[0], Math.abs(r[1]), '±')); }
      else out.push(cpx(r[0], Math.abs(r[1]), r[1] > 0 ? '+' : '−'));
    }
    return out.join('，');
  }
  const breakName = point => ({ breakaway: '分离点', breakin: '会合点', stationary: '重根候选' })[point.kind];
  const axisPoint = w => w === 0 ? 's = 0' : 's = ±j' + fmt(w);
  const anglesText = angles => angles.map(angle => fmt(angle > 180 ? angle - 360 : angle) + '°').join('，');

  function leadingPoles() {
    if (!cl.length) return [];
    const rightmost = Math.max(...cl.map(pole => pole[0]));
    return cl.filter(pole => Math.abs(pole[0] - rightmost) <= 1e-7 * Math.max(1e-12, Math.abs(rightmost), Math.abs(pole[0])));
  }

  function highlightedCrossings(points, best) {
    return (best ? [best, ...points.filter(point => point !== best)] : points).slice(0, 4);
  }
  function polyHTML(p) {
    const t = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const c = p[i];
      if (c === 0) continue;
      const a = Math.abs(c);
      const body = i === 0 ? fmt(a, 5) : (Math.abs(a - 1) < 1e-12 ? '' : fmt(a, 5)) + '<i>s</i>' + (i > 1 ? `<sup>${i}</sup>` : '');
      t.push({ neg: c < 0, body });
    }
    if (!t.length) return '0';
    return t.map((x, k) => (k === 0 ? (x.neg ? '−' : '') : (x.neg ? ' − ' : ' + ')) + x.body).join('');
  }

  const EX = [
    { name: '三阶积分系统', n: '1', d: 's(s+1)(s+2)', k: 1 },
    { name: '二阶系统', n: '1', d: 's(s+2)', k: 4 },
    { name: '带开环零点', n: 's+2', d: 's^2+2s+3', k: 1 },
    { name: '四阶振荡系统', n: '1', d: 's(s+4)(s^2+4s+20)', k: 100 },
    { name: 'II 型系统', n: 's+1', d: 's^2(s+10)', k: 10 },
    { name: '条件稳定系统', n: 's^2+2s+4', d: 's(s+4)(s+6)(s^2+1.4s+1)', k: 30 },
    { name: '非最小相位系统', n: '1-s', d: '(s+1)(s+2)', k: 1 },
    { name: '开环不稳定系统', n: 's+1', d: 's(s-1)', k: 2 },
    { name: '含纯延迟系统', n: '1', d: 's+1', k: 1, tau: 1 },
    { name: '系数列表示例', n: '10', d: '1 6 5 0', k: 1 },
  ];

  const state = { K: 1, sg: 1, duration: 0, frequency: null, view: 'all', model: null };
  let sys = null, S = null, RL = null, asy = null, brks = [], cross = null, ranges = [], mar = null, cl = [], stp = null;
  let rlStatic = { series: [], markers: [] }, rlHoverK = null, nyq = null, nic = null;
  let closedAnalysis = null, comparison = null, rlHome = null;
  let feedbackTimer = 0;
  const gainScale = { low: -3, high: 4 };
  const gainFields = [
    { number: $('kNum'), slider: $('kSlider'), error: $('kErr') },
    { number: $('mobileKNum'), slider: $('mobileKSlider'), error: $('mobileKErr') },
  ];

  function createPlot(canvas, readout, options) {
    return new Plot($(canvas), {
      onKeyboard(message) { $('plotAnnouncement').textContent = message || $(readout).textContent || '当前视图无可读数据'; },
      ...options,
    });
  }

  const P = {
    rl: createPlot('cRL', 'rRL', { equal: true, xlabel: '实轴 σ', ylabel: '虚轴 jω', onHover: hoverRL, onClick: h => { hoverRL(h); if (rlHoverK !== null) setK(rlHoverK); } }),
    mag: createPlot('cMag', 'rBode', { xlog: true, zoom: 'x', ylabel: 'L(ω) / dB', yMode: 'db', onHover: hoverBode, onClick: hoverBode, onView: linkBode }),
    ph: createPlot('cPh', 'rBode', { xlog: true, zoom: 'x', xlabel: 'ω / (rad/s)', ylabel: 'φ(ω) / °', yMode: 'deg', onHover: hoverBode, onClick: hoverBode, onView: linkBode }),
    nyq: createPlot('cNyq', 'rNyq', { equal: true, xlabel: 'Re', ylabel: 'Im', onHover: hoverNyq, onClick: hoverNyq }),
    nic: createPlot('cNic', 'rNic', { xlabel: '相角 / °', ylabel: '幅值 / dB', xMode: 'deg', yMode: 'db', onHover: hoverNic, onClick: hoverNic }),
    step: createPlot('cStep', 'rStep', { xlabel: 't / s', ylabel: 'c(t)', onHover: hoverStep, onClick: hoverStep }),
  };
  P.mag.m.b = 26;
  for (const plot of Object.values(P)) plot.o.drawLegend = false;
  const ro = (id, html) => {
    $(id).innerHTML = html || '';
    $(id).title = $(id).textContent;
  };

  /* ================= 系统构建 ================= */
  function rebuild() {
    const tau = $('tau').value === '' ? 0 : Number($('tau').value);
    try {
      const nextSystem = Ctl.makeSystem($('num').value, $('den').value, tau);
      const duration = readDuration();
      sys = nextSystem;
      state.duration = duration;
    } catch (e) {
      $('err').textContent = e.message + (state.model ? '。当前图表显示上次有效输入的结果。' : ''); $('err').hidden = false;
      $('controlOptions').open = true;
      if (/延迟|时长/.test(e.message)) $('advancedOptions').open = true;
      return;
    }
    $('err').hidden = true;
    state.sg = $('neg').checked ? -1 : 1;
    state.model = { n: $('num').value, d: $('den').value, tau, sg: state.sg };
    buildRL();
    P.mag.userView = P.ph.userView = false;
    P.nyq.userView = P.nic.userView = P.step.userView = false;
    renderTF();
    updateK();
  }

  function buildRL() {
    const sg = state.sg;
    RL = Ctl.rootLocus(sys, sg);
    asy = Ctl.asymptotes(sys, sg);
    brks = Ctl.breakaways(sys, sg, RL.Kref);
    cross = Ctl.jwCross(sys, sg);
    ranges = Ctl.stableRanges(sys, sg, cross.list, RL.Kref);
    const series = [], markers = [];
    if (asy) {
      const L = 1e5 * sys.R;
      for (const a of asy.angles) {
        const t = a / DEG;
        series.push({ x: [asy.sigma, asy.sigma + L * Math.cos(t)], y: [0, L * Math.sin(t)], color: '--muted', dash: [6, 5], width: 1 });
      }
      markers.push({ x: asy.sigma, y: 0, type: 'diamond', color: '--c3', label: ['渐近线中心', `σₐ = ${fmt(asy.sigma)}`], priority: 3, r: 4 });
    }
    RL.branches.forEach(b => series.push({ x: b.x, y: b.y, brk: b.brk, color: '--c1', width: 2.4, direction: true }));
    const xs = [], ys = [];
    const add = (x, y) => { xs.push(x); ys.push(y); };
    for (const b of brks) {
      markers.push({ x: b.s[0], y: b.s[1], type: 'diamond', color: '--c1', r: 4, label: [breakName(b), `${axisValue(b.s)} · K ${fmt(b.K)}`], priority: 4 });
      if (b.s[1] !== 0) markers.push({ x: b.s[0], y: -b.s[1], type: 'diamond', color: '--c1', r: 4 });
      add(b.s[0], b.s[1]); add(b.s[0], -b.s[1]);
    }
    for (const c of cross.list) {
      markers.push({ x: 0, y: c.w, type: 'o', color: '--c2', label: ['虚轴交点', `K ${fmt(c.K)} · ${axisPoint(c.w)}`], priority: 5, r: 4 });
      if (c.w > 0) markers.push({ x: 0, y: -c.w, type: 'o', color: '--c2', r: 4 });
      add(0, c.w); add(0, -c.w);
    }
    for (const [roots, type] of [[sys.zeros, 'o'], [sys.poles, 'x']]) {
      for (const root of roots) {
        markers.push({ x: root[0], y: root[1], type, color: '--fg', label: axisValue(root) });
        add(root[0], root[1]);
      }
    }
    if (asy) add(asy.sigma, 0);
    add(0, 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const h = Math.max(x1 - x0, y1 - y0, 0.6 * sys.R, 1e-9) * 0.75, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    rlStatic = { series, markers };
    P.rl.regions = [{ x0: 0, x1: Infinity, color: '--c2', alpha: 0.055 }];
    paintTrack();
    rlHome = [cx - h, cx + h, cy - h, cy + h];
    P.rl.setHome(rlHome, true);
  }

  function axisValue(root) { return `s = ${rootsStr([root])}`; }

  /* K 滑块轨道按稳定区间着色（对数刻度 10^-3 … 10^4） */
  function paintTrack() {
    const bar = $('kbar');
    const intervalText = ranges.map(([a, b]) => a === 0 && b === Infinity ? 'K > 0' : `${fmt(a)} < K < ${fmt(b)}`).join(' 或 ');
    $('trackNote').textContent = sys.tau > 0 ? '根轨迹与色带采用 τ=0 模型' : state.K === 0 ? 'K=0，频率裕度未定义' : '稳定范围 ' + (intervalText || '无渐近稳定区间');
    const pos = gainPosition;
    // 稳定区间：实心墨色；其余：橙色剖面线
    const stops = [];
    let cur = 0;
    for (const [a, b] of ranges) {
      const pa = pos(a), pb = pos(b);
      if (pb <= pa) continue;
      stops.push(`transparent ${cur}% ${pa}%`, `var(--fg) ${pa}% ${pb}%`);
      cur = pb;
    }
    stops.push(`transparent ${cur}% 100%`);
    bar.style.backgroundImage = `linear-gradient(90deg, ${stops.join(', ')}), repeating-linear-gradient(-45deg, var(--sig) 0 2px, transparent 2px 6px)`;
  }

  function gainPosition(K) {
    if (K === 0) return 0;
    if (K === Infinity) return 100;
    return Math.max(0, Math.min(100, (Math.log10(K) - gainScale.low + 0.5) / (gainScale.high - gainScale.low + 0.5) * 100));
  }

  function buildRuler() {
    for (const { slider } of gainFields) {
      slider.min = gainScale.low - 0.5;
      slider.max = gainScale.high;
    }
    let lines = '<line x1="0" x2="0" y1="2" y2="34"/>';
    const labels = ['<span style="left:0">0</span>'];
    const labelEvery = Math.max(1, Math.ceil((gainScale.high - gainScale.low) / 4));
    for (let exponent = gainScale.low; exponent <= gainScale.high; exponent++) {
      const position = gainPosition(Math.pow(10, exponent));
      const x = position * 7;
      lines += `<line x1="${x}" x2="${x}" y1="2" y2="34"/>`;
      if (position > 12 && ((exponent - gainScale.low - 1) % labelEvery === 0 || exponent === gainScale.high))
        labels.push(`<span style="left:${position}%">${exponent === 0 ? '1' : '10<sup>' + exponent + '</sup>'}</span>`);
      if (exponent < gainScale.high) {
        const minor = gainPosition(5 * Math.pow(10, exponent)) * 7;
        lines += `<line x1="${minor}" x2="${minor}" y1="20" y2="34"/>`;
      }
    }
    $('ruler').innerHTML = `<g stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke">${lines}</g>`;
    $('gainScale').innerHTML = labels.join('');
  }

  function syncGainControls(source) {
    const previousLow = gainScale.low, previousHigh = gainScale.high;
    if (state.K > 0) {
      gainScale.low = Math.min(gainScale.low, Math.floor(Math.log10(state.K)));
      gainScale.high = Math.max(gainScale.high, Math.ceil(Math.log10(state.K)));
    }
    if (previousLow !== gainScale.low || previousHigh !== gainScale.high) buildRuler();
    const exponent = state.K === 0 ? gainScale.low - 0.5 : Math.log10(state.K);
    for (const { number, slider, error } of gainFields) {
      if (number !== source) number.value = state.K;
      if (slider !== source || state.K === 0) slider.value = exponent;
      slider.setAttribute('aria-valuetext', 'K = ' + state.K);
      number.removeAttribute('aria-invalid');
      error.hidden = true;
    }
    if (sys) paintTrack();
  }

  function renderKPI() {
    const g = mar.bestG, p = mar.bestP, t = [];
    function tile(label, value, unit, status, detail) {
      const suffix = unit ? `<small>${unit}</small>` : '';
      t.push(`<div class="kpi ${status || ''}" title="${detail || label}"><span class="k">${label}</span>` +
        `<span class="v">${value}${suffix}</span><span class="s">${detail || ''}</span></div>`);
    }
    const descriptions = {
      stable: ['good', '稳定', '闭环极点全部在左半平面'],
      unstable: ['bad', '不稳定', unstableReason()],
      marginal: ['warn', '临界', '闭环极点位于虚轴'],
      singular: ['bad', '奇异增益', '闭环特征方程退化，常规闭环响应未定义'],
      unknown: ['warn', '待核查', '当前数值尺度下无法可靠判定'],
    };
    const description = sys.tau > 0 ? ['warn', '含延迟', `τ = ${fmt(sys.tau)} s · 频域计入延迟，根轨迹采用 τ=0 模型`] : descriptions[closedAnalysis.kind];
    $('status').className = 'status ' + description[0];
    $('status').innerHTML = `<span class="status-dot" aria-hidden="true"></span><strong>${description[1]}</strong><span class="sub visually-hidden">K = ${fmt(state.K)}，${description[2]}</span>`;
    $('status').title = description[2];
    tile('相角裕度', g ? fmt(g.pm) : '—', g ? '°' : '', g && g.pm <= 0 ? 'bad' : '', g ? `ωc = ${fmt(g.w)} rad/s` : state.K === 0 ? 'K=0，相角未定义' : '无正频率的 0 dB 交越');
    const phaseFrequency = p?.atInfinity ? 'ωx → ∞，最高次项抵消'
      : p?.w === 0 ? 'ωx = 0 rad/s（直流）'
      : p ? `ωx = ${fmt(p.w)} rad/s`
      : state.K === 0 ? 'K=0，裕度未定义' : '未找到负实轴交点';
    tile('幅值裕度', p ? fmt(p.gm) : state.K === 0 ? '—' : '∞', p ? 'dB' : '', p && p.gm <= 0 ? 'bad' : '', phaseFrequency);
    const ok = stp && !stp.err && stp.stable && stp.os != null;
    tile('超调量', ok ? fmt(stp.os) : '—', ok ? '%' : '', '', ok && stp.tp ? `tp = ${fmt(stp.tp)} s` : '');
    tile('调节时间', ok ? fmt(stp.ts) : '—', ok ? 's' : '', '', '2% 误差带');
    tile('稳态误差', ok ? fmt(1 - stp.yss) : '—', '', '', ok ? `c(∞) = ${fmt(stp.yss)}` : '');
    $('kpis').innerHTML = t.join('');
  }

  function unstableReason() {
    const reasons = [];
    if (closedAnalysis.rightCount) reasons.push(`${closedAnalysis.rightCount} 个闭环极点在右半平面`);
    if (closedAnalysis.repeatedAxis) reasons.push('闭环含虚轴重根');
    return reasons.join('，');
  }

  /* ================= 随 K 更新 ================= */
  function updateK() {
    if (!sys) return;
    const K = state.K, sg = state.sg;
    closedAnalysis = Ctl.closedStatus(sys, sg, K);
    cl = closedAnalysis.poles;
    S = Ctl.freqSamples(sys, sg, K);
    mar = Ctl.margins(sys, sg, S, K);
    stp = sys.tau > 0 ? { err: '阶跃仿真适用于 τ=0' } : Ctl.step(sys, sg, K, state.duration, closedAnalysis);
    fitBodeRange();
    drawRL(); bodeRefresh(); drawNyq(); drawNic(); drawStep(); renderInfo(); renderKPI();
    renderLegends();
    if (state.frequency !== null) showFrequency(state.frequency);
    renderCalculations();
    saveHash();
  }

  function drawRL() {
    const referenceBranches = comparison && !sameSystem(comparison.model, state.model)
      ? comparison.RL.branches.map(branch => ({ x: branch.x, y: branch.y, brk: branch.brk, color: '--c3', dash: [6, 4], width: 1.6 })) : [];
    P.rl.series = rlStatic.series.concat(referenceBranches);
    const dominant = leadingPoles(), featured = dominant.find(pole => pole[1] >= 0) || dominant[0];
    const paired = featured && featured[1] !== 0 && dominant.some(pole => pole[1] * featured[1] < 0 && Math.abs(pole[1] + featured[1]) < 1e-7 * Math.abs(featured[1]));
    P.rl.markers = rlStatic.markers.concat(cl.map(p => ({
      x: p[0], y: p[1], type: 'sq', color: '--accent', r: 4.5,
      label: p === featured ? ['主导极点', `s = ${paired ? cpx(p[0], Math.abs(p[1]), '±') : rootsStr([p])}`] : '', priority: 6,
    })));
    if (comparison) P.rl.markers.push(...comparison.cl.map(p => ({ x: p[0], y: p[1], type: 'o', color: '--c3', r: 5 })));
    if (!P.rl.userView) {
      P.rl.setHome(rlHome);
      includeView(P.rl, cl.concat(comparison ? [...comparison.sys.poles, ...comparison.sys.zeros, ...comparison.cl] : []));
    }
    $('rlModel').hidden = sys.tau === 0 && !(comparison && comparison.sys.tau > 0);
    $('rlModel').textContent = '根轨迹、闭环极点与稳定 K 区间采用 τ=0 模型。';
    P.rl.legend = [
      { label: 'K 增大方向', color: '--c1', symbol: '→' }, { label: '开环极点', color: '--fg', symbol: '×' },
      ...(sys.zeros.length ? [{ label: '开环零点', color: '--fg', symbol: '○' }] : []),
      { label: '当前闭环极点', color: '--accent', symbol: '▪' },
    ];
    if (asy) P.rl.legend.push({ label: '渐近线', color: '--muted', dash: [6, 5] });
    if (comparison) P.rl.legend.push({ label: '对比', color: '--c3', symbol: '○' });
    P.rl.draw();
  }
  function hoverRL(h) {
    rlHoverK = null; P.rl.cursor = null;
    if (!h || !RL) { P.rl.drawCursor(); return; }
    let best = null;
    for (const b of RL.branches) {
      const r = P.rl.nearest(b.x, b.y, h.px, h.py);
      if (!best || r.d < best.d) best = { i: r.i, d: r.d, b };
    }
    if (best && best.i >= 0 && (h.keyboard || best.d < 30)) {
      const x = best.b.x[best.i], y = best.b.y[best.i], K = best.b.k[best.i], wn = Math.hypot(x, y);
      P.rl.cursor = { x, y }; rlHoverK = K;
      ro('rRL', `<b>K = ${fmt(K)}</b>　s = ${fmt(x)} ${y < 0 ? '−' : '+'} j${fmt(Math.abs(y))}<span class="probe-more">　ζ = ${wn ? fmt(-x / wn) : '—'}　ω<sub>n</sub> = ${fmt(wn)}</span>`);
    } else ro('rRL', `s = ${fmt(h.x)} ${h.y < 0 ? '−' : '+'} j${fmt(Math.abs(h.y))}`);
    P.rl.drawCursor();
  }

  /* ---------- Bode ---------- */
  function linkBode(p) {
    const o = p === P.mag ? P.ph : P.mag;
    o.view[0] = p.view[0]; o.view[1] = p.view[1];
    o.userView = p.userView;
    bodeRefresh();
  }

  function fitBodeRange() {
    const frequencies = [sys.wLow / 10, sys.wHigh * 10];
    for (const analysis of [mar, comparison && comparison.mar].filter(Boolean)) {
      for (const point of [...analysis.gc, ...analysis.pc]) if (point.w > 0 && Number.isFinite(point.w)) frequencies.push(point.w / 3, point.w * 3);
    }
    if (comparison) frequencies.push(comparison.sys.wLow / 10, comparison.sys.wHigh * 10);
    const low = Math.floor(Math.log10(Math.min(...frequencies))), high = Math.ceil(Math.log10(Math.max(...frequencies)));
    P.mag.setHome([low, high, -1, 1]);
    P.ph.setHome([low, high, -1, 1]);
  }
  function bodeRefresh() {
    if (!sys) return;
    if (state.K === 0) {
      for (const plot of [P.mag, P.ph]) {
        plot.series = []; plot.markers = []; plot.legend = []; plot.hlines = [];
        plot.view[2] = -1; plot.view[3] = 1;
        plot.message = plot === P.mag ? 'K = 0，开环幅值为 0（−∞ dB）' : 'K = 0，相角未定义';
        plot.draw();
      }
      if (comparison && comparison.model.k > 0) {
        const x = comparison.S.w.map(frequency => Math.log10(frequency));
        const magnitude = comparison.S.lm.map(value => (value + Math.log(comparison.model.k)) * 20 / LN10);
        const phase = comparison.S.ph.map(value => value * DEG);
        for (const [plot, values] of [[P.mag, magnitude], [P.ph, phase]]) {
          const finite = values.filter(Number.isFinite);
          plot.message = '';
          plot.series = [{ x, y: values, color: '--c3', dash: [6, 4], width: 1.8 }];
          plot.legend = [{ label: '对比 K=' + fmt(comparison.model.k), color: '--c3', dash: [6, 4] }];
          const low = Math.min(...finite), high = Math.max(...finite), padding = Math.max(10, (high - low) * .08);
          plot.view[2] = low - padding; plot.view[3] = high + padding;
          plot.draw();
        }
        ro('rBode', '当前 K=0，开环幅值为 0，相角未定义。虚线显示对比模型。');
      }
      return;
    }
    P.mag.message = P.ph.message = '';
    const K = state.K, sg = state.sg, lk = Math.log(K), a = P.mag.view[0], b = P.mag.view[1], N = 600;
    const lx = [];
    for (let i = 0; i <= N; i++) lx.push(a + (b - a) * i / N);
    for (const { w } of [...mar.gc, ...mar.pc]) {
      const x = Math.log10(w);
      if (x > a && x < b) lx.push(x);
    }
    for (const r of [...sys.poles, ...sys.zeros]) {       // 谐振峰附近加密
      const mg = Cx.abs(r);
      if (r[1] > 0 && Math.abs(r[0]) < 0.5 * mg) {
        const z = Math.max(Math.abs(r[0]) / mg, 1e-4), c = Math.log10(mg);
        for (let j = -30; j <= 30; j++) { const x = c + (j / 30) * 6 * z / LN10; if (x > a && x < b) lx.push(x); }
      }
    }
    lx.sort((p, q) => p - q);
    const db = [], ph = [], referenceDb = [], referencePhase = [];
    for (const x of lx) {
      const r = Ctl.resp(sys, sg, Math.pow(10, x));
      db.push((r[0] + lk) * 20 / LN10); ph.push(r[1] * DEG);
      if (comparison && comparison.model.k > 0) {
        const response = Ctl.resp(comparison.sys, comparison.model.sg, Math.pow(10, x));
        referenceDb.push((response[0] + Math.log(comparison.model.k)) * 20 / LN10);
        referencePhase.push(response[1] * DEG);
      }
    }
    const ax = [a];
    for (const c of sys.corners) { const x = Math.log10(c); if (x > a && x < b) ax.push(x); }
    ax.push(b);
    const ay = ax.map(x => Ctl.asymDb(sys, K, Math.pow(10, x)));
    const amin = Math.min(...ay), amax = Math.max(...ay);
    let lo = amin, hi = amax;
    for (const v of db) if (isFinite(v)) { lo = Math.min(lo, Math.max(v, amin - 40)); hi = Math.max(hi, Math.min(v, amax + 40)); }
    for (const value of referenceDb) if (Number.isFinite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
    lo = Math.floor((lo - 5) / 20) * 20; hi = Math.ceil((hi + 5) / 20) * 20;
    if (hi - lo < 40) { lo -= 20; hi += 20; }
    P.mag.view[2] = lo; P.mag.view[3] = hi;
    let pl = Infinity, pu = -Infinity;
    for (const v of ph) if (isFinite(v)) { pl = Math.min(pl, v); pu = Math.max(pu, v); }
    for (const value of referencePhase) if (Number.isFinite(value)) { pl = Math.min(pl, value); pu = Math.max(pu, value); }
    pl = Math.floor((pl - 5) / 45) * 45; pu = Math.ceil((pu + 5) / 45) * 45;
    if (pu - pl < 90) { pl -= 45; pu += 45; }
    P.ph.view[2] = pl; P.ph.view[3] = pu;

    const ms = [{ x: ax, y: ay, color: '--c4', dash: [7, 4], width: 1.6 }, { x: lx, y: db, color: '--c1', width: 2.2 }], mm = [];
    const ps = [{ x: lx, y: ph, color: '--c1', width: 2.2 }], pm = [];
    if (referenceDb.length) {
      ms.push({ x: lx, y: referenceDb, color: '--c3', dash: [6, 4], width: 1.8 });
      ps.push({ x: lx, y: referencePhase, color: '--c3', dash: [6, 4], width: 1.8 });
    }
    highlightedCrossings(mar.gc, mar.bestG).forEach(g => {
      const x = Math.log10(g.w);
      mm.push({ x, y: 0, type: 'dot', color: '--c2', label: ['0 dB 交越', `ωc = ${fmt(g.w)}`], priority: g === mar.bestG ? 5 : 1 });
      ps.push({ x: [x, x], y: [g.ph - g.pm, g.ph], color: '--c3', width: 1.6 });
      pm.push({ x, y: g.ph, type: 'dot', color: '--c3', label: ['相角裕度 γ', `${fmt(g.pm)}°`], priority: g === mar.bestG ? 5 : 1 });
    });
    highlightedCrossings(mar.pc, mar.bestP).forEach(p => {
      if (!(p.w > 0 && Number.isFinite(p.w))) return;
      const x = Math.log10(p.w);
      ms.push({ x: [x, x], y: [0, p.db], color: '--c3', width: 1.6 });
      mm.push({ x, y: p.db, type: 'dot', color: '--c3', label: ['幅值裕度 h', `${fmt(p.gm)} dB`], priority: p === mar.bestP ? 5 : 1 });
      pm.push({ x, y: p.level, type: 'dot', color: '--c2', label: [`${fmt(p.level)}° 交越`, `ωx = ${fmt(p.w)}`], priority: p === mar.bestP ? 5 : 1 });
    });
    for (const corner of sys.corners) {
      const x = Math.log10(corner);
      if (x <= a || x >= b) continue;
      mm.push({ x, y: Ctl.asymDb(sys, K, corner), type: 'o', color: '--muted', r: 2.5, label: `转折 ${fmt(corner)}`, priority: -1 });
    }
    P.mag.series = ms; P.mag.markers = mm;
    P.mag.legend = [{ label: '精确曲线', color: '--c1' }, { label: '渐近线', color: '--c4', dash: [7, 4] }];
    if (referenceDb.length) P.mag.legend.push({ label: '对比', color: '--c3', dash: [6, 4] });
    P.ph.series = ps; P.ph.markers = pm; P.ph.hlines = [];
    const lineSpacing = 360 * Math.max(1, Math.ceil((pu - pl) / (360 * 24)));
    const firstLine = Math.ceil((pl + 180) / lineSpacing) * lineSpacing - 180;
    for (let i = 0; i <= 24; i++) {
      const v = firstLine + i * lineSpacing;
      if (!(v <= pu)) break;
      P.ph.hlines.push({ v, color: '--c2', dash: [5, 4] });
    }
    P.mag.draw(); P.ph.draw();
  }
  function hoverBode(h) {
    if (h && sys) showFrequency(Math.pow(10, h.x));
  }

  function showFrequency(w) {
    if (!sys || !(w > 0) || !Number.isFinite(w)) return;
    state.frequency = w;
    if (document.activeElement !== $('frequency')) $('frequency').value = +w.toPrecision(7);
    const response = Ctl.resp(sys, state.sg, w), magnitude = state.K === 0 ? 0 : Math.exp(response[0] + Math.log(state.K));
    const phase = response[1] * DEG, db = state.K === 0 ? -Infinity : (response[0] + Math.log(state.K)) * 20 / LN10;
    const real = magnitude * Math.cos(response[1]), imaginary = magnitude * Math.sin(response[1]);
    P.mag.vcursor = P.ph.vcursor = Math.log10(w);
    P.nyq.cursor = { x: real, y: imaginary };
    P.nic.cursor = state.K === 0 ? null : { x: phase, y: db };
    const frequency = `<b>ω = ${fmt(w)} rad/s</b>`;
    ro('rBode', `${frequency}　L = ${fmt(db)} dB　|G| = ${fmt(magnitude)}　φ = ${state.K === 0 ? '未定义' : fmt(phase) + '°'}`);
    ro('rNyq', `${frequency}　G(jω) = ${fmt(real)} ${imaginary < 0 ? '−' : '+'} j${fmt(Math.abs(imaginary))}`);
    ro('rNic', `${frequency}　φ = ${state.K === 0 ? '未定义' : fmt(phase) + '°'}　L = ${fmt(db)} dB`);
    P.mag.drawCursor(); P.ph.drawCursor(); P.nyq.drawCursor(); P.nic.drawCursor();
  }

  /* ---------- Nyquist ---------- */
  function drawNyq() {
    const K = state.K, sg = state.sg, lk = Math.log(K), n = S.w.length;
    const re = new Float64Array(n), im = new Float64Array(n), imn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const mg = Math.exp(S.lm[i] + lk);
      re[i] = mg * Math.cos(S.ph[i]); im[i] = mg * Math.sin(S.ph[i]); imn[i] = -im[i];
    }
    nyq = { re, im, imn };
    let Lm = Infinity;
    if (sys.imagPoles || sys.m > sys.n) {
      let mx = 0;
      for (const c of sys.corners) {
        if (sys.poles.some(p => p[0] === 0 && Math.abs(Cx.abs(p) - c) < 1e-4 * c)) continue;
        const v = K * Math.exp(Ctl.resp(sys, sg, c)[0]);
        if (isFinite(v)) mx = Math.max(mx, v);
      }
      for (const p of mar.pc) mx = Math.max(mx, Math.pow(10, p.db / 20));
      Lm = Math.max(2.5, 1.5 * mx);
    }
    let x0 = -1.3, x1 = 0.4, y1 = 0.6;
    for (let i = 0; i < n; i++) {
      if (Math.hypot(re[i], im[i]) > Lm) continue;
      x0 = Math.min(x0, re[i]); x1 = Math.max(x1, re[i]); y1 = Math.max(y1, Math.abs(im[i]));
    }
    const dx = (x1 - x0) * 0.1, hy = y1 * 1.12, hx0 = x0 - dx, hx1 = x1 + dx;
    P.nyq.setHome([hx0, hx1, -hy, hy]);
    const uc = { x: [], y: [], color: '--muted', dash: [3, 4], width: 1 };
    for (let i = 0; i <= 180; i++) { uc.x.push(Math.cos(i * Math.PI / 90)); uc.y.push(Math.sin(i * Math.PI / 90)); }
    P.nyq.series = [uc, { x: re, y: imn, brk: S.brk, color: '--c1', dash: [5, 4], width: 1.4 }, { x: re, y: im, brk: S.brk, color: '--c1', width: 2.2 }];
    if (comparison) {
      P.nyq.series.push({ x: comparison.polar.re, y: comparison.polar.im, brk: comparison.S.brk, color: '--c3', dash: [6, 4], width: 1.8 });
      P.nyq.series.push({ x: comparison.polar.re, y: comparison.polar.imn, brk: comparison.S.brk, color: '--c3', dash: [2, 4], width: 1.2 });
      includeView(P.nyq, comparison.polar.re.map((real, i) => [real, comparison.polar.im[i]]), Math.max(3, Lm === Infinity ? 10 * Math.max(Math.abs(hx0), Math.abs(hx1), hy) : Lm));
    }
    const mk = [];
    if (K === 0) mk.push({ x: 0, y: 0, type: 'dot', color: '--c1', label: ['零增益', 'L(jω) = 0'], priority: 4 });
    if (comparison && comparison.model.k === 0) mk.push({ x: 0, y: 0, type: 'o', color: '--c3', label: '对比 K=0' });
    const ins = i => re[i] >= hx0 && re[i] <= hx1 && Math.abs(im[i]) <= hy;
    const cum = new Float64Array(n);
    let tot = 0;
    for (let i = 1; i < n; i++) {
      if (ins(i) && ins(i - 1)) tot += Math.hypot(re[i] - re[i - 1], im[i] - im[i - 1]);
      cum[i] = tot;
    }
    if (tot > 0) {
      let i = 1;
      for (const f of [0.32, 0.73]) {
        while (i < n - 1 && cum[i] < f * tot) i++;
        mk.push({ x: re[i], y: im[i], type: 'arrow', dx: re[i] - re[i - 1], dy: im[i] - im[i - 1], color: '--c1' });
      }
    }
    highlightedCrossings(mar.gc, mar.bestG).forEach(g => mk.push({ x: Math.cos(g.ph / DEG), y: Math.sin(g.ph / DEG), type: 'dot', color: '--c3', r: 3.5, label: ['单位圆交点', `ωc = ${fmt(g.w)}`], priority: g === mar.bestG ? 3 : 0 }));
    highlightedCrossings(mar.pc, mar.bestP).filter(p => !p.atInfinity).forEach(p => mk.push({ x: -Math.pow(10, p.db / 20), y: 0, type: 'dot', color: '--c3', r: 3.5, label: ['负实轴交点', `ωx = ${fmt(p.w)}`], priority: p === mar.bestP ? 3 : 0 }));
    mk.push({ x: -1, y: 0, type: 'plus', color: '--c2', label: ['临界点', '(−1, j0)'], priority: 6 });
    P.nyq.markers = mk;
    P.nyq.legend = [{ label: '正频率（箭头沿 ω 增大）', color: '--c1' }, { label: '负频率', color: '--c1', dash: [5, 4] }, { label: '单位圆', color: '--muted', dash: [3, 4] }];
    if (comparison) P.nyq.legend.push({ label: '对比', color: '--c3', dash: [6, 4] });
    const nyqNotes = [];
    if (sys.imagPoles) nyqNotes.push('开环含虚轴极点。图中显示频率响应，完整奈氏路径还需绕开这些极点。');
    if (sys.tau === 0 && closedAnalysis.axisCount) nyqNotes.push('闭环含虚轴极点，判读奈氏包围数时须处理临界点。');
    if (S.brk.some(Boolean) || !S.complete) nyqNotes.push('高频密集绕转处采用断线显示。');
    $('nyqNote').hidden = nyqNotes.length === 0;
    $('nyqNote').textContent = nyqNotes.join(' ');
    P.nyq.draw();
  }
  function hoverNyq(h) {
    if (!h || !nyq) return;
    const a = P.nyq.nearest(nyq.re, nyq.im, h.px, h.py), b = P.nyq.nearest(nyq.re, nyq.imn, h.px, h.py);
    const neg = b.d < a.d, r = neg ? b : a;
    if (r.i >= 0 && (h.keyboard || r.d < 30)) {
      showFrequency(S.w[r.i]);
      if (neg) {
        P.nyq.cursor = { x: nyq.re[r.i], y: nyq.imn[r.i] };
        ro('rNyq', `<b>ω = −${fmt(S.w[r.i])} rad/s</b>　G(jω) = ${fmt(nyq.re[r.i])} ${nyq.imn[r.i] < 0 ? '−' : '+'} j${fmt(Math.abs(nyq.imn[r.i]))}　其余图显示对应正频率`);
        P.nyq.drawCursor();
      }
    }
  }

  /* ---------- Nichols ---------- */
  function drawNic() {
    if (state.K === 0) {
      P.nic.series = []; P.nic.markers = []; P.nic.vlines = []; P.nic.legend = []; P.nic.cursor = null;
      P.nic.setHome([-270, 0, -60, 20]);
      P.nic.message = 'K = 0，对数幅相曲线未定义'; P.nic.draw();
      if (comparison && comparison.model.k > 0) {
        const x = comparison.S.ph.map(phase => phase * DEG);
        const y = comparison.S.lm.map(magnitude => (magnitude + Math.log(comparison.model.k)) * 20 / LN10);
        P.nic.message = '';
        P.nic.series = [{ x, y, color: '--c3', dash: [6, 4], width: 1.8 }];
        P.nic.legend = [{ label: '对比 K=' + fmt(comparison.model.k), color: '--c3', dash: [6, 4] }];
        includeView(P.nic, x.map((phase, i) => [phase, y[i]]).filter(point => Math.abs(point[0]) < 1080 && Math.abs(point[1]) < 100));
        P.nic.draw();
        ro('rNic', '当前 K=0，对数幅相曲线未定义。虚线显示对比模型。');
      }
      return;
    }
    P.nic.message = '';
    const lk = Math.log(state.K), n = S.w.length;
    const x = new Float64Array(n), y = new Float64Array(n);
    let x0 = Infinity, x1 = -Infinity, y0 = 0, y1 = 0, any = false;
    for (let i = 0; i < n; i++) {
      x[i] = S.ph[i] * DEG; y[i] = (S.lm[i] + lk) * 20 / LN10;
      if (Math.abs(y[i]) <= 70) { any = true; x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
    }
    if (!any) { x0 = Math.min(...x); x1 = Math.max(...x); y0 = Math.min(...y, 0); y1 = Math.max(...y, 0); }
    nic = { x, y };
    if (x1 - x0 > 720) {          // 含延迟时相角无限滞后，只取低频端附近 720°
      if (Math.abs(x[0] - x1) <= Math.abs(x[0] - x0)) x0 = x1 - 720; else x1 = x0 + 720;
    }
    const kc = (x0 <= -180 + 200 && x1 >= -180 - 200) ? 0 : Math.round(((x0 + x1) / 2 + 180) / 360), xc = -180 + 360 * kc;   // 最近的临界点
    x0 = Math.min(x0, xc); x1 = Math.max(x1, xc);
    const px = Math.max(15, (x1 - x0) * 0.08), py = Math.max(5, (y1 - y0) * 0.08);
    P.nic.setHome([x0 - px, x1 + px, y0 - py, y1 + py]);
    P.nic.series = [{ x, y, color: '--c1', width: 2.2, direction: true }];
    if (comparison && comparison.model.k > 0) {
      const referenceX = comparison.S.ph.map(phase => phase * DEG);
      const referenceY = comparison.S.lm.map(magnitude => (magnitude + Math.log(comparison.model.k)) * 20 / LN10);
      P.nic.series.push({ x: referenceX, y: referenceY, color: '--c3', dash: [6, 4], width: 1.8 });
      includeView(P.nic, referenceX.map((phase, i) => [phase, referenceY[i]]).filter(point => point[0] >= x0 - 90 && point[0] <= x1 + 90 && Math.abs(point[1]) < 100));
    }
    P.nic.legend = comparison ? [{ label: '当前', color: '--c1' }, { label: '对比', color: '--c3', dash: [6, 4] }] : [];
    const mk = [];
    P.nic.vlines = [];
    for (let k = Math.floor((x0 + 180) / 360) - 1; k <= Math.ceil((x1 + 180) / 360) + 1; k++) {
      const v = -180 + 360 * k;
      P.nic.vlines.push({ v, color: '--c2', dash: [5, 4] });
      mk.push({ x: v, y: 0, type: 'plus', color: '--c2', label: k === kc ? ['临界点', `(${fmt(v)}°, 0 dB)`] : '', priority: 6 });
    }
    highlightedCrossings(mar.gc, mar.bestG).forEach(g => {
      P.nic.series.push({ x: [g.ph - g.pm, g.ph], y: [0, 0], color: '--c3', width: 1.6 });
      mk.push({ x: g.ph, y: 0, type: 'dot', color: '--c3', r: 3.5, label: ['相角裕度 γ', `${fmt(g.pm)}°`], priority: g === mar.bestG ? 4 : 1 });
    });
    highlightedCrossings(mar.pc, mar.bestP).filter(p => !p.atInfinity).forEach(p => {
      P.nic.series.push({ x: [p.level, p.level], y: [0, p.db], color: '--c3', width: 1.6 });
      mk.push({ x: p.level, y: p.db, type: 'dot', color: '--c3', r: 3.5, label: ['幅值裕度 h', `${fmt(p.gm)} dB`], priority: p === mar.bestP ? 4 : 1 });
    });
    P.nic.markers = mk;
    P.nic.draw();
  }
  function hoverNic(h) {
    if (!h || !nic || state.K === 0) return;
    const r = P.nic.nearest(nic.x, nic.y, h.px, h.py);
    if (r.i >= 0 && (h.keyboard || r.d < 30)) {
      showFrequency(S.w[r.i]);
    }
  }

  /* ---------- 阶跃响应 ---------- */
  function drawStep() {
    const p = P.step;
    p.cursor = null;
    p.markers = []; p.regions = []; p.vlines = [];
    $('mStep').hidden = true;
    if (stp.err) {
      p.series = []; p.hlines = []; p.legend = []; p.message = stp.err;
      $('mStep').textContent = '';
      if (comparison && !comparison.stp.err) {
        p.series = [{ x: comparison.stp.t, y: comparison.stp.y, color: '--c3', dash: [6, 4], width: 1.8 }];
        p.legend = [{ label: '对比 K=' + fmt(comparison.model.k), color: '--c3', dash: [6, 4] }];
        p.message = '';
        p.setHome([0, comparison.stp.T, -0.1, 1.1]);
        includeView(p, comparison.stp.t.map((time, i) => [time, comparison.stp.y[i]]));
        $('mStep').textContent = '虚线为对比模型。' + stp.err + '。';
        $('mStep').hidden = false;
      }
      p.draw();
      return;
    }
    p.message = '';
    p.series = [{ x: stp.t, y: stp.y, color: '--c1', width: 2.4 }];
    if (comparison && !comparison.stp.err) p.series.push({ x: comparison.stp.t, y: comparison.stp.y, color: '--c3', dash: [6, 4], width: 1.8 });
    p.legend = comparison && !comparison.stp.err ? [{ label: '当前 K=' + fmt(state.K), color: '--c1' }, { label: '对比 K=' + fmt(comparison.model.k), color: '--c3', dash: [6, 4] }] : [];
    p.hlines = stp.stable && stp.yss != null ? [{ v: stp.yss, color: '--c2', dash: [5, 4] }] : [];
    let lo = 0, hi = 0;
    for (const v of stp.y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (stp.stable && stp.yss != null) { lo = Math.min(lo, stp.yss); hi = Math.max(hi, stp.yss); }
    if (stp.stable && Number.isFinite(stp.yss)) {
      const tolerance = Math.abs(stp.yss) * 0.02;
      if (tolerance > 0) p.regions = [{ y0: stp.yss - tolerance, y1: stp.yss + tolerance, color: '--c3', alpha: 0.18 }];
      p.markers.push({ x: stp.T * 0.8, y: stp.yss, type: 'dot', r: 2.5, color: '--c2', label: ['稳态值', `c(∞) = ${fmt(stp.yss)}`], priority: 4 });
      if (Number.isFinite(stp.tp)) {
        const peak = stp.y[stp.t.indexOf(stp.tp)];
        p.vlines.push({ v: stp.tp, color: '--axis', dash: [3, 4] });
        p.markers.push({ x: stp.tp, y: peak, type: 'dot', color: '--c2', label: [`峰值 ${fmt(peak)} · ${fmt(stp.os)}%`, `tp = ${fmt(stp.tp)} s`], priority: 6 });
      }
      if (Number.isFinite(stp.ts) && stp.ts > 0) {
        const level = stp.y[stp.t.indexOf(stp.ts)];
        p.vlines.push({ v: stp.ts, color: '--c3', dash: [3, 4] });
        p.markers.push({ x: stp.ts, y: level, type: 'dot', color: '--c3', label: ['调节时间 · 2%', `ts = ${fmt(stp.ts)} s`], priority: 5 });
      }
    }
    const pad = (hi - lo || 1) * 0.08;
    p.setHome([0, Math.max(stp.T, comparison && !comparison.stp.err ? comparison.stp.T : 0), lo - pad, hi + pad]);
    if (comparison && !comparison.stp.err) includeView(p, comparison.stp.t.map((time, i) => [time, comparison.stp.y[i]]));
    p.draw();
    if (!stp.stable) {
      $('mStep').textContent = closedAnalysis.repeatedAxis
        ? '闭环含虚轴重根，系统不稳定。稳态指标未定义。'
        : '闭环含非渐近稳定极点，稳态指标未定义。';
      $('mStep').hidden = false;
    }
  }
  function hoverStep(h) {
    P.step.cursor = null;
    if (!h || !stp || stp.err) { P.step.drawCursor(); return; }
    const dt = stp.t[1] - stp.t[0], i = Math.round(h.x / dt);
    if (i >= 0 && i < stp.t.length) {
      P.step.cursor = { x: stp.t[i], y: stp.y[i] };
      ro('rStep', `<b>t = ${fmt(stp.t[i])} s</b>　c(t) = ${fmt(stp.y[i])}`);
    } else ro('rStep');
    P.step.drawCursor();
  }

  /* ================= 文字信息 ================= */
  function renderTF() {
    $('tf').innerHTML =
      `<span>G(s)H(s) = ${state.sg < 0 ? '−' : ''}K ·</span>` +
      `<span class="frac"><span>${polyHTML(sys.num)}</span><span>${polyHTML(sys.den)}</span></span>` +
      (sys.tau > 0 ? `<span>· e<sup>−${fmt(sys.tau)}s</sup></span>` : '');
  }
  function kRangeStr() {
    if (!ranges.length) return '<span class="bad">无渐近稳定区间</span>';
    return ranges.map(([a, b]) => a === 0 && b === Infinity ? '任意 K &gt; 0' : a === 0 ? `0 &lt; K &lt; ${fmt(b)}` : b === Infinity ? `K &gt; ${fmt(a)}` : `${fmt(a)} &lt; K &lt; ${fmt(b)}`).join('　或　');
  }
  function renderInfo() {
    const K = state.K, sg = state.sg, rows = [];
    const sec = t => rows.push(`<tr class="sec"><th colspan="2">${t}</th></tr>`);
    const row = (k, v) => rows.push(`<tr><th>${k}</th><td>${v}</td></tr>`);
    sec('开环特性');
    row('开环零点', rootsStr(sys.zeros));
    row('开环极点', rootsStr(sys.poles));
    row('系统型别', (sys.type >= 0 ? ['0', 'I', 'II', 'III'][sys.type] || sys.type : sys.type) + ' 型');
    row('开环增益', fmt(sg * K * sys.k0) + `<span class="dim">（K × ${fmt(sys.k0)}）</span>`);
    sec((sg > 0 ? '根轨迹（180° 根轨迹）' : '根轨迹（0° 根轨迹）') + (sys.tau > 0 ? '<span class="warn">　按 τ=0 计算</span>' : ''));
    row('分支数', String(Math.max(sys.n, sys.m)));
    row('渐近线', asy ? `σ<sub>a</sub> = ${fmt(asy.sigma)}；φ<sub>a</sub> = ${asy.angles.map(a => fmt(a > 180 ? a - 360 : a) + '°').join('，')}` : '无');
    row('分离/会合点', brks.length ? brks.map(b => `${b.s[1] === 0 ? fmt(b.s[0]) : cpx(b.s[0], b.s[1], '±')}<span class="dim">（K=${fmt(b.K)}）</span>`).join('，') : '无');
    row('与虚轴交点', cross.degenerate && Math.max(sys.n, sys.m) > 0 ? '存在虚轴上的轨迹，需检查各增益的极点' : cross.list.length ? cross.list.map(c => `${c.w === 0 ? '原点' : '±j' + fmt(c.w)}<span class="dim">（K=${fmt(c.K)}）</span>`).join('，') : '无');
    const singular = Ctl.singularGains(sys, sg);
    if (singular.length) row('最高次项抵消', singular.map(K => 'K = ' + fmt(K)).join('，'));
    row('稳定的 K 范围', kRangeStr() + (sys.tau > 0 ? '<span class="dim">（未计延迟）</span>' : ''));
    sec(`当前 K = ${fmt(K)} 时`);
    row(sys.tau > 0 ? '闭环极点（τ=0）' : '闭环极点', rootsStr(cl));
    const Z = closedAnalysis.rightCount, Pn = sys.poles.filter(p => p[0] > 0).length;
    if (sys.tau > 0) row('闭环稳定性', '<span class="dim">含延迟环节：上面的根轨迹与闭环极点按 τ=0 计算，实际稳定性请依据裕度与奈氏曲线判断</span>');
    else {
      const statusText = { stable: '稳定', unstable: `不稳定（${unstableReason()}）`, marginal: '临界稳定', singular: '奇异增益，闭环特征方程退化', unknown: '当前数值尺度下待核查' };
      row('闭环稳定性', statusText[closedAnalysis.kind]);
    }
    const g = mar.bestG, p = mar.bestP;
    row('截止频率 ω<sub>c</sub>', g ? fmt(g.w) + ' rad/s' : '无正频率的 0 dB 交越');
    row('相角裕度 γ', g ? `<span class="${g.pm > 0 ? 'good' : 'bad'}">${fmt(g.pm)}°</span>` : state.K === 0 ? 'K=0，未定义' : '—');
    row('穿越频率 ω<sub>x</sub>', p ? p.atInfinity ? 'ω → ∞' : p.w === 0 ? '0 rad/s（直流）' : fmt(p.w) + ' rad/s' : '未找到负实轴交点');
    row('幅值裕度 h', p ? `${fmt(p.gm)} dB<span class="dim">（${fmt(Math.pow(10, p.gm / 20))} 倍）</span>` : state.K === 0 ? 'K=0，未定义' : '∞');
    if (sys.tau === 0 && !['singular', 'unknown'].includes(closedAnalysis.kind)) {
      const winding = closedAnalysis.axisCount ? '（闭环含虚轴极点，临界点需单独处理）'
        : `，R = P − Z = ${fmt(Pn - Z)}<span class="dim">（由极点数推得的逆时针包围数）</span>`;
      row('奈氏关系', `P = ${Pn}，Z = ${Z}${winding}`);
    }
    sec('阶跃响应');
    if (!stp.err && stp.stable) {
      row('稳态值', fmt(stp.yss));
      row('稳态误差', fmt(1 - stp.yss));
      row('超调量', fmt(stp.os) + '%');
      row('峰值时间', fmt(stp.tp) + ' s');
      row('调节时间（2%）', fmt(stp.ts) + ' s');
    } else row('适用条件', stp.err || '稳态指标未定义');
    $('info').innerHTML = `<table>${rows.join('')}</table>`;
  }

  function renderLegends() {
    for (const container of document.querySelectorAll('[data-legend]')) {
      const legend = P[container.dataset.legend].legend;
      const elements = legend.map(item => {
        const element = document.createElement('span');
        element.className = 'legend-item';
        const swatch = document.createElement('span');
        swatch.className = item.symbol ? 'legend-symbol' : 'legend-line';
        swatch.setAttribute('aria-hidden', 'true');
        swatch.style.color = item.color.startsWith('--') ? `var(${item.color})` : item.color;
        if (item.symbol) swatch.textContent = item.symbol;
        else swatch.style.borderTopStyle = item.dash ? 'dashed' : 'solid';
        element.append(swatch, document.createTextNode(item.label));
        return element;
      });
      container.replaceChildren(...elements);
    }
  }

  function sameSystem(a, b) {
    return a && b && a.n === b.n && a.d === b.d && a.sg === b.sg && a.tau === b.tau;
  }

  function includeView(plot, points, limit = Infinity) {
    if (plot.userView) return;
    let [left, right, bottom, top] = plot.home;
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > limit) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      bottom = Math.min(bottom, y); top = Math.max(top, y);
    }
    const paddingX = (right - left) * 0.04, paddingY = (top - bottom) * 0.04;
    plot.setHome([left - paddingX, right + paddingX, bottom - paddingY, top + paddingY]);
  }

  function makeComparison(input) {
    const model = { n: String(input.n), d: String(input.d), k: Number(input.k), tau: Number(input.tau || 0), sg: input.sg === -1 ? -1 : 1, t: Number(input.t || 0) };
    if (!Number.isFinite(model.k) || model.k < 0 || !Number.isFinite(model.t) || model.t < 0) throw new Error('对比模型的增益或仿真时长无效');
    const system = Ctl.makeSystem(model.n, model.d, model.tau);
    const analysis = Ctl.closedStatus(system, model.sg, model.k);
    const samples = Ctl.freqSamples(system, model.sg, model.k);
    const re = [], im = [], imn = [];
    for (let i = 0; i < samples.w.length; i++) {
      const magnitude = model.k === 0 ? 0 : Math.exp(samples.lm[i] + Math.log(model.k));
      re.push(magnitude * Math.cos(samples.ph[i]));
      im.push(magnitude * Math.sin(samples.ph[i]));
      imn.push(-im[i]);
    }
    return {
      model, sys: system, S: samples,
      RL: sameSystem(model, state.model) ? RL : Ctl.rootLocus(system, model.sg),
      mar: Ctl.margins(system, model.sg, samples, model.k),
      cl: analysis.poles,
      stp: model.tau > 0 ? { err: '含延迟模型' } : Ctl.step(system, model.sg, model.k, model.t, analysis),
      polar: { re, im, imn },
    };
  }

  function renderComparison() {
    $('comparisonNote').hidden = !comparison;
    $('clearCompare').hidden = !comparison;
    $('compare').textContent = comparison ? '更新对比' : '加入对比 ＋';
    if (comparison) {
      const model = comparison.model;
      $('comparisonNote').textContent = `虚线对比 ${model.sg < 0 ? '−' : ''}${model.k} · (${model.n}) / (${model.d})${model.tau > 0 ? ' · τ=' + model.tau + ' s' : ''}`;
    }
  }

  function figureFacts(id, items) {
    $(id).innerHTML = items.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('');
  }

  function calculationBlock(name, value, method, table = '') {
    return `<section class="calc-block"><h3>${name}</h3>${value ? `<p class="calc-result">${value}</p>` : ''}${method ? `<p>${method}</p>` : ''}${table}</section>`;
  }

  function calculationTable(headings, rows) {
    return `<table><thead><tr>${headings.map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(text => `<td>${text}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderCalculations() {
    if (!sys) return;
    const realRoots = [...sys.poles, ...sys.zeros].filter(root => Math.abs(root[1]) < 1e-8 * (1 + Math.abs(root[0]))).map(root => root[0]).sort((a, b) => a - b);
    const uniqueRoots = realRoots.filter((root, i) => i === 0 || Math.abs(root - realRoots[i - 1]) > 1e-8 * (1 + Math.abs(root)));
    const edges = [-Infinity, ...uniqueRoots, Infinity], intervals = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i], b = edges[i + 1];
      const point = a === -Infinity ? (b === Infinity ? 0 : b - Math.max(1, Math.abs(b))) : b === Infinity ? a + Math.max(1, Math.abs(a)) : (a + b) / 2;
      const count = realRoots.filter(root => root > point).length;
      if (count % 2 === (state.sg * sys.kLead > 0 ? 1 : 0)) intervals.push(`(${fmt(a)}, ${fmt(b)})`);
    }
    const singular = Ctl.singularGains(sys, state.sg);
    const sign = state.sg > 0 ? '+' : '−', term = state.sg > 0 ? '' : '−';
    const leading = rootsStr(leadingPoles());
    const currentRoots = closedAnalysis.kind === 'unknown' ? '未确定' : rootsStr(cl);
    const interval = kRangeStr();
    const unitModel = sys.tau > 0 ? '（τ = 0）' : '';
    const closedLabel = { stable: '稳定', unstable: '不稳定', marginal: '临界', singular: '奇异增益', unknown: '待核查' }[closedAnalysis.kind];
    figureFacts('rootFacts', [
      ['稳定区间' + unitModel, interval], ['主导极点', leading],
      ...(cross.list.length ? [['首个虚轴交点', 'K = ' + fmt(cross.list[0].K)]] : []),
    ]);
    $('rootNotes').innerHTML = [
      calculationBlock('当前闭环' + unitModel, `K = ${fmt(state.K)} · ${closedLabel}`,
        `将当前 K 代入 <code>D(s) ${sign} K N(s) = 0</code>。闭环极点为 ${currentRoots}。实部最大的极点为 ${leading}。`),
      calculationBlock('实轴轨迹', Math.max(sys.n, sys.m) === 0 ? '无轨迹分支' : intervals.join(' ∪ ') || '无',
        `对每段取一个试点，数右边的实极点和实零点，按重数计。当前模型取${state.sg * sys.kLead > 0 ? '奇' : '偶'}数段。`),
      calculationBlock('渐近线', asy ? `${sys.n - sys.m} 条 · 中心 σₐ = ${fmt(asy.sigma)}` : '无通往无穷远的渐近线',
        asy ? `用 <code>σₐ = (Σp − Σz) / (n − m)</code> 求中心。方向角为 ${anglesText(asy.angles)}。` : ''),
      calculationBlock('分离与会合', brks.length ? '' : '无符合条件的点', `由特征方程得 <code>K(s) = ${state.sg > 0 ? '−' : ''}D(s) / N(s)</code>。令导数为零，保留 K 为正实数的解。实轴上的极大值对应分离，极小值对应会合。`,
        brks.length ? calculationTable(['类型', '位置', '增益'], brks.map(point => [breakName(point), axisValue(point.s), fmt(point.K)])) : ''),
      calculationBlock('虚轴与稳定边界' + unitModel, interval,
        `令 <code>s = jω</code>，联立特征方程的实部和虚部。按交点增益${singular.length ? `及最高次项抵消处 K = ${singular.map(K => fmt(K)).join('、')}` : ''}分段，检查每段闭环极点是否全在左半平面。`,
        cross.list.length ? calculationTable(['虚轴位置', 'ω / rad/s', '增益'], cross.list.map(point => [axisPoint(point.w), fmt(point.w), fmt(point.K)]))
          : `<p>${cross.degenerate ? '轨迹含虚轴上的点，逐个检查增益对应的极点。' : '无孤立的正增益虚轴交点。'}</p>`),
    ].join('');

    let slope = -20 * sys.type;
    const cornerRows = [];
    for (const corner of sys.corners) {
      const atCorner = root => Math.abs(Cx.abs(root) - corner) < corner * 2e-5;
      const zeros = sys.zeros.filter(atCorner).length, poles = sys.poles.filter(atCorner).length;
      const next = slope + 20 * (zeros - poles);
      cornerRows.push([fmt(corner), zeros, poles, `${fmt(slope)} → ${fmt(next)}`]);
      slope = next;
    }
    const crossingRows = mar.gc.map(point => ['0 dB', fmt(point.w), `γ = ${fmt(point.pm)}°`]);
    const phasePoints = mar.pc.slice(0, 8);
    if (mar.bestP && !phasePoints.includes(mar.bestP)) phasePoints.push(mar.bestP);
    for (const point of phasePoints) crossingRows.push([fmt(point.level) + '°', point.atInfinity ? '∞' : fmt(point.w), `h = ${fmt(point.gm)} dB`]);
    const { bestG: g, bestP: p } = mar;
    const gainMargin = p ? `${fmt(p.gm)} dB` : state.K === 0 ? '未定义' : '∞';
    const phaseMargin = g ? `${fmt(g.pm)}°` : state.K === 0 ? '未定义' : '无 0 dB 交越';
    const frequency = w => w === Infinity ? 'ω → ∞' : `${fmt(w)} rad/s`;
    figureFacts('bodeFacts', [
      ['相角裕度 γ', phaseMargin], ['幅值裕度 h', gainMargin],
      ...(g ? [['0 dB 交越 ωc', frequency(g.w)]] : []),
      ...(p ? [['相角交越 ωx', frequency(p.w)]] : []),
    ]);
    const openLoop = `L(jω) = ${term}K N(jω) / D(jω)${sys.tau > 0 ? ' · e<sup>−jωτ</sup>' : ''}`;
    const phaseRef = g ? fmt(g.ph - g.pm) : '−180';
    $('bodeNotes').innerHTML = [
      calculationBlock('相角裕度 γ', g ? `${phaseMargin} · ωc = ${frequency(g.w)}` : phaseMargin,
        g ? `先在幅频图找 0 dB，再到相频图读相角 ${fmt(g.ph)}°。相对 ${phaseRef}° 的角差为 ${phaseMargin}。` : '先在幅频图找 0 dB，再到相频图读角差。'),
      calculationBlock('幅值裕度 h', p ? `${gainMargin} · ${p.atInfinity ? frequency(p.w) : 'ωx = ' + frequency(p.w)}` : gainMargin,
        p ? `先找相角 ${fmt(p.level)}°，再读同一频率的幅值 ${fmt(p.db)} dB。到 0 dB 的差为 ${gainMargin}。` : state.K === 0 ? '零增益下相角和裕度未定义。' : '未检出负实轴交越。'),
      crossingRows.length ? calculationBlock('交越点一览', '', mar.pc.length > phasePoints.length ? '相角交越列出前八个及所选裕度对应点。' : '',
        calculationTable(['交越条件', 'ω / rad/s', '裕度'], crossingRows)) : '',
      calculationBlock('幅频渐近线', `低频斜率 ${fmt(-20 * sys.type)} dB/dec`,
        '每经过一个零点转折，斜率加 20 dB/dec。每经过一个极点转折，斜率减 20 dB/dec。重根按重数累计。',
        cornerRows.length ? calculationTable(['转折 ω / rad/s', '零点', '极点', '前后斜率'], cornerRows) : ''),
    ].join('');

    const Pn = sys.poles.filter(pole => pole[0] > 0).length, Z = closedAnalysis.rightCount;
    const hasCount = state.K > 0 && sys.tau === 0 && !['singular', 'unknown'].includes(closedAnalysis.kind);
    const crossingAxis = closedAnalysis.axisCount > 0;
    const winding = hasCount && !crossingAxis ? `R = ${fmt(Pn - Z)}` : '—';
    figureFacts('nyqFacts', hasCount
      ? [['开环右半平面 P', Pn], ['闭环右半平面 Z', Z], ['逆时针包围数', winding]]
      : [['临界点', '(−1, j0)'], ['当前条件', state.K === 0 ? '曲线退化为原点' : '需单独判断包围数']]);
    $('nyqNotes').innerHTML = [
      calculationBlock('曲线从哪来', '临界点 (−1, j0)', `在 <code>${openLoop}</code> 中逐个代入 ω。横轴取实部，纵轴取虚部。实线箭头沿正频率增加方向。`),
      calculationBlock('读两个交点', `单位圆 ${g ? frequency(g.w) : '—'} · 负实轴 ${p && !p.atInfinity ? frequency(p.w) : '—'}`,
        '单位圆交点满足 |L(jω)| = 1。负实轴交点满足相角 −180° 或其等效角。'),
      calculationBlock('判读包围数', hasCount ? `P = ${Pn} · Z = ${Z} · ${winding}` : '',
        !hasCount ? '包围数需在适用的完整奈氏路径上判读。' : crossingAxis ? '闭环含虚轴极点，临界点需单独处理。' : '按开环和闭环的右半平面极点数，用 R = P − Z 推得完整路径的逆时针包围数。'),
    ].join('');
    figureFacts('nicFacts', [['相角裕度 γ', phaseMargin], ['幅值裕度 h', gainMargin]]);
    $('nicNotes').innerHTML = [
      calculationBlock('坐标与临界点', '(−180°, 0 dB)', '每个 ω 对应一个点，横轴取 ∠L(jω)，纵轴取 20 log₁₀|L(jω)|。相角平移整圈后，临界点与 −180° 等效。'),
      calculationBlock('沿 0 dB 读相角裕度', phaseMargin,
        g ? `在 0 dB 交点读得 ${fmt(g.ph)}°，量到等效临界相角 ${phaseRef}° 的有符号角差。` : '曲线与 0 dB 线相交时，可在该交点读角差。'),
      calculationBlock('沿临界相角读幅值裕度', gainMargin,
        p ? `在 ${fmt(p.level)}° 处读得 ${fmt(p.db)} dB，量到 0 dB 的有符号差。` : '先找曲线与临界相角线的交点，再沿幅值轴读差值。'),
    ].join('');

    const stepAvailable = !stp.err && stp.stable && Number.isFinite(stp.yss);
    if (!stepAvailable) {
      const reason = stp.err || '稳态指标未定义';
      figureFacts('stepFacts', [['状态', reason]]);
      $('stepNotes').innerHTML = calculationBlock('适用范围', reason, stp.err ? '' : '先检查闭环极点。存在虚轴极点或右半平面极点时，按时域曲线观察响应。');
      return;
    }
    const overshoot = Number.isFinite(stp.os) ? `${fmt(stp.os)}%` : '未定义';
    const settle = Number.isFinite(stp.ts) ? `${fmt(stp.ts)} s` : Math.abs(stp.yss) > 1e-12 ? '窗内未保持在带内' : '未定义';
    const peak = Number.isFinite(stp.tp) ? stp.y[stp.t.indexOf(stp.tp)] : null;
    figureFacts('stepFacts', [
      ['稳态值', fmt(stp.yss)], ['超调量', overshoot], ['调节时间 · 2%', settle],
    ]);
    $('stepNotes').innerHTML = [
      calculationBlock('稳态值', `c(∞) = ${fmt(stp.yss)} · 稳态误差 ${fmt(1 - stp.yss)}`,
        `稳定时，单位阶跃输出的终值等于闭环直流增益。取 <code>T(s) = ${term}K N(s) / [D(s) ${sign} K N(s)]</code> 在 s = 0 的值。`),
      calculationBlock('峰值与超调量', peak === null ? overshoot : `${fmt(peak)} · tp = ${fmt(stp.tp)} s · 超调 ${overshoot}`,
        '沿稳态值的方向找仿真中的最突出点，计算它超出稳态值的比例。'),
      calculationBlock('调节时间 · 2% 带', settle,
        '以稳态值为中心画 ±2% 的带，读取仿真窗口内最后一次进入且随后始终留在带内的时刻。'),
    ].join('');
  }

  function setView(view) {
    const valid = ['all', 'rl', 'bode', 'nyq', 'nic', 'step', 'info'];
    state.view = valid.includes(view) ? view : 'all';
    $('plots').dataset.view = state.view;
    for (const button of $('plotTabs').querySelectorAll('button')) {
      const selected = button.dataset.view === state.view;
      button.setAttribute('aria-pressed', String(selected));
      if (selected && $('plotTabs').scrollWidth > $('plotTabs').clientWidth) $('plotTabs').scrollLeft = button.offsetLeft - ($('plotTabs').clientWidth - button.offsetWidth) / 2;
    }
    for (const panel of $('plots').querySelectorAll('[data-plot]')) panel.hidden = state.view !== 'all' && panel.dataset.plot !== state.view;
    for (const button of $('plots').querySelectorAll('[data-focus]')) {
      const focused = state.view === button.dataset.focus;
      button.textContent = focused ? '↙' : '↗';
      button.setAttribute('aria-label', focused ? '返回总览' : '放大 ' + button.closest('figure').querySelector('h2').textContent);
    }
    if (state.view === 'info') $('resultsDetails').open = true;
    for (const plot of Object.values(P)) plot.resize();
    saveHash();
  }

  function feedback(message) {
    clearTimeout(feedbackTimer);
    $('actionFeedback').textContent = message;
    $('actionFeedback').hidden = false;
    feedbackTimer = setTimeout(() => { $('actionFeedback').hidden = true; }, 4000);
  }

  function resultRows() {
    return Array.from($('info').querySelectorAll('tr'), row => Array.from(row.cells, cell => cell.textContent.trim()).join('    '));
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const exportGroups = [
    { key: 'rl', title: '根轨迹', plots: [P.rl] },
    { key: 'bode', title: 'Bode 图', plots: [P.mag, P.ph] },
    { key: 'nyq', title: 'Nyquist 图', plots: [P.nyq] },
    { key: 'nic', title: 'Nichols 图', plots: [P.nic] },
    { key: 'step', title: '闭环单位阶跃响应', plots: [P.step] },
    { key: 'info', title: '数据表', plots: [] },
  ];

  function exportPNG() {
    if (!sys) return;
    $('exportMenu').open = false;
    $('exportMenu').querySelector('summary').focus({ preventScroll: true });
    const groups = exportGroups.filter(group => state.view === 'all' || group.key === state.view);
    const columns = groups.length > 1 ? 2 : 1, tileWidth = 1000;
    const tileHeight = Math.max(660, resultRows().length * 24 + 80);
    const headerHeight = comparison ? 140 : 110;
    const canvas = document.createElement('canvas');
    canvas.width = tileWidth * columns; canvas.height = headerHeight + Math.ceil(groups.length / columns) * tileHeight;
    const context = canvas.getContext('2d'), style = getComputedStyle(document.documentElement);
    context.fillStyle = style.getPropertyValue('--paper').trim(); context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = style.getPropertyValue('--fg').trim();
    context.font = '26px system-ui, sans-serif'; context.fillText('自控绘图台', 30, 40);
    context.font = '16px system-ui, sans-serif';
    context.fillText(`K = ${state.sg < 0 ? '−' : ''}${state.K}  ·  N(s) = ${state.model.n}  ·  D(s) = ${state.model.d}  ·  τ = ${sys.tau} s`, 30, 74);
    if (comparison) context.fillText(`虚线对比 K = ${comparison.model.sg < 0 ? '−' : ''}${comparison.model.k}  ·  N(s) = ${comparison.model.n}  ·  D(s) = ${comparison.model.d}  ·  τ = ${comparison.model.tau} s`, 30, 102);
    groups.forEach((group, index) => {
      const x = index % columns * tileWidth + 30, y = headerHeight + Math.floor(index / columns) * tileHeight;
      context.font = '22px system-ui, sans-serif'; context.fillText(group.title, x, y + 28);
      if (group.key === 'info') {
        context.font = '15px system-ui, sans-serif';
        let line = y + 56;
        for (const row of resultRows()) {
          let text = '';
          for (const character of row) {
            if (context.measureText(text + character).width > tileWidth - 70) { context.fillText(text, x, line); line += 19; text = ''; }
            text += character;
          }
          context.fillText(text, x, line); line += 22;
        }
        return;
      }
      const plots = group.plots.filter(plot => plot.c.width && plot.W);
      const totalHeight = plots.reduce((sum, plot) => sum + plot.H, 0);
      const maxWidth = Math.max(...plots.map(plot => plot.W), 1);
      const scale = Math.min((tileWidth - 60) / maxWidth, (tileHeight - 70) / Math.max(1, totalHeight));
      let top = y + 46;
      for (const plot of plots) {
        context.drawImage(plot.toCanvas(Math.max(2, scale)), x, top, plot.W * scale, plot.H * scale);
        top += plot.H * scale;
      }
      if (group.key === 'rl' && sys.tau > 0) { context.font = '15px system-ui, sans-serif'; context.fillText('根轨迹采用 τ=0 模型', x, y + tileHeight - 12); }
    });
    canvas.toBlob(blob => {
      if (!blob) { feedback('图片生成失败，请重试。'); return; }
      download(blob, '自控绘图台_' + state.view + '.png');
      feedback('已导出 PNG 图片。');
    }, 'image/png');
  }

  function exportCSV() {
    if (!sys) return;
    $('exportMenu').open = false;
    $('exportMenu').querySelector('summary').focus({ preventScroll: true });
    const rows = [['图表', '模型', '分支', 'K', '频率 / rad/s', '时间 / s', '实部', '虚部', '相角 / °', '幅值 / dB', '响应', '说明']];
    const models = [{ label: '当前', sys, S, RL, stp, model: { ...state.model, k: state.K } }];
    if (comparison) models.push({ ...comparison, label: '对比' });
    for (const analysis of models) {
      const K = analysis.model.k;
      rows.push(['模型', analysis.label, '', K, '', '', '', '', '', '', '', JSON.stringify(analysis.model)]);
      if (state.view === 'all' || state.view === 'rl') analysis.RL.branches.forEach((branch, index) => {
        branch.x.forEach((real, i) => rows.push(['根轨迹', analysis.label, index + 1, branch.k[i], '', '', real, branch.y[i], '', '', '', analysis.sys.tau > 0 ? 'τ=0 模型' : '']));
      });
      if (['all', 'bode', 'nyq', 'nic'].includes(state.view)) analysis.S.w.forEach((frequency, i) => {
        const phase = analysis.S.ph[i], magnitude = K === 0 ? 0 : Math.exp(analysis.S.lm[i] + Math.log(K));
        const phaseDegrees = K === 0 ? '' : phase * DEG;
        const magnitudeDb = K === 0 ? '-Infinity' : (analysis.S.lm[i] + Math.log(K)) * 20 / LN10;
        rows.push([
          '频率响应', analysis.label, '', K, frequency, '',
          magnitude * Math.cos(phase), magnitude * Math.sin(phase),
          phaseDegrees, magnitudeDb, '', '正频率',
        ]);
      });
      if ((state.view === 'all' || state.view === 'step') && !analysis.stp.err) analysis.stp.t.forEach((time, i) => rows.push(['阶跃响应', analysis.label, '', K, '', time, '', '', '', '', analysis.stp.y[i], '']));
    }
    if (state.view === 'all' || state.view === 'info') for (const row of resultRows()) rows.push(['数据表', '当前', '', state.K, '', '', '', '', '', '', '', row]);
    const csv = rows.map(row => row.map(value => '"' + String(value == null || Number.isNaN(value) ? '' : value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    download(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), '自控绘图台_' + state.view + '.csv');
    feedback('已导出 UTF-8 CSV 数据。');
  }

  /* ================= 交互 ================= */
  function setK(K, src) {
    if (!Number.isFinite(K) || K < 0) {
      const field = gainFields.find(({ number }) => number === src) || gainFields[0];
      field.error.textContent = '请输入非负有限数值，曲线保留上次有效增益。';
      field.error.hidden = false;
      field.number.setAttribute('aria-invalid', 'true');
      return;
    }
    state.K = K;
    syncGainControls(src);
    schedule();
  }
  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateK(); });
  }
  let deb = 0;
  const debounced = () => { clearTimeout(deb); deb = setTimeout(rebuild, 100); };

  function saveHash() {
    const q = new URLSearchParams();
    if (!state.model) return;
    q.set('n', state.model.n); q.set('d', state.model.d); q.set('k', state.K);
    if (state.model.tau > 0) q.set('tau', state.model.tau);
    if (state.sg < 0) q.set('neg', '1');
    if (state.duration > 0) q.set('t', state.duration);
    if (state.view !== 'all') q.set('view', state.view);
    if (comparison) q.set('compare', JSON.stringify(comparison.model));
    if (state.frequency !== null) q.set('w', state.frequency);
    try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* 直接打开本地文件时保留可用交互 */ }
  }
  function loadExample(e) {
    $('num').value = e.n; $('den').value = e.d; $('tau').value = e.tau || 0; $('neg').checked = e.sg === -1;
    state.duration = e.t || 0;
    $('tEnd').value = state.duration > 0 ? state.duration : '';
    state.K = e.k;
    syncGainControls();
    rebuild();
  }

  function readDuration() {
    const duration = $('tEnd').value === '' ? 0 : Number($('tEnd').value);
    if (!Number.isFinite(duration) || duration < 0) throw new Error('仿真时长须为非负有限数值，留空或填 0 使用自动时长');
    return duration;
  }

  function clearFrequency() {
    state.frequency = null;
    $('frequency').value = '';
    $('frequency').setCustomValidity('');
    P.mag.vcursor = P.ph.vcursor = null;
    P.nyq.cursor = P.nic.cursor = null;
    for (const plot of [P.mag, P.ph, P.nyq, P.nic]) plot.drawCursor();
    for (const id of ['rBode', 'rNyq', 'rNic']) ro(id);
  }

  function restoreHash() {
    const query = new URLSearchParams(location.hash.slice(1));
    comparison = null;
    if (query.get('compare')) {
      try { comparison = makeComparison(JSON.parse(query.get('compare'))); }
      catch (error) { feedback('对比模型读取失败。' + error.message); }
    }
    renderComparison();
    const K = query.has('k') ? Number(query.get('k')) : 1;
    const duration = Number(query.get('t') || 0);
    const view = query.get('view') || 'all';
    const frequency = Number(query.get('w'));
    clearFrequency();
    state.frequency = Number.isFinite(frequency) && frequency > 0 ? frequency : null;
    if (query.get('n') && query.get('d')) {
      $('ex').value = '';
      loadExample({
        n: query.get('n'),
        d: query.get('d'),
        tau: Number(query.get('tau') || 0),
        k: Number.isFinite(K) && K >= 0 ? K : 1,
        t: Number.isFinite(duration) && duration >= 0 ? duration : 0,
        sg: query.get('neg') === '1' ? -1 : 1,
      });
      const selectedExample = EX.findIndex(example => example.n === query.get('n') && example.d === query.get('d') && (example.tau || 0) === Number(query.get('tau') || 0) && query.get('neg') !== '1');
      $('ex').value = selectedExample >= 0 ? String(selectedExample) : '';
    } else {
      $('ex').value = '0'; loadExample(EX[0]);
    }
    setView(view);
  }

  buildRuler();
  EX.forEach((e, i) => { const o = document.createElement('option'); o.value = i; o.textContent = e.name; $('ex').appendChild(o); });
  $('ex').addEventListener('change', () => { if ($('ex').value !== '') loadExample(EX[+$('ex').value]); });
  for (const id of ['num', 'den', 'tau']) $(id).addEventListener('input', () => { $('ex').value = ''; debounced(); });
  $('neg').addEventListener('change', rebuild);
  $('tEnd').addEventListener('input', () => {
    try {
      state.duration = readDuration();
      P.step.userView = false;
      if ($('err').hidden) schedule();
      else rebuild();
    } catch (error) { $('err').textContent = error.message; $('err').hidden = false; }
  });
  for (const { number, slider, error } of gainFields) {
    slider.addEventListener('input', () => {
      const exponent = Number(slider.value);
      setK(exponent < gainScale.low - 0.25 ? 0 : Math.pow(10, Math.max(gainScale.low, exponent)), slider);
    });
    slider.addEventListener('keydown', event => {
      const lowestGain = Math.pow(10, gainScale.low);
      if (state.K === 0 && ['ArrowRight', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); setK(lowestGain);
      } else if (state.K <= lowestGain && ['ArrowLeft', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); setK(0);
      }
    });
    number.addEventListener('input', () => setK(number.value === '' ? NaN : Number(number.value), number));
    number.addEventListener('blur', () => {
      if (number.getAttribute('aria-invalid') !== 'true') return;
      number.value = state.K;
      number.removeAttribute('aria-invalid');
      error.hidden = true;
    });
  }
  $('frequency').addEventListener('input', () => {
    const value = Number($('frequency').value);
    $('frequency').setCustomValidity($('frequency').value === '' || Number.isFinite(value) && value > 0 ? '' : '频率须为正有限数值');
    if ($('frequency').value === '') { clearFrequency(); saveHash(); }
    else if (Number.isFinite(value) && value > 0) { showFrequency(value); saveHash(); }
  });
  $('clearFrequency').addEventListener('click', () => { clearFrequency(); saveHash(); });
  $('plotTabs').addEventListener('click', event => { const button = event.target.closest('button[data-view]'); if (button) setView(button.dataset.view); });
  $('plots').addEventListener('click', event => {
    const button = event.target.closest('button[data-focus]');
    if (button) setView(state.view === button.dataset.focus ? 'all' : button.dataset.focus);
  });
  $('gainIncrease').addEventListener('click', () => setK(state.K === 0 ? 1 : +(state.K * 1.1).toPrecision(8)));
  $('gainDecrease').addEventListener('click', () => setK(+(state.K * .9).toPrecision(8)));
  $('compare').addEventListener('click', () => {
    if (!state.model) return;
    try {
      comparison = makeComparison({ ...state.model, k: state.K, t: state.duration });
      renderComparison(); updateK();
      feedback('已保存对比模型，可调整参数查看两组曲线。');
    } catch (error) { feedback(error.message); }
  });
  $('clearCompare').addEventListener('click', () => { comparison = null; renderComparison(); updateK(); });
  $('exportPNG').addEventListener('click', exportPNG);
  $('exportCSV').addEventListener('click', exportCSV);
  const redrawAll = () => Object.values(P).forEach(p => p.draw());
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  function updateThemeLabel() {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : mqDark.matches;
    $('theme').textContent = dark ? '浅色模式' : '深色模式';
  }
  mqDark.addEventListener('change', () => { redrawAll(); updateThemeLabel(); });
  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : mqDark.matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* 隐私模式下忽略 */ }
    $('siteMenu').open = false;
    $('siteMenu').querySelector('summary').focus({ preventScroll: true });
    redrawAll(); updateThemeLabel();
  });
  $('share').addEventListener('click', async () => {
    const b = $('share');
    saveHash();
    try { await navigator.clipboard.writeText(location.href); b.textContent = '已复制'; b.classList.add('done'); }
    catch (e) { feedback('请复制浏览器地址栏中的链接。'); }
    setTimeout(() => { b.innerHTML = '分享<span aria-hidden="true">↗</span>'; b.classList.remove('done'); }, 1800);
  });

  function closeMenus(except) {
    for (const menu of document.querySelectorAll('.popover[open]')) if (menu !== except) menu.open = false;
  }
  document.addEventListener('pointerdown', event => closeMenus(event.target.closest('.popover')));
  document.addEventListener('toggle', event => {
    if (event.target.classList.contains('popover') && event.target.open) closeMenus(event.target);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = document.querySelector('.popover[open]');
    if (menu) { closeMenus(); menu.querySelector('summary').focus({ preventScroll: true }); }
  });
  let helpReturnFocus = null;
  function openHelp(opener) {
    closeMenus();
    helpReturnFocus = opener;
    $('helpDialog').returnValue = '';
    $('helpDialog').showModal();
  }
  $('helpOpen').addEventListener('click', () => openHelp($('siteMenu').querySelector('summary')));
  $('exerciseOpen').addEventListener('click', event => openHelp(event.currentTarget));
  $('helpClose').addEventListener('click', () => $('helpDialog').close());
  $('helpDialog').addEventListener('click', event => {
    const exercise = event.target.closest('[data-exercise]');
    if (exercise && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      const query = new URLSearchParams(new URL(exercise.href).hash.slice(1));
      $('helpDialog').close(query.get('view') || 'all');
      return;
    }
    if (event.target !== $('helpDialog')) return;
    const bounds = $('helpDialog').getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('helpDialog').close();
  });
  $('helpDialog').addEventListener('close', () => {
    const view = $('helpDialog').returnValue;
    const chartTab = [...$('plotTabs').querySelectorAll('button[data-view]')].find(button => button.dataset.view === view);
    (chartTab || helpReturnFocus)?.focus({ preventScroll: true });
  });
  const mobileLayout = window.matchMedia('(max-width: 760px)');
  function updateMobileGain() {
    const show = mobileLayout.matches && $('kSlider').getBoundingClientRect().bottom <= 0;
    $('mobileGainDock').hidden = !show;
    document.documentElement.classList.toggle('gain-docked', show);
  }
  const updateControlLayout = () => {
    $('controlOptions').open = !mobileLayout.matches;
    updateMobileGain();
  };
  mobileLayout.addEventListener('change', updateControlLayout);
  new IntersectionObserver(updateMobileGain).observe($('kSlider'));
  updateControlLayout();
  updateThemeLabel();
  document.fonts.ready.then(() => { redrawAll(); renderLegends(); });

  ['rRL', 'rBode', 'rNyq', 'rNic', 'rStep'].forEach(id => ro(id));
  window.addEventListener('hashchange', restoreHash);
  restoreHash();
})();
