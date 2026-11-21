'use strict';
/* 轻量 Canvas 绘图组件。鼠标、触屏和键盘均可读图。
   xlog=true 时数据的 x 坐标应为 log10(ω)，组件只负责对数刻度的绘制。 */

function niceTicks(a, b, target, mode) {
  const raw = (b - a) / Math.max(target, 2);
  let step;
  if (mode === 'deg') step = [1, 2, 5, 10, 15, 30, 45, 90, 180, 360, 720, 1440, 3600].find(s => s >= raw);
  else if (mode === 'db') step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 40, 60, 100, 200, 400, 1000].find(s => s >= raw);
  if (!step) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  const ticks = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) ticks.push(v);
  return { ticks, step };
}

function fmtTick(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  const a = Math.abs(v);
  let s;
  if (a >= 1e5 || a < 1e-4) s = v.toExponential(1).replace('.0e', 'e').replace('e+', 'e');
  else s = v.toFixed(Math.min(8, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))));
  return s.replace('-', '−');
}

class Plot {
  constructor(canvas, o) {
    this.c = canvas;
    this.styleSource = canvas;
    this.g = canvas.getContext('2d');
    this.background = document.createElement('canvas');
    this.o = Object.assign({ xlog: false, equal: false, xlabel: '', ylabel: '', zoom: 'xy', xMode: null, yMode: null }, o);
    this.view = [0, 1, 0, 1];
    this.home = [0, 1, 0, 1];
    this.series = []; this.markers = []; this.hlines = []; this.vlines = []; this.legend = [];
    this.regions = [];
    this.cursor = null; this.vcursor = null; this.message = '';
    this.keyboardPosition = [0.5, 0.5];
    this.userView = false;
    this.m = { l: 62, r: 16, t: 16, b: 44 };
    this.W = 0; this.H = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this._events();
    this.resize();
  }
  get pw() { return Math.max(10, this.W - this.m.l - this.m.r); }
  get ph() { return Math.max(10, this.H - this.m.t - this.m.b); }
  resize() {
    const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.W = w; this.H = h; this.dpr = dpr;
    if (this.o.equal) { if (!this.userView) this.view = this.home.slice(); this.fixAspect(); }
    this.draw();
  }
  fixAspect() {
    const [x0, x1, y0, y1] = this.view;
    const s = Math.max((x1 - x0) / this.pw, (y1 - y0) / this.ph), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.view = [cx - s * this.pw / 2, cx + s * this.pw / 2, cy - s * this.ph / 2, cy + s * this.ph / 2];
  }
  setHome(v, force) {
    this.home = v.slice();
    if (force || !this.userView) {
      this.view = v.slice(); this.userView = false;
      if (this.o.equal) this.fixAspect();
    }
  }
  X(x) { return this.m.l + (x - this.view[0]) / (this.view[1] - this.view[0]) * this.pw; }
  Y(y) { return this.m.t + (this.view[3] - y) / (this.view[3] - this.view[2]) * this.ph; }
  invX(px) { return this.view[0] + (px - this.m.l) / this.pw * (this.view[1] - this.view[0]); }
  invY(py) { return this.view[3] - (py - this.m.t) / this.ph * (this.view[3] - this.view[2]); }

  _point(px, py) { return { x: this.invX(px), y: this.invY(py), px, py }; }

  _zoomAt(px, py, factor) {
    const v = this.view, x = this.invX(px), y = this.invY(py);
    const width = (v[1] - v[0]) * factor;
    if (width < 1e-9 || width > 1e12) return false;
    v[0] = x + (v[0] - x) * factor;
    v[1] = x + (v[1] - x) * factor;
    if (this.o.zoom === 'xy') {
      v[2] = y + (v[2] - y) * factor;
      v[3] = y + (v[3] - y) * factor;
    }
    this._changed();
    return true;
  }

