const { test: base, expect } = require('@playwright/test');

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(page);
    expect(errors, 'Unhandled browser errors').toEqual([]);
  },
});

function openModel(page, parameters) {
  return page.goto('./#' + new URLSearchParams(parameters));
}

module.exports = { test, expect, openModel };
