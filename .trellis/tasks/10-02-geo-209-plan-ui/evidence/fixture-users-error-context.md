# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: system-users.spec.ts >> Users export、启用、停用和删除传递 CSRF 与当前 revision
- Location: tests/e2e/system-users.spec.ts:133:1

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 2
+ Received  + 2

  Object {
    "csrfToken": "users-e2e-csrf",
-   "expectedRevision": 18,
-   "operation": "delete",
+   "expectedRevision": 10,
+   "operation": "update",
  }
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - link [ref=e4] [cursor=pointer]:
      - /url: "#main-content"
      - text: 跳到主内容
    - complementary [ref=e5]:
      - generic [ref=e7]: PartSignal
      - navigation [ref=e8]:
        - region [ref=e9]:
          - heading [level=2] [ref=e10]: 工作区
          - list [ref=e11]:
            - listitem [ref=e12]:
              - link [ref=e13] [cursor=pointer]:
                - /url: /
                - img [ref=e14]
                - text: 工作台
            - listitem [ref=e19]:
              - link [ref=e20] [cursor=pointer]:
                - /url: /products
                - img [ref=e21]
                - text: 产品
        - region [ref=e31]:
          - heading [level=2] [ref=e32]: 内容运营
          - list [ref=e33]:
            - listitem [ref=e34]:
              - link [ref=e35] [cursor=pointer]:
                - /url: /content/tasks
                - img [ref=e36]
                - text: 内容任务
            - listitem [ref=e39]:
              - link [ref=e40] [cursor=pointer]:
                - /url: /publishing/work
                - img [ref=e41]
                - text: 发布工作
            - listitem [ref=e44]:
              - link [ref=e45] [cursor=pointer]:
                - /url: /publishing/articles
                - img [ref=e46]
                - text: 发布成果
            - listitem [ref=e49]:
              - link [ref=e50] [cursor=pointer]:
                - /url: /publishing/issues
                - img [ref=e51]
                - text: 内容问题
        - region [ref=e53]:
          - heading [level=2] [ref=e54]: GEO
          - list [ref=e55]:
            - listitem [ref=e56]:
              - link [ref=e57] [cursor=pointer]:
                - /url: /geo/insights
                - img [ref=e58]
                - text: 洞察
            - listitem [ref=e61]:
              - link [ref=e62] [cursor=pointer]:
                - /url: /geo/topics
                - img [ref=e63]
                - text: 问题主题
            - listitem [ref=e66]:
              - link [ref=e67] [cursor=pointer]:
                - /url: /geo/questions
                - img [ref=e68]
                - text: 问题库
            - listitem [ref=e71]:
              - link [ref=e72] [cursor=pointer]:
                - /url: /geo/plans
                - img [ref=e73]
                - text: 监测计划
            - listitem [ref=e76]:
              - link [ref=e77] [cursor=pointer]:
                - /url: /geo/observations
                - img [ref=e78]
                - text: 观测记录
        - region [ref=e81]:
          - heading [level=2] [ref=e82]: 业务配置
          - list [ref=e83]:
            - listitem [ref=e84]:
              - link [ref=e85] [cursor=pointer]:
                - /url: /settings/platforms
                - img [ref=e86]
                - text: 平台与账号
            - listitem [ref=e89]:
              - link [ref=e90] [cursor=pointer]:
                - /url: /configuration/geo-surfaces
                - img [ref=e91]
                - text: GEO 平台与采集配置
            - listitem [ref=e94]:
              - link [ref=e95] [cursor=pointer]:
                - /url: /configuration/geo-entities
                - img [ref=e96]
                - text: 监测对象与竞品
            - listitem [ref=e106]:
              - link [ref=e107] [cursor=pointer]:
                - /url: /settings/prompts
                - img [ref=e108]
                - text: Prompt 管理
            - listitem [ref=e111]:
              - link [ref=e112] [cursor=pointer]:
                - /url: /settings/ai
                - img [ref=e113]
                - text: AI 渠道
        - region [ref=e116]:
          - heading [level=2] [ref=e117]: 系统管理
          - list [ref=e118]:
            - listitem [ref=e119]:
              - link [ref=e120] [cursor=pointer]:
                - /url: /system/users
                - img [ref=e121]
                - text: 用户管理
            - listitem [ref=e126]:
              - link [ref=e127] [cursor=pointer]:
                - /url: /system/audit
                - img [ref=e128]
                - text: 系统审计
    - generic [ref=e131]:
      - banner [ref=e132]:
        - generic [ref=e133]:
          - paragraph [ref=e134]: PartSignal
          - paragraph [ref=e135]: 运营工作台
        - button [ref=e137]:
          - img
          - generic [ref=e138]: 系统管理员
      - main [ref=e139]:
        - generic [ref=e140]:
          - navigation [ref=e141]:
            - list [ref=e142]:
              - listitem [ref=e143]:
                - generic [ref=e144]: 用户管理
          - region "用户管理" [ref=e145]:
            - generic [ref=e146]:
              - generic [ref=e147]:
                - heading [level=1] [ref=e148]: 用户管理
                - paragraph [ref=e149]: 管理内部账号、账号类型、启停状态和临时密码。
              - button [ref=e150]: 新增用户
            - region [ref=e151]:
              - paragraph [ref=e152]: 全局统计，不受当前筛选影响。
              - generic [ref=e153]:
                - generic [ref=e154]:
                  - text: 用户总数
                  - strong [ref=e155]: "25"
                - generic [ref=e156]:
                  - text: 已启用
                  - strong [ref=e157]: "23"
                - generic [ref=e158]:
                  - text: 已停用
                  - strong [ref=e159]: "2"
                - generic [ref=e160]:
                  - text: 必须改密
                  - strong [ref=e161]: "1"
                - generic [ref=e162]:
                  - text: 管理员
                  - strong [ref=e163]: "3"
            - generic [ref=e164]:
              - search [ref=e166]:
                - generic [ref=e167]:
                  - generic [ref=e168]: 搜索用户
                  - img
                  - searchbox [ref=e169]: operator-18
                - combobox [ref=e170]:
                  - generic [ref=e171]: 全部类型
                  - img: ▼
                - textbox [ref=e172]: ALL
                - combobox [ref=e173]:
                  - generic [ref=e174]: Disabled
                  - img: ▼
                - textbox [ref=e175]: DISABLED
                - generic [ref=e176]:
                  - button [ref=e177]: 搜索
                  - button [ref=e178]: 重置
              - button [ref=e180]: 导出 CSV
            - region [ref=e181]:
              - table [ref=e182]:
                - rowgroup [ref=e183]:
                  - row [ref=e184]:
                    - columnheader [ref=e185]:
                      - checkbox [ref=e186]
                    - columnheader [ref=e187]: 用户
                    - columnheader [ref=e188]: 账号类型
                    - columnheader [ref=e189]: 状态
                    - columnheader [ref=e190]: 登录安全
                    - columnheader [ref=e191]: 创建时间
                    - columnheader [ref=e192]: 操作
                - rowgroup [ref=e193]:
                  - row [ref=e194]:
                    - cell [ref=e195]:
                      - checkbox [ref=e196]
                    - cell [ref=e197]:
                      - generic [ref=e198]:
                        - strong [ref=e199]: 运营人员 18
                        - generic [ref=e200]: "@operator-18"
                    - cell [ref=e201]:
                      - generic [ref=e202]: ENGINEER
                    - cell [ref=e203]:
                      - generic [ref=e204]: Disabled
                    - cell [ref=e205]: 已完成初始改密
                    - cell [ref=e206]:
                      - time [ref=e207]: 2026/07/31 17:18
                    - cell [ref=e208]:
                      - generic [ref=e209]:
                        - button [ref=e210]: 启用用户
                        - button [ref=e211]:
                          - img
            - navigation "表格分页" [ref=e212]:
              - generic [ref=e213]: 共 1 条
              - generic [ref=e214]:
                - combobox [ref=e215]:
                  - generic [ref=e216]: 20 条/页
                  - img: ▼
                - textbox [ref=e217]: "20"
                - generic [ref=e218]: 第 1 / 1 页
                - button [disabled]:
                  - img
                - button [disabled]:
                  - img
  - dialog "删除用户“operator-18”？" [ref=e222]:
    - generic [ref=e223]:
      - heading "删除用户“operator-18”？" [level=2] [ref=e224]
      - paragraph [ref=e225]: 删除不可恢复；服务端会校验当前 revision 与业务历史引用。
    - generic [ref=e226]:
      - button "关闭" [ref=e227]
      - button "删除用户" [active] [ref=e228]
    - button "关闭" [ref=e229]:
      - img
      - generic [ref=e230]: 关闭