  _panFrom(view, dx, dy) {
    const x = dx * (view[1] - view[0]) / this.pw;
    const y = dy * (view[3] - view[2]) / this.ph;
    this.view[0] = view[0] - x;
    this.view[1] = view[1] - x;
    if (this.o.zoom === 'xy') {
      this.view[2] = view[2] + y;
      this.view[3] = view[3] + y;
    }
    this._changed();
  }

  _resetView() {
    this.setHome(this.home, true);
    this.o.onView?.(this);
    this.draw();
  }

  _onKey(event) {
    if (!this.W || event.ctrlKey || event.metaKey || event.altKey) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    const key = event.key;
    if (!direction && !['+', '=', '-', '_', '0', 'Home', 'Enter'].includes(key)) return;
    event.preventDefault();

    let message;
    if (direction && event.shiftKey) {
      const [dx, dy] = direction;
      if (dx || this.o.zoom === 'xy') {
        this._panFrom(this.view.slice(), -dx * this.pw / 10, -dy * this.ph / 10);
        message = '已平移图表';
      } else message = '使用 Shift 加左右键平移频率轴';
    } else if (direction) {
      this.keyboardPosition = this.keyboardPosition.map((position, i) => Math.max(0, Math.min(1, position + direction[i] / 20)));
    } else if (key === 'Home' || key === '0') {
      this.keyboardPosition = [0.5, 0.5];
      this._resetView();
      message = '已恢复图表默认视图';
    }

    const [x, y] = this.keyboardPosition;
    const point = { ...this._point(this.m.l + x * this.pw, this.m.t + y * this.ph), keyboard: true };
    if (key === 'Enter') this.o.onClick?.(point);
    else if (key === '+' || key === '=' || key === '-' || key === '_') {
      const zoomIn = key === '+' || key === '=';
      const changed = this._zoomAt(point.px, point.py, zoomIn ? 0.8 : 1.25);
      message = changed ? (zoomIn ? '已放大图表' : '已缩小图表') : '已到缩放范围边界';
    }
    if (key !== 'Enter') this.o.onHover?.({ ...this._point(point.px, point.py), keyboard: true });
    this.o.onKeyboard?.(message);
  }

