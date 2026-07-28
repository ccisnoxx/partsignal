# 完善观测与发布管理流程：集成实施计划

## 执行顺序

- [x] 先启动并完成 `07-28-observation-evidence-management`。
- [x] 确认人工观测契约、数据库迁移、通用 FileRecord 清理、后端与前端测试全部通过。
- [x] 再启动并完成 `07-28-publication-management`，复用已落地的通用附件清理。
- [x] 运行跨子任务契约生成与全量差异检查。
- [x] 使用真实 PostgreSQL、Redis、对象存储替身和 Playwright CLI 完成观测、发布记录、发布关注事项闭环。

## 集成校验

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
```

Playwright CLI 验收前以正确代理目标启动前端：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:18000 npm --prefix frontend run dev -- --host 127.0.0.1
```

然后至少验证：

- 无截图新建观测、独立发现/提及/准确性、更正不重复上传、整链删除和附件最终清理。
- 未公开发布记录显示删除并成功清理独占附件。
- 已出现 `PUBLISHED/VERIFIED` 历史的记录没有删除动作，直接 DELETE 返回冲突。
- “发布需关注”从总览直达关注 Tab，并能查看、创建修复任务和显式解决。
- 发布记录表格在 1536×1024、1024px、375×812 下无页面级横向滚动，所有服务端动作可发现。
- `playwright-cli console` 与 `playwright-cli requests` 没有本任务引入的错误。

## 最终审查

- [x] 检查没有保留推荐/引用兼容写入或前端隐藏字段。
- [x] 检查没有第二套文件清理器、引用计数或前端删除资格。
- [x] 检查直接数据库 DELETE 仍被事务级门禁外的触发器拒绝。
- [x] 检查审计不包含搜索词、备注、回答正文、文件名或对象内容。
- [x] 检查现有用户改动和其他活跃 Trellis 任务文件未被覆盖。