```

# Test source

```ts
  62  |   const firstRow = page.getByRole('row', { name: /operator-long-account-name/ });
  63  |   await firstRow.getByRole('button', { name: '管理用户' }).click();
  64  |   const edit = page.getByRole('dialog', { name: /编辑用户 operator-long-account-name/ });
  65  |   await edit.getByRole('textbox', { name: '显示名称' }).fill('已编辑运营人员');
  66  |   await edit.getByRole('button', { name: '保存修改' }).click();
  67  |   await expect(edit).not.toBeVisible();
  68  |   expect(usersApi.requestRecords.at(-1)).toMatchObject({ operation: 'update', expectedRevision: 1 });
  69  | 
  70  |   const resetRow = page.getByRole('row', { name: /operator-02/ });
  71  |   usersApi.conflictNext('reset');
  72  |   usersApi.allowHttpError(409);
  73  |   await resetRow.getByRole('button', { name: '重置临时密码' }).click();
  74  |   const reset = page.getByRole('dialog', { name: /重置 operator-02 的临时密码/ });
  75  |   const password = reset.getByLabel(/临时密码/);
  76  |   await password.fill(fixtureArtifactSecrets.usersResetPassword);
  77  |   await reset.getByRole('button', { name: '重置临时密码' }).click();
  78  |   await expect(reset.getByRole('alert')).toContainText('请求 ID：req-users-conflict');
  79  |   await expect(password).toHaveValue(fixtureArtifactSecrets.usersResetPassword);
  80  |   const resetCount = usersApi.requestRecords.filter((record) => record.operation === 'reset').length;
  81  |   await page.waitForTimeout(150);
  82  |   expect(usersApi.requestRecords.filter((record) => record.operation === 'reset')).toHaveLength(resetCount);
  83  |   await reset.getByRole('button', { name: '重新加载列表' }).click();
  84  |   await expect(reset).not.toBeVisible();
  85  |   expect(usersApi.requestRecords.at(-1)).toMatchObject({
  86  |     operation: 'reset',
  87  |     csrfToken: 'users-e2e-csrf',
  88  |     expectedRevision: 2,
  89  |     passwordLength: fixtureArtifactSecrets.usersResetPassword.length,
  90  |   });
  91  | 
  92  |   await firstRow.getByRole('button', { name: /更多操作/ }).click();
  93  |   await page.getByRole('menuitem', { name: '查看删除条件' }).click();
  94  |   const blocker = page.getByRole('dialog', { name: /暂不可删除/ });
  95  |   await expect(blocker).toContainText('USER_BUSINESS_HISTORY：2');
  96  |   await expect(blocker.getByRole('link', { name: '查看审计历史' })).toHaveAttribute(
  97  |     'href',
  98  |     '/system/audit?actorId=00000000-0000-4000-8000-000000000001',
  99  |   );
  100 |   await blocker.getByRole('button', { name: '关闭' }).first().click();
  101 |   await expect(firstRow.getByRole('button', { name: /更多操作/ })).toBeFocused();
  102 | 
  103 |   expect(usersApi.responsePayloads.join('\n')).not.toContain(fixtureArtifactSecrets.usersCreatePassword);
  104 |   expect(usersApi.responsePayloads.join('\n')).not.toContain(fixtureArtifactSecrets.usersResetPassword);
  105 |   expect(JSON.stringify(usersApi.requestRecords)).not.toContain('users-secret');
  106 | });
  107 | 
  108 | test('Users loading、空态、失败重试与越界页均由 UserList 合同驱动', async ({ page, usersApi }) => {
  109 |   usersApi.delayNextList(300);
  110 |   await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  111 |   await expect(page.locator('tbody[aria-label="正在加载表格"]')).toBeVisible();
  112 |   await expect(page.getByText('@operator-long-account-name', { exact: true })).toBeVisible();
  113 | 
  114 |   usersApi.allowHttpError(503);
  115 |   usersApi.failNextList(503);
  116 |   await page.goto('/system/users?status=ENABLED&page=1&pageSize=10');
  117 |   await expect(page.getByText('用户列表加载失败', { exact: true })).toBeVisible();
  118 |   await page.getByRole('button', { name: '重试' }).click();
  119 |   await expect(page.getByText('@operator-long-account-name', { exact: true })).toBeVisible();
  120 | 
  121 |   await page.goto('/system/users?q=not-found&status=ENABLED&page=1&pageSize=20');
  122 |   await expect(page.getByText('未找到匹配用户', { exact: true })).toBeVisible();
  123 |   await page.goto('/system/users?status=ENABLED&page=99&pageSize=20');
  124 |   await expect(page.getByText('当前页已超出范围', { exact: true })).toBeVisible();
  125 |   await page.getByRole('button', { name: '返回最后一页' }).click();
  126 |   await expect(page).toHaveURL(/page=2/);
  127 | 
  128 |   usersApi.clearUsers();
  129 |   await page.reload();
  130 |   await expect(page.getByText('暂无用户', { exact: true })).toBeVisible();
  131 | });
  132 | 
  133 | test('Users export、启用、停用和删除传递 CSRF 与当前 revision', async ({ page, usersApi }) => {
  134 |   await page.goto('/system/users?status=DISABLED&page=1&pageSize=20');
  135 | 
  136 |   const download = page.waitForEvent('download');
  137 |   await page.getByRole('button', { name: '导出 CSV' }).click();
  138 |   expect((await download).suggestedFilename()).toBe('users-e2e.csv');
  139 |   expect(usersApi.requestRecords.at(-1)).toEqual({ operation: 'export', csrfToken: null });
  140 | 
  141 |   const enableRow = page.getByRole('row', { name: /operator-09/ });
  142 |   await enableRow.getByRole('button', { name: '启用用户' }).click();
  143 |   await page.getByRole('dialog', { name: /启用用户“operator-09”/ }).getByRole('button', { name: '启用用户' }).click();
  144 |   expect(usersApi.requestRecords.at(-1)).toMatchObject({
  145 |     operation: 'update', csrfToken: 'users-e2e-csrf', expectedRevision: 9, status: 'ENABLED',
  146 |   });
  147 | 
  148 |   await page.goto('/system/users?status=ENABLED&q=operator-10&page=1&pageSize=20');
  149 |   const disableRow = page.getByRole('row', { name: /operator-10/ });
  150 |   await disableRow.getByRole('button', { name: /更多操作/ }).click();
  151 |   await page.getByRole('menuitem', { name: '停用用户' }).click();
  152 |   await page.getByRole('dialog', { name: /停用用户“operator-10”/ }).getByRole('button', { name: '停用用户' }).click();
  153 |   expect(usersApi.requestRecords.at(-1)).toMatchObject({
  154 |     operation: 'update', csrfToken: 'users-e2e-csrf', expectedRevision: 10, status: 'DISABLED',
  155 |   });
  156 | 
  157 |   await page.goto('/system/users?status=DISABLED&q=operator-18&page=1&pageSize=20');
  158 |   const deleteRow = page.getByRole('row', { name: /operator-18/ });
  159 |   await deleteRow.getByRole('button', { name: /更多操作/ }).click();
  160 |   await page.getByRole('menuitem', { name: '删除用户' }).click();
  161 |   await page.getByRole('dialog', { name: /删除用户“operator-18”/ }).getByRole('button', { name: '删除用户' }).click();
> 162 |   expect(usersApi.requestRecords.at(-1)).toMatchObject({
      |                                          ^ Error: expect(received).toMatchObject(expected)
  163 |     operation: 'delete', csrfToken: 'users-e2e-csrf', expectedRevision: 18,
  164 |   });
  165 | });
  166 | 
  167 | test('User 删除 Dialog 重新聚焦后采用当前列表 projection 的最新 revision', async ({ page, usersApi }) => {
  168 |   const userId = '00000000-0000-4000-8000-000000000018';
  169 |   await page.goto('/system/users?status=DISABLED&page=1&pageSize=20');
  170 |   const row = page.getByRole('row', { name: /operator-18/ });
  171 |   await row.getByRole('button', { name: /更多操作/ }).click();
  172 |   await page.getByRole('menuitem', { name: '删除用户' }).click();
  173 | 
  174 |   usersApi.setProjection(userId, { username: 'operator-18-latest', revision: 28 });
  175 |   await page.evaluate(() => {
  176 |     Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  177 |     window.dispatchEvent(new Event('visibilitychange'));
  178 |     Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  179 |     window.dispatchEvent(new Event('visibilitychange'));
  180 |   });
  181 |   const dialog = page.getByRole('dialog', { name: '删除用户“operator-18-latest”？' });
  182 |   await expect(dialog).toBeVisible();
  183 |   await dialog.getByRole('button', { name: '删除用户' }).click();
  184 |   await expect.poll(() => usersApi.requestRecords.filter((record) => record.operation === 'delete').at(-1)?.expectedRevision)
  185 |     .toBe(28);
  186 | });
  187 | 
  188 | test('Users 两个删除 409 各自保持冻结，失败重读不解冻', async ({ page, usersApi }) => {
  189 |   await page.goto('/system/users?status=DISABLED&page=1&pageSize=20');
  190 |   for (const username of ['operator-09', 'operator-18']) {
  191 |     usersApi.conflictNextDelete();
  192 |     const row = page.getByRole('row', { name: new RegExp(username) });
  193 |     await row.getByRole('button', { name: /更多操作/ }).click();
  194 |     await page.getByRole('menuitem', { name: '删除用户' }).click();
  195 |     const dialog = page.getByRole('dialog', { name: `删除用户“${username}”？` });
  196 |     await dialog.getByRole('button', { name: '删除用户' }).click();
  197 |     await expect(dialog).toContainText('req-users-delete-conflict');
  198 |     await dialog.getByRole('button', { name: '关闭' }).first().click();
  199 |   }
  200 |   const first = page.getByRole('row', { name: /operator-09/ });
  201 |   await first.getByRole('button', { name: /更多操作/ }).click();
  202 |   await page.getByRole('menuitem', { name: '删除用户' }).click();
  203 |   const reopened = page.getByRole('dialog', { name: '删除用户“operator-09”？' });
  204 |   await expect(reopened.getByRole('button', { name: '删除用户' })).toBeDisabled();
  205 |   usersApi.failNextList(503);
  206 |   usersApi.allowHttpError(503);
  207 |   await reopened.getByRole('button', { name: '重新加载当前用户列表' }).click();
  208 |   await expect(reopened).toContainText('req-users-list-failed');
  209 |   await expect(reopened.getByRole('button', { name: '删除用户' })).toBeDisabled();
  210 |   await reopened.getByRole('button', { name: '重新加载当前用户列表' }).click();
  211 |   await expect(reopened.getByRole('button', { name: '删除用户' })).toBeEnabled();
  212 |   await reopened.getByRole('button', { name: '关闭' }).first().click();
  213 |   const second = page.getByRole('row', { name: /operator-18/ });
  214 |   await second.getByRole('button', { name: /更多操作/ }).click();
  215 |   await page.getByRole('menuitem', { name: '删除用户' }).click();
  216 |   await expect(page.getByRole('dialog', { name: '删除用户“operator-18”？' })
  217 |     .getByRole('button', { name: '删除用户' })).toBeDisabled();
  218 |   expect(usersApi.requestRecords.filter((record) => record.operation === 'delete')).toHaveLength(2);
  219 | });
  220 | 
  221 | test('Users bulk 使用选择时 revision、custom 停用确认和 200 partial 反馈', async ({ page, usersApi }) => {
  222 |   await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  223 |   await page.getByRole('checkbox', { name: '选择用户 operator-long-account-name' }).check();
  224 |   await page.getByRole('checkbox', { name: '选择用户 operator-02' }).check();
  225 |   await expect(page.getByRole('toolbar', { name: '批量操作' })).toContainText('已选择 2 项');
  226 | 
  227 |   await page.getByRole('button', { name: '批量停用' }).click();
  228 |   const confirm = page.getByRole('dialog', { name: '批量停用 2 个用户？' });
  229 |   await confirm.getByRole('button', { name: '批量停用' }).click();
  230 |   await expect(page.getByRole('toolbar', { name: '批量操作' })).toHaveCount(0);
  231 |   await expect(page.getByRole('status')).toContainText('成功 1，失败 1');
  232 |   await expect(page.getByRole('status')).toContainText('operator-02：用户修订冲突（REVISION_CONFLICT）');
  233 |   expect(usersApi.requestRecords.at(-1)).toEqual({
  234 |     operation: 'bulk',
  235 |     csrfToken: 'users-e2e-csrf',
  236 |     status: 'DISABLED',
  237 |     itemRevisions: [
  238 |       { userId: '00000000-0000-4000-8000-000000000001', expectedRevision: 1 },
  239 |       { userId: '00000000-0000-4000-8000-000000000002', expectedRevision: 2 },
  240 |     ],
  241 |   });
  242 | 
  243 |   await page.getByRole('checkbox', { name: '选择用户 operator-03' }).check();
  244 |   await page.getByRole('combobox', { name: '账号类型' }).click();
  245 |   await page.getByRole('option', { name: 'ADMIN' }).click();
  246 |   await expect(page.getByRole('toolbar', { name: '批量操作' })).toHaveCount(0);
  247 |   await expect(page.getByRole('alert')).toContainText('查询范围已变化');
  248 | });
  249 | 
  250 | test('Users 管理员边界、四档响应式、键盘动作与无敏感响应成立', async ({ page, usersApi }, testInfo) => {
  251 |   const widths = testInfo.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  252 |   await page.goto('/system/users?status=ENABLED&page=1&pageSize=20');
  253 |   for (const width of widths) {
  254 |     await page.setViewportSize({ width, height: 900 });
  255 |     expect(
  256 |       await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  257 |       `${width}px 页面根不应横向溢出`,
  258 |     ).toBe(true);
  259 |   }
  260 |   await page.setViewportSize({ width: widths[0], height: 900 });
  261 |   const firstRow = page.getByRole('row', { name: /operator-long-account-name/ });
  262 |   if (widths[0] <= 768) {
```