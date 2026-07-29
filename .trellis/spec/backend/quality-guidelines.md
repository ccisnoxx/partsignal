# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

### Starlette TestClient 依赖

- 当前 Starlette TestClient 优先导入 `httpx2`；业务 HTTP 调用继续使用 `httpx`，测试 extra 单独声明 `httpx2>=2,<3`。不得删除业务依赖或用 warning filter 掩盖旧客户端回退。
- 修改 TestClient 相关依赖后必须更新 `backend/uv.lock`，重建 `backend-test` 镜像，并运行实际发起请求的轻量测试。

```bash
UV_CACHE_DIR=.cache/uv uv lock --project backend --check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py backend/tests/unit/test_request_context.py
```

验证要求：测试通过且输出中没有 `Using httpx with starlette.testclient is deprecated`。

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
