import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';

import { fixtureArtifactSecrets } from './fixture-secrets';

type LateArtifactFixture = { lateArtifact: undefined };

const test = base.extend<LateArtifactFixture>({
  lateArtifact: [async ({ page }, use, testInfo) => {
    void page;
    await use(undefined);
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(
      testInfo.outputPath('error-context.md'),
      `测试函数返回后写入的受控产物：${fixtureArtifactSecrets.postRunLeak}`,
    );
  }, { auto: true }],
});

test('post-run scanner 检出测试函数返回后生成的敏感产物', async ({ page }) => {
  await page.setContent('<label>密码<input type="password" aria-label="密码"></label>');
  await page.getByLabel('密码').fill(fixtureArtifactSecrets.postRunLeak);
  await expect(page.getByLabel('密码')).toHaveValue(fixtureArtifactSecrets.postRunLeak);
});
