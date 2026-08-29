#!/usr/bin/env python3
"""生成并比较 0043 snapshot 的非敏感聚合 profile。"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, NoReturn, Protocol, cast

import psycopg
from psycopg import IsolationLevel, sql


EXPECTED_REVISION = "0043_geo_platform_identity"
EXPECTED_SCHEMA_SHA256 = (
    "90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a"
)
EXPECTED_SANITIZER_SHA256 = (
    "124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d"
)
EXPECTED_MATRIX_SHA256 = (
    "71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6"
)
SANITIZER_COMMIT = "217d011c"
PROFILE_SHAPE_VERSION = "production-snapshot-profile-v1"
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
SNAPSHOT_ID = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$")

TASK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
ARCHIVED_RESEARCH = (
    REPO_ROOT
    / ".trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research"
)
SANITIZER_PATH = ARCHIVED_RESEARCH / "sanitize_snapshot.py"
MATRIX_PATH = ARCHIVED_RESEARCH / "sanitization-matrix.md"


class ProfileError(RuntimeError):
    """表示 profile 输入、数据库或比较结果不满足固定合同。"""


class SafeArgumentParser(argparse.ArgumentParser):
    """将参数错误收敛到不回显原始参数的统一安全边界。"""

    def error(self, message: str) -> NoReturn:
        raise ProfileError("CLI 参数不满足固定合同")


class SanitizerModule(Protocol):
    EXPECTED_REVISION: str
    EXPECTED_SCHEMA_SHA256: str
    RULES: dict[tuple[str, str], str]

    def _validate_schema(
        self, connection: psycopg.Connection[tuple[object, ...]]
    ) -> str: ...

    def _columns(
        self, connection: psycopg.Connection[tuple[object, ...]]
    ) -> list[tuple[object, ...]]: ...


TABLES = (
    "ai_channel_headers",
    "ai_channels",
    "ai_models",
    "audit_logs",
    "content_humanization_prompts",
    "content_review_records",
    "content_task_geo_sources",
    "content_tasks",
    "content_versions",
    "fact_review_records",
    "fact_versions",
    "file_records",
    "generation_jobs",
    "geo_observation_attachments",
    "geo_observation_citations",
    "geo_observation_publications",
    "geo_observations",
    "platform_accounts",
    "platform_profiles",
    "platform_prompts",
    "platform_types",
    "products",
    "publication_attachments",
    "publication_verifications",
    "publication_work_events",
    "publication_works",
    "published_articles",
    "published_content_issues",
    "query_topics",
    "sessions",
    "users",
)

FOREIGN_KEYS = (
    ("ai_channel_headers", "channel_id", "ai_channels", "id"),
    ("ai_channels", "created_by", "users", "id"),
    ("ai_models", "channel_id", "ai_channels", "id"),
    ("ai_models", "created_by", "users", "id"),
    ("audit_logs", "actor_id", "users", "id"),
    ("content_humanization_prompts", "updated_by", "users", "id"),
    ("content_review_records", "content_version_id", "content_versions", "id"),
    ("content_review_records", "actor_id", "users", "id"),
    ("content_task_geo_sources", "content_task_id", "content_tasks", "id"),
    ("content_task_geo_sources", "published_article_id", "published_articles", "id"),
    ("content_task_geo_sources", "query_topic_id", "query_topics", "id"),
    ("content_task_geo_sources", "created_by", "users", "id"),
    ("content_tasks", "query_topic_id", "query_topics", "id"),
    ("content_tasks", "product_id", "products", "id"),
    ("content_tasks", "fact_version_id", "fact_versions", "id"),
    ("content_tasks", "current_content_version_id", "content_versions", "id"),
    ("content_tasks", "platform_profile_id", "platform_profiles", "id"),
    (
        "content_tasks",
        "source_published_content_issue_id",
        "published_content_issues",
        "id",
    ),
    ("content_tasks", "created_by", "users", "id"),
    ("content_versions", "task_id", "content_tasks", "id"),
    ("content_versions", "fact_version_id", "fact_versions", "id"),
    ("content_versions", "source_job_id", "generation_jobs", "id"),
    ("content_versions", "based_on_id", "content_versions", "id"),
    ("content_versions", "created_by", "users", "id"),
    ("fact_review_records", "fact_version_id", "fact_versions", "id"),
    ("fact_review_records", "actor_id", "users", "id"),
    ("fact_versions", "product_id", "products", "id"),
    ("fact_versions", "created_by", "users", "id"),
    ("fact_versions", "approved_by", "users", "id"),
    ("file_records", "uploader_id", "users", "id"),
    ("generation_jobs", "content_task_id", "content_tasks", "id"),
    ("generation_jobs", "source_content_version_id", "content_versions", "id"),
    ("generation_jobs", "ai_channel_id", "ai_channels", "id"),
    ("generation_jobs", "ai_model_id", "ai_models", "id"),
    ("generation_jobs", "content_version_id", "content_versions", "id"),
    ("generation_jobs", "retry_of_id", "generation_jobs", "id"),
    ("generation_jobs", "created_by", "users", "id"),
    ("geo_observation_attachments", "observation_id", "geo_observations", "id"),
    ("geo_observation_attachments", "file_id", "file_records", "id"),
    ("geo_observation_citations", "observation_id", "geo_observations", "id"),
    ("geo_observation_citations", "published_article_id", "published_articles", "id"),
    ("geo_observation_publications", "observation_id", "geo_observations", "id"),
    (
        "geo_observation_publications",
        "published_article_id",
        "published_articles",
        "id",
    ),
    ("geo_observations", "query_topic_id", "query_topics", "id"),
    ("geo_observations", "product_id", "products", "id"),
    ("geo_observations", "supersedes_id", "geo_observations", "id"),
    ("geo_observations", "tested_by", "users", "id"),
    ("platform_accounts", "platform_profile_id", "platform_profiles", "id"),
    ("platform_profiles", "platform_type_id", "platform_types", "id"),
    ("platform_profiles", "platform_prompt_id", "platform_prompts", "id"),
    ("platform_profiles", "logo_file_id", "file_records", "id"),
    ("platform_prompts", "updated_by", "users", "id"),
    ("platform_types", "created_by", "users", "id"),
    ("publication_attachments", "publication_work_id", "publication_works", "id"),
    ("publication_attachments", "file_id", "file_records", "id"),
    ("publication_verifications", "publication_work_id", "publication_works", "id"),
    ("publication_verifications", "content_version_id", "content_versions", "id"),
    ("publication_verifications", "actor_id", "users", "id"),
    ("publication_work_events", "publication_work_id", "publication_works", "id"),
    ("publication_work_events", "from_content_version_id", "content_versions", "id"),
    ("publication_work_events", "to_content_version_id", "content_versions", "id"),
    ("publication_work_events", "actor_id", "users", "id"),
    ("publication_works", "content_task_id", "content_tasks", "id"),
    ("publication_works", "content_version_id", "content_versions", "id"),
    ("publication_works", "platform_profile_id", "platform_profiles", "id"),
    ("publication_works", "platform_account_id", "platform_accounts", "id"),
    ("publication_works", "closed_by", "users", "id"),
    ("publication_works", "created_by", "users", "id"),
    ("published_articles", "id", "publication_works", "id"),
    ("published_articles", "verification_id", "publication_verifications", "id"),
    ("published_content_issues", "published_article_id", "published_articles", "id"),
    ("published_content_issues", "opened_by", "users", "id"),
    ("published_content_issues", "resolved_by", "users", "id"),
    ("sessions", "user_id", "users", "id"),
)

REVISION_COLUMNS = (
    ("ai_channels", "revision"),
    ("ai_models", "revision"),
    ("content_humanization_prompts", "revision"),
    ("content_tasks", "revision"),
    ("content_versions", "revision"),
    ("fact_versions", "revision"),
    ("platform_accounts", "revision"),
    ("platform_profiles", "revision"),
    ("platform_prompts", "revision"),
    ("platform_types", "revision"),
    ("products", "revision"),
    ("products", "facts_revision"),
    ("publication_works", "revision"),
    ("published_content_issues", "revision"),
    ("query_topics", "revision"),
    ("users", "revision"),
)

TIME_COLUMNS = (
    ("ai_channels", "api_key_updated_at"),
    ("ai_channels", "created_at"),
    ("ai_channels", "updated_at"),
    ("ai_models", "last_tested_at"),
    ("ai_models", "created_at"),
    ("ai_models", "updated_at"),
    ("audit_logs", "created_at"),
    ("content_humanization_prompts", "created_at"),
    ("content_humanization_prompts", "updated_at"),
    ("content_review_records", "created_at"),
    ("content_task_geo_sources", "date_from"),
    ("content_task_geo_sources", "date_to"),
    ("content_task_geo_sources", "created_at"),
    ("content_tasks", "created_at"),
    ("content_tasks", "updated_at"),
    ("content_tasks", "archived_at"),
    ("content_versions", "created_at"),
    ("content_versions", "updated_at"),
    ("fact_review_records", "created_at"),
    ("fact_versions", "created_at"),
    ("fact_versions", "approved_at"),
    ("file_records", "upload_expires_at"),
    ("file_records", "created_at"),
    ("file_records", "verified_at"),
    ("file_records", "cleanup_after"),
    ("file_records", "deleted_at"),
    ("generation_jobs", "last_dispatch_attempt_at"),
    ("generation_jobs", "created_at"),
    ("generation_jobs", "started_at"),
    ("generation_jobs", "lease_expires_at"),
    ("generation_jobs", "finished_at"),
    ("geo_observations", "tested_at"),
    ("geo_observations", "created_at"),
    ("platform_prompts", "created_at"),
    ("platform_prompts", "updated_at"),
    ("platform_types", "created_at"),
    ("platform_types", "updated_at"),
    ("products", "created_at"),
    ("products", "updated_at"),
    ("publication_verifications", "published_at_snapshot"),
    ("publication_verifications", "created_at"),
    ("publication_work_events", "created_at"),
    ("publication_works", "published_at"),
    ("publication_works", "closed_at"),
    ("publication_works", "created_at"),
    ("publication_works", "updated_at"),
    ("published_content_issues", "opened_at"),
    ("published_content_issues", "resolved_at"),
    ("query_topics", "created_at"),
    ("sessions", "expires_at"),
    ("sessions", "revoked_at"),
    ("sessions", "created_at"),
    ("sessions", "last_seen_at"),
    ("users", "created_at"),
)

BOOLEAN_COLUMNS = (
    ("ai_channel_headers", "is_sensitive"),
    ("ai_channels", "is_enabled"),
    ("ai_models", "is_enabled"),
    ("geo_observation_publications", "discovered"),
    ("geo_observation_publications", "mentioned"),
    ("geo_observations", "web_search_enabled"),
    ("geo_observations", "mentioned"),
    ("platform_accounts", "is_active"),
    ("platform_profiles", "is_active"),
    ("users", "is_active"),
    ("users", "must_change_password"),
)

VALUE_COLUMNS: dict[tuple[str, str], tuple[str, ...]] = {
    ("ai_channels", "protocol_type"): ("openai-compatible-chat-completions",),
    ("ai_channels", "provider_brand"): (
        "OPENAI",
        "ANTHROPIC",
        "GOOGLE",
        "AZURE_OPENAI",
        "ZHIPU",
        "QWEN",
        "CUSTOM",
    ),
    ("ai_models", "test_status"): ("UNTESTED", "PASSED", "FAILED"),
    ("audit_logs", "business_module"): (
        "IDENTITY",
        "PRODUCT_FACTS",
        "CONTENT_PLANNING",
        "CONTENT_PRODUCTION",
        "CONTENT_REVIEW",
        "PUBLICATION",
        "GEO_OBSERVATION",
        "CONFIGURATION",
        "FILE_MANAGEMENT",
    ),
    ("audit_logs", "outcome"): ("SUCCESS", "FAILED", "DENIED"),
    ("content_review_records", "action"): (
        "submit-review",
        "approve",
        "request-changes",
    ),
    ("content_task_geo_sources", "rule_code"): (
        "CONTENT_DECLINE",
        "LONG_UNMENTIONED",
        "QUESTION_COVERAGE_GAP",
    ),
    ("content_tasks", "status"): ("OPEN", "COMPLETED", "CANCELLED"),
    ("content_versions", "source_type"): ("AI", "HUMAN"),
    ("content_versions", "status"): (
        "DRAFT",
        "PENDING_REVIEW",
        "CHANGES_REQUESTED",
        "APPROVED",
        "SUPERSEDED",
        "ABANDONED",
    ),
    ("fact_review_records", "action"): (
        "submit-review",
        "approve",
        "request-changes",
        "retire",
    ),
    ("fact_versions", "status"): (
        "PENDING_REVIEW",
        "CHANGES_REQUESTED",
        "APPROVED",
        "RETIRED",
    ),
    ("fact_versions", "classification"): ("PUBLIC", "INTERNAL", "RESTRICTED"),
    ("file_records", "category"): (
        "EVIDENCE",
        "OPERATION_SCREENSHOT",
        "PUBLICATION_ASSET",
        "PLATFORM_LOGO",
    ),
    ("file_records", "content_type"): (
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "text/plain",
    ),
    ("file_records", "access_level"): ("PUBLIC", "INTERNAL", "RESTRICTED"),
    ("file_records", "status"): (
        "PENDING",
        "VERIFIED",
        "FAILED",
        "ABORTED",
        "DELETING",
        "DELETED",
    ),
    ("generation_jobs", "job_type"): ("GENERATE", "HUMANIZE"),
    ("generation_jobs", "status"): ("PENDING", "RUNNING", "SUCCEEDED", "FAILED"),
    ("geo_observation_citations", "source_type"): (
        "OFFICIAL",
        "EXTERNAL_COMPANY",
        "OTHER",
    ),
    ("geo_observation_publications", "accuracy"): (
        "ACCURATE",
        "PARTIAL",
        "INCORRECT",
        "UNJUDGEABLE",
    ),
    ("geo_observations", "observation_kind"): (
        "LEGACY_MODEL_RESULT",
        "MANUAL_ARTICLE_SEARCH",
    ),
    ("geo_observations", "recommendation"): ("NONE", "CANDIDATE", "RECOMMENDED"),
    ("geo_observations", "accuracy"): (
        "ACCURATE",
        "PARTIAL",
        "INCORRECT",
        "UNJUDGEABLE",
    ),
    ("products", "status"): ("ACTIVE", "RETIRED"),
    ("products", "facts_classification"): ("PUBLIC", "INTERNAL", "RESTRICTED"),
    ("publication_verifications", "outcome"): ("PASSED", "FAILED"),
    ("publication_work_events", "from_status"): (
        "PREPARING",
        "PLATFORM_REVIEW",
        "AWAITING_VERIFICATION",
        "ACTION_REQUIRED",
        "COMPLETED",
        "CLOSED",
    ),
    ("publication_work_events", "to_status"): (
        "PREPARING",
        "PLATFORM_REVIEW",
        "AWAITING_VERIFICATION",
        "ACTION_REQUIRED",
        "COMPLETED",
        "CLOSED",
    ),
    ("publication_works", "status"): (
        "PREPARING",
        "PLATFORM_REVIEW",
        "AWAITING_VERIFICATION",
        "ACTION_REQUIRED",
        "COMPLETED",
        "CLOSED",
    ),
    ("publication_works", "close_reason"): (
        "PLATFORM_REJECTED",
        "BUSINESS_CANCELLED",
        "OTHER",
    ),
    ("published_content_issues", "kind"): (
        "PAGE_UNAVAILABLE",
        "CONTENT_CHANGED",
        "OTHER",
    ),
    ("published_content_issues", "status"): ("OPEN", "RESOLVED"),
    ("published_content_issues", "resolution_outcome"): ("RESTORED", "RETIRED"),
    ("query_topics", "intent_type"): (
        "BRAND",
        "PRODUCT",
        "REPLACEMENT",
        "COMPARISON",
        "APPLICATION",
        "TROUBLESHOOTING",
    ),
    ("users", "account_type"): ("ADMIN", "ENGINEER"),
}

RELATIONSHIP_KEYS = tuple(
    f"{child}.{column}->{parent}.{parent_column}"
    for child, column, parent, parent_column in FOREIGN_KEYS
)
REVISION_KEYS = tuple(f"{table}.{column}" for table, column in REVISION_COLUMNS)
TIME_KEYS = tuple(f"{table}.{column}" for table, column in TIME_COLUMNS)
BOOLEAN_KEYS = tuple(f"{table}.{column}" for table, column in BOOLEAN_COLUMNS)
VALUE_KEYS = tuple(f"{table}.{column}" for table, column in VALUE_COLUMNS)
LENGTH_BUCKET_KEYS = ("empty", "xs", "sm", "md", "lg")
RELATIONSHIP_METRICS = (
    "child_rows",
    "linked_rows",
    "orphan_rows",
    "orphan_free",
    "parent_rows",
    "parents_with_children",
    "fanout_min",
    "fanout_max",
    "fanout_p50",
    "fanout_p95",
)
FILE_SIZE_BUCKETS = ("empty", "lt_1k", "lt_1m", "lt_10m", "le_50m", "gt_50m")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_artifacts() -> dict[str, str]:
    script_sha256 = _sha256(SANITIZER_PATH)
    matrix_sha256 = _sha256(MATRIX_PATH)
    if (
        script_sha256 != EXPECTED_SANITIZER_SHA256
        or matrix_sha256 != EXPECTED_MATRIX_SHA256
    ):
        raise ProfileError("归档 sanitizer artifact checksum 漂移")
    return {
        "sanitizer_commit": SANITIZER_COMMIT,
        "sanitizer_sha256": script_sha256,
        "matrix_sha256": matrix_sha256,
    }


def _load_sanitizer() -> SanitizerModule:
    _verify_artifacts()
    spec = importlib.util.spec_from_file_location(
        "partsignal_archived_sanitizer", SANITIZER_PATH
    )
    if spec is None or spec.loader is None:
        raise ProfileError("无法加载归档 sanitizer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    loaded = cast(SanitizerModule, module)
    if (
        loaded.EXPECTED_REVISION != EXPECTED_REVISION
        or loaded.EXPECTED_SCHEMA_SHA256 != EXPECTED_SCHEMA_SHA256
    ):
        raise ProfileError("归档 sanitizer schema identity 漂移")
    return loaded


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ProfileError("缺少必需的仓库外执行参数")
    return value


def _run_id() -> str:
    value = _required_env("PROFILE_RUN_ID")
    if RUN_ID.fullmatch(value) is None:
        raise ProfileError("run ID 不满足固定格式")
    return value


def _database_target(stage: str, run_id: str) -> tuple[str, str | None]:
    if stage == "source":
        return "SOURCE_DATABASE_URL", _required_env("SOURCE_EXPECTED_DATABASE")
    if stage in {"raw-quarantine", "sanitized-quarantine"}:
        return "QUARANTINE_DATABASE_URL", f"quarantine_{run_id}"
    if stage == "fresh-verify":
        return "VERIFY_DATABASE_URL", f"verify_{run_id}"
    raise AssertionError("未知 profile stage")


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _key(table: str, column: str) -> str:
    return f"{table}.{column}"


def _row(
    connection: psycopg.Connection[tuple[object, ...]], query: sql.SQL | sql.Composed
) -> tuple[Any, ...]:
    row = connection.execute(query).fetchone()
    if row is None:
        raise ProfileError("聚合查询缺少预期结果")
    return tuple(row)


def _integer(value: object) -> int:
    if not isinstance(value, int):
        raise ProfileError("聚合查询返回类型漂移")
    return value


def _table_counts(connection: psycopg.Connection[tuple[object, ...]]) -> dict[str, int]:
    return {
        table: int(
            _row(
                connection,
                sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)),
            )[0]
        )
        for table in TABLES
    }


def _relationship_profile(
    connection: psycopg.Connection[tuple[object, ...]],
    child: str,
    column: str,
    parent: str,
    parent_column: str,
) -> dict[str, int | bool]:
    query = sql.SQL(
        """
        WITH fanout AS (
          SELECT parent.{parent_column} AS parent_key, count(child.{child_column})::bigint AS n
            FROM {parent} parent
            LEFT JOIN {child} child ON child.{child_column} = parent.{parent_column}
           GROUP BY parent.{parent_column}
        )
        SELECT
          (SELECT count(*) FROM {child}),
          (SELECT count(*) FROM {child} WHERE {child_column} IS NOT NULL),
          (SELECT count(*) FROM {child} child
            WHERE child.{child_column} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM {parent} parent
                 WHERE parent.{parent_column} = child.{child_column}
              )),
          (SELECT count(*) FROM {parent}),
          count(*) FILTER (WHERE n > 0),
          coalesce(min(n), 0),
          coalesce(max(n), 0),
          coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY n), 0),
          coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY n), 0)
        FROM fanout
        """
    ).format(
        child=sql.Identifier(child),
        child_column=sql.Identifier(column),
        parent=sql.Identifier(parent),
        parent_column=sql.Identifier(parent_column),
    )
    values = tuple(int(value) for value in _row(connection, query))
    return {
        "child_rows": values[0],
        "linked_rows": values[1],
        "orphan_rows": values[2],
        "orphan_free": values[2] == 0,
        "parent_rows": values[3],
        "parents_with_children": values[4],
        "fanout_min": values[5],
        "fanout_max": values[6],
        "fanout_p50": values[7],
        "fanout_p95": values[8],
    }


def _value_distribution(
    connection: psycopg.Connection[tuple[object, ...]],
    table: str,
    column: str,
    allowed: tuple[str, ...],
) -> dict[str, int]:
    query = sql.SQL("SELECT {}::text, count(*) FROM {} GROUP BY 1").format(
        sql.Identifier(column), sql.Identifier(table)
    )
    result = {value: 0 for value in (*allowed, "null")}
    for raw_value, raw_count in connection.execute(query).fetchall():
        value = "null" if raw_value is None else str(raw_value)
        if value not in result:
            raise ProfileError("登记机器值发生漂移")
        result[value] = _integer(raw_count)
    return result


def _boolean_distribution(
    connection: psycopg.Connection[tuple[object, ...]], table: str, column: str
) -> dict[str, int]:
    query = sql.SQL(
        "SELECT count(*) FILTER (WHERE {column} IS FALSE), "
        "count(*) FILTER (WHERE {column} IS TRUE), "
        "count(*) FILTER (WHERE {column} IS NULL) FROM {table}"
    ).format(column=sql.Identifier(column), table=sql.Identifier(table))
    false_count, true_count, null_count = _row(connection, query)
    return {"false": int(false_count), "true": int(true_count), "null": int(null_count)}


def _revision_distribution(
    connection: psycopg.Connection[tuple[object, ...]], table: str, column: str
) -> list[dict[str, int]]:
    query = sql.SQL("SELECT {}, count(*) FROM {} GROUP BY 1 ORDER BY 1").format(
        sql.Identifier(column), sql.Identifier(table)
    )
    result: list[dict[str, int]] = []
    for raw_value, raw_count in connection.execute(query).fetchall():
        if not isinstance(raw_value, int) or raw_value < 0:
            raise ProfileError("revision 分布包含非法值")
        result.append({"value": raw_value, "count": _integer(raw_count)})
    return result


def _safe_time(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    raise ProfileError("时间聚合返回类型漂移")


def _time_range(
    connection: psycopg.Connection[tuple[object, ...]], table: str, column: str
) -> dict[str, int | str | None]:
    query = sql.SQL(
        "SELECT count(*) FILTER (WHERE {column} IS NULL), min({column}), max({column}) "
        "FROM {table}"
    ).format(column=sql.Identifier(column), table=sql.Identifier(table))
    null_count, minimum, maximum = _row(connection, query)
    return {
        "null_count": int(null_count),
        "min": _safe_time(minimum),
        "max": _safe_time(maximum),
    }


def _length_select(value: sql.Composable, *, null_rows: sql.Composable) -> sql.Composed:
    return sql.SQL(
        "SELECT {null_rows}, count({value}), "
        "count(*) FILTER (WHERE length({value}) = 0), "
        "count(*) FILTER (WHERE length({value}) BETWEEN 1 AND 32), "
        "count(*) FILTER (WHERE length({value}) BETWEEN 33 AND 128), "
        "count(*) FILTER (WHERE length({value}) BETWEEN 129 AND 512), "
        "count(*) FILTER (WHERE length({value}) > 512)"
    ).format(null_rows=null_rows, value=value)


def _length_profile(
    connection: psycopg.Connection[tuple[object, ...]],
    table: str,
    column: str,
    type_name: str,
) -> dict[str, int]:
    identifier = sql.Identifier(column)
    table_identifier = sql.Identifier(table)
    if type_name in {"json", "jsonb"}:
        query = (
            sql.SQL(
                """
            WITH strings AS (
              SELECT string_value #>> '{{}}' AS value
                FROM {table}
                CROSS JOIN LATERAL jsonb_path_query(
                  {column}::jsonb,
                  'strict $.** ? (@.type() == "string")'
                ) AS string_value
            )
            """
            ).format(column=identifier, table=table_identifier)
            + _length_select(
                sql.Identifier("value"),
                null_rows=sql.SQL("(SELECT count(*) FROM {} WHERE {} IS NULL)").format(
                    table_identifier, identifier
                ),
            )
            + sql.SQL(" FROM strings")
        )
    elif type_name.endswith("[]"):
        query = (
            sql.SQL(
                "WITH strings AS (SELECT unnest({column}) AS value FROM {table}) "
            ).format(column=identifier, table=table_identifier)
            + _length_select(
                sql.Identifier("value"),
                null_rows=sql.SQL("(SELECT count(*) FROM {} WHERE {} IS NULL)").format(
                    table_identifier, identifier
                ),
            )
            + sql.SQL(" FROM strings")
        )
    else:
        query = _length_select(
            identifier,
            null_rows=sql.SQL("count(*) FILTER (WHERE {} IS NULL)").format(identifier),
        ) + sql.SQL(" FROM {} ").format(table_identifier)
    null_rows, values, empty, xs, sm, md, lg = _row(connection, query)
    return {
        "null_rows": int(null_rows),
        "values": int(values),
        "empty": int(empty),
        "xs": int(xs),
        "sm": int(sm),
        "md": int(md),
        "lg": int(lg),
    }


def _file_size_profile(
    connection: psycopg.Connection[tuple[object, ...]],
) -> dict[str, int]:
    query = sql.SQL(
        """
        SELECT count(*) FILTER (WHERE size = 0),
               count(*) FILTER (WHERE size BETWEEN 1 AND 1023),
               count(*) FILTER (WHERE size BETWEEN 1024 AND 1048575),
               count(*) FILTER (WHERE size BETWEEN 1048576 AND 10485759),
               count(*) FILTER (WHERE size BETWEEN 10485760 AND 52428800),
               count(*) FILTER (WHERE size > 52428800),
               count(*) FILTER (WHERE size < 0)
          FROM file_records
        """
    )
    *counts, negative = (int(value) for value in _row(connection, query))
    if negative:
        raise ProfileError("file size 包含非法值")
    return dict(zip(FILE_SIZE_BUCKETS, counts, strict=True))


def _build_profile(
    connection: psycopg.Connection[tuple[object, ...]], sanitizer: SanitizerModule
) -> dict[str, object]:
    column_types = {
        (str(table), str(column)): str(type_name)
        for table, _position, column, type_name, _not_null in sanitizer._columns(
            connection
        )
    }
    rules = sanitizer.RULES
    length_fields = sorted(key for key, action in rules.items() if action != "preserve")
    return {
        "table_counts": _table_counts(connection),
        "relationships": {
            relationship_key: _relationship_profile(connection, *foreign_key)
            for relationship_key, foreign_key in zip(
                RELATIONSHIP_KEYS, FOREIGN_KEYS, strict=True
            )
        },
        "value_distributions": {
            _key(table, column): _value_distribution(connection, table, column, allowed)
            for (table, column), allowed in VALUE_COLUMNS.items()
        },
        "boolean_distributions": {
            _key(table, column): _boolean_distribution(connection, table, column)
            for table, column in BOOLEAN_COLUMNS
        },
        "revision_distributions": {
            _key(table, column): _revision_distribution(connection, table, column)
            for table, column in REVISION_COLUMNS
        },
        "timestamp_ranges": {
            _key(table, column): _time_range(connection, table, column)
            for table, column in TIME_COLUMNS
        },
        "length_buckets": {
            _key(table, column): _length_profile(
                connection, table, column, column_types[(table, column)]
            )
            for table, column in length_fields
        },
        "file_size_buckets": _file_size_profile(connection),
    }


def _profile(stage: str) -> dict[str, object]:
    sanitizer = _load_sanitizer()
    artifacts = _verify_artifacts()
    run_id = _run_id()
    variable, expected_database = _database_target(stage, run_id)
    snapshot_id = _required_env("SOURCE_SNAPSHOT_ID") if stage == "source" else None
    if snapshot_id is not None and SNAPSHOT_ID.fullmatch(snapshot_id) is None:
        raise ProfileError("source snapshot identity 格式非法")

    with psycopg.connect(
        _psycopg_url(_required_env(variable)), autocommit=True
    ) as connection:
        if connection.info.dbname != expected_database:
            raise ProfileError("database identity 与批准目标不一致")
        default_read_only = str(
            _row(connection, sql.SQL("SHOW default_transaction_read_only"))[0]
        )
        if stage == "source" and default_read_only != "on":
            raise ProfileError(
                "production session 未由外部强制 default_transaction_read_only=on"
            )
        connection.autocommit = False
        connection.read_only = True
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
        with connection.transaction():
            if snapshot_id is not None:
                connection.execute(
                    sql.SQL("SET TRANSACTION SNAPSHOT {}").format(
                        sql.Literal(snapshot_id)
                    )
                )
            transaction_read_only = str(
                _row(connection, sql.SQL("SHOW transaction_read_only"))[0]
            )
            transaction_isolation = str(
                _row(connection, sql.SQL("SHOW transaction_isolation"))[0]
            )
            if (
                transaction_read_only != "on"
                or transaction_isolation != "repeatable read"
            ):
                raise ProfileError("profile transaction 未满足只读 snapshot 合同")
            signature = sanitizer._validate_schema(connection)
            profile = _build_profile(connection, sanitizer)

    document: dict[str, object] = {
        "command": "profile",
        "status": "passed",
        "shape_version": PROFILE_SHAPE_VERSION,
        "stage": stage,
        "run_id": run_id,
        "schema_revision": EXPECTED_REVISION,
        "schema_signature": signature,
        "snapshot_bound": snapshot_id is not None,
        "default_transaction_read_only": default_read_only == "on",
        "transaction_read_only": True,
        "transaction_isolation": "repeatable read",
        "object_payload_copied": 0,
        "artifacts": artifacts,
        "profile_contract_sha256": _sha256(Path(__file__)),
        "profile": profile,
    }
    return _validate_document(document, stage, sanitizer)


def _expect_keys(
    value: object, expected: Sequence[str], label: str
) -> Mapping[str, object]:
    if not isinstance(value, Mapping) or set(value) != set(expected):
        raise ProfileError(f"{label} output shape 漂移")
    return cast(Mapping[str, object], value)


def _expect_count_mapping(value: object, expected: Sequence[str], label: str) -> None:
    mapping = _expect_keys(value, expected, label)
    if any(type(item) is not int or item < 0 for item in mapping.values()):
        raise ProfileError(f"{label} 聚合值非法")


def _length_fields(sanitizer: SanitizerModule) -> tuple[str, ...]:
    return tuple(
        _key(table, column)
        for (table, column), action in sorted(sanitizer.RULES.items())
        if action != "preserve"
    )


def _validate_document(
    document: object, stage: str, sanitizer: SanitizerModule
) -> dict[str, object]:
    top = _expect_keys(
        document,
        (
            "command",
            "status",
            "shape_version",
            "stage",
            "run_id",
            "schema_revision",
            "schema_signature",
            "snapshot_bound",
            "default_transaction_read_only",
            "transaction_read_only",
            "transaction_isolation",
            "object_payload_copied",
            "artifacts",
            "profile_contract_sha256",
            "profile",
        ),
        "profile",
    )
    if (
        top["command"] != "profile"
        or top["status"] != "passed"
        or top["shape_version"] != PROFILE_SHAPE_VERSION
        or top["stage"] != stage
        or top["schema_revision"] != EXPECTED_REVISION
        or top["schema_signature"] != EXPECTED_SCHEMA_SHA256
        or top["transaction_read_only"] is not True
        or top["transaction_isolation"] != "repeatable read"
        or type(top["object_payload_copied"]) is not int
        or top["object_payload_copied"] != 0
    ):
        raise ProfileError("profile identity 或只读结论不满足合同")
    if stage == "source" and (
        top["snapshot_bound"] is not True
        or top["default_transaction_read_only"] is not True
    ):
        raise ProfileError("source profile 未绑定外部只读 snapshot")
    if stage != "source" and top["snapshot_bound"] is not False:
        raise ProfileError("非 source profile 不得声明 imported snapshot")
    if not isinstance(top["run_id"], str) or RUN_ID.fullmatch(top["run_id"]) is None:
        raise ProfileError("profile run ID 非法")
    if top["profile_contract_sha256"] != _sha256(Path(__file__)):
        raise ProfileError("profile contract checksum 非法")
    artifacts = _expect_keys(
        top["artifacts"],
        ("sanitizer_commit", "sanitizer_sha256", "matrix_sha256"),
        "artifacts",
    )
    if artifacts != _verify_artifacts():
        raise ProfileError("profile artifact identity 漂移")

    profile = _expect_keys(
        top["profile"],
        (
            "table_counts",
            "relationships",
            "value_distributions",
            "boolean_distributions",
            "revision_distributions",
            "timestamp_ranges",
            "length_buckets",
            "file_size_buckets",
        ),
        "profile body",
    )
    _expect_count_mapping(profile["table_counts"], TABLES, "table_counts")
    relationships = _expect_keys(
        profile["relationships"], RELATIONSHIP_KEYS, "relationships"
    )
    for key, metrics in relationships.items():
        metric_mapping = _expect_keys(
            metrics, RELATIONSHIP_METRICS, f"relationship {key}"
        )
        if type(metric_mapping["orphan_free"]) is not bool or any(
            type(value) is not int or value < 0
            for name, value in metric_mapping.items()
            if name != "orphan_free"
        ):
            raise ProfileError("relationship 聚合值非法")
    values = _expect_keys(
        profile["value_distributions"], VALUE_KEYS, "value_distributions"
    )
    for (table, column), allowed in VALUE_COLUMNS.items():
        _expect_count_mapping(
            values[_key(table, column)], (*allowed, "null"), _key(table, column)
        )
    booleans = _expect_keys(
        profile["boolean_distributions"], BOOLEAN_KEYS, "boolean_distributions"
    )
    for key, distribution in booleans.items():
        _expect_count_mapping(distribution, ("false", "true", "null"), key)
    revisions = _expect_keys(
        profile["revision_distributions"], REVISION_KEYS, "revisions"
    )
    for key, distribution in revisions.items():
        if not isinstance(distribution, list) or any(
            not isinstance(item, Mapping)
            or set(item) != {"value", "count"}
            or type(item["value"]) is not int
            or type(item["count"]) is not int
            or item["value"] < 0
            or item["count"] < 0
            for item in distribution
        ):
            raise ProfileError(f"{key} revision output shape 漂移")
    times = _expect_keys(profile["timestamp_ranges"], TIME_KEYS, "timestamp_ranges")
    for key, value in times.items():
        time_range = _expect_keys(value, ("null_count", "min", "max"), key)
        if type(time_range["null_count"]) is not int or time_range["null_count"] < 0:
            raise ProfileError("timestamp 聚合值非法")
        if any(
            item is not None and not isinstance(item, str)
            for item in (time_range["min"], time_range["max"])
        ):
            raise ProfileError("timestamp output shape 漂移")
    lengths = _expect_keys(
        profile["length_buckets"], _length_fields(sanitizer), "length_buckets"
    )
    for key, value in lengths.items():
        _expect_count_mapping(value, ("null_rows", "values", *LENGTH_BUCKET_KEYS), key)
    _expect_count_mapping(
        profile["file_size_buckets"], FILE_SIZE_BUCKETS, "file_size_buckets"
    )
    return cast(dict[str, object], dict(top))


def _same(left: object, right: object, label: str) -> None:
    if left != right:
        raise ProfileError(f"{label} profile 比较失败")


def _assert_sanitized_ai(profile: Mapping[str, object]) -> None:
    counts = cast(Mapping[str, int], profile["table_counts"])
    booleans = cast(Mapping[str, Mapping[str, int]], profile["boolean_distributions"])
    values = cast(Mapping[str, Mapping[str, int]], profile["value_distributions"])
    for table in ("ai_channels", "ai_models"):
        distribution = booleans[f"{table}.is_enabled"]
        if distribution != {"false": counts[table], "true": 0, "null": 0}:
            raise ProfileError("sanitized AI enabled 分布不满足合同")
    test_status = values["ai_models.test_status"]
    expected = {
        value: 0 for value in (*VALUE_COLUMNS[("ai_models", "test_status")], "null")
    }
    expected["UNTESTED"] = counts["ai_models"]
    if test_status != expected:
        raise ProfileError("sanitized AI test status 不满足合同")


def _compare_cross_phase(
    source: Mapping[str, object],
    sanitized: Mapping[str, object],
    sanitizer: SanitizerModule,
) -> None:
    source_counts = cast(Mapping[str, int], source["table_counts"])
    sanitized_counts = cast(Mapping[str, int], sanitized["table_counts"])
    for table in TABLES:
        if table == "sessions":
            if sanitized_counts[table] != 0:
                raise ProfileError("sanitized sessions 未清零")
        else:
            _same(source_counts[table], sanitized_counts[table], f"row count {table}")

    source_relations = cast(Mapping[str, object], source["relationships"])
    sanitized_relations = cast(Mapping[str, object], sanitized["relationships"])
    for key in RELATIONSHIP_KEYS:
        if key == "sessions.user_id->users.id":
            relation = cast(Mapping[str, object], sanitized_relations[key])
            if any(
                relation[name] != 0
                for name in RELATIONSHIP_METRICS
                if name not in {"orphan_free", "parent_rows"}
            ):
                raise ProfileError("sanitized session relationship 未清零")
            if relation["orphan_free"] is not True:
                raise ProfileError("sanitized session relationship 非 orphan-free")
            _same(
                cast(Mapping[str, object], source_relations[key])["parent_rows"],
                relation["parent_rows"],
                "session parent rows",
            )
        else:
            _same(
                source_relations[key], sanitized_relations[key], f"relationship {key}"
            )

    source_values = cast(Mapping[str, object], source["value_distributions"])
    sanitized_values = cast(Mapping[str, object], sanitized["value_distributions"])
    for key in VALUE_KEYS:
        if key != "ai_models.test_status":
            _same(
                source_values[key], sanitized_values[key], f"value distribution {key}"
            )

    source_booleans = cast(Mapping[str, object], source["boolean_distributions"])
    sanitized_booleans = cast(Mapping[str, object], sanitized["boolean_distributions"])
    for key in BOOLEAN_KEYS:
        if key not in {"ai_channels.is_enabled", "ai_models.is_enabled"}:
            _same(
                source_booleans[key],
                sanitized_booleans[key],
                f"boolean distribution {key}",
            )
    _assert_sanitized_ai(sanitized)

    _same(
        source["revision_distributions"],
        sanitized["revision_distributions"],
        "revision",
    )
    source_times = cast(Mapping[str, object], source["timestamp_ranges"])
    sanitized_times = cast(Mapping[str, object], sanitized["timestamp_ranges"])
    for key in TIME_KEYS:
        if key == "ai_models.last_tested_at":
            expected = {
                "null_count": sanitized_counts["ai_models"],
                "min": None,
                "max": None,
            }
            _same(sanitized_times[key], expected, key)
        elif key.startswith("sessions."):
            _same(
                sanitized_times[key], {"null_count": 0, "min": None, "max": None}, key
            )
        else:
            _same(source_times[key], sanitized_times[key], f"timestamp {key}")

    source_lengths = cast(Mapping[str, object], source["length_buckets"])
    sanitized_lengths = cast(Mapping[str, object], sanitized["length_buckets"])
    allowed_actions = {"clear", "clear_json", "credential", "password", "delete"}
    for (table, column), action in sanitizer.RULES.items():
        key = _key(table, column)
        if action != "preserve" and action not in allowed_actions:
            _same(source_lengths[key], sanitized_lengths[key], f"length bucket {key}")
    _same(source["file_size_buckets"], sanitized["file_size_buckets"], "file size")


def _load_document(path: Path) -> object:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def _require_expected_run(
    documents: Sequence[Mapping[str, object]], expected_run_id: str
) -> None:
    if RUN_ID.fullmatch(expected_run_id) is None or any(
        document.get("run_id") != expected_run_id for document in documents
    ):
        raise ProfileError("profile run identity 与批准目标不一致")


def _compare(paths: Sequence[Path], expected_run_id: str) -> dict[str, object]:
    if len(paths) != 4:
        raise ProfileError("compare 需要四个固定阶段 profile")
    sanitizer = _load_sanitizer()
    stages = ("source", "raw-quarantine", "sanitized-quarantine", "fresh-verify")
    documents = [
        _validate_document(_load_document(path), stage, sanitizer)
        for path, stage in zip(paths, stages, strict=True)
    ]
    run_ids = {str(document["run_id"]) for document in documents}
    contract_checksums = {
        str(document["profile_contract_sha256"]) for document in documents
    }
    if len(run_ids) != 1 or len(contract_checksums) != 1:
        raise ProfileError("profile run 或 contract identity 不一致")
    _require_expected_run(documents, expected_run_id)
    profiles = [
        cast(Mapping[str, object], document["profile"]) for document in documents
    ]
    _same(profiles[0], profiles[1], "source/raw quarantine")
    _same(profiles[2], profiles[3], "sanitized quarantine/fresh verify")
    _compare_cross_phase(profiles[0], profiles[2], sanitizer)
    return {
        "shape_version": PROFILE_SHAPE_VERSION,
        "run_id": documents[0]["run_id"],
        "source_raw_equal": True,
        "sanitized_fresh_equal": True,
        "matrix_changes_valid": True,
        "object_payload_copied": 0,
        "artifacts": _verify_artifacts(),
        "profile_contract_sha256": documents[0]["profile_contract_sha256"],
    }


def _empty_profile(sanitizer: SanitizerModule) -> dict[str, object]:
    return {
        "table_counts": {table: 0 for table in TABLES},
        "relationships": {
            key: {
                name: True if name == "orphan_free" else 0
                for name in RELATIONSHIP_METRICS
            }
            for key in RELATIONSHIP_KEYS
        },
        "value_distributions": {
            _key(table, column): {value: 0 for value in (*allowed, "null")}
            for (table, column), allowed in VALUE_COLUMNS.items()
        },
        "boolean_distributions": {
            key: {"false": 0, "true": 0, "null": 0} for key in BOOLEAN_KEYS
        },
        "revision_distributions": {key: [] for key in REVISION_KEYS},
        "timestamp_ranges": {
            key: {"null_count": 0, "min": None, "max": None} for key in TIME_KEYS
        },
        "length_buckets": {
            key: {name: 0 for name in ("null_rows", "values", *LENGTH_BUCKET_KEYS)}
            for key in _length_fields(sanitizer)
        },
        "file_size_buckets": {key: 0 for key in FILE_SIZE_BUCKETS},
    }


def _static_metadata_check(sanitizer: SanitizerModule) -> None:
    import app.models  # type: ignore[import-untyped]  # noqa: F401
    from app.db import Base  # type: ignore[import-untyped]
    from sqlalchemy import (
        ARRAY,
        Boolean,
        Date,
        DateTime,
        JSON,
        LargeBinary,
        String,
        Text,
    )

    tables = tuple(sorted(Base.metadata.tables))
    foreign_keys = tuple(
        sorted(
            (
                table.name,
                column.name,
                foreign_key.column.table.name,
                foreign_key.column.name,
            )
            for table in Base.metadata.tables.values()
            for column in table.columns
            for foreign_key in column.foreign_keys
        )
    )
    revisions = tuple(
        sorted(
            (table.name, column.name)
            for table in Base.metadata.tables.values()
            for column in table.columns
            if column.name in {"revision", "facts_revision"}
        )
    )
    times = tuple(
        sorted(
            (table.name, column.name)
            for table in Base.metadata.tables.values()
            for column in table.columns
            if isinstance(column.type, (Date, DateTime))
        )
    )
    booleans = tuple(
        sorted(
            (table.name, column.name)
            for table in Base.metadata.tables.values()
            for column in table.columns
            if isinstance(column.type, Boolean)
        )
    )
    sensitive = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, (String, Text, JSON, ARRAY, LargeBinary))
    }
    if (
        tables != TABLES
        or foreign_keys != tuple(sorted(FOREIGN_KEYS))
        or revisions != tuple(sorted(REVISION_COLUMNS))
        or times != tuple(sorted(TIME_COLUMNS))
        or booleans != tuple(sorted(BOOLEAN_COLUMNS))
        or sensitive != set(sanitizer.RULES)
    ):
        raise ProfileError("本地 ORM metadata 与 profile 0043 清单漂移")
    known_columns = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
    }
    if not set(VALUE_COLUMNS).issubset(known_columns):
        raise ProfileError("登记机器值字段与 ORM metadata 漂移")


def _self_check() -> dict[str, object]:
    sanitizer = _load_sanitizer()
    _static_metadata_check(sanitizer)
    source = _empty_profile(sanitizer)
    source_counts = cast(dict[str, int], source["table_counts"])
    source_counts.update({"ai_channels": 1, "ai_models": 1, "sessions": 2, "users": 1})
    source_booleans = cast(dict[str, dict[str, int]], source["boolean_distributions"])
    source_booleans["ai_channels.is_enabled"] = {"false": 0, "true": 1, "null": 0}
    source_booleans["ai_models.is_enabled"] = {"false": 0, "true": 1, "null": 0}
    source_values = cast(dict[str, dict[str, int]], source["value_distributions"])
    source_values["ai_models.test_status"]["PASSED"] = 1
    source_times = cast(
        dict[str, dict[str, int | str | None]], source["timestamp_ranges"]
    )
    source_times["ai_models.last_tested_at"] = {
        "null_count": 0,
        "min": "2026-08-26T00:00:00Z",
        "max": "2026-08-26T00:00:00Z",
    }
    for key in ("sessions.expires_at", "sessions.created_at", "sessions.last_seen_at"):
        source_times[key] = {
            "null_count": 0,
            "min": "2026-08-26T00:00:00Z",
            "max": "2026-08-26T00:00:00Z",
        }
    source_times["sessions.revoked_at"] = {"null_count": 2, "min": None, "max": None}
    session_relation = cast(
        dict[str, int | bool],
        cast(dict[str, object], source["relationships"])["sessions.user_id->users.id"],
    )
    session_relation.update(
        {
            "child_rows": 2,
            "linked_rows": 2,
            "parent_rows": 1,
            "parents_with_children": 1,
            "fanout_min": 2,
            "fanout_max": 2,
            "fanout_p50": 2,
            "fanout_p95": 2,
        }
    )
    source_lengths = cast(dict[str, dict[str, int]], source["length_buckets"])
    source_lengths["users.password_hash"].update({"values": 1, "sm": 1})
    _validate_document(
        {
            "command": "profile",
            "status": "passed",
            "shape_version": PROFILE_SHAPE_VERSION,
            "stage": "source",
            "run_id": "static-self-check",
            "schema_revision": EXPECTED_REVISION,
            "schema_signature": EXPECTED_SCHEMA_SHA256,
            "snapshot_bound": True,
            "default_transaction_read_only": True,
            "transaction_read_only": True,
            "transaction_isolation": "repeatable read",
            "object_payload_copied": 0,
            "artifacts": _verify_artifacts(),
            "profile_contract_sha256": _sha256(Path(__file__)),
            "profile": source,
        },
        "source",
        sanitizer,
    )
    sanitized = copy.deepcopy(source)
    sanitized_counts = cast(dict[str, int], sanitized["table_counts"])
    sanitized_counts["sessions"] = 0
    sanitized_booleans = cast(
        dict[str, dict[str, int]], sanitized["boolean_distributions"]
    )
    for key in ("ai_channels.is_enabled", "ai_models.is_enabled"):
        sanitized_booleans[key] = {"false": 1, "true": 0, "null": 0}
    sanitized_values = cast(dict[str, dict[str, int]], sanitized["value_distributions"])
    sanitized_values["ai_models.test_status"]["PASSED"] = 0
    sanitized_values["ai_models.test_status"]["UNTESTED"] = 1
    sanitized_times = cast(
        dict[str, dict[str, int | str | None]], sanitized["timestamp_ranges"]
    )
    sanitized_times["ai_models.last_tested_at"] = {
        "null_count": 1,
        "min": None,
        "max": None,
    }
    for key in (
        "sessions.expires_at",
        "sessions.revoked_at",
        "sessions.created_at",
        "sessions.last_seen_at",
    ):
        sanitized_times[key] = {"null_count": 0, "min": None, "max": None}
    sanitized_relation = cast(
        dict[str, int | bool],
        cast(dict[str, object], sanitized["relationships"])[
            "sessions.user_id->users.id"
        ],
    )
    sanitized_relation.update(
        {
            "child_rows": 0,
            "linked_rows": 0,
            "parents_with_children": 0,
            "fanout_min": 0,
            "fanout_max": 0,
            "fanout_p50": 0,
            "fanout_p95": 0,
        }
    )
    sanitized_lengths = cast(dict[str, dict[str, int]], sanitized["length_buckets"])
    sanitized_lengths["users.password_hash"].update({"sm": 0, "md": 1})
    _compare_cross_phase(source, sanitized, sanitizer)
    broken = copy.deepcopy(sanitized)
    cast(dict[str, int], broken["table_counts"])["users"] = 2
    try:
        _compare_cross_phase(source, broken, sanitizer)
    except ProfileError:
        pass
    else:
        raise AssertionError("禁止的 row count 漂移未被拒绝")
    forbidden_length = copy.deepcopy(sanitized)
    cast(dict[str, dict[str, int]], forbidden_length["length_buckets"])[
        "users.username"
    ]["xs"] = 1
    try:
        _compare_cross_phase(source, forbidden_length, sanitizer)
    except ProfileError:
        pass
    else:
        raise AssertionError("禁止的长度桶漂移未被拒绝")
    _require_expected_run([{"run_id": "static-self-check"}], "static-self-check")
    try:
        _require_expected_run([{"run_id": "historical-run"}], "static-self-check")
    except ProfileError:
        pass
    else:
        raise AssertionError("历史 profile run 未被拒绝")
    return {
        "shape_version": PROFILE_SHAPE_VERSION,
        "schema_revision": EXPECTED_REVISION,
        "schema_signature": EXPECTED_SCHEMA_SHA256,
        "checks": {
            "artifacts": True,
            "orm_metadata": True,
            "output_shape": True,
            "allowed_changes": True,
            "forbidden_changes_fail_closed": True,
            "expected_run_identity": True,
            "canonical_envelope": True,
            "database_connected": False,
        },
        "object_payload_copied": 0,
        "artifacts": _verify_artifacts(),
        "profile_contract_sha256": _sha256(Path(__file__)),
    }


def main() -> int:
    """执行固定子命令，并在成功或失败时都只输出安全 JSON。"""
    parser = SafeArgumentParser(add_help=False)
    subparsers = parser.add_subparsers(dest="command", required=True)
    profile_parser = subparsers.add_parser("profile", add_help=False)
    profile_parser.add_argument(
        "stage",
        choices=("source", "raw-quarantine", "sanitized-quarantine", "fresh-verify"),
    )
    compare_parser = subparsers.add_parser("compare", add_help=False)
    compare_parser.add_argument("--expected-run-id", required=True)
    compare_parser.add_argument("source", type=Path)
    compare_parser.add_argument("raw_quarantine", type=Path)
    compare_parser.add_argument("sanitized_quarantine", type=Path)
    compare_parser.add_argument("fresh_verify", type=Path)
    subparsers.add_parser("self-check", add_help=False)
    command = (
        sys.argv[1]
        if len(sys.argv) > 1
        and sys.argv[1]
        in {
            "profile",
            "compare",
            "self-check",
        }
        else None
    )
    try:
        arguments = parser.parse_args()
        if arguments.command == "profile":
            result = _profile(cast(str, arguments.stage))
        elif arguments.command == "compare":
            result = _compare(
                (
                    arguments.source,
                    arguments.raw_quarantine,
                    arguments.sanitized_quarantine,
                    arguments.fresh_verify,
                ),
                cast(str, arguments.expected_run_id),
            )
        else:
            result = _self_check()
        print(
            json.dumps(
                {"command": command, "status": "passed", **result},
                sort_keys=True,
            )
        )
        return 0
    except Exception as error:  # 安全边界：禁止数据库异常携带连接信息或原始值进入输出。
        print(
            json.dumps(
                {
                    "command": command,
                    "status": "failed",
                    "error_type": type(error).__name__,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