  _events() {
    const c = this.c;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const inside = (x, y) => x >= this.m.l && x <= this.W - this.m.r && y >= this.m.t && y <= this.H - this.m.b;
    let drag = null;
    c.addEventListener('wheel', e => {
      const [px, py] = pos(e);
      if (!inside(px, py)) return;
      e.preventDefault();
      const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0016)));
      this._zoomAt(px, py, f);
    }, { passive: false });
    c.addEventListener('pointerdown', e => {
      const [px, py] = pos(e);
      if (!inside(px, py) || e.button !== 0) return;
      drag = { px, py, v: this.view.slice(), moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      const [px, py] = pos(e);
      if (drag) {
        const dx = px - drag.px, dy = py - drag.py;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        this._panFrom(drag.v, dx, dy);
      } else if (this.o.onHover) {
        this.o.onHover(inside(px, py) ? this._point(px, py) : null);
      }
    });
    const up = e => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved && e.type === 'pointerup' && this.o.onClick) {
        const [px, py] = pos(e);
        if (inside(px, py)) this.o.onClick(this._point(px, py));
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (!drag && this.o.onHover) this.o.onHover(null); });
    c.addEventListener('dblclick', () => this._resetView());
    c.addEventListener('keydown', event => this._onKey(event));
  }
  _changed() {
    this.userView = true;
    if (this.o.onView) this.o.onView(this);
    this.draw();
  }

  _clip(x0, y0, x1, y1, L, T, R, B) {
    if (x0 >= L && x0 <= R && y0 >= T && y0 <= B && x1 >= L && x1 <= R && y1 >= T && y1 <= B) return [x0, y0, x1, y1, false, false];
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const P = [-dx, dx, -dy, dy], Q = [x0 - L, R - x0, y0 - T, B - y0];
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return null; }
      else {
        const t = Q[i] / P[i];
        if (P[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
        else { if (t < t0) return null; if (t < t1) t1 = t; }
      }
    }
    return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy, t0 > 0, t1 < 1];
  }

  _drawLabels(markers, ink, col, font, reserved) {
    const g = this.g, { l: left, t: top } = this.m, right = left + this.pw, bottom = top + this.ph;
    const size = this.W < 350 ? 11 : 12, lineHeight = size + 3;
    const occupied = markers.map(({ x, y, marker }) => [x - (marker.r || 5) - 3, y - (marker.r || 5) - 3, 2 * (marker.r || 5) + 6, 2 * (marker.r || 5) + 6]);
    if (reserved) occupied.push(reserved);
    const labels = markers.filter(({ marker }) => marker.label).sort((a, b) => (b.marker.priority || 0) - (a.marker.priority || 0));
    const budget = this.pw < 200 ? 4 : this.pw < 390 ? 7 : 12;
    const overlaps = ([x, y, w, h], [a, b, u, v]) => x < a + u && x + w > a && y < b + v && y + h > b;
    const paint = col('--plot-bg');
    const placed = new Map();
    let count = 0;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const { x, y, marker } of labels) {
      if (count >= budget) break;
      const lines = Array.isArray(marker.label) ? marker.label : [marker.label];
      const key = lines.join('\n'), previous = placed.get(key);
      if (previous && Math.hypot(x - previous.x, y - previous.y) < 10) continue;
      const fontAt = i => `${lines.length > 1 && i === 0 ? '600 ' : ''}${size}px ${font}`;
      const width = Math.ceil(Math.max(...lines.map((line, i) => { g.font = fontAt(i); return g.measureText(line).width; }))) + 8;
      const height = lines.length * lineHeight + 4;
      if (width > this.pw - 8 || height > this.ph - 8) continue;
      let best = null;
      for (const gap of [12, 25, 43, 65]) {
        for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [1, 0], [-1, 0]]) {
          const idealX = x + dx * gap - (1 - dx) * width / 2;
          const idealY = y + dy * gap - (1 - dy) * height / 2;
          const lx = Math.max(left + 4, Math.min(right - width - 4, idealX));
          const ly = Math.max(top + 4, Math.min(bottom - height - 4, idealY));
          const box = [lx, ly, width, height];
          if (occupied.some(other => overlaps(box, other))) continue;
          const endX = Math.max(lx, Math.min(lx + width, x)), endY = Math.max(ly, Math.min(ly + height, y));
          const length = Math.hypot(endX - x, endY - y);
          if (length > 78) continue;
          let crossings = 0;
          for (let row = Math.floor(ly / 8); row <= Math.floor((ly + height) / 8); row++) {
            for (let column = Math.floor(lx / 8); column <= Math.floor((lx + width) / 8); column++) {
              if (ink.has(row * 4096 + column)) crossings++;
            }
          }
          const score = length + crossings * 13 + (Math.abs(idealX - lx) + Math.abs(idealY - ly)) * 0.15;
          if (!best || score < best.score) best = { box, endX, endY, length, score };
        }
      }
      if (!best) continue;
      const [lx, ly] = best.box;
      occupied.push([lx - 3, ly - 2, width + 6, height + 4]);
      placed.set(key, { x, y });
      count++;
      if (best.length > 5) {
        const offset = Math.min((marker.r || 4) + 2, best.length);
        g.strokeStyle = col(marker.color || '--axis'); g.globalAlpha = 0.58; g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(x + (best.endX - x) * offset / best.length, y + (best.endY - y) * offset / best.length);
        g.lineTo(best.endX, best.endY); g.stroke(); g.globalAlpha = 1;
      }
      lines.forEach((line, i) => {
        g.font = fontAt(i); g.strokeStyle = paint; g.lineWidth = 3.5;
        g.fillStyle = col(i === 0 ? '--fg' : '--fg2');
        const ty = ly + 2 + (i + 0.5) * lineHeight;
        g.strokeText(line, lx + 4, ty); g.fillText(line, lx + 4, ty);
      });
    }
  }

  draw() {
    if (!this.W) return;
    const g = this.g, m = this.m, W = this.W, H = this.H, pw = this.pw, ph = this.ph;
    const cs = getComputedStyle(this.styleSource);
    const col = n => (n && n.startsWith('--') ? cs.getPropertyValue(n).trim() : n);
    const cText = col('--fg2'), cGrid = col('--grid'), cAxis = col('--axis');
    const fontFamily = cs.getPropertyValue('--ui').trim();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = col('--plot-bg');
    g.fillRect(0, 0, W, H);
    g.font = '13px ' + fontFamily;
    const [x0, x1, y0, y1] = this.view;

    /* 网格与刻度 */
    g.lineWidth = 1;
    // 保留主网格与零轴，减少小屏上的刻度干扰。
    const tX = [], tY = [];
    const vline = (px, c) => {
      if (c === cGrid) tX.push(px);
      g.strokeStyle = c; g.setLineDash([]);
      g.beginPath(); g.moveTo(Math.round(px) + 0.5, m.t); g.lineTo(Math.round(px) + 0.5, m.t + ph); g.stroke(); g.setLineDash([]);
    };
    const hline = (py, c) => {
      if (c === cGrid) tY.push(py);
      g.strokeStyle = c; g.setLineDash([]);
      g.beginPath(); g.moveTo(m.l, Math.round(py) + 0.5); g.lineTo(m.l + pw, Math.round(py) + 0.5); g.stroke(); g.setLineDash([]);
    };
    g.fillStyle = cText; g.textAlign = 'center'; g.textBaseline = 'top';
    if (this.o.xlog && x1 - x0 >= 1.2) {
      const st = Math.max(1, Math.ceil((x1 - x0) / Math.max(3, pw / 70)));
      for (let k = Math.ceil(x0 / st) * st; k <= x1; k += st) {
        vline(this.X(k), cGrid);
        const lab = k >= -3 && k <= 4 ? String(+Math.pow(10, k).toFixed(3)) : '1e' + k;
        g.fillText(lab.replace('-', '−'), this.X(k), m.t + ph + 9);
      }
    } else {
      const tx = niceTicks(x0, x1, pw / 90, this.o.xMode);
      for (const v of tx.ticks) {
        vline(this.X(v), cGrid);
        const lab = this.o.xlog ? String(+Math.pow(10, v).toPrecision(3)) : fmtTick(v, tx.step);
        g.fillText(lab, this.X(v), m.t + ph + 9);
      }
    }
    const ty = niceTicks(y0, y1, Math.max(4, ph / 48), this.o.yMode);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of ty.ticks) {
      hline(this.Y(v), cGrid);
      g.fillStyle = cText;
      g.fillText(fmtTick(v, ty.step), m.l - 9, this.Y(v));
    }
    if (!this.o.xlog && x0 < 0 && x1 > 0) vline(this.X(0), cAxis);
    if (y0 < 0 && y1 > 0) hline(this.Y(0), cAxis);

    /* 数据区 */
    g.save();
    g.beginPath(); g.rect(m.l, m.t, pw, ph); g.clip();
    const L = m.l - 40, T = m.t - 40, R = m.l + pw + 40, B = m.t + ph + 40;
    const glow = parseFloat(cs.getPropertyValue('--glow')) || 0;
    for (const r of this.regions) {
      const a = Math.max(m.l, this.X(r.x0 ?? -Infinity)), b = Math.min(m.l + pw, this.X(r.x1 ?? Infinity));
      const top = Math.max(m.t, this.Y(r.y1 ?? Infinity)), bottom = Math.min(m.t + ph, this.Y(r.y0 ?? -Infinity));
      if (b <= a || bottom <= top) continue;
      if (r.hatch) {                             // 45° 剖面线
        g.save(); g.beginPath(); g.rect(a, m.t, b - a, ph); g.clip();
        g.strokeStyle = col(r.color); g.globalAlpha = r.alpha; g.lineWidth = 1; g.beginPath();
        for (let x = a - ph - ((a - ph) % 8); x < b; x += 8) { g.moveTo(x, m.t + ph); g.lineTo(x + ph, m.t); }
        g.stroke(); g.restore();
      } else { g.globalAlpha = r.alpha; g.fillStyle = col(r.color); g.fillRect(a, top, b - a, bottom - top); g.globalAlpha = 1; }
    }
    for (const s of this.series) {             // 曲线下方的面积填充
      if (s.fill == null || !s.x.length) continue;
      const yb = this.Y(s.fill), cl = v => Math.max(-1e4, Math.min(1e4, v));
      const gr = g.createLinearGradient(0, m.t, 0, m.t + ph);
      g.beginPath(); g.moveTo(this.X(s.x[0]), yb);
      for (let i = 0; i < s.x.length; i++) g.lineTo(cl(this.X(s.x[i])), cl(this.Y(s.y[i])));
      g.lineTo(cl(this.X(s.x[s.x.length - 1])), yb); g.closePath();
      g.fillStyle = col(s.color); g.globalAlpha = 0.1; g.fill(); g.globalAlpha = 1;
    }
    for (const h of this.hlines) {
      g.strokeStyle = col(h.color || '--axis'); g.lineWidth = h.width || 1; g.setLineDash(h.dash || []);
      const py = this.Y(h.v);
      g.beginPath(); g.moveTo(m.l, py); g.lineTo(m.l + pw, py); g.stroke();
    }
    for (const v of this.vlines) {
      g.strokeStyle = col(v.color || '--axis'); g.lineWidth = v.width || 1; g.setLineDash(v.dash || []);
      const px = this.X(v.v);
      g.beginPath(); g.moveTo(px, m.t); g.lineTo(px, m.t + ph); g.stroke();
    }
    g.lineJoin = 'round'; g.lineCap = 'round';
    const ink = new Set(), arrows = [];
    const hasLabels = this.markers.some(marker => marker.label);
    for (const s of this.series) {
      g.strokeStyle = col(s.color); g.lineWidth = s.width || 2; g.setLineDash(s.dash || []);
      g.beginPath();
      let px = NaN, py = NaN, conn = false;
      const directional = [];
      let visibleLength = 0;
      const n = s.x.length;
      for (let i = 0; i < n; i++) {
        const x = this.X(s.x[i]), y = this.Y(s.y[i]);
        const ok = isFinite(x) && isFinite(y);
        if (ok && isFinite(px) && !(s.brk && s.brk[i])) {
          const c = this._clip(px, py, x, y, L, T, R, B);
          if (c) {
            if (!conn || c[4]) g.moveTo(c[0], c[1]);
            g.lineTo(c[2], c[3]);
            conn = !c[5];
            if (hasLabels && (s.width || 2) >= 2 && !s.dash) {
              const steps = Math.ceil(Math.max(Math.abs(c[2] - c[0]), Math.abs(c[3] - c[1])) / 7);
              for (let j = 0; j <= steps; j++) {
                const fraction = j / (steps || 1);
                const sx = c[0] + fraction * (c[2] - c[0]), sy = c[1] + fraction * (c[3] - c[1]);
                ink.add(Math.floor(sy / 8) * 4096 + Math.floor(sx / 8));
              }
            }
            if (s.direction) {
              const v = this._clip(c[0], c[1], c[2], c[3], m.l + 12, m.t + 12, m.l + pw - 12, m.t + ph - 12);
              if (v) {
                const length = Math.hypot(v[2] - v[0], v[3] - v[1]);
                if (length) { visibleLength += length; directional.push({ v, length, end: visibleLength }); }
              }
            }
          } else conn = false;
        } else conn = false;
        px = ok ? x : NaN; py = ok ? y : NaN;
      }
      if (glow && !s.dash && (s.width || 2) >= 2) { g.shadowColor = g.strokeStyle; g.shadowBlur = glow; }
      g.stroke();
      g.shadowBlur = 0;
      if (visibleLength > 32) {
        for (const fraction of [0.72, 0.53, 0.88, 0.36]) {
          const target = visibleLength * fraction;
          const { v, length, end } = directional.find(segment => segment.end >= target);
          const t = 1 - (end - target) / length;
          const x = v[0] + t * (v[2] - v[0]), y = v[1] + t * (v[3] - v[1]);
          if (arrows.some(a => Math.hypot(this.X(a.x) - x, this.Y(a.y) - y) < 21)
            || this.markers.some(k => Math.hypot(this.X(k.x) - x, this.Y(k.y) - y) < 13)) continue;
          arrows.push({ x: this.invX(x), y: this.invY(y), dx: this.invX(v[2]) - this.invX(v[0]), dy: this.invY(v[3]) - this.invY(v[1]), type: 'arrow', color: s.color });
          break;
        }
      }
    }
    g.setLineDash([]);
    const sxs = pw / (x1 - x0), sys_ = ph / (y1 - y0);
    const anchors = [];
    for (const k of [...arrows, ...this.markers]) {
      const x = this.X(k.x), y = this.Y(k.y);
      if (!(x > L && x < R && y > T && y < B)) continue;
      if (x >= m.l && x <= m.l + pw && y >= m.t && y <= m.t + ph) anchors.push({ x, y, marker: k });
      const c = col(k.color || '--fg');
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
      const r = k.r || 5;
      g.beginPath();
      switch (k.type) {
        case 'x': g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x - r, y + r); g.lineTo(x + r, y - r); g.stroke(); break;
        case 'plus': g.moveTo(x - r - 1, y); g.lineTo(x + r + 1, y); g.moveTo(x, y - r - 1); g.lineTo(x, y + r + 1); g.stroke(); break;
        case 'o': g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = col('--plot-bg'); g.fill(); g.stroke(); break;
        case 'sq': g.rect(x - r + 0.5, y - r + 0.5, 2 * r - 1, 2 * r - 1); g.fill(); g.strokeStyle = col('--plot-bg'); g.lineWidth = 1.5; g.stroke(); break;
        case 'diamond': g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); g.fill(); break;
        case 'arrow': {
          const a = Math.atan2(-k.dy * sys_, k.dx * sxs), s = 6;
          g.moveTo(x + s * Math.cos(a), y + s * Math.sin(a));
          g.lineTo(x + s * Math.cos(a + 2.5), y + s * Math.sin(a + 2.5));
          g.lineTo(x + s * Math.cos(a - 2.5), y + s * Math.sin(a - 2.5));
          g.closePath(); g.fill();
          break;
        }
        default: g.arc(x, y, k.r || 4, 0, 2 * Math.PI); g.fill(); g.strokeStyle = col('--plot-bg'); g.lineWidth = 1.5; g.stroke();
      }
    }
    const showLegend = this.legend.length && this.o.drawLegend !== false;
    g.font = '13px ' + fontFamily;
    const legendWidth = showLegend ? Math.max(...this.legend.map(item => g.measureText(item.label).width)) + 44 : 0;
    const legendBox = showLegend ? [m.l + pw - legendWidth - 8, m.t + 8, legendWidth, this.legend.length * 18 + 8] : null;
    if (hasLabels) this._drawLabels(anchors, ink, col, fontFamily, legendBox);
    g.restore();

    g.strokeStyle = cAxis; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(m.l, m.t); g.lineTo(m.l, m.t + ph); g.lineTo(m.l + pw, m.t + ph);
    for (const px of tX) { g.moveTo(Math.round(px) + 0.5, m.t + ph); g.lineTo(Math.round(px) + 0.5, m.t + ph + 5); }
    for (const py of tY) { g.moveTo(m.l - 5, Math.round(py) + 0.5); g.lineTo(m.l, Math.round(py) + 0.5); }
    g.stroke();
    g.font = '13px ' + fontFamily;
    g.fillStyle = cText; g.textAlign = 'center'; g.textBaseline = 'bottom';
    if (this.o.xlabel) g.fillText(this.o.xlabel, m.l + pw / 2, H - 3);
    if (this.o.ylabel) {
      g.save(); g.translate(13, m.t + ph / 2); g.rotate(-Math.PI / 2);
      g.textBaseline = 'middle'; g.fillText(this.o.ylabel, 0, 0); g.restore();
    }
    if (showLegend) {
      g.textAlign = 'left'; g.textBaseline = 'middle';
      const [bx, by, bw, bh] = legendBox;
      g.globalAlpha = 0.88; g.fillStyle = col('--plot-bg'); g.fillRect(bx, by, bw, bh); g.globalAlpha = 1;
      this.legend.forEach((l, i) => {
        const y = by + 13 + i * 18;
        if (l.symbol) {
          g.fillStyle = col(l.color); g.fillText(l.symbol, bx + 13, y);
        } else {
          g.strokeStyle = col(l.color); g.lineWidth = 2; g.setLineDash(l.dash || []);
          g.beginPath(); g.moveTo(bx + 8, y); g.lineTo(bx + 30, y); g.stroke(); g.setLineDash([]);
        }
        g.fillStyle = cText; g.fillText(l.label, bx + 36, y);
      });
    }
    if (this.message) {
      g.fillStyle = cText; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '14px ' + fontFamily;
      const lines = [''];
      for (const character of this.message) {
        const last = lines.length - 1;
        if (g.measureText(lines[last] + character).width > pw - 24) lines.push(character);
        else lines[last] += character;
      }
      lines.forEach((line, index) => g.fillText(line, m.l + pw / 2, m.t + ph / 2 + (index - (lines.length - 1) / 2) * 22));
    }
    this.background.width = this.c.width;
    this.background.height = this.c.height;
    this.background.getContext('2d').drawImage(this.c, 0, 0);
    this.drawCursor();
  }

  /* 光标只重绘缓存与标记，鼠标移动时复用已完成的曲线绘制。 */
  drawCursor() {
    if (!this.W || !this.background.width) return;
    const g = this.g;
    const color = getComputedStyle(this.styleSource).getPropertyValue('--fg2').trim();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.c.width, this.c.height);
    g.drawImage(this.background, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.save();
    g.beginPath(); g.rect(this.m.l, this.m.t, this.pw, this.ph); g.clip();
    g.strokeStyle = color;
    if (this.vcursor != null) {
      const x = this.X(this.vcursor);
      g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, this.m.t); g.lineTo(x, this.m.t + this.ph); g.stroke();
      g.setLineDash([]);
    }
    if (this.cursor && Number.isFinite(this.cursor.x) && Number.isFinite(this.cursor.y)) {
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(this.X(this.cursor.x), this.Y(this.cursor.y), 6.5, 0, 2 * Math.PI); g.stroke();
    }
    g.restore();
  }

  toCanvas(pixelRatio = 2) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(this.W * pixelRatio);
    canvas.height = Math.round(this.H * pixelRatio);
    const snapshot = Object.assign(Object.create(Plot.prototype), this, {
      c: canvas,
      g: canvas.getContext('2d'),
      background: document.createElement('canvas'),
      dpr: pixelRatio,
      o: { ...this.o, drawLegend: true },
    });
    snapshot.draw();
    return canvas;
  }

  /* 屏幕空间内离 (px,py) 最近的采样点 */
  nearest(xs, ys, px, py) {
    let best = -1, bd = Infinity;
    const ax = this.pw / (this.view[1] - this.view[0]), ay = this.ph / (this.view[3] - this.view[2]);
    const X0 = this.invX(px), Y0 = this.invY(py);
    for (let i = 0; i < xs.length; i++) {
      const dx = (xs[i] - X0) * ax, dy = (ys[i] - Y0) * ay, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }
}
