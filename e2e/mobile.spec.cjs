const { AxeBuilder } = require('@axe-core/playwright');
const { test, expect } = require('./fixtures.cjs');

test('opens a lesson directly and tunes gain while viewing a curve by touch', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#controlOptions')).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: '课堂练习' }).tap();
  await page.getByRole('link', { name: '读 Bode 裕度' }).tap();
  await expect(page.locator('#plots')).toHaveAttribute('data-view', 'bode');
  await expect(page.locator('#kpis')).toContainText('15.56');

  await page.locator('#plotTabs button[data-view="all"]').tap();
  const step = page.locator('#cStep');
  await step.scrollIntoViewIfNeeded();
  const dock = page.locator('#mobileGainDock');
  await expect(dock).toBeVisible();
  const bounds = await step.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThan((await dock.boundingBox()).y);
  const initial = await step.evaluate(canvas => canvas.toDataURL());

  const slider = page.locator('#mobileKSlider');
  const size = await slider.boundingBox();
  await slider.tap({ position: { x: size.width * 0.78, y: size.height / 2 } });
  await expect(page.locator('#status strong')).toHaveText('不稳定');
  const field = page.locator('#mobileKNum');
  expect(Number(await field.inputValue())).toBeGreaterThan(6);
  expect(await step.evaluate(canvas => canvas.toDataURL()) === initial).toBe(false);

  await field.fill('6');
  await expect(page.locator('#kNum')).toHaveValue('6');
  await expect(page.locator('#status strong')).toHaveText('临界');
  await field.fill('-1');
  await expect(page.locator('#mobileKErr')).toBeVisible();
  await field.blur();
  await expect(field).toHaveValue('6');
  await page.evaluate(() => scrollTo(0, 0));
  await expect(dock).toBeHidden();
});

test('fits narrow screens and checks accessibility with the gain dock open', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('./');
  await page.locator('#cStep').scrollIntoViewIfNeeded();
  await expect(page.locator('#mobileGainDock')).toBeVisible();
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])).toEqual([320, 320]);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
});
