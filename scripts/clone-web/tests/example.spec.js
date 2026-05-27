const { test, expect } = require('@playwright/test');

test('示例测试 - 页面加载', async ({ page }) => {
  await page.goto('https://example.com');

  // 验证标题
  await expect(page).toHaveTitle(/Example Domain/);

  // 验证页面内容
  const heading = page.locator('h1');
  await expect(heading).toContainText('Example Domain');
});

test('示例测试 - 截图', async ({ page }) => {
  await page.goto('https://example.com');

  // 全页面截图
  await page.screenshot({ path: 'tests/screenshots/example.png', fullPage: true });
});