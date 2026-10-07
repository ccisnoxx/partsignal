"""业务测试显式选用正式生成模式，不依赖开发环境的默认配置。"""

import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def business_generation_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """仅设置运行实例；独立 Settings 构造仍检验真实配置边界。"""
    monkeypatch.setattr(settings, "content_generator", "openai-compatible")
