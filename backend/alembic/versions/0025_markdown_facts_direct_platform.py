"""将结构化产品事实收敛为 Markdown，并让内容任务直接绑定平台。"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0025_markdown_facts"
down_revision = "0024_audit_outcome"
branch_labels = None
depends_on = None

_SECTIONS = (
    (
        "reference_parts",
        "参考型号",
        ("client_key", "part_number", "manufacturer", "category"),
    ),
    (
        "parameters",
        "参数",
        (
            "client_key",
            "owner_key",
            "key",
            "name",
            "value_type",
            "min_value",
            "typical_value",
            "max_value",
            "text_value",
            "unit",
            "test_conditions",
            "is_critical",
            "evidence_keys",
        ),
    ),
    (
        "replacement_relations",
        "替代关系",
        (
            "client_key",
            "reference_part_key",
            "replacement_level",
            "conditions",
            "exclusions",
            "evidence_keys",
        ),
    ),
    (
        "evidences",
        "证据",
        (
            "client_key",
            "type",
            "title",
            "version",
            "source_url",
            "file_id",
            "confidentiality",
        ),
    ),
    (
        "claims",
        "声明",
        ("client_key", "type", "text", "evidence_keys"),
    ),
)
_SECTION_FIELDS = {name: frozenset(fields) for name, _, fields in _SECTIONS}
_CLASSIFICATION_RANK = {"PUBLIC": 0, "INTERNAL": 1, "RESTRICTED": 2}


def _json_text(value: Any) -> str:
    """用稳定 JSON 标量表达原值，避免 Markdown 符号或换行改变字段边界。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _records(snapshot: Mapping[str, Any], section: str) -> list[dict[str, Any]]:
    """读取一个冻结结构化章节，遇到未知结构时显式中止迁移。"""
    value = snapshot.get(section, [])
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise RuntimeError(f"旧事实章节 {section} 不是记录列表")
    allowed_fields = _SECTION_FIELDS[section]
    for item in value:
        unknown_fields = set(item) - allowed_fields
        if unknown_fields:
            raise RuntimeError(
                f"旧事实章节 {section} 包含无法确定渲染的字段：{sorted(unknown_fields)}"
            )
    return value


def _render_markdown(snapshot: Mapping[str, Any]) -> str:
    """按冻结章节、记录和字段顺序渲染旧事实，不总结或补充任何值。"""
    unknown_sections = set(snapshot) - _SECTION_FIELDS.keys()
    if unknown_sections:
        raise RuntimeError(f"旧事实包含无法确定渲染的章节：{sorted(unknown_sections)}")

    rendered_sections: list[str] = []
    for section, title, fields in _SECTIONS:
        records = _records(snapshot, section)
        if not records:
            continue
        records.sort(
            key=lambda item: (
                _json_text(item.get("client_key")),
                _json_text(item),
            )
        )
        lines = [f"## {title}"]
        for index, item in enumerate(records, start=1):
            lines.extend(("", f"### 记录 {index}"))
            lines.extend(
                f"- `{field}`: {_json_text(item[field])}" for field in fields if field in item
            )
        rendered_sections.append("\n".join(lines))
    return "\n\n".join(rendered_sections)


def _classification(snapshot: Mapping[str, Any]) -> str:
    """取证据中的最高限制级；缺失或未知分级一律收敛为 RESTRICTED。"""
    evidences = _records(snapshot, "evidences")
    if not evidences:
        return "RESTRICTED"
    result = "PUBLIC"
    for evidence in evidences:
        value = evidence.get("confidentiality")
        if value not in _CLASSIFICATION_RANK:
            return "RESTRICTED"
        if _CLASSIFICATION_RANK[value] > _CLASSIFICATION_RANK[result]:
            result = value
    return result


def _grouped_keys(rows: Iterable[sa.RowMapping]) -> dict[Any, list[str]]:
    """把证据关联转换为按旧 client_key 稳定排序的列表。"""
    grouped: defaultdict[Any, list[str]] = defaultdict(list)
    for row in rows:
        grouped[row["owner_id"]].append(row["client_key"])
    return {owner_id: sorted(keys) for owner_id, keys in grouped.items()}


