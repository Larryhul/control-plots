const fs = require('node:fs/promises');
const { AxeBuilder } = require('@axe-core/playwright');
const { test, expect, openModel } = require('./fixtures.cjs');

test('opens the lecture exercise and tracks the textbook stability boundary', async ({ page }) => {
  const response = await page.goto('./');
  expect(response.status()).toBe(200);
  await expect(page.locator('#status strong')).toHaveText('稳定');
  await expect(page.locator('#kpis')).toContainText('53.41');

  await page.getByRole('button', { name: '课堂练习' }).click();
  await page.getByRole('link', { name: '找临界增益' }).click();
  await expect(page.locator('#plots')).toHaveAttribute('data-view', 'rl');
  await expect(page.locator('#status strong')).toHaveText('临界');
  await expect(page.locator('#plotTabs button[data-view="rl"]')).toBeFocused();
  await page.locator('#kNum').fill('5');
  await expect(page.locator('#status strong')).toHaveText('稳定');
  await page.locator('#kNum').fill('7');
  await expect(page.locator('#status strong')).toHaveText('不稳定');
});

test('explains unstable repeated poles even with no poles in the right half-plane', async ({ page }) => {
  for (const denominator of ['s^2-1', '(s^2+4)^2-1']) {
    await openModel(page, { n: '1', d: denominator, k: '1', t: '4', view: 'step' });
    await expect(page.locator('#den')).toHaveValue(denominator);
    await expect(page.locator('#status strong')).toHaveText('不稳定');
    await expect(page.locator('#status')).toHaveAttribute('title', '闭环含虚轴重根');
    await expect(page.locator('#mStep')).toContainText('虚轴重根');
    await expect(page.locator('#kpis .kpi').filter({ hasText: '稳态误差' }).locator('.v')).toHaveText('—');
  }
});

test('supports keyboard gain selection, probing, zoom, pan and reset', async ({ page }) => {
  await openModel(page, { n: '1', d: 's+1', k: '2.718281828', view: 'rl' });
  const plot = page.locator('#cRL');
  const feedback = page.locator('#plotAnnouncement');
  await page.locator('button[data-focus="rl"]').focus();
  await page.keyboard.press('Tab');
  await expect(plot).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#rRL')).toContainText('K =');
  await expect(feedback).toContainText('K =');
  await page.keyboard.press('Enter');
  await expect(page.locator('#kNum')).not.toHaveValue('2.718281828');
  await expect(page.locator('#status strong')).toHaveText('稳定');

  const render = () => plot.evaluate(canvas => canvas.toDataURL());
  const initial = await render();
  await page.keyboard.press('=');
  await expect(feedback).toHaveText('已放大图表');
  const zoomed = await render();
  expect(zoomed === initial).toBe(false);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(feedback).toHaveText('已平移图表');
  expect(await render() === zoomed).toBe(false);
  await page.keyboard.press('Home');
  await expect(feedback).toHaveText('已恢复图表默认视图');
  await page.keyboard.press('Tab');
  await expect(plot).not.toBeFocused();

  await page.locator('#plotTabs button[data-view="bode"]').click();
  await page.locator('#cMag').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#rBode')).toContainText('rad/s');
  await expect(page.locator('#rNyq')).toContainText('rad/s');
  await expect(page.locator('#rNic')).toContainText('rad/s');
});

test('restores shared comparisons and exports PNG and UTF-8 CSV', async ({ page }) => {
  await openModel(page, { n: '1', d: 's(s+2)', k: '1', t: '12', view: 'step' });
  await page.locator('#compare').click();
  await page.locator('#kNum').fill('4');
  await expect(page.locator('#kpis')).toContainText('16.3');
  await page.reload();
  await expect(page.locator('#kNum')).toHaveValue('4');
  await expect(page.locator('#tEnd')).toHaveValue('12');
  await expect(page.locator('#comparisonNote')).toBeVisible();

  for (const format of ['PNG', 'CSV']) {
    await page.locator('#exportMenu > summary').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export' + format).click()]);
    expect(await download.failure()).toBeNull();
    const data = await fs.readFile(await download.path());
    if (format === 'PNG') expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    else {
      expect(data.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(data.toString('utf8')).toContain('对比');
    }
  }
});

test('keeps the focused chart and gain controls usable in classroom viewports', async ({ page }) => {
  await page.goto('./');
  await page.locator('#plotTabs button[data-view="rl"]').click();
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#cRL').scrollIntoViewIfNeeded();
    const result = await page.evaluate(() => {
      const graph = document.getElementById('cRL').getBoundingClientRect();
      const gain = document.getElementById('kSlider').getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        graphVisible: graph.top >= 0 && graph.bottom <= innerHeight,
        gainVisible: gain.top >= 0 && gain.bottom <= innerHeight,
      };
    });
    expect(result).toEqual({ width, graphVisible: true, gainVisible: true });
  }
});

test('passes automated accessibility checks in the default workspace', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status strong')).toHaveText('稳定');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
});
