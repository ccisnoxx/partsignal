"""PartSignal 领域数据的 SQLAlchemy 模型。

可编辑产品事实保持规范化；JSONB 仅用于冻结快照、版本化规则和结构化作业数据。
"""

from __future__ import annotations

import uuid


def new_uuid() -> uuid.UUID:
    """生成数据库实体 UUID。"""
    return uuid.uuid4()
