'use strict';
/* 控制系统分析：开环 G(s)H(s) = K·N(s)/D(s)·e^{-τs}，单位负反馈闭环特征方程 D + K·N = 0 */

const Ctl = (() => {
  const PI = Math.PI;

  function makeSystem(numStr, denStr, tau = 0) {
    if (!Number.isFinite(tau) || tau < 0) throw new Error('延迟时间 τ 必须是非负有限数值');
    let A, B;
    try { A = parseTF(numStr); } catch (e) { throw new Error('分子：' + e.message); }
    try { B = parseTF(denStr); } catch (e) { throw new Error('分母：' + e.message); }
    let n = Poly.mul(A.n, B.d), d = Poly.mul(A.d, B.n);
    if (![...n, ...d].every(Number.isFinite)) throw new Error('系数运算超出数值范围');
    n = Poly.trim(n); d = Poly.trim(d);
    if (Poly.isZero(d)) throw new Error('分母不能为 0');
    if (Poly.isZero(n)) throw new Error('分子不能为 0');
    while (n.length > 1 && d.length > 1 && n[0] === 0 && d[0] === 0) { n = n.slice(1); d = d.slice(1); }
    if (d.length > 25 || n.length > 25) throw new Error('阶次过高（最高支持 24 阶）');
    const lead = d[d.length - 1];
    n = n.map(c => c / lead); d = d.map(c => c / lead);
    if (![...n, ...d].every(Number.isFinite)) throw new Error('系数归一化超出数值范围');
    const zeros = Poly.cleanRoots(Poly.roots(n)), poles = Poly.cleanRoots(Poly.roots(d));
    if (![...zeros, ...poles].every(r => r.every(Number.isFinite))) throw new Error('当前系数无法可靠求根，请调整数值尺度');
    const sys = { num: n, den: d, zeros, poles, m: n.length - 1, n: d.length - 1, kLead: n[n.length - 1], tau: tau > 0 ? tau : 0 };
    const mags = [...zeros, ...poles].map(Cx.abs).filter(v => v > 0);
    sys.corners = [...new Set(mags.map(v => +v.toPrecision(6)))].sort((a, b) => a - b);
    const all = sys.corners.slice();
    if (sys.tau > 0) all.push(1 / sys.tau);
    sys.wLow = all.length ? Math.min(...all) : 1;
    sys.wHigh = all.length ? Math.max(...all) : 1;
    sys.R = mags.length ? Math.max(...mags) : 1;
    const nz = rs => rs.filter(x => x[0] === 0 && x[1] === 0).length;
    sys.type = nz(poles) - nz(zeros);
    let i = 0; while (n[i] === 0) i++;
    let j = 0; while (d[j] === 0) j++;
    sys.k0 = n[i] / d[j];                       // lim s^v·N/D
    sys.imagPoles = poles.some(p => p[0] === 0);
    sys.shift = {};
    for (const sg of [1, -1]) {
      const w0 = sys.wLow * 1e-7;
      let ph = sys.kLead * sg < 0 ? PI : 0;
      for (const z of zeros) ph += angRoot(z, w0);
      for (const p of poles) ph -= angRoot(p, w0);
      const target = -PI / 2 * sys.type;
      sys.shift[sg] = -2 * PI * Math.floor((ph - target + PI + 1e-6) / (2 * PI));
    }
    return sys;
  }

  /* (jω − r) 的相角，取对 ω 连续的分支 */
  function angRoot(r, w) {
    const a = r[0], b = r[1];
    if (a < 0) return Math.atan2(w - b, -a);
    if (a > 0) return (b >= 0 ? PI : -PI) - Math.atan((w - b) / a);
    return w - b >= 0 ? PI / 2 : -PI / 2;
  }

  /* K=1 时的频率响应：[ln|G|, 连续相角(rad)] */
  function resp(sys, sg, w) {
    let lm = Math.log(Math.abs(sys.kLead)), ph = (sys.kLead * sg < 0 ? PI : 0) + sys.shift[sg] - w * sys.tau;
    for (const z of sys.zeros) { lm += Math.log(Math.hypot(z[0], w - z[1])); ph += angRoot(z, w); }
    for (const p of sys.poles) { lm -= Math.log(Math.hypot(p[0], w - p[1])); ph -= angRoot(p, w); }
    return [lm, ph];
  }

  /* 渐近幅频特性（折线）dB */
  function asymDb(sys, K, w) {
    let v = 20 * (Math.log(Math.abs(K)) + Math.log(Math.abs(sys.kLead))) / Math.LN10;
    const f = r => { const a = Cx.abs(r); return 20 * Math.log10(a === 0 ? w : Math.max(w, a)); };
    for (const z of sys.zeros) v += f(z);
    for (const p of sys.poles) v -= f(p);
    return v;
  }

  /* 用增益和低、高频渐近式确定搜索范围，覆盖幅值交越点。 */
  function frequencyBounds(sys, K) {
    let low = Math.log(sys.wLow) - Math.log(1000);
    let high = Math.log(sys.wHigh) + Math.log(1000);
    if (K > 0) {
      const lowSlope = -sys.type, highSlope = sys.m - sys.n;
      const lowGain = Math.log(K) + Math.log(Math.abs(sys.k0));
      const highGain = Math.log(K) + Math.log(Math.abs(sys.kLead));
      if (lowSlope !== 0) low = Math.min(low, (-Math.sign(lowSlope) * Math.log(100) - lowGain) / lowSlope);
      if (highSlope !== 0) high = Math.max(high, (Math.sign(highSlope) * Math.log(100) - highGain) / highSlope);
    }
    return [Math.exp(Math.max(-690, low)), Math.exp(Math.min(690, high))];
  }

  /* 数值分析使用连续相角。显示采样在密集延迟绕转处断线，避免连出伪曲线。 */
  function freqSamples(sys, sg, K = 1, resolveDelay = true) {
    const w = [], lm = [], ph = [];
    const bounds = frequencyBounds(sys, K);
    let x = bounds[0];
    const wEnd = bounds[1];
    let f = 1.02, cur = resp(sys, sg, x);
    w.push(x); lm.push(cur[0]); ph.push(cur[1]);
    while (x < wEnd && w.length < 40000) {
      const xn = Math.min(wEnd, x * f), r = resp(sys, sg, xn);
      if (!(xn > x)) break;
      if (!isFinite(r[0])) { x = xn; continue; }
      const delayChange = resolveDelay ? 0 : (xn - x) * sys.tau;
      const dph = Math.abs(r[1] - cur[1] + delayChange), dlm = Math.abs(r[0] - cur[0]);
      if ((dph > 0.04 || dlm > 0.05) && f > 1.0005) { f = 1 + (f - 1) / 2; continue; }
      w.push(xn); lm.push(r[0]); ph.push(r[1]);
      x = xn; cur = r;
      if (dph < 0.008 && dlm < 0.02) f = Math.min(1.03, 1 + (f - 1) * 1.6);
    }
    const brk = ph.map((angle, i) => i > 0 && Math.abs(angle - ph[i - 1]) > 0.3);
    return { w, lm, ph, brk, complete: x >= wEnd, bounds };
  }

  const wrap180 = x => x - 360 * Math.ceil((x - 180) / 360);

  function bisect(fn, a, b) {
    let fa = fn(a);
    for (let i = 0; i < 50; i++) {
      const m = Math.sqrt(a * b), fm = fn(m);
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
    }
    return Math.sqrt(a * b);
  }

  /* 截止频率/相角裕度、穿越频率/幅值裕度 */
  function margins(sys, sg, S, K) {
    if (K === 0) return { gc: [], pc: [], bestG: null, bestP: null, zeroGain: true };
    const bounds = frequencyBounds(sys, K);
    // 延迟不改变幅值，数值搜索可沿用有理部分的采样密度。
    if (sys.tau > 0 || !S.complete || S.w[0] > bounds[0] || S.w[S.w.length - 1] < bounds[1]) S = freqSamples(sys, sg, K, false);
    const lk = Math.log(K), gc = [], pc = [];
    const seenPhaseCrossings = new Set();
    for (let i = 0; i + 1 < S.w.length; i++) {
      const a = S.lm[i] + lk, b = S.lm[i + 1] + lk;
      if ((a > 0) !== (b > 0)) {
        const w = bisect(x => resp(sys, sg, x)[0] + lk, S.w[i], S.w[i + 1]);
        const ph = resp(sys, sg, w)[1] * 180 / PI;
        gc.push({ w, ph, pm: wrap180(ph + 180) });
      }
    }
    for (let i = 0; i + 1 < S.w.length; i++) {
      const lowPhase = Math.min(S.ph[i], S.ph[i + 1]), highPhase = Math.max(S.ph[i], S.ph[i + 1]);
      if (highPhase - lowPhase < 1e-10) continue;
      const first = Math.ceil((lowPhase + PI) / (2 * PI)), last = Math.floor((highPhase + PI) / (2 * PI));
      if (first > last) continue;
      const levels = new Set();
      // 密集延迟绕转只需保留区间端点及 0 dB 附近的交点，即可选择最小绝对裕度。
      for (let j = 0; j < Math.min(8, last - first + 1); j++) { levels.add(first + j); levels.add(last - j); }
      for (const g of gc) {
        if (g.w < S.w[i] || g.w > S.w[i + 1]) continue;
        const nearest = (g.ph * PI / 180 + PI) / (2 * PI);
        levels.add(Math.floor(nearest)); levels.add(Math.ceil(nearest));
      }
      for (const index of levels) {
        if (index < first || index > last) continue;
        const level = -PI + 2 * PI * index;
        const w = bisect(x => resp(sys, sg, x)[1] - level, S.w[i], S.w[i + 1]);
        const crossingKey = w.toPrecision(10);
        if (seenPhaseCrossings.has(crossingKey)) continue;
        seenPhaseCrossings.add(crossingKey);
        const db = (resp(sys, sg, w)[0] + lk) * 20 / Math.LN10;
        pc.push({ w, db, gm: -db, level: level * 180 / PI });
      }
    }
    // 同阶系统可能在无穷频率达到负实轴，对应闭环最高次项消失的增益边界。
    if (sys.tau === 0 && sys.n === sys.m && sg * sys.kLead < 0) {
      const db = 20 * (Math.log(K) + Math.log(Math.abs(sys.kLead))) / Math.LN10;
      const level = Math.round(resp(sys, sg, S.w[S.w.length - 1])[1] / PI) * 180;
      pc.push({ w: Infinity, db, gm: -db, level, atInfinity: true });
    }
    pc.sort((a, b) => a.w - b.w);
    let bestG = null, bestP = null;
    for (const g of gc) if (!bestG || Math.abs(g.pm) < Math.abs(bestG.pm)) bestG = g;
    for (const p of pc) if (!bestP || Math.abs(p.gm) < Math.abs(bestP.gm)) bestP = p;
    return { gc, pc, bestG, bestP };
  }

  /* ---------- 根轨迹 ---------- */
  const charPoly = (sys, sg, K) => Poly.add(sys.den, Poly.scale(sys.num, sg * K));

  function singularGains(sys, sg) {
    if (sys.n !== sys.m) return [];
    const K = -sys.den[sys.n] / (sg * sys.num[sys.m]);
    return K > 0 && Number.isFinite(K) ? [K] : [];
  }

  function closedStatus(sys, sg, K) {
    const coefficients = charPoly(sys, sg, K);
    if (!coefficients.every(Number.isFinite)) return { kind: 'unknown', poles: [], rightCount: 0 };
    const polynomial = Poly.trim(coefficients);
    const poles = Poly.cleanRoots(Poly.roots(polynomial));
    if (Poly.isZero(polynomial) || (K > 0 && polynomial.length < sys.num.length)) return { kind: 'singular', poles, rightCount: 0 };
    if (!poles.every(p => p.every(Number.isFinite))) return { kind: 'unknown', poles: [], rightCount: 0 };
    const tolerance = pole => 1e-9 * Cx.abs(pole);
    const rightCount = poles.filter(p => p[0] > tolerance(p)).length;
    const marginal = poles.some(p => Math.abs(p[0]) <= tolerance(p));
    return { kind: rightCount ? 'unstable' : marginal ? 'marginal' : 'stable', poles, rightCount };
  }

  function match(prev, next) {
    const n = prev.length;
    let ident = true;
    for (let i = 0; i < n && ident; i++) {
      const di = Cx.abs(Cx.sub(prev[i], next[i]));
      for (let j = 0; j < n; j++)
        if (j !== i && Cx.abs(Cx.sub(prev[i], next[j])) < di) { ident = false; break; }
    }
    if (ident) return next;
    const pairs = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) pairs.push([Cx.abs(Cx.sub(prev[i], next[j])), i, j]);
    pairs.sort((a, b) => a[0] - b[0]);
    const out = new Array(n), ui = new Array(n).fill(false), uj = new Array(n).fill(false);
    for (const [, i, j] of pairs) {
      if (ui[i] || uj[j]) continue;
      out[i] = next[j]; ui[i] = uj[j] = true;
    }
    return out;
  }

  function rootLocus(sys, sg) {
    const nb = Math.max(sys.n, sys.m), R = sys.R;
    const Kref = Math.exp(Math.max(-690, Math.min(690, (sys.n - sys.m) * Math.log(R) - Math.log(Math.abs(sys.kLead)))));
    const br = [];
    for (let i = 0; i < nb; i++) br.push({ x: [], y: [], k: [], brk: [] });
    const push = (rs, K, brk) => {
      for (let i = 0; i < nb; i++) { br[i].x.push(rs[i][0]); br[i].y.push(rs[i][1]); br[i].k.push(K); br[i].brk.push(brk); }
    };
    if (nb === 0) return { branches: br, Kref };
    let K = Kref * 1e-7, roots = Poly.roots(charPoly(sys, sg, K));
    if (roots.length !== nb || roots.some(root => !root.every(Number.isFinite))) return { branches: br, Kref };
    if (sys.m <= sys.n) {
      const p0 = match(roots, sys.poles.map(p => p.slice()));
      push(p0, 0, false);
    }
    push(roots, K, false);
    let f = 1.2, steps = 0;
    const Kmax = Kref * 1e7;
    while (K < Kmax && steps < 9000) {
      const Kn = K * f;
      // 初值加微小虚部扰动：否则实根初值在实系数迭代中永远停在实轴上，无法在分离点处离开实轴
      const init = roots.map((r, i) => [r[0], r[1] + (i % 2 ? 1 : -1) * 1e-6 * (1 + 0.13 * i) * (R + Cx.abs(r))]);
      let rn = Poly.roots(charPoly(sys, sg, Kn), init);
      if (rn.length !== nb || rn.some(r => !isFinite(r[0]) || !isFinite(r[1]))) { K = Kn; steps++; continue; }
      rn = match(roots, rn);
      let e = 0;
      for (let i = 0; i < nb; i++)
        e = Math.max(e, Cx.abs(Cx.sub(rn[i], roots[i])) / (0.015 * (R + Cx.abs(roots[i]))));
      if (e > 1 && f > 1.0004) { f = Math.sqrt(f); continue; }
      push(rn, Kn, e > 8);
      roots = rn; K = Kn; steps++;
      if (e < 0.35) f = Math.min(f * f, 1.5);
    }
    return { branches: br, Kref };
  }

  function asymptotes(sys, sg) {
    const q = sys.n - sys.m;
    if (q <= 0) return null;
    const sumP = sys.n > 0 ? -sys.den[sys.n - 1] : 0;
    const sumZ = sys.m > 0 ? -sys.num[sys.m - 1] / sys.num[sys.m] : 0;
    const pos = sg * sys.kLead > 0, angles = [];
    for (let k = 0; k < q; k++) angles.push((pos ? 2 * k + 1 : 2 * k) * 180 / q);
    return { sigma: (sumP - sumZ) / q, angles };
  }

  /* 分离点/会合点：N'D − ND' = 0 且对应 K 为正实数 */
  function breakaways(sys, sg, Kref) {
    const P = Poly.trim(Poly.add(Poly.mul(Poly.deriv(sys.num), sys.den), Poly.scale(Poly.mul(sys.num, Poly.deriv(sys.den)), -1)));
    if (P.length < 2) return [];
    const out = [];
    for (const s of Poly.cleanRoots(Poly.roots(P))) {
      if (s[1] < 0) continue;
      const N = Poly.eval(sys.num, s), D = Poly.eval(sys.den, s);
      if (Cx.abs(N) === 0) continue;
      const K = Cx.div([-D[0], -D[1]], N), Ks = K[0] * sg;
      if (Ks > 1e-9 * Kref && isFinite(Ks) && Math.abs(K[1]) < 1e-5 * Math.abs(K[0])) out.push({ s, K: Ks });
    }
    return out;
  }

  /* 与虚轴交点：Im[D(jω)·conj(N(jω))] = 0 的非负实根 */
  function jwCross(sys, sg, Kref) {
    const J = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const cp = (p, conj) => p.map((c, k) => [c * J[k % 4][0], c * J[k % 4][1] * (conj ? -1 : 1)]);
    const Dj = cp(sys.den, false), Nc = cp(sys.num, true);
    const P = [];
    for (let i = 0; i < Dj.length + Nc.length - 1; i++) P.push([0, 0]);
    for (let i = 0; i < Dj.length; i++)
      for (let j = 0; j < Nc.length; j++) {
        const v = Cx.mul(Dj[i], Nc[j]);
        P[i + j][0] += v[0]; P[i + j][1] += v[1];
      }
    let sc = 0;
    for (const c of P) sc = Math.max(sc, Cx.abs(c));
    const Q = Poly.trim(P.map(c => (Math.abs(c[1]) < 1e-12 * sc ? 0 : c[1])));
    if (Poly.isZero(Q)) return { degenerate: true, list: [] };
    const list = [];
    for (const r of Poly.cleanRoots(Poly.roots(Q))) {
      if (Math.abs(r[1]) > 1e-5 * (sys.R + Cx.abs(r)) || r[0] < -1e-9 * sys.R) continue;
      const w = Math.max(0, r[0]), s = [0, w];
      const N = Poly.eval(sys.num, s), D = Poly.eval(sys.den, s), n2 = N[0] * N[0] + N[1] * N[1];
      if (n2 === 0) continue;
      const K = -(D[0] * N[0] + D[1] * N[1]) / n2 * sg;
      if (!(K > 1e-9 * Kref) || !isFinite(K)) continue;
      if (list.some(c => Math.abs(c.w - w) < 1e-6 * (sys.R + w) && Math.abs(c.K - K) < 1e-6 * K)) continue;
      list.push({ w, K });
    }
    list.sort((a, b) => a.K - b.K);
    return { degenerate: false, list };
  }

  function isStable(sys, sg, K) {
    return closedStatus(sys, sg, K).kind === 'stable';
  }

  function stableRanges(sys, sg, cross, Kref) {
    const ks = [];
    for (const K of [...cross.map(c => c.K), ...singularGains(sys, sg)])
      if (!ks.some(k => Math.abs(k - K) < 1e-6 * k)) ks.push(K);
    ks.sort((a, b) => a - b);
    const edges = [0, ...ks, Infinity], res = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i], b = edges[i + 1];
      const t = a === 0 ? (b === Infinity ? Kref : b / 2) : (b === Infinity ? a * 2 : Math.sqrt(a * b));
      if (isStable(sys, sg, t)) res.push([a, b]);
    }
    return res;
  }

  const closedPoles = (sys, sg, K) => Poly.cleanRoots(Poly.roots(charPoly(sys, sg, K)));

  /* ---------- 单位阶跃响应（闭环 T = KN/(D+KN)，矩阵指数精确离散化） ---------- */
  function matMul(A, B) {
    const n = A.length, C = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      for (let k = 0; k < n; k++) {
        const a = A[i][k];
        if (a === 0) continue;
        for (let j = 0; j < n; j++) row[j] += a * B[k][j];
      }
      C.push(row);
    }
    return C;
  }
  function expm(A) {
    const n = A.length;
    let norm = 0;
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += Math.abs(A[i][j]); norm = Math.max(norm, s); }
    if (!Number.isFinite(norm)) throw new Error('仿真数值超出范围，请缩短时长');
    const sq = Math.max(0, Math.ceil(Math.log2(norm) + 1));
    const sc = Math.pow(2, -sq), B = A.map(r => r.map(v => v * sc));
    let E = [], T = [];
    for (let i = 0; i < n; i++) { E.push(new Array(n).fill(0)); E[i][i] = 1; T.push(E[i].slice()); }
    for (let k = 1; k <= 18; k++) {
      T = matMul(T, B).map(r => r.map(v => v / k));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) E[i][j] += T[i][j];
    }
    for (let i = 0; i < sq; i++) {
      E = matMul(E, E);
      if (!E.every(row => row.every(Number.isFinite))) throw new Error('响应超出数值范围，请缩短时长');
    }
    return E;
  }

  function step(sys, sg, K, Tuser) {
    const numerator = Poly.scale(sys.num, sg * K), denominator = Poly.add(sys.den, numerator);
    if (![...numerator, ...denominator].every(Number.isFinite)) return { err: '当前系数或增益超出仿真数值范围' };
    const num = Poly.trim(numerator), den = Poly.trim(denominator);
    if (Poly.isZero(den)) return { err: '闭环特征多项式恒为 0' };
    if (num.length > den.length) return { err: '闭环传递函数分子阶次高于分母，无法仿真' };
    const n = den.length - 1, lead = den[n];
    const a = den.map(c => c / lead), b = [];
    for (let i = 0; i <= n; i++) b.push((num[i] || 0) / lead);
    const poles = Poly.roots(den);
    let scp = 0;
    for (const p of poles) scp = Math.max(scp, Cx.abs(p));
    const tolerance = pole => 1e-9 * Cx.abs(pole);
    const st = poles.filter(p => p[0] < -tolerance(p));
    const un = poles.filter(p => p[0] > tolerance(p));
    const mg = poles.filter(p => Math.abs(p[0]) <= tolerance(p));
    const stable = n > 0 ? (un.length === 0 && mg.length === 0) : true;
    let T = Tuser;
    if (!(T > 0)) {
      if (un.length) T = 6 / Math.max(...un.map(p => p[0]));
      else if (mg.length) {
        const ims = mg.map(p => Math.abs(p[1])).filter(v => v > 0);
        T = ims.length ? 12 * PI / Math.min(...ims) : 10 / (scp || 1);
        if (st.length) T = Math.max(T, 8 / Math.min(...st.map(p => -p[0])));
      } else if (st.length) T = 8 / Math.min(...st.map(p => -p[0]));
      else T = 10;
    }
    const t = [0], y = [];
    const D = b[n];
    if (n === 0) return { t: [0, T], y: [D, D], T, stable: true, yss: D, os: 0, tp: NaN, ts: 0 };
    const C = [];
    for (let i = 0; i < n; i++) C.push(b[i] - a[i] * D);
    const M = [];
    for (let i = 0; i <= n; i++) M.push(new Array(n + 1).fill(0));
    for (let i = 0; i < n - 1; i++) M[i][i + 1] = 1;
    for (let i = 0; i < n; i++) M[n - 1][i] = -a[i];
    M[n - 1][n] = 1;
    const steps = 2000, dt = T / steps;
    let Phi;
    try { Phi = expm(M.map(r => r.map(v => v * dt))); }
    catch (error) { return { err: error.message }; }
    let z = new Array(n + 1).fill(0);
    z[n] = 1;
    y.push(D);
    for (let k = 1; k <= steps; k++) {
      const zn = new Array(n + 1).fill(0);
      for (let i = 0; i <= n; i++) { let s = 0; for (let j = 0; j <= n; j++) s += Phi[i][j] * z[j]; zn[i] = s; }
      z = zn;
      let v = D;
      for (let i = 0; i < n; i++) v += C[i] * z[i];
      if (!isFinite(v) || Math.abs(v) > 1e15) break;
      t.push(k * dt); y.push(v);
    }
    const out = { t, y, T, stable };
    if (stable) {
      const yss = b[0] / a[0];
      out.yss = yss;
      if (K === 0) { out.os = 0; out.tp = NaN; out.ts = 0; }
      if (Math.abs(yss) > 1e-12) {
        const sgn = Math.sign(yss);
        let pi = 0;
        for (let i = 1; i < y.length; i++) if (y[i] * sgn > y[pi] * sgn) pi = i;
        out.os = Math.max(0, (y[pi] * sgn - Math.abs(yss)) / Math.abs(yss)) * 100;
        out.tp = out.os > 1e-6 ? t[pi] : NaN;
        let last = -1;
        for (let i = 0; i < y.length; i++) if (Math.abs(y[i] - yss) > 0.02 * Math.abs(yss)) last = i;
        out.ts = last + 1 < t.length ? t[last + 1] : NaN;
      }
    }
    return out;
  }

  return { makeSystem, resp, asymDb, frequencyBounds, freqSamples, margins, rootLocus, asymptotes, breakaways, jwCross, singularGains, stableRanges, closedStatus, isStable, closedPoles, step, charPoly };
})();

if (typeof module !== 'undefined') module.exports = { Ctl };
