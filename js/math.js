'use strict';
/* 基础数学：复数、实系数多项式（升幂数组 p[i] 为 s^i 的系数）、求根、传递函数表达式解析 */

const Cx = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  },
  abs: a => Math.hypot(a[0], a[1]),
};

const Poly = {
  trim(p) {
    let n = p.length;
    while (n > 1 && p[n - 1] === 0) n--;
    return p.slice(0, n);
  },
  add(a, b) {
    const n = Math.max(a.length, b.length), r = new Array(n);
    for (let i = 0; i < n; i++) r[i] = (a[i] ?? 0) + (b[i] ?? 0);
    return r;
  },
  scale: (a, k) => a.map(c => c * k),
  mul(a, b) {
    const r = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
    return r;
  },
  deriv: a => (a.length < 2 ? [0] : a.slice(1).map((c, i) => c * (i + 1))),
  isZero: a => a.every(c => c === 0),
  eval(a, s) {
    let r = [0, 0];
    for (let i = a.length - 1; i >= 0; i--)
      r = [r[0] * s[0] - r[1] * s[1] + a[i], r[0] * s[1] + r[1] * s[0]];
    return r;
  },

  // 由导数的正实根分隔单调区间。对数坐标二分覆盖不同数量级的根。
  positiveRoots(input) {
    const first = input.findIndex(coefficient => coefficient !== 0);
    if (first < 0) return [];
    const p = Poly.trim(input.slice(first));
    const degree = p.length - 1;
    if (degree === 0) return [];
    if (degree === 1) {
      const root = -p[0] / p[1];
      return root > 0 && Number.isFinite(root) ? [root] : [];
    }

    function logUpper(coefficients) {
      const logLeading = Math.log(Math.abs(coefficients[degree]));
      let bound = -Infinity;
      for (let i = 0; i < degree; i++) {
        const logRatio = Math.log(Math.abs(coefficients[i])) - logLeading;
        bound = Math.max(bound, logRatio / (degree - i));
      }
      return Math.LN2 + bound;
    }
    const low = Math.exp(Math.max(Math.log(Number.MIN_VALUE), -logUpper(p.slice().reverse())));
    const high = Math.exp(Math.min(Math.log(Number.MAX_VALUE), logUpper(p)));
    if (!(low <= high)) return [];

    // 在 x>1 时求 p(x)/xⁿ，避免霍纳法中间结果溢出。
    function relativeValue(x) {
      const descending = x <= 1;
      const ratio = descending ? x : 1 / x;
      const start = descending ? degree : 0;
      const increment = descending ? -1 : 1;
      let value = p[start], scale = Math.abs(value);
      for (let i = start + increment; i >= 0 && i <= degree; i += increment) {
        value = value * ratio + p[i];
        scale = scale * ratio + Math.abs(p[i]);
      }
      return value / scale;
    }

    const critical = Poly.positiveRoots(Poly.deriv(p)).filter(x => x > low && x < high);
    const points = [low, ...critical, high];
    const values = points.map(relativeValue);
    const roots = [];
    const tolerance = 8 * degree * Number.EPSILON;
    for (let i = 0; i < points.length; i++) {
      const value = values[i];
      const touchesZero = Math.abs(value) <= tolerance;
      if (touchesZero) roots.push(points[i]);
      if (i === 0 || touchesZero || Math.abs(values[i - 1]) <= tolerance
        || Math.sign(value) === Math.sign(values[i - 1])) continue;
      let left = Math.log(points[i - 1]), right = Math.log(points[i]);
      const sign = Math.sign(values[i - 1]);
      for (let iteration = 0; iteration < 56; iteration++) {
        const middle = (left + right) / 2;
        const middleValue = relativeValue(Math.exp(middle));
        if (middleValue === 0) { left = right = middle; break; }
        if (Math.sign(middleValue) === sign) left = middle;
        else right = middle;
      }
      roots.push(Math.exp((left + right) / 2));
    }
    return roots;
  },

  /* Aberth–Ehrlich 法求全部根；init 可给出上一次的根作为初值（用于根轨迹连续跟踪） */
  roots(pin, init) {
    const p = Poly.trim(pin);
    let z0 = 0;
    while (z0 < p.length - 1 && p[z0] === 0) z0++;
    const q = p.slice(z0), m = q.length - 1, out = [];
    for (let i = 0; i < z0; i++) out.push([0, 0]);
    if (m <= 0) return out;
    if (m === 1) { out.push([-q[0] / q[1], 0]); return out; }
    const r0 = Math.pow(Math.abs(q[0] / q[m]), 1 / m) || 1;
    let z;
    if (init && z0 === 0 && init.length === m) z = init.map(r => [r[0], r[1]]);
    else {
      z = [];
      for (let k = 0; k < m; k++) {
        const a = 2 * Math.PI * k / m + 0.7;
        z.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
      }
    }
    for (let it = 0; it < 400; it++) {
      let maxd = 0;
      for (let k = 0; k < m; k++) {
        const s = z[k];
        let pr = [0, 0], dr = [0, 0];
        for (let i = m; i >= 0; i--) {
          dr = [dr[0] * s[0] - dr[1] * s[1] + pr[0], dr[0] * s[1] + dr[1] * s[0] + pr[1]];
          pr = [pr[0] * s[0] - pr[1] * s[1] + q[i], pr[0] * s[1] + pr[1] * s[0]];
        }
        if (pr[0] === 0 && pr[1] === 0) continue;
        const sa = Math.max(Cx.abs(s), r0 * 1e-6);
        if (dr[0] === 0 && dr[1] === 0) {
          z[k] = [s[0] + 1e-6 * sa, s[1] + 1e-6 * sa];
          maxd = 1;
          continue;
        }
        const w = Cx.div(pr, dr);
        let sum = [0, 0];
        for (let j = 0; j < m; j++) {
          if (j === k) continue;
          let d = Cx.sub(s, z[j]);
          if (d[0] === 0 && d[1] === 0) d = [1e-9 * sa, 1e-9 * sa];
          const inv = Cx.div([1, 0], d);
          sum[0] += inv[0]; sum[1] += inv[1];
        }
        const den = Cx.sub([1, 0], Cx.mul(w, sum));
        const dz = (den[0] === 0 && den[1] === 0) ? w : Cx.div(w, den);
        z[k] = Cx.sub(s, dz);
        maxd = Math.max(maxd, Cx.abs(dz) / sa);
      }
      if (maxd < 1e-14) break;
    }
    return out.concat(z);
  },

  /* 合并重根簇（重根数值上会散开，取簇均值可恢复精度），并把极小的实/虚部归零 */
  cleanRoots(rs) {
    const n = rs.length;
    if (!n) return [];
    let rmax = 0;
    for (const r of rs) rmax = Math.max(rmax, Cx.abs(r));
    const used = new Array(n).fill(false), out = [];
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const g = [i];
      used[i] = true;
      const tol = 2e-4 * Math.max(Cx.abs(rs[i]), 1e-6 * rmax);
      for (let j = i + 1; j < n; j++) {
        if (!used[j] && Cx.abs(Cx.sub(rs[i], rs[j])) < tol) { g.push(j); used[j] = true; }
      }
      let mx = 0, my = 0;
      for (const j of g) { mx += rs[j][0]; my += rs[j][1]; }
      mx /= g.length; my /= g.length;
      for (let k = 0; k < g.length; k++) out.push([mx, my]);
    }
    for (const r of out) {
      const a = Cx.abs(r);
      if (Math.abs(r[1]) < 1e-8 * a) r[1] = 0;
      if (Math.abs(r[0]) < 1e-9 * a) r[0] = 0;
    }
    out.sort((a, b) => (b[0] - a[0]) || (Math.abs(a[1]) - Math.abs(b[1])) || (b[1] - a[1]));
    return out;
  },
};

