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
  assert.equal(boundary.repeatedAxis, false);
  near(Math.abs(boundary.poles[0][1]), Math.SQRT2, 1e-10);
  near(Ctl.jwCross(model, 1).list[0].K, 6, 1e-10);
  const result = marginsFor(model, 1);
  near(result.bestP.w, Math.SQRT2, 1e-10);
  near(result.bestP.gm, 20 * Math.log10(6), 1e-9);
  near(result.bestG.pm, 53.4107861777, 1e-7);
});

test('A double pole at the origin is unstable and the step response grows as t²/2', () => {
  const model = solve('1', 's^2-1');
  const status = Ctl.closedStatus(model, 1, 1);
  assert.equal(status.kind, 'unstable');
  assert.equal(status.repeatedAxis, true);
  assert.equal(status.rightCount, 0);
  assert.equal(status.axisCount, 2);
  assert.equal(Ctl.closedStatus(model, 1, 0.9).kind, 'unstable');
  assert.equal(Ctl.closedStatus(model, 1, 1.1).kind, 'marginal');
  const step = Ctl.step(model, 1, 1, 4);
  assert.equal(step.stable, false);
  near(step.y[1000], 2, 1e-10);
  near(step.y.at(-1), 8, 1e-10);
});

test('Repeated imaginary pairs are unstable and remain on the imaginary axis', () => {
  for (const [denominator, rightCount] of [['(s^2+4)^2-1', 0], ['(s^2+4)^2(s-2)-1', 1]]) {
    const status = Ctl.closedStatus(solve('1', denominator), 1, 1);
    assert.equal(status.kind, 'unstable');
    assert.equal(status.repeatedAxis, true);
    assert.equal(status.rightCount, rightCount);
    assert.equal(status.axisCount, 4);
    for (const [re, im] of status.poles.filter(p => p[0] === 0)) {
      assert.equal(re, 0);
      near(Math.abs(im), 2, 1e-12);
    }
  }
  const separate = Ctl.closedStatus(solve('1', '(s^2+1)(s^2+4)-1'), 1, 1);
  assert.equal(separate.kind, 'marginal');
  assert.equal(separate.repeatedAxis, false);
  assert.equal(separate.axisCount, 4);
  const damped = Ctl.closedStatus(solve('1', '((s+0.001)^2+4)^2-1'), 1, 1);
  assert.equal(damped.kind, 'stable');
  assert.equal(damped.repeatedAxis, false);
});

test('Close poles on opposite sides of the imaginary axis are kept distinct', () => {
  const model = solve('1', '((s-0.00001)^2+1)((s+0.00001)^2+1)-1');
  const status = Ctl.closedStatus(model, 1, 1);
  assert.equal(status.kind, 'unstable');
  assert.equal(status.rightCount, 2);
  assert.equal(status.axisCount, 0);
  assert.equal(status.repeatedAxis, false);
  for (const [re, im] of status.poles) {
    near(Math.abs(re), 0.00001, 1e-8);
    near(Math.abs(im), 1, 1e-8);
  }
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

test('A 24th-order model matches its analytic stability boundary', () => {
  const order = 24;
  const model = solve('1', `(s+1)^${order}`);
  const boundary = Math.pow(1 / Math.cos(Math.PI / order), order);
  const atOne = Ctl.closedStatus(model, 1, 1);
  assert.equal(atOne.poles.length, order);
  near(Math.max(...atOne.poles.map(pole => pole[0])), Math.cos(Math.PI / order) - 1, 1e-10);
  assert.equal(Ctl.closedStatus(model, 1, boundary * 0.99).kind, 'stable');
  assert.equal(Ctl.closedStatus(model, 1, boundary * 1.01).rightCount, 2);
});

test('The fourth-order teaching example has the expected locus landmarks', () => {
  const model = solve('1', 's(s+2)(s^2+4s+5)');
  const asymptotes = Ctl.asymptotes(model, 1);
  assert.equal(asymptotes.sigma, -1.5);
  assert.deepEqual([...asymptotes.angles], [45, 135, 225, 315]);
  const breakaway = Ctl.breakaways(model, 1, 1).find(point => point.kind === 'breakaway');
  near(breakaway.s[0], -0.6018, 0.0001);
  near(breakaway.K, 2.486, 0.001);
  const crossing = Ctl.jwCross(model, 1).list[0];
  near(crossing.w, Math.sqrt(5 / 3), 1e-10);
  near(crossing.K, 170 / 9, 1e-10);
});

test('Nyquist limits distinguish the ray and travel angles at each end', () => {
  const model = solve('1', 's(s+2)(s^2+4s+5)');
  const { start, end } = Ctl.nyquistEnds(model, 1, 6.5);
  assert.equal(start.kind, 'infinity');
  assert.equal(start.angle, -90);
  assert.equal(start.travel, 90);
  near(start.term.value, 0.65, 1e-12);
  assert.equal(end.kind, 'zero');
  assert.equal(end.phase, -360);
  assert.equal(end.ray, 0);
  assert.equal(end.angle, 180);
  const negative = Ctl.nyquistEnds(model, -1, 6.5);
  assert.equal(negative.start.angle, 90);
  assert.equal(negative.end.angle, 0);
});

test('Nyquist angles at finite nonzero endpoints use the first change from the limit', () => {
  const { start, end } = Ctl.nyquistEnds(solve('s+2', 's+1'), 1, 1);
  assert.equal(start.limit, 2);
  assert.equal(start.angle, -90);
  assert.equal(end.limit, 1);
  assert.equal(end.ray, -90);
  assert.equal(end.angle, 90);
  const secondOrder = Ctl.nyquistEnds(solve('s^2+s+2', 's^2+s+1'), 1, 1).end;
  assert.equal(secondOrder.term.power, -2);
  assert.equal(secondOrder.angle, 0);
});

test('Nyquist angles handle delay, cancellation and constant loci', () => {
  const delayed = Ctl.nyquistEnds(solve('s+1', '1', 1), 1, 1);
  assert.equal(delayed.start.term.power, 2);
  near(delayed.start.term.value, -0.5, 1e-12);
  assert.equal(delayed.start.angle, 0);
  assert.equal(delayed.end.angle, undefined);
  assert.equal(delayed.end.rotating, true);
  assert.equal(Ctl.nyquistEnds(solve('1', 's+1', 1), 1, 1).end.kind, 'zero');
  assert.equal(Ctl.nyquistEnds(solve('s+2', 's+1', 1), 1, 1).end.kind, 'circle');
  const constant = Ctl.nyquistEnds(solve('2(s+1)', 's+1'), 1, 1);
  assert.equal(constant.start.kind, 'constant');
  assert.equal(constant.end.kind, 'constant');
  const zero = Ctl.nyquistEnds(solve('1', 's+1'), 1, 0);
  assert.equal(zero.start.limit, 0);
  assert.equal(zero.end.angle, undefined);
});
