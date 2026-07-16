# 技术设计

## 1. 删除边界

服务层只诊断目标表的直接外键引用，避免递归推断和重复计算。权威矩阵如下：

| 删除目标 | 阻断引用 | 无引用时处理 |
| --- | --- | --- |
| `Product` | `FactVersion`、`ContentTask`、`GeoObservation` | 删除产品，既有 CASCADE 清理当前事实工作区 |
| `PlatformProfileVersion` | `ContentTask` | 删除该规则版本；允许删除 `ACTIVE` |
| `PlatformProfile` | `PlatformProfileVersion`、`PlatformAccount` | 删除平台；拥有的当前 Prompt 随平台删除 |
| `PlatformAccount` | `PublicationRecord` | 删除账号配置 |
| `PlatformType` | `PlatformProfile` | 删除类型 |
| `PlatformPrompt` | 无业务表直接引用 | 删除当前配置，作业快照保留 |

实现前再次通过 ORM、迁移和数据库契约确认矩阵。若发现新的直接外键，先更新矩阵和测试，不以捕获 `IntegrityError` 作为兼容逻辑。

## 2. API 契约

新增或完善管理员接口：

```text
DELETE /api/v1/products/{product_id}
DELETE /api/v1/platform-profile-versions/{platform_profile_version_id}
DELETE /api/v1/platform-profiles/{platform_profile_id}
DELETE /api/v1/platform-accounts/{platform_account_id}
DELETE /api/v1/platform-types/{platform_type_id}
DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt
```

成功沿用项目现有删除响应约定。目标不存在返回 `404`。引用冲突统一使用错误信封：

```json
{
  "error": {
    "code": "PRODUCT_IN_USE",
    "message": "产品仍被以下历史对象引用：事实版本（2）、内容任务（1）",
    "details": {
      "references": [
        {"type": "FACT_VERSION", "count": 2},
        {"type": "CONTENT_TASK", "count": 1}
      ]
    }
  }
}
```

`type` 使用稳定机器值，前端按机器值显示中文标签；`count` 是当前事务内的真实数量。每类对象使用明确错误码，如 `PRODUCT_IN_USE`、`PLATFORM_PROFILE_VERSION_IN_USE`、`PLATFORM_PROFILE_IN_USE`、`PLATFORM_ACCOUNT_IN_USE` 和 `PLATFORM_TYPE_IN_USE`。

## 3. 服务端事务

每个删除服务按相同顺序实现，但不建立通用反射式删除框架：

1. 通过主键查询并锁定目标行，不存在则返回 `404`。
2. 在当前事务统计该目标的全部直接阻断引用。
3. 存在引用则构造完整 `references` 并返回 `409`。
4. 无引用则删除目标、flush 并记录审计。
5. 保留数据库 `RESTRICT` 作为并发和遗漏的最终防线；非预期约束错误应显式暴露并修正矩阵。

管理员依赖沿用现有 `AdminUser`，CSRF 由现有写请求中间件处理。服务不得接受 `force`、`cascade` 或归属改写参数。

## 4. 删除有效规则后的状态

删除 `ACTIVE PlatformProfileVersion` 不触发任何替代选择：

- 平台记录不删除。
- 平台列表投影返回 `active_version=null`。
- 当前 Prompt 保留。
- 管理员可创建 `DRAFT` 并通过既有激活流程产生新的 `ACTIVE` 版本。
- 工程师平台选项和内容任务创建服务立即把该平台视为不可用。

只有显式激活新规则，且平台当前 Prompt 存在时，平台才重新可用于内容任务。该判断复用前一子任务的权威可用性逻辑，不在删除服务建立第二套状态字段。

## 5. 前端设计

- 产品删除入口放在现有产品列表或详情的管理员操作区，确认框明确会删除产品和当前事实工作区，不会删除历史引用。
- 平台管理页分别在规则版本和平台操作区提供删除；删除有效规则后重新获取平台投影。
- 设置/账号管理中的平台账号提供管理员删除入口。
- 平台类型和 Prompt 页复用对应删除交互。
- 冲突组件只负责把 `details.references` 的稳定类型映射为中文并展示数量，不根据 message 文本解析引用。
- 成功后只失效相关资源和依赖选项查询，不清空全局缓存。

## 6. 测试策略

- 每类目标测试管理员成功、工程师拒绝、目标不存在、单一引用、多类引用和清理引用后重试。
- 产品测试确认当前工作区 CASCADE 与历史对象 RESTRICT。
- 规则版本测试确认删除 `ACTIVE` 后平台仍存在、`active_version=null`、工程师不可选，以及新版本激活后恢复。
- 平台账号测试确认发布引用阻断；平台/类型测试确认不级联配置层级。
- Prompt 和生成作业测试确认删除当前配置不改变历史快照。
- 前端测试确认按钮权限、具体确认文案、结构化冲突、成功缓存失效和无有效规则状态。
