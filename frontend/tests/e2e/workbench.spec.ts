import { aggregate, expect, test } from './fixtures/workbench.fixture';

test('单一 aggregate 完整绘制 Operations Inbox、canonical links 和四档布局', async ({ page, workbenchApi }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible();
  expect(workbenchApi.requests).toHaveLength(1);

  const counts = page.getByRole('region', { name: '需要处理' });
  await expect(counts.locator('[data-workbench-count]')).toHaveCount(6);
  await expect(counts.getByText('事实审核', { exact: true })).toBeVisible();
  await expect(counts.getByText('内容审核', { exact: true })).toBeVisible();
  await expect(counts.getByText('待核验发布', { exact: true })).toBeVisible();
  await expect(counts.getByText('发布处理', { exact: true })).toBeVisible();
  await expect(counts.getByText('内容问题', { exact: true })).toBeVisible();
  await expect(counts.getByText('GEO 准确性问题', { exact: true })).toBeVisible();

  const expectedCountLinks = [
    ['查看事实审核', '/products?workbench=fact-review'],
    ['查看内容审核', '/content/tasks?workbench=content-review'],
    ['查看待核验发布', '/publishing/work?workbench=verification'],
    ['处理待开始发布', '/publishing/work?workbench=ready'],
    ['处理发布失败', '/publishing/work?workbench=failed'],
    ['查看内容问题', '/publishing/issues?workbench=open'],
    ['检查准确性异常', '/geo/observations?workbench=accuracy'],
    ['检查缺失样本', '/geo/observations?workbench=missing'],
  ] as const;
  for (const [name, href] of expectedCountLinks) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  for (let index = 0; index < aggregate.recent_attention_items.length; index += 1) {
    await expect(page.getByRole('link', { name: new RegExp(`关注事项 ${index + 1}`) }))
      .toHaveAttribute('href', `/workbench-target/${index + 1}?canonical=server`);
  }

  await expect(page.getByText('产品事实流程正常')).toBeVisible();
  await expect(page.getByText('内容审核存在积压')).toBeVisible();
  await expect(page.getByText('发布流程需要处理')).toBeVisible();
  await expect(page.getByText('GEO 流程正常')).toBeVisible();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect(page.getByText('0%', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无数据')).toBeVisible();
  await expect(page.getByText('0 / 2')).toBeVisible();

  const main = page.getByRole('main');
  await main.focus();
  const focusOrder = page.locator('.workbench-action-link, .workbench-attention-link');
  await expect(focusOrder).toHaveCount(expectedCountLinks.length + aggregate.recent_attention_items.length);
  for (let index = 0; index < await focusOrder.count(); index += 1) {
    await page.keyboard.press('Tab');
    await expect(focusOrder.nth(index)).toBeFocused();
  }

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(workbenchApi.requests).toHaveLength(1);
});

test('loading、fatal error、retry、empty、zero 与 nullable rate 彼此区分', async ({ page, workbenchApi }) => {
  workbenchApi.setMode('loading');
  await page.goto('/');
  await expect(page.getByText('正在读取工作台…')).toBeVisible();
  workbenchApi.releaseLoading();
  await expect(page.getByText('内容审核存在积压')).toBeVisible();
  expect(workbenchApi.requests).toHaveLength(1);

  workbenchApi.setMode('error');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('工作台暂不可用（请求 ID：req-workbench）');
  expect(workbenchApi.requests).toHaveLength(2);
  workbenchApi.setMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('内容审核存在积压')).toBeVisible();
  expect(workbenchApi.requests).toHaveLength(3);

  workbenchApi.setMode('empty');
  await page.reload();
  await expect(page.getByText('当前没有需要关注的事项。')).toBeVisible();
  await expect(page.getByRole('region', { name: '需要处理' }).locator('[data-workbench-count]')).toHaveCount(6);
  await expect(page.getByRole('region', { name: '需要处理' }).getByText('0', { exact: true })).toHaveCount(6);
  await expect(page.getByRole('link', { name: '查看事实审核' })).toHaveAttribute('href', '/products?workbench=fact-review');
  await expect(page.getByText('暂无数据')).toHaveCount(3);
  expect(workbenchApi.requests).toHaveLength(4);
});
