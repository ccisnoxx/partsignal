# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plans-real-stack.spec.ts >> 工程师八步创建、服务端预览、dirty、URL、启停修订复制归档与删除持久化
- Location: tests/e2e/plans-real-stack.spec.ts:39:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('未找到匹配计划', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('未找到匹配计划', { exact: true })

```

```yaml
- link "跳到主内容":
  - /url: "#main-content"
- banner:
  - button "打开主导航"
  - paragraph: PartSignal
  - paragraph: 运营工作台
  - button "GEO-209 验收工程师"
- main:
  - navigation "面包屑":
    - list:
      - listitem: 监测计划
  - region "监测计划":
    - heading "监测计划" [level=1]
    - paragraph: 组合监测对象、问题变体和采集配置，预览运行矩阵并管理计划状态。
    - button "新建监测计划"
    - region "监测计划列表工作区":
      - form "筛选监测计划":
        - text: 搜索计划名称
        - textbox "搜索计划名称"
        - button "应用筛选"
      - combobox "筛选计划状态": 全部状态
      - combobox "筛选调度": 全部调度
      - combobox "计划排序": 最近更新
      - region "监测计划列表":
        - table:
          - rowgroup:
            - row "计划名称 状态 操作":
              - columnheader "计划名称"
              - columnheader "状态"
              - columnheader "操作"
          - rowgroup:
            - row "GEO508 复核 9639b9e7 Revision 0 可以启用 未启用 启用计划 更多操作：GEO508 复核 9639b9e7":
              - cell "GEO508 复核 9639b9e7 Revision 0":
                - button "GEO508 复核 9639b9e7"
                - paragraph: Revision 0
              - cell "可以启用 未启用":
                - text: 可以启用
                - paragraph: 未启用
              - cell "启用计划 更多操作：GEO508 复核 9639b9e7":
                - button "启用计划"
                - button "更多操作：GEO508 复核 9639b9e7"
            - row "GEO508 复核 ff8b43b4 Revision 0 可以启用 未启用 启用计划 更多操作：GEO508 复核 ff8b43b4":
              - cell "GEO508 复核 ff8b43b4 Revision 0":
                - button "GEO508 复核 ff8b43b4"
                - paragraph: Revision 0
              - cell "可以启用 未启用":
                - text: 可以启用
                - paragraph: 未启用
              - cell "启用计划 更多操作：GEO508 复核 ff8b43b4":
                - button "启用计划"
                - button "更多操作：GEO508 复核 ff8b43b4"
      - navigation "表格分页":
        - text: 共 2 条
        - combobox "每页条数": 20 条/页
        - text: 第 1 / 1 页
        - button "上一页" [disabled]
        - button "下一页" [disabled]
    - region "计划配置工作区":
      - heading "新建监测计划向导" [level=2]
      - form "新建监测计划":
        - navigation "计划向导步骤":
          - list:
            - listitem:
              - button "1. 基本信息"
            - listitem:
              - button "2. 监测对象"
            - listitem:
              - button "3. 问题变体"
            - listitem:
              - button "4. 采集配置"
            - listitem:
              - button "5. 重复和预算"
            - listitem:
              - button "6. 调度"
            - listitem:
              - button "7. 服务端预览"
            - listitem:
              - button "8. 保存"
        - heading "7. 服务端预览" [level=2]
        - group:
          - paragraph: 预览当前完整草稿。任何字段或选择变化后都必须重新预览。
          - button "预览当前配置"
          - region "服务端运行预览":
            - paragraph: 服务端运行矩阵：1 × 1 × 3 = 3。保存时服务端会重新校验当前资源与运行资格。
            - term: 问题变体数
            - definition: "1"
            - term: 采集配置数
            - definition: "1"
            - term: 重复次数
            - definition: "3"
            - term: 总运行数
            - definition: "3"
            - term: 人工待录入数
            - definition: "3"
            - term: API 运行数
            - definition: "0"
            - term: 浏览器运行数
            - definition: "0"
            - term: 未解析运行数
            - definition: "0"
            - region "费用估算":
              - heading "费用估算" [level=3]
              - paragraph: 估价覆盖：全部未知 · 已知费用运行数 0 · 未知费用运行数 3
              - paragraph: 已知部分小计：未知或无法合并 · 币种：未知或多个币种
              - paragraph: 未知费用不按零计入。已知小计不能作为全部运行的最终费用；预算不执行预留或扣费。
            - status: 当前服务端预览没有运行阻断；预览结果不替代保存和状态操作的服务端裁决。
            - region "预览警告":
              - heading "警告（2）" [level=3]
              - list:
                - listitem:
                  - paragraph: 无法观测模型版本（MODEL_VERSION_UNKNOWN）
                  - paragraph: 字段：collection_profile_ids · 资源：330d8591-0f43-4ddc-aeb1-b74037b5fb86 · 关联资源：无
                - listitem:
                  - paragraph: 全部运行费用未知（COST_UNKNOWN）
                  - paragraph: 字段：estimated_cost · 资源：无 · 关联资源：无
        - status: 有未保存的修改
        - button "关闭向导"
        - button "上一步"
        - button "下一步"
```

# Test source

```ts
  57  |   expect(subject.is_active).toBe(true);
  58  |   await page.waitForLoadState('networkidle'); await page.goto('/configuration/geo-surfaces');
  59  |   await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  60  |   await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`GEO209 人工观测面 ${suffix}`);
  61  |   await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo209-${suffix}`);
  62  |   const surface = await pendingWrite<components['schemas']['GeoEngineSurfaceRead']>('POST', surfaces, () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  63  |   await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  64  |   await pendingWrite('POST', `${surfaces}/${surface.summary.id}/enable`, () => resourceAction(page, '启用观测面'));
  65  |   await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  66  |   await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  67  |   await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  68  |   const profileName = `GEO209 人工配置 ${suffix}`;
  69  |   await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(profileName);
  70  |   const profile = await pendingWrite<components['schemas']['GeoCollectionProfileRead']>('POST', profiles, () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  71  |   await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  72  |   await pendingWrite('POST', `${profiles}/${profile.summary.id}/enable`, () => resourceAction(page, '启用采集配置'));
  73  | 
  74  |   const temporaryPassword = `Geo209-temp-${randomUUID()}`;
  75  |   const newPassword = `Geo209-final-${randomUUID()}`;
  76  |   await registerArtifactSecrets([temporaryPassword, newPassword]);
  77  |   const username = `geo209-${suffix}`;
  78  |   await body(await page.request.post(`${api}/api/v1/users`, { headers: { 'X-CSRF-Token': admin.csrf_token }, data: { username, display_name: 'GEO-209 验收工程师', temporary_password: temporaryPassword, account_type: 'ENGINEER' } satisfies components['schemas']['UserCreate'] }), 201);
  79  |   const context = await browser.newContext({ baseURL: process.env.PARTSIGNAL_E2E_BASE_URL ?? 'http://127.0.0.1:4174', viewport: testInfo.project.use.viewport });
  80  |   try {
  81  |     const engineer = await context.newPage();
  82  |     const session = await body<components['schemas']['AuthSession']>(await engineer.request.post(`${api}/api/v1/auth/login`, { data: { username, password: temporaryPassword } }));
  83  |     await registerRealStackLoginSecrets(context, api, session.csrf_token);
  84  |     expect((await engineer.request.post(`${api}/api/v1/auth/change-password`, { headers: { 'X-CSRF-Token': session.csrf_token }, data: { old_password: temporaryPassword, new_password: newPassword } })).status()).toBe(204);
  85  |     await registerCurrentRealStackCookies(context, api);
  86  |     await engineer.goto('/geo/topics');
  87  |     await engineer.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
  88  |     const dialog = engineer.getByRole('dialog', { name: '创建 Query Topic', exact: true });
  89  |     const topicName = `GEO209 主题 ${suffix}`;
  90  |     await dialog.getByRole('textbox', { name: '标准问题' }).fill(topicName);
  91  |     await dialog.getByRole('textbox', { name: '变体 1' }).fill(`既有主题问题 ${suffix}`);
  92  |     const topicResponse = engineer.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/query-topics' && response.request().method() === 'POST');
  93  |     await dialog.getByRole('button', { name: '创建', exact: true }).click();
  94  |     const topic = await body<components['schemas']['QueryTopic']>(await topicResponse, 201);
  95  |     await expect(dialog).toBeHidden(); await engineer.waitForLoadState('networkidle');
  96  |     await engineer.goto('/geo/questions?new=1');
  97  |     await choose(engineer, '问题主题', topicName);
  98  |     const promptName = `GEO209 替代问题 ${suffix}`;
  99  |     await engineer.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(promptName);
  100 |     await choose(engineer, '点名属性', '非点名'); await choose(engineer, '优先级', '核心');
  101 |     await engineer.getByRole('textbox', { name: '语言代码', exact: true }).fill('zh-CN');
  102 |     await engineer.getByRole('textbox', { name: '地区代码', exact: true }).fill('CN');
  103 |     const variantResponse = engineer.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/geo/query-topics/${topic.id}/prompt-variants` && response.request().method() === 'POST');
  104 |     await engineer.getByRole('button', { name: '创建变体', exact: true }).click();
  105 |     const variant = await body<components['schemas']['GeoPromptVariantOut']>(await variantResponse, 201);
  106 |     await engineer.waitForLoadState('networkidle');
  107 | 
  108 |     let phase = 'open';
  109 |     // 写后取消旧列表 GET 是防止旧快照回写的已观测行为；写请求不允许取消。
  110 |     const allowedCancellations: RuntimeCancellation[] = ['resume', 'delete', 'archive'].map((phase) => ({ phase, method: 'GET', origin: apiOrigin, pathname: plans, reason: 'net::ERR_ABORTED' }));
  111 |     const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase, allowedCancellations }); audit.watch(engineer);
  112 |     const expectations: TrafficExpectation[] = [];
  113 |     const mutate = async <T,>(next: string, method: string, pathname: string, click: () => Promise<unknown>, status = 200): Promise<T> => {
  114 |       await engineer.waitForLoadState('networkidle'); phase = next;
  115 |       expectations.push({ phase, origin: apiOrigin, method, pathname, attempts: 1, responses: 1, status });
  116 |       const pending = engineer.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === method);
  117 |       await click(); const result = await pending; expect(result.status()).toBe(status);
  118 |       return status === 204 ? undefined as T : result.json() as Promise<T>;
  119 |     };
  120 |     // canonical suite 共享本轮隔离 DB；其他 flow 可以已创建自己的计划。
  121 |     // 空态布局只针对本用例的唯一筛选，不能依赖全库尚无计划。
  122 |     await engineer.goto(`/geo/plans?new=1&q=${suffix}`);
  123 |     const planName = `GEO209 计划 ${suffix}`;
  124 |     await engineer.getByRole('textbox', { name: '计划名称', exact: true }).fill(planName);
  125 |     await engineer.getByRole('button', { name: '关闭向导' }).click();
  126 |     await expect(engineer.getByRole('dialog', { name: '要离开当前页面吗？' })).toBeVisible();
  127 |     await engineer.getByRole('button', { name: '继续编辑' }).click();
  128 |     await expect(engineer.getByRole('textbox', { name: '计划名称', exact: true })).toHaveValue(planName);
  129 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  130 |     await expect(engineer.getByRole('heading', { name: '2. 监测对象', exact: true })).toBeFocused();
  131 |     await engineer.waitForLoadState('networkidle');
  132 |     await engineer.getByRole('searchbox', { name: '搜索监测对象选项' }).fill(suffix);
  133 |     await choose(engineer, `选择对象角色：${subjectName}`, '主要监测对象');
  134 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  135 |     await engineer.waitForLoadState('networkidle');
  136 |     await engineer.getByRole('searchbox', { name: '搜索问题变体选项' }).fill(suffix);
  137 |     await engineer.getByRole('button', { name: `选择问题变体：${promptName}`, exact: true }).click();
  138 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  139 |     await engineer.waitForLoadState('networkidle');
  140 |     await engineer.getByRole('searchbox', { name: '搜索采集配置选项' }).fill(suffix);
  141 |     await engineer.getByRole('button', { name: `选择采集配置：${profileName}`, exact: true }).click();
  142 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  143 |     await expect(engineer.getByRole('spinbutton', { name: '重复次数' })).toHaveValue('3');
  144 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  145 |     await choose(engineer, '调度方式', '定时配置');
  146 |     await engineer.getByRole('textbox', { name: 'Cron 表达式' }).fill('0 9 * * *');
  147 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  148 |     const serverPreview = await mutate<components['schemas']['GeoMonitoringPlanPreview']>('preview', 'POST', `${plans}/preview`, () => engineer.getByRole('button', { name: '预览当前配置' }).click());
  149 |     expect(serverPreview).toMatchObject({ run_count: 3, manual_run_count: 3, estimated_cost: { value: null }, blockers: [] });
  150 |     await expect(engineer.getByText('服务端运行矩阵：1 × 1 × 3 = 3。保存时服务端会重新校验当前资源与运行资格。')).toBeVisible();
  151 |     for (const width of [375, 768, 1024, 1440]) {
  152 |       await engineer.setViewportSize({ width, height: 900 });
  153 |       expect(await engineer.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  154 |       await expect(engineer.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
  155 |       if (width === 375) {
  156 |         const empty = engineer.getByText('未找到匹配计划', { exact: true });
> 157 |         await expect(empty).toBeVisible();
      |                             ^ Error: expect(locator).toBeVisible() failed
  158 |         const bounds = await empty.boundingBox();
  159 |         expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  160 |         await engineer.evaluate(() => window.scrollTo(0, 0));
  161 |         await engineer.screenshot({ path: testInfo.outputPath('geo209-wizard-mobile.png'), fullPage: true });
  162 |       }
  163 |     }
  164 |     await engineer.evaluate(() => window.scrollTo(0, 0));
  165 |     await engineer.screenshot({ path: testInfo.outputPath('geo209-wizard-preview.png'), fullPage: true });
  166 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  167 |     const created = await mutate<Plan>('create', 'POST', plans, () => engineer.getByRole('button', { name: '创建监测计划', exact: true }).click(), 201);
  168 |     expect(created).toMatchObject({ status: 'DISABLED', revision: 0, prompt_variant_ids: [variant.id], collection_profile_ids: [profile.summary.id], subjects: [{ subject_id: subject.id, role: 'PRIMARY' }], cron_expression: '0 9 * * *' });
  169 |     await expect(engineer).toHaveURL(new RegExp(`selected=${created.id}`));
  170 |     const detail = engineer.getByRole('region', { name: '监测计划详情' });
  171 |     await expect(detail.getByText(/NOT_IMPLEMENTED/)).toBeVisible();
  172 |     for (const [command, label, revision, status] of [['activate', '启用计划', 1, 'ACTIVE'], ['pause', '暂停计划', 2, 'PAUSED'], ['resume', '恢复计划', 3, 'ACTIVE']] as const) {
  173 |       await planAction(engineer, label);
  174 |       const result = await mutate<Plan>(command, 'POST', `${plans}/${created.id}/${command}`, () => engineer.getByRole('dialog', { name: `确认${label}` }).getByRole('button', { name: '确认操作' }).click());
  175 |       expect(result).toMatchObject({ status, revision });
  176 |       await engineer.waitForLoadState('networkidle');
  177 |     }
  178 |     await engineer.reload(); await expect(detail.getByText('Revision 3', { exact: true })).toBeVisible();
  179 |     await planAction(engineer, '修订配置');
  180 |     await engineer.getByRole('textbox', { name: '计划名称', exact: true }).fill(`${planName} 已修订`);
  181 |     await engineer.getByRole('button', { name: '7. 服务端预览', exact: true }).click();
  182 |     await mutate('revision-preview', 'POST', `${plans}/preview`, () => engineer.getByRole('button', { name: '预览当前配置' }).click());
  183 |     await engineer.getByRole('button', { name: '下一步', exact: true }).click();
  184 |     const revised = await mutate<Plan>('revision', 'PATCH', `${plans}/${created.id}`, () => engineer.getByRole('button', { name: '保存计划配置' }).click());
  185 |     expect(revised.revision).toBe(4); expect(revised.status).toBe('ACTIVE');
  186 |     await engineer.waitForLoadState('networkidle');
  187 |     await planAction(engineer, '复制为新计划');
  188 |     const copyDialog = engineer.getByRole('dialog', { name: '确认复制为新计划' });
  189 |     await copyDialog.getByRole('textbox', { name: '新计划名称' }).fill(`${planName} 副本`);
  190 |     const copied = await mutate<Plan>('copy', 'POST', `${plans}/${created.id}/copy`, () => copyDialog.getByRole('button', { name: '确认操作' }).click(), 201);
  191 |     expect(copied).toMatchObject({ status: 'DISABLED', revision: 0 }); expect(copied.id).not.toBe(created.id);
  192 |     await expect(engineer).toHaveURL(new RegExp(`selected=${copied.id}`));
  193 |     await planAction(engineer, '删除计划');
  194 |     await mutate('delete', 'DELETE', `${plans}/${copied.id}`, () => engineer.getByRole('dialog', { name: '确认删除计划' }).getByRole('button', { name: '确认操作' }).click(), 204);
  195 |     await expect(engineer.getByRole('dialog', { name: '监测计划工作区' })).toBeHidden();
  196 |     await engineer.waitForLoadState('networkidle');
  197 |     await engineer.goto(`/geo/plans?selected=${created.id}&q=${suffix}&schedule_kind=CRON&sort=NAME_ASC`);
  198 |     await planAction(engineer, '归档计划');
  199 |     const archived = await mutate<Plan>('archive', 'POST', `${plans}/${created.id}/archive`, () => engineer.getByRole('dialog', { name: '确认归档计划' }).getByRole('button', { name: '确认操作' }).click());
  200 |     expect(archived).toMatchObject({ status: 'ARCHIVED', revision: 5, available_actions: ['COPY'] });
  201 |     await engineer.waitForLoadState('networkidle'); await engineer.reload();
  202 |     expect(await body<Plan>(await engineer.request.get(`${api}${plans}/${created.id}`))).toMatchObject({ status: 'ARCHIVED', revision: 5, name: `${planName} 已修订` });
  203 |     await engineer.getByRole('button', { name: '关闭', exact: true }).click();
  204 |     await expect(engineer.getByRole('textbox', { name: '搜索计划名称' })).toHaveValue(suffix);
  205 |     await expect(engineer.getByRole('combobox', { name: '筛选调度' })).toContainText('定时配置');
  206 |     expect(trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin))).toEqual([]);
  207 |     expect(audit.errors).toEqual([]);
  208 |     expect(audit.attempts.some((item) => /\/(run|runs|batches)(\/|$)/.test(item.pathname))).toBe(false);
  209 |   } finally { await registerCurrentRealStackCookies(context, api); await context.close(); }
  210 | });
  211 | 
```