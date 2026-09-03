import { blockedTopic, deletableTopic, expect, test, topicIds } from './fixtures/geo-topics.fixture';

const canonical = '/geo/topics?sort=QUESTION_ASC&page=1&pageSize=20';

test('五列只消费服务端动作，primary 携带 canonical handoff，引用链接精确可解析', async ({
  page,
}) => {
  await page.goto(canonical);
  await expect(page.getByRole('heading', { level: 1, name: 'GEO 问题主题' })).toBeVisible();
  await expect(page.locator('thead th')).toHaveCount(5);
  await expect(page.getByText(blockedTopic.canonical_question)).toBeVisible();
  const blockedRow = page.getByRole('row').filter({ hasText: blockedTopic.canonical_question });
  await blockedRow.getByText(blockedTopic.variants[0]).scrollIntoViewIfNeeded();
  await expect(blockedRow.getByText(blockedTopic.variants[0])).toBeVisible();
  await expect(blockedRow.getByText('+1')).toBeVisible();
  await expect(page.getByText('Content Task 2')).toBeVisible();
  await expect(page.getByText('GEO Optimization 1')).toBeVisible();
  await expect(page.getByText('Observation 3')).toBeVisible();
  await expect(blockedRow.getByRole('link', { name: '开始观测' })).toHaveAttribute(
    'href',
    `/geo/observations/new?queryTopicId=${topicIds.blocked}`,
  );
  await expect(page.getByText('查看详情')).toHaveCount(0);

  const trigger = page.getByRole('button', { name: `更多操作：${blockedTopic.canonical_question}` });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '查看删除条件或引用情况' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: '业务引用与删除条件' });
  await expect(dialog.getByRole('link', { name: '2 条' })).toHaveAttribute(
    'href',
    `/content/tasks?queryTopicId=${topicIds.blocked}&queryTopicReference=CONTENT_TASK&archiveStatus=ALL&page=1&pageSize=20`,
  );
  await expect(dialog.getByRole('link', { name: '1 条' })).toHaveAttribute(
    'href',
    `/content/tasks?queryTopicId=${topicIds.blocked}&queryTopicReference=GEO_OPTIMIZATION_SOURCE&archiveStatus=ALL&page=1&pageSize=20`,
  );
  await expect(dialog.getByRole('link', { name: '3 条' })).toHaveAttribute(
    'href',
    `/geo/observations?queryTopicId=${topicIds.blocked}&page=1&pageSize=20`,
  );
  await expect(dialog.getByText('服务端投影当前存在直接引用阻断。', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭' }).first().click();
  await expect(trigger).toBeFocused();
});

test('搜索、排序、分页进入 URL/API，direct、refresh、Back/Forward 保持 canonical', async ({
  page,
  geoTopicsApi,
}) => {
  await page.goto(canonical);
  await page.getByRole('searchbox', { name: '搜索 Query Topic' }).fill('  LNA  ');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/q=LNA/);
  expect(geoTopicsApi.listRequests.at(-1)?.searchParams.get('q')).toBe('LNA');

  await page.getByRole('button', { name: '标准问题' }).click();
  await expect(page).toHaveURL(/sort=QUESTION_DESC/);
  expect(geoTopicsApi.listRequests.at(-1)?.searchParams.get('sort')).toBe('QUESTION_DESC');

  await page.goto('/geo/topics?sort=INTENT_ASC&page=2&pageSize=10');
  await expect.poll(() => geoTopicsApi.listRequests.at(-1)?.searchParams.get('page')).toBe('2');
  expect(geoTopicsApi.listRequests.at(-1)?.searchParams.get('page_size')).toBe('10');
  await page.reload();
  await expect(page).toHaveURL('/geo/topics?sort=INTENT_ASC&page=2&pageSize=10');
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL('/geo/topics?sort=INTENT_ASC&page=2&pageSize=10');

  await page.goto('/geo/topics?sort=QUESTION_ASC&page=99&pageSize=20');
  await expect(page.getByText('当前页已超出范围')).toBeVisible();
  await page.getByRole('button', { name: '返回最后一页' }).click();
  await expect(page).toHaveURL(canonical);

  await page.goto('/geo/topics?sort=bad&page=0&pageSize=99&extra=1');
  await expect(page).toHaveURL(canonical);
});

