# DEF-06 技术设计

## 边界与权威状态

- AI 渠道当前详情的权威 owner 是 React Router 路径参数 `channelId`；TanStack Query 只持有服务端缓存。
- Prompt 当前选中项的权威 owner 是查询参数 `platform_prompt_id`；编辑器本地状态只属于该身份。
- 列表查询数据决定无显式选中项时现有自动选择 effect 的候选集合。

不修改 API、后端、query key 注册表或公共组件。

## 根因

两个页面都在删除成功后对仍有活动 observer 的详情 key 调用 `removeQueries`。缓存记录被移除时，旧路由或旧查询参数尚未完成解除，observer 会按原 ID 再次执行详情 GET。Prompt 与渠道父工作区随后还可能从尚未刷新的列表缓存重新选择已删除 ID。

## 最小修复

### AI 渠道

详情面板和列表行删除成功后都执行：

1. 用 `queryClient.setQueriesData` 只更新 `queryKeys.aiChannels.all` 范围内的渠道列表缓存，过滤已删除 ID。
2. 若删除当前渠道，导航到 `/configuration/ai`；删除非当前渠道不改变路由。
3. 对已删除详情 key（以及详情页已加载的模型 key）调用 `invalidateQueries({ refetchType: 'none' })`：使缓存失效但不触发当前 observer GET。
4. 正常失效渠道列表，让服务端响应成为最终列表真相。

列表缓存的同步过滤只用于阻止路由清理后的自动选择 effect 重新激活已删除 ID；后台列表刷新仍负责权威校准。

### Prompt

删除 mutation 返回已确认删除的 Prompt ID，成功后执行：

1. 用 `setQueryData` 从 Prompt 列表缓存过滤该 ID。
2. 清空编辑器本地身份并从 URL 删除 `platform_prompt_id`。
3. 对该详情 key 使用 `invalidateQueries({ refetchType: 'none' })`，不调用 `removeQueries`。
4. 正常失效 Prompt 列表。

列表缓存已先过滤，因此现有自动选择 effect 即使运行，也只能选择仍存在的 Prompt。

## 错误与兼容

- mutation 失败时不执行任何导航、选中清理或缓存过滤，原错误继续由现有 `Alert`/编辑器错误区展示。
- 普通直接 URL 不走删除成功回调；详情 query 保持启用，服务端 404 继续进入现有 `QueryFailure`。
- 删除后的详情 key 被标记 stale。用户以后直接访问相同 URL 时必须重新 GET，因此不会显示旧缓存伪成功。
- 不忽略 404，不改变 retry 全局设置，不增加延时或空 catch。

## 风险与回滚

- 风险集中在缓存列表的同步投影类型和自动选择 effect。回归测试必须覆盖单项、多项/非当前删除及直接不存在 URL。
- 如修复导致列表投影与生成类型不一致，回滚目标仅为三个页面的删除成功回调与对应测试，不涉及契约或数据迁移。
