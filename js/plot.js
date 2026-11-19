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
    for (const r of this.regions) {            // 竖直色带（如右半平面）
      const a = Math.max(m.l, this.X(r.x0)), b = Math.min(m.l + pw, this.X(r.x1));
      if (b <= a) continue;
      if (r.hatch) {                             // 45° 剖面线
        g.save(); g.beginPath(); g.rect(a, m.t, b - a, ph); g.clip();
        g.strokeStyle = col(r.color); g.globalAlpha = r.alpha; g.lineWidth = 1; g.beginPath();
        for (let x = a - ph - ((a - ph) % 8); x < b; x += 8) { g.moveTo(x, m.t + ph); g.lineTo(x + ph, m.t); }
        g.stroke(); g.restore();
      } else { g.globalAlpha = r.alpha; g.fillStyle = col(r.color); g.fillRect(a, m.t, b - a, ph); g.globalAlpha = 1; }
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
    for (const s of this.series) {
      g.strokeStyle = col(s.color); g.lineWidth = s.width || 2; g.setLineDash(s.dash || []);
      g.beginPath();
      let px = NaN, py = NaN, conn = false;
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
          } else conn = false;
        } else conn = false;
        px = ok ? x : NaN; py = ok ? y : NaN;
      }
      if (glow && !s.dash && (s.width || 2) >= 2) { g.shadowColor = g.strokeStyle; g.shadowBlur = glow; }
      g.stroke();
      g.shadowBlur = 0;
    }
    g.setLineDash([]);
    const sxs = pw / (x1 - x0), sys_ = ph / (y1 - y0);
    const boxes = [];
    for (const k of this.markers) {
      const x = this.X(k.x), y = this.Y(k.y);
      if (!(x > L && x < R && y > T && y < B)) continue;
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
      if (k.label) {
        g.font = '13px ' + fontFamily;
        g.textAlign = k.align || 'left'; g.textBaseline = 'middle';
        const lx = x + (k.align === 'right' ? -9 : 9), ly = y + (k.dyLabel != null ? k.dyLabel : -10);
        const tw = g.measureText(k.label).width, bx0 = k.align === 'right' ? lx - tw : lx;
        if (boxes.some(b => bx0 < b[1] + 4 && bx0 + tw > b[0] - 4 && Math.abs(ly - b[2]) < 16)) continue;
        boxes.push([bx0, bx0 + tw, ly]);
        g.lineWidth = 3; g.strokeStyle = col('--plot-bg'); g.strokeText(k.label, lx, ly);
        g.fillStyle = col(k.labelColor || '--fg'); g.fillText(k.label, lx, ly);
      }
    }
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
    if (this.legend.length && this.o.drawLegend !== false) {
      g.textAlign = 'left'; g.textBaseline = 'middle';
      let wmax = 0;
      for (const l of this.legend) wmax = Math.max(wmax, g.measureText(l.label).width);
      const bw = wmax + 44, bh = this.legend.length * 18 + 8, bx = m.l + pw - bw - 8, by = m.t + 8;
      g.globalAlpha = 0.88; g.fillStyle = col('--plot-bg'); g.fillRect(bx, by, bw, bh); g.globalAlpha = 1;
      this.legend.forEach((l, i) => {
        const y = by + 13 + i * 18;
        g.strokeStyle = col(l.color); g.lineWidth = 2; g.setLineDash(l.dash || []);
        g.beginPath(); g.moveTo(bx + 8, y); g.lineTo(bx + 30, y); g.stroke(); g.setLineDash([]);
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