test('loading、empty、filtered-empty、error/retry 与四档根宽度状态诚实', async ({
  page,
  geoTopicsApi,
}, testInfo) => {
  geoTopicsApi.setListMode('loading');
  await page.goto(canonical);
  await expect(page.getByRole('rowgroup', { name: '正在加载表格' })).toBeVisible();
  geoTopicsApi.releaseLoading();
  await expect(page.getByText(blockedTopic.canonical_question)).toBeVisible();

  geoTopicsApi.setListMode('empty');
  await page.goto('/geo/topics?q=missing&sort=QUESTION_ASC&page=1&pageSize=20');
  await expect(page.getByText('未找到匹配主题')).toBeVisible();
  await page.goto(canonical);
  await expect(page.getByText('暂无 Query Topic')).toBeVisible();

  geoTopicsApi.setListMode('error');
  await page.goto('/geo/topics?q=%E4%BD%8E%E5%99%AA%E5%A3%B0&sort=QUESTION_ASC&page=1&pageSize=20');
  await expect(page.getByText('Query Topic 列表加载失败')).toBeVisible();
  await expect(page.getByText(/req-topic-list/)).toBeVisible();
  geoTopicsApi.setListMode('success');
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText(blockedTopic.canonical_question)).toBeVisible();

  const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  }
});

test('创建与更新携带 CSRF/revision；409 保留草稿并只在显式 reload 后恢复', async ({
  page,
  geoTopicsApi,
}) => {
  await page.goto(canonical);
  const createButton = page.getByRole('button', { name: '创建 Query Topic' });
  await createButton.click();
  let dialog = page.getByRole('dialog', { name: '创建 Query Topic' });
  await dialog.getByLabel('标准问题').fill('  如何验证新主题？  ');
  await dialog.getByLabel('变体 1').fill('  新主题验证  ');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(createButton).toBeFocused();
  expect(geoTopicsApi.mutationRequests[0]).toMatchObject({
    method: 'POST',
    csrfToken: 'geo-topics-csrf',
    body: { canonical_question: '  如何验证新主题？  ', variants: ['  新主题验证  '] },
  });

  const editTrigger = page.getByRole('button', { name: `更多操作：${blockedTopic.canonical_question}` });
  await editTrigger.click();
  await page.getByRole('menuitem', { name: '编辑' }).click();
  dialog = page.getByRole('dialog', { name: '编辑 Query Topic' });
  await dialog.getByLabel('标准问题').fill('本地草稿问题');
  geoTopicsApi.setMutationMode('conflict');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText('当前输入已保留，不会自动重放')).toBeVisible();
  await expect(dialog.getByLabel('标准问题')).toHaveValue('本地草稿问题');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'PATCH')).toHaveLength(1);

  geoTopicsApi.setMutationMode('success');
  geoTopicsApi.setOptionsMode('loading');
  const optionsBeforeInFlightReload = geoTopicsApi.optionsRequests.length;
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeInFlightReload + 1);
  geoTopicsApi.setOptionsMode('success');
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeInFlightReload + 2);
  geoTopicsApi.releaseOptionsLoading();
  await expect(dialog.getByLabel('标准问题')).toHaveValue(`${blockedTopic.canonical_question}（外部更新）`);
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeInFlightReload + 2);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();

  await dialog.getByLabel('标准问题').fill('第二次本地草稿');
  geoTopicsApi.resetMutationConflicts();
  geoTopicsApi.setMutationMode('conflict');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText(/req-topic-conflict/)).toBeVisible();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'PATCH')).toHaveLength(2);

  geoTopicsApi.setOptionsMode('error');
  const optionsBeforeFailure = geoTopicsApi.optionsRequests.length;
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeFailure + 1);
  await expect(dialog.getByLabel('标准问题')).toHaveValue('第二次本地草稿');
  await expect(dialog.getByText(/req-topic-conflict/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'PATCH')).toHaveLength(2);

  geoTopicsApi.setOptionsMode('success');
  geoTopicsApi.setMutationMode('success');
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeFailure + 2);
  await expect(dialog.getByLabel('标准问题')).toHaveValue(`${blockedTopic.canonical_question}（外部更新）（外部更新）`);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await dialog.getByLabel('标准问题').fill('人工确认后的问题');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const patches = geoTopicsApi.mutationRequests.filter((item) => item.method === 'PATCH');
  expect(patches).toHaveLength(3);
  expect(patches[0]?.expectedRevision).toBe(blockedTopic.revision);
  expect(patches[1]?.expectedRevision).toBe(blockedTopic.revision + 1);
  expect(patches[2]?.expectedRevision).toBe(blockedTopic.revision + 2);
});

