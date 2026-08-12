import type { Page } from '@playwright/test';

import {
  articleThree,
  articleTwo,
  correctionIds,
  expect,
  manualDetail,
  pendingFile,
  test,
} from './fixtures/geo-correction.fixture';
import { detailIds } from './fixtures/geo-detail.fixture';
import { geoIds } from './fixtures/geo.fixture';

const selectedDetailRoute = `/geo/observations/${detailIds.selected}`;
const canonicalCorrectionRoute = `/geo/observations/${detailIds.tail}/correct`;
const createdDetailRoute = `/geo/observations/${correctionIds.created}`;

async function showPanel(
  page: Page,
  name: 'Original / 当前尾' | '本次更正事实' | '新证据与原因',
) {
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await page.getByRole('tab', { name }).click();
  }
}

async function chooseSelect(
  page: Page,
  trigger: ReturnType<Page['getByRole']>,
  option: string,
) {
  await trigger.click();
  const item = page.locator('[role="listbox"]:visible')
    .getByRole('option', { name: option, exact: true });
  await expect(item).toBeVisible();
  await item.press('Enter');
  await expect(page.locator('[role="listbox"]:visible')).toHaveCount(0);
}

async function fillNewArticleFacts(page: Page, title = articleTwo.title) {
  await showPanel(page, '本次更正事实');
  const group = page.getByRole('group', { name: title });
  await chooseSelect(page, group.getByRole('combobox', { name: '是否发现' }), '否');
  await chooseSelect(page, group.getByRole('combobox', { name: '是否提及' }), '否');
}

test('从 Detail CORRECT 入口进入，历史 ID 先 replace 到服务端 canonical 尾', async ({
  page,
  geoCorrectionApi,
}) => {
  await page.goto(selectedDetailRoute);
  const trigger = page.getByRole('button', { name: /更多操作/ });
  await trigger.click();
  await page.getByRole('menuitem', { name: '更正' }).click();
  await expect(page).toHaveURL(canonicalCorrectionRoute);
  await expect(page.getByRole('heading', { level: 1, name: '更正 GEO Observation' }))
    .toBeVisible();

  await showPanel(page, 'Original / 当前尾');
  await expect(page.getByText('Original', { exact: true })).toBeVisible();
  await expect(page.getByText(/Correction 2 · 当前尾/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'geo-detail-1.png' })).toBeVisible();
  await showPanel(page, '本次更正事实');
  const main = page.getByRole('region', { name: '本次更正事实' });
  await expect(main.getByText(manualDetail.product.label)).toBeVisible();
  await expect(main.getByText('DeepSeek Web Search')).toBeVisible();
  await expect(main.getByText('如何选择高可靠性低噪声放大器？')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Product|GEO platform|Search query/ }))
    .toHaveCount(0);

  await page.goto(`/geo/observations/${detailIds.selected}/correct`);
  await expect(page).toHaveURL(canonicalCorrectionRoute);
  await page.reload();
  await expect(page).toHaveURL(canonicalCorrectionRoute);
  expect(geoCorrectionApi.contextRequests.some(
    (request) => request.pathname.includes(detailIds.selected),
  )).toBe(true);
});

