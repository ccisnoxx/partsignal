# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prompt-workspace.spec.ts >> 管理员从导航进入 Prompt Workspace，并完成 create/update/delete revision 闭环
- Location: tests/e2e/prompt-workspace.spec.ts:14:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Prompt 管理' })
    - locator resolved to <a href="/settings/prompts" class="flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 text-text-secondary hover:bg-surface-raised hover:text-text-primary">…</a>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - element is outside of the viewport
  - retrying click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
      - waiting 100ms
    57 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - element is outside of the viewport
     - retrying click action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - link [ref=e4] [cursor=pointer]:
      - /url: "#main-content"
      - text: 跳到主内容
    - generic [ref=e5]:
      - banner [ref=e6]:
        - button [expanded] [ref=e7]:
          - img
        - generic [ref=e8]:
          - paragraph [ref=e9]: PartSignal
          - paragraph [ref=e10]: 运营工作台
        - button [ref=e12]:
          - img
          - generic [ref=e13]: 系统管理员
      - main [ref=e14]:
        - generic [ref=e15]:
          - navigation [ref=e16]:
            - list [ref=e17]:
              - listitem [ref=e18]:
                - generic [ref=e19]: 工作台
          - region [ref=e20]:
            - generic [ref=e21]:
              - heading [level=1] [ref=e22]: 工作台
              - paragraph [ref=e23]: 集中处理跨产品事实、内容、发布与 GEO 的当前运营事项。
              - paragraph [ref=e24]: 聚合生成于 2026/8/23 01:00:00
            - region [ref=e25]:
              - generic [ref=e26]:
                - heading [level=2] [ref=e27]: 需要处理
                - paragraph [ref=e28]: 数量与入口均来自服务端聚合投影。
              - generic [ref=e29]:
                - article [ref=e30]:
                  - paragraph [ref=e31]: 事实审核
                  - paragraph [ref=e32]: "0"
                  - list [ref=e33]:
                    - listitem [ref=e34]:
                      - link [ref=e35] [cursor=pointer]:
                        - /url: /products?workbench=fact-review
                        - generic [ref=e36]: 查看事实审核
                - article [ref=e37]:
                  - paragraph [ref=e38]: 内容审核
                  - paragraph [ref=e39]: "0"
                  - list [ref=e40]:
                    - listitem [ref=e41]:
                      - link [ref=e42] [cursor=pointer]:
                        - /url: /content/tasks?workbench=content-review
                        - generic [ref=e43]: 查看内容审核
                - article [ref=e44]:
                  - paragraph [ref=e45]: 待核验发布
                  - paragraph [ref=e46]: "0"
                  - list [ref=e47]:
                    - listitem [ref=e48]:
                      - link [ref=e49] [cursor=pointer]:
                        - /url: /publishing/work?workbench=verification
                        - generic [ref=e50]: 查看待核验发布
                - article [ref=e51]:
                  - paragraph [ref=e52]: 发布处理
                  - paragraph [ref=e53]: "0"
                  - list [ref=e54]:
                    - listitem [ref=e55]:
                      - link [ref=e56] [cursor=pointer]:
                        - /url: /publishing/work?workbench=ready
                        - generic [ref=e57]: 处理待开始发布
                    - listitem [ref=e58]:
                      - link [ref=e59] [cursor=pointer]:
                        - /url: /publishing/work?workbench=failed
                        - generic [ref=e60]: 处理发布失败
                - article [ref=e61]:
                  - paragraph [ref=e62]: 内容问题
                  - paragraph [ref=e63]: "0"
                  - list [ref=e64]:
                    - listitem [ref=e65]:
                      - link [ref=e66] [cursor=pointer]:
                        - /url: /publishing/issues?workbench=open
                        - generic [ref=e67]: 查看内容问题
                - article [ref=e68]:
                  - paragraph [ref=e69]: GEO 准确性问题
                  - paragraph [ref=e70]: "0"
                  - list [ref=e71]:
                    - listitem [ref=e72]:
                      - link [ref=e73] [cursor=pointer]:
                        - /url: /geo/observations?workbench=accuracy
                        - generic [ref=e74]: 检查准确性异常
                    - listitem [ref=e75]:
                      - link [ref=e76] [cursor=pointer]:
                        - /url: /geo/observations?workbench=missing
                        - generic [ref=e77]: 检查缺失样本
            - region [ref=e78]:
              - generic [ref=e79]:
                - heading [level=2] [ref=e80]: 关注队列
                - paragraph [ref=e81]: 按服务端返回顺序展示最近需要人工关注的事项。
              - generic [ref=e82]: 当前没有需要关注的事项。
            - region [ref=e83]:
              - generic [ref=e84]:
                - heading [level=2] [ref=e85]: 流程健康
                - paragraph [ref=e86]: 状态与说明直接来自服务端 workflow health。
              - generic [ref=e87]:
                - article [ref=e88]:
                  - generic [ref=e89]:
                    - heading [level=3] [ref=e90]: 产品事实
                    - generic [ref=e91]: 正常
                  - paragraph [ref=e92]: 产品事实流程正常
                - article [ref=e93]:
                  - generic [ref=e94]:
                    - heading [level=3] [ref=e95]: 内容生产
                    - generic [ref=e96]: 需关注
                  - paragraph [ref=e97]: 内容审核存在积压
                - article [ref=e98]:
                  - generic [ref=e99]:
                    - heading [level=3] [ref=e100]: 发布管理
                    - generic [ref=e101]: 需关注
                  - paragraph [ref=e102]: 发布流程需要处理
                - article [ref=e103]:
                  - generic [ref=e104]:
                    - heading [level=3] [ref=e105]: GEO
                    - generic [ref=e106]: 正常
                  - paragraph [ref=e107]: GEO 流程正常
            - region [ref=e108]:
              - generic [ref=e109]:
                - heading [level=2] [ref=e110]: 30 日 GEO 摘要
                - paragraph [ref=e111]: 2026-07-25 至 2026-08-23
              - generic [ref=e112]:
                - generic [ref=e113]:
                  - term [ref=e114]: 发现率
                  - definition [ref=e115]:
                    - paragraph [ref=e116]: 暂无数据
                    - paragraph [ref=e117]: 0 / 0
                - generic [ref=e118]:
                  - term [ref=e119]: 提及率
                  - definition [ref=e120]:
                    - paragraph [ref=e121]: 暂无数据
                    - paragraph [ref=e122]: 0 / 0
                - generic [ref=e123]:
                  - term [ref=e124]: 准确率
                  - definition [ref=e125]:
                    - paragraph [ref=e126]: 暂无数据
                    - paragraph [ref=e127]: 0 / 0
  - dialog "PartSignal 导航" [ref=e131]:
    - generic [ref=e132]:
      - heading "PartSignal 导航" [level=2] [ref=e133]
      - paragraph [ref=e134]: 选择工作区或系统管理入口。
    - navigation "主导航" [ref=e135]:
      - region "工作区" [ref=e136]:
        - heading "工作区" [level=2] [ref=e137]
        - list [ref=e138]:
          - listitem [ref=e139]:
            - link "工作台" [active] [ref=e140] [cursor=pointer]:
              - /url: /
              - img [ref=e141]
              - text: 工作台
          - listitem [ref=e146]:
            - link "产品" [ref=e147] [cursor=pointer]:
              - /url: /products
              - img [ref=e148]
              - text: 产品
      - region "内容运营" [ref=e158]:
        - heading "内容运营" [level=2] [ref=e159]
        - list [ref=e160]:
          - listitem [ref=e161]:
            - link "内容任务" [ref=e162] [cursor=pointer]:
              - /url: /content/tasks
              - img [ref=e163]
              - text: 内容任务
          - listitem [ref=e166]:
            - link "发布工作" [ref=e167] [cursor=pointer]:
              - /url: /publishing/work
              - img [ref=e168]
              - text: 发布工作
          - listitem [ref=e171]:
            - link "发布成果" [ref=e172] [cursor=pointer]:
              - /url: /publishing/articles
              - img [ref=e173]
              - text: 发布成果
          - listitem [ref=e176]:
            - link "内容问题" [ref=e177] [cursor=pointer]:
              - /url: /publishing/issues
              - img [ref=e178]
              - text: 内容问题
      - region "GEO" [ref=e180]:
        - heading "GEO" [level=2] [ref=e181]
        - list [ref=e182]:
          - listitem [ref=e183]:
            - link "总览" [ref=e184] [cursor=pointer]:
              - /url: /geo/overview
              - img [ref=e185]
              - text: 总览
          - listitem [ref=e190]:
            - link "回答洞察" [ref=e191] [cursor=pointer]:
              - /url: /geo/insights/answers
              - img [ref=e192]
              - text: 回答洞察
          - listitem [ref=e195]:
            - link "洞察" [ref=e196] [cursor=pointer]:
              - /url: /geo/insights
              - img [ref=e197]
              - text: 洞察
          - listitem [ref=e200]:
            - link "问题主题" [ref=e201] [cursor=pointer]:
              - /url: /geo/topics
              - img [ref=e202]
              - text: 问题主题
          - listitem [ref=e205]:
            - link "问题库" [ref=e206] [cursor=pointer]:
              - /url: /geo/questions
              - img [ref=e207]
              - text: 问题库
          - listitem [ref=e210]:
            - link "监测计划" [ref=e211] [cursor=pointer]:
              - /url: /geo/plans
              - img [ref=e212]
              - text: 监测计划
          - listitem [ref=e215]:
            - link "运行中心" [ref=e216] [cursor=pointer]:
              - /url: /geo/runs
              - img [ref=e217]
              - text: 运行中心
          - listitem [ref=e220]:
            - link "观测记录" [ref=e221] [cursor=pointer]:
              - /url: /geo/observations
              - img [ref=e222]
              - text: 观测记录
      - region "业务配置" [ref=e225]:
        - heading "业务配置" [level=2] [ref=e226]
        - list [ref=e227]:
          - listitem [ref=e228]:
            - link "平台与账号" [ref=e229] [cursor=pointer]:
              - /url: /settings/platforms
              - img [ref=e230]
              - text: 平台与账号
          - listitem [ref=e233]:
            - link "GEO 平台与采集配置" [ref=e234] [cursor=pointer]:
              - /url: /configuration/geo-surfaces
              - img [ref=e235]
              - text: GEO 平台与采集配置
          - listitem [ref=e238]:
            - link "监测对象与竞品" [ref=e239] [cursor=pointer]:
              - /url: /configuration/geo-entities
              - img [ref=e240]
              - text: 监测对象与竞品
          - listitem [ref=e250]:
            - link "Prompt 管理" [ref=e251] [cursor=pointer]:
              - /url: /settings/prompts
              - img [ref=e252]
              - text: Prompt 管理
          - listitem [ref=e255]:
            - link "AI 渠道" [ref=e256] [cursor=pointer]:
              - /url: /settings/ai
              - img [ref=e257]
              - text: AI 渠道
      - region "系统管理" [ref=e260]:
        - heading "系统管理" [level=2] [ref=e261]
        - list [ref=e262]:
          - listitem [ref=e263]:
            - link "用户管理" [ref=e264] [cursor=pointer]:
              - /url: /system/users
              - img [ref=e265]
              - text: 用户管理
          - listitem [ref=e270]:
            - link "系统审计" [ref=e271] [cursor=pointer]:
              - /url: /system/audit
              - img [ref=e272]
              - text: 系统审计
    - button "关闭" [ref=e275]:
      - img
      - generic [ref=e276]: 关闭