def _workspace_snapshots(bind: sa.Connection) -> dict[Any, dict[str, list[dict[str, Any]]]]:
    """从 0024 的规范化表读取每个产品当前事实工作区。"""
    product_ids = tuple(bind.execute(sa.text("SELECT id FROM products ORDER BY id")).scalars())
    snapshots = {
        product_id: {section: [] for section in _SECTION_FIELDS} for product_id in product_ids
    }

    references = tuple(
        bind.execute(
            sa.text(
                "SELECT id, product_id, client_key, part_number, manufacturer, category "
                "FROM reference_parts ORDER BY product_id, client_key, id"
            )
        ).mappings()
    )
    reference_keys = {row["id"]: row["client_key"] for row in references}
    for row in references:
        snapshots[row["product_id"]]["reference_parts"].append(
            {
                "client_key": row["client_key"],
                "part_number": row["part_number"],
                "manufacturer": row["manufacturer"],
                "category": row["category"],
            }
        )

    evidences = tuple(
        bind.execute(
            sa.text(
                "SELECT id, product_id, client_key, type, title, version, source_url, "
                "file_record_id, confidentiality "
                "FROM evidences ORDER BY product_id, client_key, id"
            )
        ).mappings()
    )
    for row in evidences:
        snapshots[row["product_id"]]["evidences"].append(
            {
                "client_key": row["client_key"],
                "type": row["type"],
                "title": row["title"],
                "version": row["version"],
                "source_url": row["source_url"],
                "file_id": str(row["file_record_id"]) if row["file_record_id"] else None,
                "confidentiality": row["confidentiality"],
            }
        )

    parameter_evidence_keys = _grouped_keys(
        bind.execute(
            sa.text(
                "SELECT link.parameter_id AS owner_id, evidence.client_key "
                "FROM parameter_evidence_links link "
                "JOIN evidences evidence ON evidence.id = link.evidence_id "
                "ORDER BY link.parameter_id, evidence.client_key"
            )
        ).mappings()
    )
    for row in bind.execute(
        sa.text(
            "SELECT id, product_id, owner_product_id, reference_part_id, client_key, key, "
            "name, value_type, min_value, typical_value, max_value, text_value, unit, "
            "test_conditions, is_critical "
            "FROM part_parameters ORDER BY product_id, client_key, id"
        )
    ).mappings():
        owner_key = (
            "product"
            if row["owner_product_id"] is not None
            else reference_keys[row["reference_part_id"]]
        )
        snapshots[row["product_id"]]["parameters"].append(
            {
                "client_key": row["client_key"],
                "owner_key": owner_key,
                "key": row["key"],
                "name": row["name"],
                "value_type": row["value_type"],
                "min_value": row["min_value"],
                "typical_value": row["typical_value"],
                "max_value": row["max_value"],
                "text_value": row["text_value"],
                "unit": row["unit"],
                "test_conditions": row["test_conditions"],
                "is_critical": row["is_critical"],
                "evidence_keys": parameter_evidence_keys.get(row["id"], []),
            }
        )

    replacement_evidence_keys = _grouped_keys(
        bind.execute(
            sa.text(
                "SELECT link.replacement_id AS owner_id, evidence.client_key "
                "FROM replacement_evidence_links link "
                "JOIN evidences evidence ON evidence.id = link.evidence_id "
                "ORDER BY link.replacement_id, evidence.client_key"
            )
        ).mappings()
    )
    for row in bind.execute(
        sa.text(
            "SELECT id, product_id, reference_part_id, client_key, replacement_level, "
            "conditions, exclusions "
            "FROM replacement_relations ORDER BY product_id, client_key, id"
        )
    ).mappings():
        snapshots[row["product_id"]]["replacement_relations"].append(
            {
                "client_key": row["client_key"],
                "reference_part_key": reference_keys[row["reference_part_id"]],
                "replacement_level": row["replacement_level"],
                "conditions": row["conditions"],
                "exclusions": row["exclusions"],
                "evidence_keys": replacement_evidence_keys.get(row["id"], []),
            }
        )

    claim_evidence_keys = _grouped_keys(
        bind.execute(
            sa.text(
                "SELECT link.claim_id AS owner_id, evidence.client_key "
                "FROM claim_evidence_links link "
                "JOIN evidences evidence ON evidence.id = link.evidence_id "
                "ORDER BY link.claim_id, evidence.client_key"
            )
        ).mappings()
    )
    for row in bind.execute(
        sa.text(
            "SELECT id, product_id, client_key, type, text "
            "FROM fact_claims ORDER BY product_id, client_key, id"
        )
    ).mappings():
        snapshots[row["product_id"]]["claims"].append(
            {
                "client_key": row["client_key"],
                "type": row["type"],
                "text": row["text"],
                "evidence_keys": claim_evidence_keys.get(row["id"], []),
            }
        )
    return snapshots


