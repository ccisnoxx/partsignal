# DEF-002 内容任务列表投影修复计划

## 实施步骤

1. 完整读取后端规范、OpenAPI 内容任务合同、数据库幂等约束、投影实现和全部调用方。
2. 在共享投影职责内排除内部 `idempotency_key`，让列表和详情复用同一规则。
3. 补充列表回归测试，并确认详情及创建幂等测试覆盖保持有效。
4. 执行定向测试、相关静态检查、Trellis 质量门禁和最终差异审查。
5. 更新任务证据；获得提交确认后提交到 `main`，推送需单独授权。

## Required Validation

```sh
cd backend
uv run pytest tests -q -k "content_task and (list or detail or idempotency)"
uv run ruff check app/services/projections.py tests
uv run mypy app/services/projections.py
```

若仓库使用的现有脚本或测试命名与上述过滤不匹配，以读到的项目规范和最小相关
测试命令替换，并在任务证据中记录实际命令。

## Optional Validation

```sh
cd backend
uv run pytest -q
```

完整后端测试用于共享投影的额外回归信心；若耗时或环境依赖使其不适合作为必需门禁，
记录跳过原因和剩余风险。

## 完成条件

全部验收标准有证据，任务状态可提交；父发布任务保持未完成，直到修复推送并重新部署。