```

# Test source

```ts
  1   | import {
  2   |   createdPromptId,
  3   |   expect,
  4   |   firstPromptId,
  5   |   platformId,
  6   |   previewJobId,
  7   |   previewModelId,
  8   |   previewTaskId,
  9   |   previewVersionId,
  10  |   secondPromptId,
  11  |   test,
  12  | } from './fixtures/prompt-workspace.fixture';
  13  | 
  14  | test('管理员从导航进入 Prompt Workspace，并完成 create/update/delete revision 闭环', async ({
  15  |   page,
  16  |   promptWorkspaceApi,
  17  | }, testInfo) => {
  18  |   await page.goto('/');
  19  |   if (testInfo.project.name === 'foundation-mobile') {
  20  |     await page.getByRole('button', { name: '打开主导航' }).click();
  21  |   }
> 22  |   await page.getByRole('link', { name: 'Prompt 管理' }).click();
      |                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
  23  |   await expect(page).toHaveURL('/settings/prompts');
  24  |   await expect(page.getByRole('heading', { level: 1, name: 'Prompt 管理' })).toBeVisible();
  25  |   await expect(page.getByText(/从 Prompt Library 选择/)).toBeVisible();
  26  | 
  27  |   await page.getByRole('button', { name: '新建 Prompt' }).click();
  28  |   await expect(page).toHaveURL('/settings/prompts?new=1');
  29  |   await page.getByRole('textbox', { name: 'Prompt 名称' }).fill('新建 E2E Prompt');
  30  |   await page.getByRole('textbox', { name: 'Prompt Markdown' }).fill('# E2E 正文');
  31  |   await page.getByRole('button', { name: '创建 Prompt' }).click();
  32  |   await expect(page).toHaveURL(`/settings/prompts?promptId=${createdPromptId}`);
  33  |   expect(promptWorkspaceApi.requests[0]).toMatchObject({
  34  |     body: { name: '新建 E2E Prompt', template_markdown: '# E2E 正文' },
  35  |     csrfToken: 'platforms-e2e-csrf',
  36  |     method: 'POST',
  37  |   });
  38  | 
  39  |   await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  40  |   const markdown = page.getByRole('textbox', { name: 'Prompt Markdown' });
  41  |   await expect(markdown).toHaveText('# 写作约束');
  42  |   await markdown.click();
  43  |   await markdown.press('End');
  44  |   await markdown.press('Enter');
  45  |   await markdown.pressSequentially('已更新约束');
  46  |   await expect(markdown).toHaveText('# 写作约束已更新约束');
  47  |   await expect(page.getByRole('button', { name: '保存 Prompt' })).toBeEnabled();
  48  |   await markdown.press('Control+s');
  49  |   const impact = page.getByRole('dialog', { name: '保存将影响绑定平台' });
  50  |   await expect(impact.getByRole('link', { name: '工程师社区 001' })).toHaveAttribute(
  51  |     'href',
  52  |     `/settings/platforms/${platformId}?tab=generation`,
  53  |   );
  54  |   await impact.getByRole('button', { name: '确认保存' }).click();
  55  |   await expect.poll(() => promptWorkspaceApi.requests.length).toBe(2);
  56  |   expect(promptWorkspaceApi.requests[1]).toMatchObject({
  57  |     body: { expected_revision: 4, template_markdown: '# 写作约束\n已更新约束' },
  58  |     csrfToken: 'platforms-e2e-csrf',
  59  |     method: 'PUT',
  60  |     promptId: firstPromptId,
  61  |   });
  62  | 
  63  |   if (testInfo.project.name === 'foundation-mobile') {
  64  |     await page.getByRole('tab', { name: '绑定平台' }).click();
  65  |   }
  66  |   await page.getByRole('button', { name: '删除 Prompt' }).click();
  67  |   const remove = page.getByRole('dialog', { name: '删除 Prompt“技术文章 Prompt”？' });
  68  |   await remove.getByRole('button', { name: '确认删除' }).click();
  69  |   await expect(page).toHaveURL('/settings/prompts');
  70  |   expect(promptWorkspaceApi.requests[2]).toMatchObject({
  71  |     csrfToken: 'platforms-e2e-csrf',
  72  |     expectedRevision: 5,
  73  |     method: 'DELETE',
  74  |     promptId: firstPromptId,
  75  |   });
  76  | });
  77  | 
  78  | test('新建 Prompt 后仅修改名称即可保存并采用 canonical revision', async ({
  79  |   page,
  80  |   promptWorkspaceApi,
  81  | }) => {
  82  |   await page.goto('/settings/prompts?new=1');
  83  |   await page.getByRole('textbox', { name: 'Prompt 名称' }).fill('名称单独保存 Prompt');
  84  |   await page.getByRole('textbox', { name: 'Prompt Markdown' }).fill('# 名称单独保存正文');
  85  |   await page.getByRole('button', { name: '创建 Prompt' }).click();
  86  |   await expect(page).toHaveURL(`/settings/prompts?promptId=${createdPromptId}`);
  87  | 
  88  |   const name = page.getByRole('textbox', { name: 'Prompt 名称' });
  89  |   await name.fill('名称单独保存 Prompt-已更新');
  90  |   await expect(page.getByText('有未保存修改 · 基于 Revision 0', { exact: true })).toBeVisible();
  91  |   const save = page.getByRole('button', { name: '保存 Prompt', exact: true });
  92  |   await expect(save).toBeEnabled();
  93  |   await save.click();
  94  | 
  95  |   await expect.poll(() => promptWorkspaceApi.requests.length).toBe(2);
  96  |   expect(promptWorkspaceApi.requests[0]).toMatchObject({
  97  |     body: { name: '名称单独保存 Prompt', template_markdown: '# 名称单独保存正文' },
  98  |     csrfToken: 'platforms-e2e-csrf',
  99  |     method: 'POST',
  100 |   });
  101 |   expect(promptWorkspaceApi.requests[1]).toMatchObject({
  102 |     body: {
  103 |       expected_revision: 0,
  104 |       name: '名称单独保存 Prompt-已更新',
  105 |       template_markdown: '# 名称单独保存正文',
  106 |     },
  107 |     csrfToken: 'platforms-e2e-csrf',
  108 |     method: 'PUT',
  109 |     promptId: createdPromptId,
  110 |   });
  111 |   await expect(page.getByText('未修改 · Revision 1')).toBeVisible();
  112 |   await expect(save).toBeDisabled();
  113 | });
  114 | 
  115 | test('Preview 显式选择并确认真实首稿，按返回 Job 轮询到不可变版本', async ({
  116 |   page,
  117 |   promptWorkspaceApi,
  118 | }, testInfo) => {
  119 |   await page.goto(`/settings/prompts?promptId=${firstPromptId}`);
  120 |   if (testInfo.project.name === 'foundation-mobile') {
  121 |     await page.getByRole('tab', { name: '绑定平台' }).click();
  122 |   }
```