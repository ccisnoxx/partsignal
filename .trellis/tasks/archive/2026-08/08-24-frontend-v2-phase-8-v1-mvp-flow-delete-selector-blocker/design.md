# 技术设计

## 1. Owner

变更只属于 `frontend/tests/e2e/mvp-flow.spec.ts` 的 Header 删除菜单 locator：

```text
唯一 headerMore trigger
        ↓ click
当前可见 menu overlay
        ↓ exact role/name
删除 menuitem
        ↓
既有确认 Dialog / 取消 / focus return
```

产品 UI 已提供唯一触发器与语义化 menuitem；无需修改产品或新增 helper framework。

## 2. 最小方案

在点击 `headerMore` 后，先定位当前可见菜单容器，再从该容器选择精确 `menuitem`“删除”。具体 DOM locator 必须以运行时实际可见 overlay 为依据；不得依赖 DOM 顺序。

若诊断发现两个 menuitem 同时位于同一个可见 menu，则当前“测试 owner”假设失效，停止实施并回到规划，不修改产品来迁就测试。

## 3. 兼容与回滚

- 不改变生产 bundle、API 或测试数据。
- 保留所有后续业务与焦点断言。
- 回滚仅撤销目标 locator hunk；无数据迁移或配置回滚。

## 4. 失败处理

目标 spec 非零时记录最小脱敏症状与 cleanup，不立即重跑。发现新的独立 owner 时停止，不在 A29 扩围。