def _reject_active_legacy_jobs(bind: sa.Connection) -> None:
    """锁住作业表，避免旧契约作业在迁移检查后继续进入运行态。"""
    bind.execute(sa.text("LOCK TABLE generation_jobs IN ACCESS EXCLUSIVE MODE"))
    active_ids = tuple(
        bind.execute(
            sa.text(
                "SELECT id FROM generation_jobs WHERE status IN ('PENDING', 'RUNNING') ORDER BY id"
            )
        ).scalars()
    )
    if active_ids:
        raise RuntimeError(
            f"0025 迁移前必须终止旧契约活动作业：{[str(job_id) for job_id in active_ids]}"
        )


def _backfill_facts(bind: sa.Connection) -> None:
    """把工作区和不可变版本逐行转换，并验证每个旧对象恰好更新一次。"""
    snapshots = _workspace_snapshots(bind)
    for product_id, snapshot in snapshots.items():
        result = bind.execute(
            sa.text(
                "UPDATE products SET facts_body_markdown = :body, "
                "facts_classification = :classification WHERE id = :id"
            ),
            {
                "id": product_id,
                "body": _render_markdown(snapshot),
                "classification": _classification(snapshot),
            },
        )
        if result.rowcount != 1:
            raise RuntimeError(f"产品事实工作区转换行数异常：{product_id}")

    versions = tuple(
        bind.execute(sa.text("SELECT id, snapshot_json FROM fact_versions ORDER BY id")).mappings()
    )
    for version in versions:
        snapshot = version["snapshot_json"]
        if not isinstance(snapshot, dict):
            raise RuntimeError(f"事实版本快照不是 JSON 对象：{version['id']}")
        try:
            body = _render_markdown(snapshot)
            classification = _classification(snapshot)
        except RuntimeError as error:
            raise RuntimeError(f"事实版本 {version['id']} 无法确定转换：{error}") from error
        result = bind.execute(
            sa.text(
                "UPDATE fact_versions SET body_markdown = :body, "
                "classification = :classification WHERE id = :id"
            ),
            {"id": version["id"], "body": body, "classification": classification},
        )
        if result.rowcount != 1:
            raise RuntimeError(f"事实版本转换行数异常：{version['id']}")

    missing = bind.execute(
        sa.text(
            "SELECT "
            "(SELECT count(*) FROM products "
            " WHERE facts_body_markdown IS NULL OR facts_classification IS NULL), "
            "(SELECT count(*) FROM fact_versions "
            " WHERE body_markdown IS NULL OR classification IS NULL)"
        )
    ).one()
    if missing != (0, 0):
        raise RuntimeError(
            f"0025 事实转换存在未回填行：products={missing[0]}；fact_versions={missing[1]}"
        )


def _backfill_task_platforms(bind: sa.Connection) -> None:
    """由旧规则版本外键唯一回填稳定平台身份，缺失时拒绝删表。"""
    bind.execute(
        sa.text(
            "UPDATE content_tasks task SET platform_profile_id = version.platform_profile_id "
            "FROM platform_profile_versions version "
            "WHERE version.id = task.platform_profile_version_id"
        )
    )
    missing_ids = tuple(
        bind.execute(
            sa.text("SELECT id FROM content_tasks WHERE platform_profile_id IS NULL ORDER BY id")
        ).scalars()
    )
    if missing_ids:
        raise RuntimeError(
            f"内容任务无法由旧规则版本回填平台：{[str(task_id) for task_id in missing_ids]}"
        )


