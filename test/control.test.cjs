const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({});
for (const name of ['math.js', 'control.js']) {
  const filename = path.join(__dirname, '..', 'js', name);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}
const { Ctl } = vm.runInContext('({ Ctl })', context);
const solve = (numerator, denominator, tau = 0) => Ctl.makeSystem(numerator, denominator, tau);
const marginsFor = (model, K, sign = 1) => Ctl.margins(model, sign, Ctl.freqSamples(model, sign, K), K);

function near(actual, expected, absoluteTolerance) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= absoluteTolerance, `Expected ${actual} within ${absoluteTolerance} of ${expected}`);
}

test('Small nonzero leading coefficients preserve the unstable pole and the DC stability boundary', () => {
  for (const denominator of ['1e-14s-1', '1e-14 -1']) {
    const model = solve('1', denominator);
    const status = Ctl.closedStatus(model, 1, 0.5);
    assert.equal(model.n, 1);
    assert.equal(status.kind, 'unstable');
    assert.equal(status.rightCount, 1);
    near(status.poles[0][0], 5e13, 0.01);
    const { list: boundaries } = Ctl.jwCross(model, 1);
    assert.equal(boundaries.length, 1);
    assert.equal(boundaries[0].w, 0);
    near(boundaries[0].K, 1, 1e-14);
    const ranges = Ctl.stableRanges(model, 1, boundaries, 1);
    assert.equal(ranges.length, 1);
    near(ranges[0][0], 1, 1e-14);
    assert.equal(ranges[0][1], Infinity);
  }
});

test('The cubic classroom model has the Routh boundary K = 6 and poles at ±j√2', () => {
  const model = solve('1', 's(s+1)(s+2)');
  assert.equal(Ctl.closedStatus(model, 1, 5).kind, 'stable');
  assert.equal(Ctl.closedStatus(model, 1, 7).kind, 'unstable');
  const boundary = Ctl.closedStatus(model, 1, 6);
  assert.equal(boundary.kind, 'marginal');
  near(Math.abs(boundary.poles[0][1]), Math.SQRT2, 1e-10);
  near(Ctl.jwCross(model, 1).list[0].K, 6, 1e-10);
  const result = marginsFor(model, 1);
  near(result.bestP.w, Math.SQRT2, 1e-10);
  near(result.bestP.gm, 20 * Math.log10(6), 1e-9);
  near(result.bestG.pm, 53.4107861777, 1e-7);
});

test('The first-order magnitude crossover is located below the drawing sample floor', () => {
  const model = solve('1', 's+1');
  const K = 1.00000001;
  const result = marginsFor(model, K);
  assert.equal(result.gc.length, 1);
  near(result.gc[0].w, Math.sqrt((K - 1) * (K + 1)), 2e-11);
  assert.equal(marginsFor(model, 1).gc.length, 0);
  assert.equal(marginsFor(model, 0.9).gc.length, 0);
});

test('A second-order resonant peak resolves two close crossovers and a tangent contact', () => {
  const model = solve('1', 's^2+0.2s+1');
  // |D(jω)|² = (ω² − 0.98)² + 0.0396.
  const result = marginsFor(model, Math.sqrt(0.0396 + 4e-8));
  assert.equal(result.gc.length, 2);
  near(result.gc[0].w, Math.sqrt(0.98 - 0.0002), 1e-10);
  near(result.gc[1].w, Math.sqrt(0.98 + 0.0002), 1e-10);
  const tangent = marginsFor(model, Math.sqrt(0.0396));
  assert.equal(tangent.gc.length, 1);
  near(tangent.gc[0].w, Math.sqrt(0.98), 1e-10);
  assert.equal(marginsFor(model, Math.sqrt(0.0396 - 4e-8)).gc.length, 0);
});

test('The unity-magnitude point is unchanged by a pure delay', () => {
  const model = solve('1', 's+1', 1);
  const result = marginsFor(model, 2);
  const frequency = Math.sqrt(3);
  near(result.bestG.w, frequency, 1e-10);
  near(result.bestG.ph, -(Math.atan(frequency) + frequency) * 180 / Math.PI, 1e-9);
  near(result.bestP.w, 2.028757838110434, 1e-9);
});

test('The negative real-axis crossing at DC is included in the gain margin', () => {
  const model = solve('1', 's-1');
  const result = marginsFor(model, 0.5);
  assert.equal(result.bestP.w, 0);
  near(result.bestP.gm, 20 * Math.log10(2), 1e-10);
});

test('Repeated open-loop poles do not create a spurious positive-frequency DC crossover', () => {
  const model = solve('1', '(s+1)^16');
  const result = marginsFor(model, 1);
  assert.equal(result.gc.length, 0);
  near(result.pc[0].w, Math.tan(Math.PI / 16), 1e-9);
  const [logMagnitude] = Ctl.resp(model, 1, 1);
  near(logMagnitude, -8 * Math.log(2), 1e-9);
});

test('A large high-frequency crossover and zero-gain margins retain their behavior', () => {
  const model = solve('1', 's+1');
  near(marginsFor(model, 10000).bestG.w, Math.sqrt(1e8 - 1), 1e-8);
  const zero = marginsFor(model, 0);
  assert.equal(zero.zeroGain, true);
  assert.equal(zero.bestG, null);
  assert.equal(zero.bestP, null);
});

test('The gain that cancels the leading coefficient is singular, with stable and unstable neighbors', () => {
  const model = solve('1-s', 's+1');
  assert.equal(Ctl.closedStatus(model, 1, 0.9).kind, 'stable');
  assert.equal(Ctl.closedStatus(model, 1, 1).kind, 'singular');
  assert.equal(Ctl.closedStatus(model, 1, 1.1).kind, 'unstable');
  const ranges = Ctl.stableRanges(model, 1, Ctl.jwCross(model, 1).list, 1);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges[0][1], 1);
});

test('The second-order step response matches the textbook overshoot at ζ = 0.5', () => {
  const model = solve('1', 's(s+2)');
  assert.ok(Ctl.step(model, 1, 1, 12).os < 1e-6);
  const step = Ctl.step(model, 1, 4, 12);
  near(step.yss, 1, 1e-10);
  near(step.os, 100 * Math.exp(-Math.PI / Math.sqrt(3)), 1e-3);
});