test('校验显式事实；上传失败只重试 complete，POST 防重复并按响应 ID 交接', async ({
  page,
  geoCorrectionApi,
}) => {
  geoCorrectionApi.setUploadMode('complete-failure');
  await page.goto(canonicalCorrectionRoute);
  await page.getByRole('button', { name: '追加 Correction' }).click();
  await expect(page.getByRole('alert', { name: 'GEO Correction 尚未提交' }))
    .toContainText('请选择是否发现');
  expect(geoCorrectionApi.createRequests).toEqual([]);

  await fillNewArticleFacts(page);
  await showPanel(page, '新证据与原因');
  await page.getByLabel('上传 GEO 证据截图').setInputFiles({
    name: 'correction-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('evidence'),
  });
  await expect(page.getByRole('alert')).toContainText('文件校验失败');
  geoCorrectionApi.setUploadMode('success');
  await page.getByRole('button', { name: '重试校验' }).click();
  await expect(page.getByText('correction-proof.png')).toBeVisible();
  await page.getByLabel('更正原因 / Notes').fill('人工确认历史事实需要更正');

  geoCorrectionApi.setCreateMode('pending');
  await page.getByRole('button', { name: '追加 Correction' }).dblclick();
  await expect.poll(() => geoCorrectionApi.createRequests.length).toBe(1);
  const request = geoCorrectionApi.createRequests[0]!;
  expect(request.csrfToken).toBe('geo-correction-csrf');
  expect(request.idempotencyKey).toBeNull();
  expect(request.body).toMatchObject({
    product_id: manualDetail.product.id,
    query_topic_id: detailIds.topic,
    search_platform: 'DeepSeek Web Search',
    search_query: '如何判断一款低噪声放大器是否适合高可靠性射频前端？',
    supersedes_id: detailIds.tail,
    attachment_file_ids: [pendingFile.id],
    notes: '人工确认历史事实需要更正',
    article_results: [
      {
        published_article_id: detailIds.article,
        discovered: true,
        mentioned: true,
        accuracy: 'ACCURATE',
      },
      {
        published_article_id: articleTwo.published_article_id,
        discovered: false,
        mentioned: false,
        accuracy: null,
      },
    ],
  });
  await expect(page.getByRole('button', { name: '提交中…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '返回当前 Detail' })).toBeDisabled();
  expect(geoCorrectionApi.uploadRequests).toEqual([
    '/api/v1/files/upload-intents',
    'PUT /correction-proof',
    `/api/v1/files/${pendingFile.id}/complete`,
    `/api/v1/files/${pendingFile.id}/complete`,
  ]);

  geoCorrectionApi.releaseCreate();
  await expect(page).toHaveURL(createdDetailRoute);
  await expect(page.getByRole('heading', {
    name: '如何判断一款低噪声放大器是否适合高可靠性射频前端？',
  })).toBeVisible();
  expect(geoCorrectionApi.detailRequests.at(-1)?.pathname).toBe(
    `/api/v1/geo-observations/${correctionIds.created}/detail`,
  );
  await expect(page.getByRole('dialog', { name: '要离开当前页面吗？' })).toHaveCount(0);
});

test.describe('更正冲突', () => {
  for (const mode of ['publication-conflict', 'revision-conflict'] as const) {
    test(`${mode} 不重放；显式刷新按 ID 合并草稿、证据和新尾`, async ({
      page,
      geoCorrectionApi,
    }) => {
      geoCorrectionApi.setCreateMode(mode);
      await page.goto(canonicalCorrectionRoute);
      await fillNewArticleFacts(page);
      await showPanel(page, '新证据与原因');
      await page.getByLabel('上传 GEO 证据截图').setInputFiles({
        name: 'correction-proof.png',
        mimeType: 'image/png',
        buffer: Buffer.from('evidence'),
      });
      await expect(page.getByText('correction-proof.png')).toBeVisible();
      await page.getByLabel('更正原因 / Notes').fill('必须保留的冲突草稿');
      await page.getByRole('button', { name: '追加 Correction' }).click();

      await expect(page.getByText(/草稿与本次上传仍保留/)).toBeVisible();
      expect(geoCorrectionApi.createRequests).toHaveLength(1);
      await expect(page.getByRole('button', { name: '追加 Correction' })).toBeDisabled();
      await page.getByRole('button', { name: '重新加载最新上下文' }).click();
      await expect(page).toHaveURL(
        `/geo/observations/${correctionIds.conflictTail}/correct`,
      );

      await showPanel(page, '本次更正事实');
      await expect(page.getByRole('group', { name: articleTwo.title })).toBeVisible();
      await expect(page.getByRole('group', { name: articleTwo.title })
        .getByRole('combobox', { name: '是否提及' })).toContainText('否');
      await expect(page.getByRole('group', { name: articleThree.title })).toBeVisible();
      await expect(page.getByRole('group', { name: manualDetail.correction_history.at(-1)!
        .observation.article_results[0]!.title })).toHaveCount(0);
      await showPanel(page, '新证据与原因');
      await expect(page.getByLabel('更正原因 / Notes')).toHaveValue('必须保留的冲突草稿');
      await expect(page.getByText('correction-proof.png')).toBeVisible();
      expect(geoCorrectionApi.createRequests).toHaveLength(1);

      await fillNewArticleFacts(page, articleThree.title);
      geoCorrectionApi.setCreateMode('success');
      await page.getByRole('button', { name: '追加 Correction' }).click();
      await expect(page).toHaveURL(createdDetailRoute);
      expect(geoCorrectionApi.createRequests).toHaveLength(2);
      expect(geoCorrectionApi.createRequests[1]!.body).toMatchObject({
        supersedes_id: correctionIds.conflictTail,
        attachment_file_ids: [pendingFile.id],
        notes: '必须保留的冲突草稿',
      });
    });
  }
});

test('loading、404、403、Legacy 与提交时权限变化均明确且保留输入', async ({
  page,
  geoCorrectionApi,
}) => {
  geoCorrectionApi.setContextMode('loading');
  await page.goto(canonicalCorrectionRoute);
  await expect(page.getByRole('heading', { name: '正在加载更正上下文' })).toBeVisible();
  geoCorrectionApi.setContextMode('forbidden');
  geoCorrectionApi.releaseContext();
  await expect(page.getByRole('heading', {
    name: '当前账号不能更正该 GEO Observation',
  })).toBeVisible();

  geoCorrectionApi.setContextMode('not-found');
  await page.goto('/geo/observations/90000000-0000-4000-8000-000000000001/correct');
  await expect(page.getByRole('heading', { name: '未找到可更正的 GEO Observation' }))
    .toBeVisible();
  geoCorrectionApi.setContextMode('success');
  await page.goto(`/geo/observations/${geoIds.legacy}/correct`);
  await expect(page.getByRole('heading', {
    name: 'GEO Observation 当前不能进入更正工作台',
  })).toBeVisible();

  await page.goto(canonicalCorrectionRoute);
  await fillNewArticleFacts(page);
  await showPanel(page, '新证据与原因');
  await page.getByLabel('更正原因 / Notes').fill('权限变化后仍保留');
  geoCorrectionApi.setCreateMode('forbidden');
  await page.getByRole('button', { name: '追加 Correction' }).click();
  await expect(page.getByRole('alert', { name: 'GEO Correction 尚未提交' }))
    .toContainText('提交时权限已变化');
  await expect(page.getByLabel('更正原因 / Notes')).toHaveValue('权限变化后仍保留');
  expect(geoCorrectionApi.createRequests).toHaveLength(1);
});

test('DirtyGuard、键盘主动作与 375/768/1024/1440 布局可达', async ({
  page,
}, testInfo) => {
  await page.goto(canonicalCorrectionRoute);
  await showPanel(page, '新证据与原因');
  await page.getByLabel('更正原因 / Notes').fill('尚未提交');
  await page.getByRole('button', { name: '返回当前 Detail' }).click();
  const dialog = page.getByRole('dialog', { name: '要离开当前页面吗？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(canonicalCorrectionRoute);

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )),
      `${width}px 页面根不应横向溢出`,
    ).toBe(true);
    await expect(page.getByRole('button', { name: '追加 Correction' })).toBeVisible();
  }
  await page.getByRole('button', { name: '追加 Correction' }).focus();
  await expect(page.getByRole('button', { name: '追加 Correction' })).toBeFocused();
});