def _replace_runtime_guards() -> None:
    """把仍引用旧事实、任务字段和规则表的数据库门禁切到 0025 契约。"""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.product_id IS DISTINCT FROM OLD.product_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
             OR NEW.classification IS DISTINCT FROM OLD.classification
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW'
             AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'CHANGES_REQUESTED'
             AND NEW.status IN ('CHANGES_REQUESTED', 'PENDING_REVIEW')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'RETIRED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid fact version transition' USING ERRCODE = '55000';
          END IF;
          IF (OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED')
             AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
               OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
            RAISE EXCEPTION 'fact approval metadata is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_validate_content_task() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM fact_versions
            WHERE id = NEW.fact_version_id
              AND product_id = NEW.product_id
              AND status = 'APPROVED'
              AND length(btrim(body_markdown)) > 0
          ) THEN
            RAISE EXCEPTION 'content task requires non-empty approved fact version'
              USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM platform_profiles
            WHERE id = NEW.platform_profile_id AND is_active = true
          ) THEN
            RAISE EXCEPTION 'content task requires active platform profile'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS content_tasks_type_guard ON content_tasks;
        DROP FUNCTION IF EXISTS partsignal_guard_content_task_type();
        CREATE FUNCTION partsignal_guard_content_task_platform() RETURNS trigger AS $$
        BEGIN
          IF NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id THEN
            RAISE EXCEPTION 'content task platform is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_tasks_platform_guard
        BEFORE UPDATE ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_platform();

        CREATE OR REPLACE FUNCTION partsignal_validate_publication_insert() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN fact_versions fv ON fv.id = cv.fact_version_id
            WHERE cv.id = NEW.content_version_id
              AND cv.status = 'APPROVED'
              AND fv.status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'publication requires approved content and fact'
              USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN content_tasks ct ON ct.id = cv.task_id
            JOIN platform_accounts pa ON pa.id = NEW.platform_account_id
            WHERE cv.id = NEW.content_version_id
              AND pa.platform_profile_id = ct.platform_profile_id
          ) THEN
            RAISE EXCEPTION 'publication account platform does not match content task'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def upgrade() -> None:
    """执行一次性前向收敛；全部检查和删表位于同一事务。"""
    bind = op.get_bind()
    _reject_active_legacy_jobs(bind)

    op.add_column(
        "products",
        sa.Column(
            "facts_body_markdown",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "facts_classification",
            sa.String(length=16),
            server_default="RESTRICTED",
            nullable=False,
        ),
    )
    op.add_column("fact_versions", sa.Column("body_markdown", sa.Text(), nullable=True))
    op.add_column(
        "fact_versions",
        sa.Column("classification", sa.String(length=16), nullable=True),
    )
    _backfill_facts(bind)
    op.alter_column("fact_versions", "body_markdown", nullable=False)
    op.alter_column("fact_versions", "classification", nullable=False)
    op.create_check_constraint(
        op.f("ck_products_facts_classification"),
        "products",
        "facts_classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
    )
    op.create_check_constraint(
        op.f("ck_fact_versions_classification"),
        "fact_versions",
        "classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
    )

    op.add_column(
        "content_tasks",
        sa.Column("platform_profile_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    _backfill_task_platforms(bind)
    op.alter_column("content_tasks", "platform_profile_id", nullable=False)
    op.create_foreign_key(
        "fk_content_tasks_platform_profile_id",
        "content_tasks",
        "platform_profiles",
        ["platform_profile_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_content_tasks_platform_profile_created_at",
        "content_tasks",
        ["platform_profile_id", "created_at"],
    )

    _replace_runtime_guards()
    op.drop_column("fact_versions", "snapshot_json")

    op.drop_index(
        "ix_content_tasks_platform_profile_version_created_at",
        table_name="content_tasks",
    )
    op.drop_constraint(
        "ck_content_tasks_generation_data_classification_complete",
        "content_tasks",
        type_="check",
    )
    op.drop_constraint(
        "ck_content_tasks_generation_data_classification",
        "content_tasks",
        type_="check",
    )
    op.drop_constraint(
        "fk_content_tasks_generation_data_classified_by_users",
        "content_tasks",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_content_tasks_platform_type_id",
        "content_tasks",
        type_="foreignkey",
    )
    for column in (
        "platform_profile_version_id",
        "platform_type_id",
        "platform_type_snapshot",
        "user_prompt_markdown",
        "generation_data_classification",
        "generation_data_classified_by",
        "generation_data_classified_at",
        "target_audience",
        "content_angle",
        "conversion_goal",
        "desired_format",
        "desired_length_min",
        "desired_length_max",
        "canonical_url",
    ):
        op.drop_column("content_tasks", column)

    for table in (
        "parameter_evidence_links",
        "replacement_evidence_links",
        "claim_evidence_links",
        "part_parameters",
        "replacement_relations",
        "fact_claims",
        "evidences",
        "reference_parts",
    ):
        op.drop_table(table)

    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_platform_version() CASCADE")
    op.drop_table("platform_profile_versions")


def downgrade() -> None:
    """已删除的结构化事实和规则版本只能从迁移前备份恢复。"""
    raise RuntimeError("0025 不支持有损降级，请恢复迁移前 PostgreSQL 备份")
