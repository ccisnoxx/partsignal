"""清理旧版职责账号并强制既有内容工程师改密。"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_user_cleanup"
down_revision = "0009_config_center"
branch_labels = None
depends_on = None

CLEANUP_USERNAMES = (
    "product_editor",
    "product_reviewer",
    "content_reviewer",
    "analyst",
)

# 该清单冻结 0010 时点的全部非会话 users 外键，未来表结构不得反向修改历史迁移。
USER_REFERENCES = (
    ("audit_logs", "actor_id"),
    ("fact_versions", "created_by"),
    ("fact_versions", "approved_by"),
    ("fact_review_records", "actor_id"),
    ("content_tasks", "created_by"),
    ("generation_jobs", "created_by"),
    ("content_versions", "created_by"),
    ("content_review_records", "actor_id"),
    ("publication_records", "created_by"),
    ("publication_status_events", "actor_id"),
    ("geo_observations", "tested_by"),
    ("file_records", "uploader_id"),
    ("platform_types", "created_by"),
    ("platform_prompts", "updated_by"),
    ("ai_channels", "created_by"),
    ("ai_models", "created_by"),
)


def _username_statement(sql: str) -> sa.TextClause:
    """为冻结用户名集合创建可复用的展开参数语句。"""
    return sa.text(sql).bindparams(sa.bindparam("usernames", expanding=True))


def upgrade() -> None:
    """在同一事务中阻断历史引用并删除四个旧版初始化账号。"""
    bind = op.get_bind()
    locked_users = tuple(
        bind.execute(
            _username_statement(
                "SELECT username FROM users "
                "WHERE username IN :usernames ORDER BY username FOR UPDATE"
            ),
            {"usernames": CLEANUP_USERNAMES},
        ).scalars()
    )

    references: dict[str, list[str]] = {username: [] for username in locked_users}
    for table_name, column_name in USER_REFERENCES:
        matched_usernames = bind.execute(
            _username_statement(
                f"SELECT DISTINCT users.username FROM {table_name} "
                f"JOIN users ON users.id = {table_name}.{column_name} "
                "WHERE users.username IN :usernames ORDER BY users.username"
            ),
            {"usernames": CLEANUP_USERNAMES},
        ).scalars()
        for username in matched_usernames:
            references[username].append(f"{table_name}.{column_name}")

    blocked = {username: locations for username, locations in references.items() if locations}
    if blocked:
        details = "; ".join(
            f"{username}: {', '.join(locations)}"
            for username, locations in sorted(blocked.items())
        )
        raise RuntimeError(f"旧版初始化账号存在业务或审计引用，无法清理：{details}")

    bind.execute(
        _username_statement(
            "DELETE FROM sessions WHERE user_id IN "
            "(SELECT id FROM users WHERE username IN :usernames)"
        ),
        {"usernames": CLEANUP_USERNAMES},
    )
    bind.execute(
        _username_statement("DELETE FROM users WHERE username IN :usernames"),
        {"usernames": CLEANUP_USERNAMES},
    )
    bind.execute(
        sa.text(
            "UPDATE users SET must_change_password = true, revision = revision + 1 "
            "WHERE username = 'content_editor'"
        )
    )


def downgrade() -> None:
    """被删除用户的密码和身份无法安全重建，只允许恢复迁移前备份。"""
    raise RuntimeError("0010 包含不可逆账号清理；请恢复迁移前 PostgreSQL 备份")
