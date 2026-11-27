import { expect, test } from './fixtures/content.fixture';

for (const surface of ['list', 'detail'] as const) {
  for (const mode of ['geo-context-conflict', 'geo-chain-conflict'] as const) {
    test(`${surface} 永久删除 ${mode} 后重新打开、读取并确认，禁止旧文本复用`, async ({ page, contentApi }) => {
      contentApi.setMutationMode(mode);
      await page.goto(surface === 'list'
        ? '/content/tasks?archiveStatus=ARCHIVED&page=1&pageSize=20'
        : '/content/tasks/00000000-0000-4000-8000-000000000999');
      const more = page.getByRole('button', { name: '更多操作：CT-ARCHIVED' });
      await more.click();
      await page.getByRole('menuitem', { name: '永久删除' }).click();
      const dialog = page.getByRole('dialog', { name: '永久删除任务“CT-ARCHIVED”' });
      await dialog.getByRole('textbox').fill('永久删除');
      await dialog.getByRole('button', { name: '永久删除' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText('req-content-geo-conflict');
      expect(contentApi.lifecycleRequests).toHaveLength(1);
      await expect(more).toBeFocused();
      contentApi.setPreviewFailure(true);
      await more.press('Enter');
      await page.getByRole('menuitem', { name: '永久删除' }).click();
      await expect(dialog.getByRole('alert')).toContainText('req-content-preview');
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '永久删除' })).toBeDisabled();
      await dialog.getByRole('button', { name: '重新读取删除范围' }).click();
      await expect(dialog.getByRole('button', { name: '永久删除' })).toBeDisabled();
      contentApi.setPreviewFailure(false);
      contentApi.setMutationMode('success');
      await dialog.getByRole('button', { name: '重新读取删除范围' }).click();
      await expect(dialog.getByRole('textbox')).toHaveValue('');
      await expect(dialog.getByRole('button', { name: '永久删除' })).toBeDisabled();
      expect(contentApi.lifecycleRequests).toHaveLength(1);
      await dialog.getByRole('textbox').fill('永久删除');
      await dialog.getByRole('button', { name: '永久删除' }).click();
      await expect.poll(() => contentApi.lifecycleRequests.length).toBe(2);
      expect(contentApi.lifecycleRequests.at(-1)).toMatchObject({
        body: { expected_revision: 100, confirmation_text: '永久删除' },
        pathname: '/api/v1/content-tasks/00000000-0000-4000-8000-000000000999/permanent-delete',
      });
    });

    test(`${surface} 普通删除 ${mode} 后只有显式读取成功才能重新确认`, async ({ page, contentApi }) => {
      contentApi.setMutationMode(mode);
      await page.goto(surface === 'list'
        ? '/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20'
        : '/content/tasks/00000000-0000-4000-8000-000000000001');
      const more = page.getByRole('button', { name: '更多操作：CT-00000001' });
      await more.click();
      await page.getByRole('menuitem', { name: '删除任务' }).click();
      await page.getByRole('dialog', { name: '确认删除任务“CT-00000001”' }).getByRole('button', { name: '确认删除' }).click();
      const recovery = page.getByRole('dialog', { name: /重新检查任务/ });
      await expect(recovery).toContainText('req-content-geo-conflict');
      expect(contentApi.lifecycleRequests).toHaveLength(1);
      contentApi.setDetailMode('error');
      await recovery.getByRole('button', { name: '重新读取删除条件' }).click();
      await expect(recovery).toContainText('req-content-detail');
      expect(contentApi.lifecycleRequests).toHaveLength(1);
      contentApi.setDetailMode('success');
      await recovery.getByRole('button', { name: '重新读取删除条件' }).click();
      await expect(recovery).toHaveCount(0);
      await expect(more).toBeFocused();
      expect(contentApi.lifecycleRequests).toHaveLength(1);
      await more.click();
      await page.getByRole('menuitem', { name: '删除任务' }).click();
      await expect(page.getByRole('dialog', { name: '确认删除任务“CT-00000001”' })).toBeVisible();
      expect(contentApi.lifecycleRequests).toHaveLength(1);
    });
  }
}
