FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.7.13 /uv /uvx /bin/
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project
COPY . .
RUN uv sync --no-dev
# 迁移会导入 app 模块；整个应用目录必须从冻结源码加载，避免缓存改变实际 DDL。
RUN find /app -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete

ENV PATH="/opt/venv/bin:$PATH"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS test
RUN uv sync --all-extras
RUN find /app -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
CMD ["pytest", "tests"]

FROM runtime AS production