/* ---------- 表达式解析：支持 "10(s+1)"、"s^2+2s+5"、"s(0.5s+1)(s+2)"，或降幂系数表 "1 3 2" ---------- */
function parseTF(str) {
  let t = String(str)
    .replace(/[\[\]]/g, ' ').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[×·]/g, '*').replace(/[−–]/g, '-').replace(/\*\*/g, '^').replace(/＋/g, '+').trim();
  if (!t) throw new Error('输入为空');
  const numRe = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  const parts = t.split(/[\s,;，]+/).filter(Boolean);
  if (parts.length > 1 && parts.every(x => numRe.test(x))) {
    const coefficients = parts.map(Number);
    if (!coefficients.every(Number.isFinite)) throw new Error('系数必须是有限数值');
    return { n: Poly.trim(coefficients.reverse()), d: [1] };
  }

  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([sS])|([-+*/^()]))/y;
  let pos = 0;
  while (pos < t.length) {
    if (/^\s*$/.test(t.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(t);
    if (!m) throw new Error(`无法识别的字符 “${t.slice(pos).trim()[0]}”`);
    if (m[1] !== undefined) {
      const value = Number(m[1]);
      if (!Number.isFinite(value)) throw new Error('系数必须是有限数值');
      toks.push({ t: 'n', v: value });
    }
    else if (m[2]) toks.push({ t: 's' });
    else toks.push({ t: m[3] });
    pos = re.lastIndex;
  }
  let i = 0;
  const peek = () => (toks[i] ? toks[i].t : null);
  const R = {
    mul: (a, b) => ({ n: Poly.mul(a.n, b.n), d: Poly.mul(a.d, b.d) }),
    div(a, b) {
      if (Poly.isZero(Poly.trim(b.n))) throw new Error('除数为 0');
      return { n: Poly.mul(a.n, b.d), d: Poly.mul(a.d, b.n) };
    },
    add(a, b, sgn) {
      if (a.d.length === 1 && b.d.length === 1)
        return { n: Poly.add(Poly.scale(a.n, 1 / a.d[0]), Poly.scale(b.n, sgn / b.d[0])), d: [1] };
      return { n: Poly.add(Poly.mul(a.n, b.d), Poly.scale(Poly.mul(b.n, a.d), sgn)), d: Poly.mul(a.d, b.d) };
    },
  };
  function expr() {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = toks[i++].t;
      a = R.add(a, term(), op === '+' ? 1 : -1);
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const p = peek();
      if (p === '*') { i++; a = R.mul(a, unary()); }
      else if (p === '/') { i++; a = R.div(a, unary()); }
      else if (p === 'n' || p === 's' || p === '(') a = R.mul(a, power());
      else break;
    }
    return a;
  }
  function unary() {
    if (peek() === '-') { i++; const a = unary(); return { n: Poly.scale(a.n, -1), d: a.d }; }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function power() {
    let a = primary();
    if (peek() === '^') {
      i++;
      let sg = 1;
      if (peek() === '-') { sg = -1; i++; }
      const tk = toks[i++];
      if (!tk || tk.t !== 'n' || !Number.isInteger(tk.v) || tk.v > 30) throw new Error('指数必须是不超过 30 的整数');
      let r = { n: [1], d: [1] };
      for (let k = 0; k < tk.v; k++) r = R.mul(r, a);
      a = sg < 0 ? R.div({ n: [1], d: [1] }, r) : r;
    }
    return a;
  }
  function primary() {
    const tk = toks[i++];
    if (!tk) throw new Error('表达式不完整');
    if (tk.t === 'n') return { n: [tk.v], d: [1] };
    if (tk.t === 's') return { n: [0, 1], d: [1] };
    if (tk.t === '(') {
      const a = expr();
      if (peek() !== ')') throw new Error('括号不匹配');
      i++;
      return a;
    }
    throw new Error(`“${tk.t}” 位置不正确`);
  }
  const res = expr();
  if (i < toks.length) throw new Error(peek() === ')' ? '括号不匹配' : `“${peek()}” 位置不正确`);
  if (![...res.n, ...res.d].every(Number.isFinite)) throw new Error('系数运算超出数值范围');
  return { n: Poly.trim(res.n), d: Poly.trim(res.d) };
}

if (typeof module !== 'undefined') module.exports = { Cx, Poly, parseTF };