test('DELETE 只对服务端允许的行出现，确认后只发送一次 expected_revision', async ({
  page,
  geoTopicsApi,
}) => {
  await page.goto(canonical);
  const trigger = page.getByRole('button', { name: `更多操作：${deletableTopic.canonical_question}` });
  await trigger.focus();
  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '删除', exact: true }).press('Enter');
  let dialog = page.getByRole('dialog', { name: '删除 Query Topic？' });
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  await page.getByRole('menuitem', { name: '删除', exact: true }).press('Enter');
  dialog = page.getByRole('dialog', { name: '删除 Query Topic？' });
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText(deletableTopic.canonical_question)).toHaveCount(0);
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'DELETE')).toEqual([{
    body: null,
    csrfToken: 'geo-topics-csrf',
    expectedRevision: deletableTopic.revision,
    method: 'DELETE',
    pathname: `/api/v1/query-topics/${topicIds.deletable}`,
  }]);
});

test('DELETE 409 不自动重放，显式 reload revision 后才允许再次确认', async ({
  page,
  geoTopicsApi,
}) => {
  geoTopicsApi.setMutationMode('conflict');
  await page.goto(canonical);
  const trigger = page.getByRole('button', { name: `更多操作：${deletableTopic.canonical_question}` });
  await trigger.click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除 Query Topic？' });
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByText(/req-topic-conflict/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认删除' })).toBeDisabled();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'DELETE')).toHaveLength(1);

  geoTopicsApi.setMutationMode('success');
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect(dialog.getByText(`已读取 revision ${deletableTopic.revision + 1}`)).toBeVisible();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(1);
  await expect(dialog.getByRole('button', { name: '确认删除' })).toBeEnabled();

  geoTopicsApi.resetMutationConflicts();
  geoTopicsApi.setMutationMode('conflict');
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByText(/req-topic-conflict/)).toBeVisible();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'DELETE')).toHaveLength(2);

  geoTopicsApi.setMutationMode('success');
  const optionsBeforeSecondReload = geoTopicsApi.optionsRequests.length;
  await dialog.getByRole('button', { name: '重新读取规范版本' }).click();
  await expect.poll(() => geoTopicsApi.optionsRequests.length).toBe(optionsBeforeSecondReload + 1);
  await expect(dialog.getByText(`已读取 revision ${deletableTopic.revision + 2}`)).toBeVisible();
  await dialog.getByRole('button', { name: '确认删除' }).click();
  const deletes = geoTopicsApi.mutationRequests.filter((item) => item.method === 'DELETE');
  expect(deletes).toHaveLength(3);
  expect(deletes[0]?.expectedRevision).toBe(deletableTopic.revision);
  expect(deletes[1]?.expectedRevision).toBe(deletableTopic.revision + 1);
  expect(deletes[2]?.expectedRevision).toBe(deletableTopic.revision + 2);
});

test('DELETE 引用竞态显示服务端最新类型、数量和 canonical resolve links', async ({
  page,
  geoTopicsApi,
}) => {
  geoTopicsApi.setMutationMode('in-use');
  await page.goto(canonical);
  await page.getByRole('button', { name: `更多操作：${deletableTopic.canonical_question}` }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除 Query Topic？' });
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(dialog.getByText('内容任务（2）、GEO 观测（3）', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('link', { name: '2 条' })).toHaveAttribute(
    'href',
    `/content/tasks?queryTopicId=${topicIds.deletable}&queryTopicReference=CONTENT_TASK&archiveStatus=ALL&page=1&pageSize=20`,
  );
  await expect(dialog.getByRole('link', { name: '3 条' })).toHaveAttribute(
    'href',
    `/geo/observations?queryTopicId=${topicIds.deletable}&page=1&pageSize=20`,
  );
  await expect(dialog.getByRole('button', { name: '确认删除' })).toBeDisabled();
  expect(geoTopicsApi.mutationRequests.filter((item) => item.method === 'DELETE')).toHaveLength(1);
});
