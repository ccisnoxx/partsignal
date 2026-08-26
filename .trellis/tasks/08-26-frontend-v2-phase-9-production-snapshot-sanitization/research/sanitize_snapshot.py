#!/usr/bin/env python3
"""对 0043 quarantine snapshot 执行一次性字段级脱敏与独立验证。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
from argon2 import PasswordHasher
from psycopg import sql


EXPECTED_REVISION = "0043_geo_platform_identity"
EXPECTED_SCHEMA_SHA256 = "90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a"
SELF_CHECK_DATABASE = re.compile(r"^partsignal_sanitize_[0-9a-f]{12}$")
TARGET_DATABASE = {
    "QUARANTINE_DATABASE_URL": re.compile(r"^quarantine_[a-z0-9][a-z0-9_-]{0,61}$"),
    "VERIFY_DATABASE_URL": re.compile(r"^verify_[a-z0-9][a-z0-9_-]{0,65}$"),
}
TASK_DIR = Path(__file__).resolve().parents[1]


class SanitizationError(RuntimeError):
    """表示输入环境或 snapshot 不满足本 Task 的硬门禁。"""


def _required_row(row: tuple[Any, ...] | None) -> tuple[Any, ...]:
    if row is None:
        raise SanitizationError("数据库查询缺少预期结果")
    return row


def _value(connection: psycopg.Connection[tuple[object, ...]], query: str) -> Any:
    return _required_row(connection.execute(query).fetchone())[0]


# 每个 0043 string/text/JSON/JSONB/text[] 字段必须且只能出现一次。
_RULE_LINES = """
ai_channel_headers|pseudo|name,normalized_name
ai_channel_headers|credential|plain_value,encrypted_value
ai_channels|pseudo|name
ai_channels|text|description
ai_channels|preserve|protocol_type,provider_brand
ai_channels|url|base_url
ai_channels|credential|api_key_ciphertext
ai_models|pseudo|display_name,model_id
ai_models|clear_json|request_parameters
ai_models|preserve|test_status
ai_models|clear|last_test_error_summary
audit_logs|preserve|business_module,action,target_type,outcome,error_code
audit_logs|uuid_or_text|target_id
audit_logs|text|result_message
audit_logs|json|details
audit_logs|pseudo|request_id
content_humanization_prompts|text|template_markdown
content_review_records|preserve|action
content_review_records|text|comment
content_task_geo_sources|preserve|rule_code
content_task_geo_sources|text|geo_platform
content_task_geo_sources|json|basis_snapshot
content_tasks|text|platform_profile_name_snapshot
content_tasks|url|platform_website_url_snapshot
content_tasks|pseudo|idempotency_key
content_tasks|preserve|status
content_versions|preserve|source_type,status
content_versions|text|title,summary,body_markdown,change_summary
content_versions|array|tags
content_versions|hash|content_hash
content_versions|json|quality_issues
fact_review_records|preserve|action
fact_review_records|text|comment
fact_versions|preserve|status,classification
fact_versions|text|body_markdown,change_summary
file_records|preserve|category,content_type,access_level,status
file_records|filename|original_filename
file_records|object_key|object_key
file_records|hash|sha256
generation_jobs|pseudo|idempotency_key
generation_jobs|preserve|job_type,status,prompt_template_version,error_code
generation_jobs|json|input_snapshot
generation_jobs|text|adapter_name
generation_jobs|hash|prompt_hash
generation_jobs|clear|error_summary,provider_request_id
geo_observation_citations|url|url
geo_observation_citations|preserve|source_type
geo_observation_publications|preserve|accuracy
geo_observations|preserve|observation_kind,recommendation,accuracy
geo_observations|text|actual_prompt,model_name,model_version,search_platform,search_query,answer_summary,notes
platform_accounts|pseudo|label,account_identifier
platform_profiles|pseudo|name
platform_profiles|slug|slug
platform_profiles|domain_array|allowed_domains
platform_profiles|url|website_url,logo_external_url
platform_prompts|pseudo|name
platform_prompts|text|template_markdown
platform_types|pseudo|name
platform_types|slug|slug
products|pseudo|part_number,normalized_part_number,brand,normalized_brand,category
products|preserve|status,facts_classification
products|text|facts_body_markdown
publication_verifications|preserve|outcome
publication_verifications|text|actual_title_snapshot,comment
publication_verifications|url|final_url_snapshot
publication_work_events|preserve|action,from_status,to_status
publication_work_events|text|comment
publication_works|pseudo|idempotency_key,platform_profile_name_snapshot,platform_account_label_snapshot,account_identifier_snapshot
publication_works|hash|content_hash
publication_works|text|actual_title,close_comment
publication_works|url|final_url
publication_works|preserve|status,close_reason
published_content_issues|preserve|kind,status,resolution_outcome
published_content_issues|text|description,resolution_comment
query_topics|text|canonical_question
query_topics|preserve|intent_type
query_topics|array|variants
sessions|delete|token_hash,csrf_hash
users|pseudo|username,display_name
users|preserve|account_type
users|password|password_hash
"""


def _rules() -> dict[tuple[str, str], str]:
    rules: dict[tuple[str, str], str] = {}
    for line in _RULE_LINES.strip().splitlines():
        table, action, columns = line.split("|")
        for column in columns.split(","):
            key = (table, column)
            if key in rules:
                raise AssertionError(f"重复字段规则：{table}.{column}")
            rules[key] = action
    return rules


RULES = _rules()
ROW_KEY = {"content_task_geo_sources": "content_task_id"}


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _database_url(value: str, database_name: str) -> str:
    parts = urlsplit(_psycopg_url(value))
    return urlunsplit((parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment))


def _columns(connection: psycopg.Connection[tuple[object, ...]]) -> list[tuple[object, ...]]:
    rows = connection.execute(
        """
        SELECT table_name, ordinal_position, column_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull
          FROM information_schema.columns c
          JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
          JOIN pg_catalog.pg_class cls
            ON cls.relnamespace = n.oid AND cls.relname = c.table_name
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = cls.oid AND a.attname = c.column_name
         WHERE c.table_schema = 'public'
           AND c.table_name <> 'alembic_version'
           AND cls.relkind IN ('r', 'p')
           AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY table_name, ordinal_position
        """
    ).fetchall()
    return [tuple(row) for row in rows]


def _schema_catalog(
    connection: psycopg.Connection[tuple[object, ...]],
) -> dict[str, list[tuple[object, ...]]]:
    constraints = connection.execute(
        """
        SELECT relation.relname, constraint_record.conname, constraint_record.contype,
               constraint_record.condeferrable, constraint_record.condeferred,
               pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          FROM pg_catalog.pg_constraint constraint_record
          JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
         ORDER BY relation.relname, constraint_record.conname
        """
    ).fetchall()
    triggers = connection.execute(
        """
        SELECT relation.relname, trigger.tgname, trigger.tgenabled,
               pg_catalog.pg_get_triggerdef(trigger.oid, true),
               pg_catalog.pg_get_functiondef(trigger.tgfoid)
          FROM pg_catalog.pg_trigger trigger
          JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
         ORDER BY relation.relname, trigger.tgname
        """
    ).fetchall()
    return {
        "columns": _columns(connection),
        "constraints": [tuple(row) for row in constraints],
        "user_triggers": [tuple(row) for row in triggers],
    }


def _schema_signature(catalog: dict[str, list[tuple[object, ...]]]) -> str:
    encoded = json.dumps(catalog, ensure_ascii=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _is_sensitive_type(type_name: str) -> bool:
    return (
        type_name == "text"
        or type_name == "jsonb"
        or type_name == "json"
        or type_name == "bytea"
        or type_name.endswith("[]")
        or type_name.startswith("character varying")
        or type_name.startswith("character(")
    )


def _revision(connection: psycopg.Connection[tuple[object, ...]]) -> str:
    rows = connection.execute("SELECT version_num FROM alembic_version").fetchall()
    if len(rows) != 1:
        raise SanitizationError("alembic_version 必须且只能包含一行")
    return str(rows[0][0])


def _validate_schema(connection: psycopg.Connection[tuple[object, ...]]) -> str:
    if _revision(connection) != EXPECTED_REVISION:
        raise SanitizationError("数据库 revision 与 0043 锁定值不一致")
    catalog = _schema_catalog(connection)
    signature = _schema_signature(catalog)
    if signature != EXPECTED_SCHEMA_SHA256:
        raise SanitizationError("数据库 schema signature 与 0043 锁定值不一致")
    discovered = {
        (str(table), str(column))
        for table, _position, column, type_name, _not_null in catalog["columns"]
        if _is_sensitive_type(str(type_name))
    }
    if discovered != set(RULES):
        missing = sorted(discovered - set(RULES))
        stale = sorted(set(RULES) - discovered)
        fields = [f"{table}.{column}" for table, column in missing + stale]
        raise SanitizationError("字段矩阵不完整：" + ",".join(fields))
    return signature


def _row_token(table: str) -> sql.Composed:
    return sql.SQL("replace({}::text, '-', '')").format(sql.Identifier(ROW_KEY.get(table, "id")))


def _expression(table: str, column: str, action: str) -> sql.Composable | None:
    current = sql.Identifier(column)
    token = _row_token(table)
    if action == "preserve" or action in {"delete", "password", "credential"}:
        return None
    if table == "publication_works" and column == "content_hash":
        return sql.SQL(
            "(SELECT content.content_hash FROM content_versions content "
            "WHERE content.id = content_version_id)"
        )
    if action in {"pseudo", "slug", "text", "url", "filename", "object_key"}:
        value = sql.SQL("pg_temp.sanitize_scalar({c}, {name}, {token}, {style})").format(
            c=current,
            name=sql.Literal(column),
            token=token,
            style=sql.Literal(action),
        )
    elif action == "uuid_or_text":
        return sql.SQL(
            "CASE WHEN {c} IS NULL OR {c} ~ "
            "'^[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[1-5][0-9a-fA-F]{{3}}-"
            "[89abAB][0-9a-fA-F]{{3}}-[0-9a-fA-F]{{12}}$' THEN {c} "
            "ELSE pg_temp.sanitize_scalar({c}, {name}, {t}, 'text') END"
        ).format(c=current, name=sql.Literal(column), t=token)
    elif action == "json":
        return sql.SQL("pg_temp.sanitize_jsonb({c}, {token}, {name})").format(
            c=current, token=token, name=sql.Literal(column)
        )
    elif action == "clear_json":
        return sql.SQL("'{}'::jsonb")
    elif action == "array":
        return sql.SQL(
            "ARRAY(SELECT pg_temp.sanitize_scalar(item, {name} || ':' || ordinality::text, "
            "{token}, 'text') FROM unnest({column}) WITH ORDINALITY AS source(item, ordinality) "
            "ORDER BY ordinality)"
        ).format(name=sql.Literal(column), token=token, column=current)
    elif action == "domain_array":
        return sql.SQL(
            "ARRAY(SELECT pg_temp.sanitize_scalar(item, {name} || ':' || ordinality::text, "
            "{token}, 'domain') FROM unnest({column}) WITH ORDINALITY AS source(item, ordinality) "
            "ORDER BY ordinality)"
        ).format(name=sql.Literal(column), token=token, column=current)
    elif action == "hash":
        return sql.SQL("md5({t} || {c}) || md5({c} || {t})").format(
            t=token, c=sql.Literal(column)
        )
    elif action == "clear":
        return sql.SQL("NULL")
    else:
        raise AssertionError(f"未知脱敏动作：{action}")
    return sql.SQL("CASE WHEN {} IS NULL THEN NULL ELSE {} END").format(current, value)


def _create_sanitizers(connection: psycopg.Connection[tuple[object, ...]]) -> None:
    connection.execute(
        """
        CREATE OR REPLACE FUNCTION pg_temp.sanitize_scalar(
          input text, label text, row_token text, style text
        ) RETURNS text AS $$
        DECLARE source_length integer;
        DECLARE target_length integer;
        DECLARE bucket text;
        DECLARE prefix text;
        DECLARE suffix text := '';
        DECLARE seed text;
        BEGIN
          IF input IS NULL THEN RETURN NULL; END IF;
          source_length := length(input);
          IF source_length = 0 THEN RETURN ''; END IF;
          IF source_length <= 32 THEN target_length := 32; bucket := 'xs';
          ELSIF source_length <= 128 THEN target_length := 64; bucket := 'sm';
          ELSIF source_length <= 512 THEN target_length := 129; bucket := 'md';
          ELSE target_length := 513; bucket := 'lg';
          END IF;
          seed := md5(row_token || ':' || label);
          CASE style
            WHEN 'url' THEN prefix := 'https://s.invalid/';
            WHEN 'domain' THEN prefix := 's-'; suffix := '.invalid';
            WHEN 'filename' THEN prefix := 's-'; suffix := '.bin';
            WHEN 'object_key' THEN prefix := 's/';
            WHEN 'slug' THEN prefix := 's-';
            WHEN 'pseudo' THEN prefix := 's-';
            ELSE prefix := 'sanitized:' || bucket || ':';
          END CASE;
          RETURN prefix
                 || left(repeat(seed, 17), target_length - length(prefix) - length(suffix))
                 || suffix;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;

        CREATE OR REPLACE FUNCTION pg_temp.sanitize_jsonb(
          input jsonb, row_token text, label text
        ) RETURNS jsonb AS $$
        DECLARE kind text;
        BEGIN
          IF input IS NULL THEN RETURN NULL; END IF;
          kind := jsonb_typeof(input);
          IF kind = 'object' THEN
            RETURN COALESCE(
              (SELECT jsonb_object_agg(
                        key, pg_temp.sanitize_jsonb(value, row_token, label || '.' || key)
                        ORDER BY key)
                 FROM jsonb_each(input)), '{}'::jsonb);
          ELSIF kind = 'array' THEN
            RETURN COALESCE(
              (SELECT jsonb_agg(
                        pg_temp.sanitize_jsonb(value, row_token, label || '[' || ordinality || ']')
                        ORDER BY ordinality)
                 FROM jsonb_array_elements(input) WITH ORDINALITY), '[]'::jsonb);
          ELSIF kind = 'string' THEN
            RETURN to_jsonb(pg_temp.sanitize_scalar(input #>> '{}', label, row_token, 'json'));
          END IF;
          RETURN input;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
        """
    )


def _tables_to_update() -> list[str]:
    tables = {
        table
        for (table, _column), action in RULES.items()
        if action not in {"preserve", "delete"}
    }
    tables.update({"ai_channels", "ai_models", "ai_channel_headers", "users"})
    return sorted(tables)


def _disable_triggers(
    connection: psycopg.Connection[tuple[object, ...]], tables: list[str], *, enabled: bool
) -> None:
    state = sql.SQL("ENABLE") if enabled else sql.SQL("DISABLE")
    for table in tables:
        connection.execute(
            sql.SQL("ALTER TABLE {} {} TRIGGER USER").format(sql.Identifier(table), state)
        )


def _apply_rules(connection: psycopg.Connection[tuple[object, ...]]) -> None:
    by_table: dict[str, list[tuple[str, sql.Composable]]] = {}
    for (table, column), action in RULES.items():
        expression = _expression(table, column, action)
        if expression is not None:
            by_table.setdefault(table, []).append((column, expression))
    for table, assignments in sorted(by_table.items()):
        connection.execute(
            sql.SQL("UPDATE {} SET ").format(sql.Identifier(table))
            + sql.SQL(", ").join(
                sql.SQL("{} = ").format(sql.Identifier(column)) + expression
                for column, expression in assignments
            )
        )

    connection.execute(
        """
        UPDATE ai_channel_headers
           SET plain_value = CASE WHEN is_sensitive THEN NULL
                                  ELSE 'sanitized:header:' || replace(id::text, '-', '') END,
               encrypted_value = CASE WHEN is_sensitive
                                      THEN 'sanitized.invalid.' || replace(id::text, '-', '')
                                      ELSE NULL END
        """
    )
    connection.execute(
        """
        UPDATE ai_channels
           SET api_key_ciphertext = 'sanitized.invalid.' || replace(id::text, '-', ''),
               is_enabled = false
        """
    )
    connection.execute(
        """
        UPDATE ai_models
           SET is_enabled = false, test_status = 'UNTESTED',
               last_tested_at = NULL, last_test_error_summary = NULL
        """
    )
    password_hasher = PasswordHasher()
    users = connection.execute("SELECT id FROM users ORDER BY id").fetchall()
    with connection.cursor() as cursor:
        cursor.executemany(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            [
                (password_hasher.hash(secrets.token_urlsafe(64)), user_id)
                for (user_id,) in users
            ],
        )
    connection.execute("DELETE FROM sessions")


def _trigger_check(connection: psycopg.Connection[tuple[object, ...]]) -> bool:
    return not bool(
        connection.execute(
            """
            SELECT 1 FROM pg_catalog.pg_trigger trigger
            JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
              AND trigger.tgenabled = 'D'
            LIMIT 1
            """
        ).fetchone()
    )


def _bad_count(
    connection: psycopg.Connection[tuple[object, ...]], table: str, predicate: sql.Composable
) -> int:
    return int(
        _required_row(
            connection.execute(
                sql.SQL("SELECT count(*) FROM {} WHERE ").format(sql.Identifier(table)) + predicate
            ).fetchone()
        )[0]
    )


def _verify_sanitized(connection: psycopg.Connection[tuple[object, ...]]) -> dict[str, bool]:
    checks: dict[str, bool] = {
        "sessions_removed": int(
            _required_row(connection.execute("SELECT count(*) FROM sessions").fetchone())[0]
        )
        == 0,
        "ai_channels_disabled": _bad_count(connection, "ai_channels", sql.SQL("is_enabled"))
        == 0,
        "ai_models_disabled": _bad_count(connection, "ai_models", sql.SQL("is_enabled")) == 0,
        "ai_models_untested": _bad_count(
            connection,
            "ai_models",
            sql.SQL("test_status <> 'UNTESTED' OR last_tested_at IS NOT NULL"),
        )
        == 0,
        "credentials_replaced": _bad_count(
            connection,
            "ai_channels",
            sql.SQL(
                "api_key_ciphertext IS DISTINCT FROM "
                "'sanitized.invalid.' || replace(id::text, '-', '')"
            ),
        )
        == 0,
        "header_values_replaced": _bad_count(
            connection,
            "ai_channel_headers",
            sql.SQL(
                "(is_sensitive AND (plain_value IS NOT NULL OR encrypted_value IS DISTINCT FROM "
                "'sanitized.invalid.' || replace(id::text, '-', ''))) OR "
                "(NOT is_sensitive AND (encrypted_value IS NOT NULL OR plain_value IS DISTINCT FROM "
                "'sanitized:header:' || replace(id::text, '-', '')))"
            ),
        )
        == 0,
        "passwords_replaced": _bad_count(
            connection, "users", sql.SQL("password_hash NOT LIKE '$argon2id$%'")
        )
        == 0,
        "triggers_enabled": _trigger_check(connection),
    }
    for (table, column), action in sorted(RULES.items()):
        identifier = sql.Identifier(column)
        if action in {"preserve", "delete", "password", "credential"}:
            continue
        expected = _expression(table, column, action)
        if expected is None:
            raise AssertionError(f"缺少验证表达式：{table}.{column}")
        predicate = sql.SQL("{} IS DISTINCT FROM (").format(identifier) + expected + sql.SQL(")")
        checks[f"{table}.{column}"] = _bad_count(connection, table, predicate) == 0
    if not all(checks.values()):
        failed = sorted(name for name, passed in checks.items() if not passed)
        raise SanitizationError("脱敏验证失败：" + ",".join(failed))
    return checks


def _table_counts(connection: psycopg.Connection[tuple[object, ...]]) -> dict[str, int]:
    tables = sorted({str(row[0]) for row in _columns(connection)})
    return {
        table: int(
            _required_row(
                connection.execute(
                    sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))
                ).fetchone()
            )[0]
        )
        for table in tables
    }


def _checksums() -> dict[str, str]:
    return {
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "matrix_sha256": hashlib.sha256(
            (TASK_DIR / "research" / "sanitization-matrix.md").read_bytes()
        ).hexdigest(),
    }


def _sanitize_connection(
    connection: psycopg.Connection[tuple[object, ...]], *, inject_constraint_failure: bool = False
) -> dict[str, object]:
    with connection.transaction():
        signature = _validate_schema(connection)
        connection.execute("SET LOCAL lock_timeout = '10s'")
        connection.execute("SET LOCAL statement_timeout = '30min'")
        connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (EXPECTED_REVISION,))
        tables = _tables_to_update()
        _disable_triggers(connection, tables, enabled=False)
        _create_sanitizers(connection)
        _apply_rules(connection)
        if inject_constraint_failure:
            connection.execute("UPDATE ai_channels SET timeout_seconds = 0")
        _disable_triggers(connection, tables, enabled=True)
        if _validate_schema(connection) != signature:
            raise SanitizationError("脱敏后 schema signature 发生变化")
        checks = _verify_sanitized(connection)
        counts = _table_counts(connection)
    return {
        "revision": EXPECTED_REVISION,
        "schema_signature": signature,
        "table_counts": counts,
        "checks": checks,
        "object_payload_copied": 0,
        **_checksums(),
    }


def _verify_connection(connection: psycopg.Connection[tuple[object, ...]]) -> dict[str, object]:
    signature = _validate_schema(connection)
    _create_sanitizers(connection)
    checks = _verify_sanitized(connection)
    return {
        "revision": EXPECTED_REVISION,
        "schema_signature": signature,
        "table_counts": _table_counts(connection),
        "checks": checks,
        "object_payload_copied": 0,
        **_checksums(),
    }


def _target_connection(command: str) -> psycopg.Connection[tuple[object, ...]]:
    if command == "sanitize":
        variable = "QUARANTINE_DATABASE_URL"
    else:
        present = [name for name in TARGET_DATABASE if os.getenv(name)]
        if len(present) != 1:
            raise SanitizationError("verify 必须且只能设置一个 quarantine/verify database URL")
        variable = present[0]
    value = os.getenv(variable)
    if not value:
        raise SanitizationError(f"缺少 {variable}")
    connection = psycopg.connect(_psycopg_url(value))
    if not TARGET_DATABASE[variable].fullmatch(connection.info.dbname):
        connection.close()
        raise SanitizationError(f"{variable} 的 database 名称不属于受控 namespace")
    return connection


def _seed_self_check(connection: psycopg.Connection[tuple[object, ...]], marker: str) -> None:
    user_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    channel_id = uuid.UUID("20000000-0000-4000-8000-000000000001")
    product_id = uuid.UUID("30000000-0000-4000-8000-000000000001")
    connection.execute(
        "INSERT INTO users (id, username, display_name, password_hash, account_type, "
        "is_active, must_change_password, revision) VALUES (%s,%s,%s,%s,'ENGINEER',true,false,7)",
        (user_id, marker, marker * 3, marker),
    )
    connection.execute(
        "INSERT INTO sessions (id, token_hash, csrf_hash, user_id, expires_at) "
        "VALUES (%s,%s,%s,%s,now() + interval '1 hour')",
        (uuid.uuid4(), "a" * 64, "b" * 64, user_id),
    )
    connection.execute(
        "INSERT INTO audit_logs (id,actor_id,business_module,action,target_type,target_id,"
        "outcome,result_message,error_code,details,request_id) "
        "VALUES (%s,%s,'IDENTITY','user.created','User',%s,'SUCCESS',%s,NULL,%s::jsonb,%s)",
        (
            uuid.uuid4(),
            user_id,
            str(user_id),
            marker,
            json.dumps({"nested": [marker, marker * 3, marker * 13, marker * 22, 7, True]}),
            marker,
        ),
    )
    connection.execute(
        "INSERT INTO ai_channels (id,name,description,protocol_type,provider_brand,base_url,"
        "api_key_ciphertext,api_key_updated_at,timeout_seconds,is_enabled,revision,created_by) "
        "VALUES (%s,%s,%s,'openai-compatible-chat-completions','CUSTOM',%s,%s,now(),30,true,5,%s)",
        (channel_id, marker * 6, marker * 13, f"https://{marker * 3}.invalid", marker, user_id),
    )
    connection.execute(
        "INSERT INTO ai_channel_headers "
        "(id,channel_id,name,normalized_name,is_sensitive,plain_value,encrypted_value) "
        "VALUES (%s,%s,%s,%s,false,%s,NULL)",
        (uuid.uuid4(), channel_id, marker, marker, marker),
    )
    connection.execute(
        "INSERT INTO ai_models (id,channel_id,display_name,model_id,request_parameters,"
        "is_enabled,test_status,last_tested_at,last_test_error_summary,revision,created_by) "
        "VALUES (%s,%s,%s,%s,%s::jsonb,true,'PASSED',now(),%s,3,%s)",
        (
            uuid.uuid4(),
            channel_id,
            marker,
            marker,
            json.dumps(
                {"nested": [marker, marker * 3, marker * 13, marker * 22, 7, True]}
            ),
            marker,
            user_id,
        ),
    )
    connection.execute(
        "INSERT INTO products (id,part_number,normalized_part_number,brand,normalized_brand,"
        "category,status,revision,facts_revision,facts_body_markdown,facts_classification) "
        "VALUES (%s,%s,%s,%s,%s,%s,'ACTIVE',9,4,%s,'PUBLIC')",
        (product_id, marker, marker, marker, marker, marker, marker * 22),
    )
    connection.execute(
        "INSERT INTO fact_versions (id,product_id,version,status,body_markdown,classification,"
        "change_summary,revision,created_by) VALUES (%s,%s,1,'PENDING_REVIEW',%s,'PUBLIC',%s,6,%s)",
        (uuid.uuid4(), product_id, marker, marker, user_id),
    )
    connection.execute(
        "INSERT INTO file_records (id,category,original_filename,object_key,content_type,size,"
        "sha256,access_level,status,uploader_id,upload_expires_at) "
        "VALUES (%s,'OPERATION_SCREENSHOT',%s,%s,'image/png',123,%s,'PUBLIC','VERIFIED',%s,"
        "now() + interval '1 hour')",
        (uuid.uuid4(), f"{marker * 3}.png", marker, "c" * 64, user_id),
    )


def _length_bucket(value: str) -> str:
    length = len(value)
    if length == 0:
        return "empty"
    if length <= 32:
        return "xs"
    if length <= 128:
        return "sm"
    if length <= 512:
        return "md"
    return "lg"


def _json_buckets(value: object) -> list[str]:
    if isinstance(value, str):
        return [_length_bucket(value)]
    if isinstance(value, list):
        return [bucket for item in value for bucket in _json_buckets(item)]
    if isinstance(value, dict):
        return [bucket for item in value.values() for bucket in _json_buckets(item)]
    return []


def _shape_profile(connection: psycopg.Connection[tuple[object, ...]]) -> dict[str, object]:
    user = _required_row(connection.execute("SELECT username, display_name FROM users").fetchone())
    channel = _required_row(
        connection.execute("SELECT name, description, base_url FROM ai_channels").fetchone()
    )
    audit = _required_row(connection.execute("SELECT details FROM audit_logs").fetchone())
    product = _required_row(
        connection.execute("SELECT facts_body_markdown FROM products").fetchone()
    )
    file_record = _required_row(
        connection.execute("SELECT original_filename, object_key FROM file_records").fetchone()
    )
    return {
        "user": [_length_bucket(str(value)) for value in user],
        "channel": [_length_bucket(str(value)) for value in channel],
        "json": _json_buckets(audit[0]),
        "product": _length_bucket(str(product[0])),
        "file": [_length_bucket(str(value)) for value in file_record],
    }


def _marker_count(connection: psycopg.Connection[tuple[object, ...]], marker: str) -> int:
    total = 0
    for (table, column), action in RULES.items():
        if action in {"preserve", "delete"}:
            continue
        total += int(
            _required_row(
                connection.execute(
                    sql.SQL("SELECT count(*) FROM {} WHERE {}::text LIKE %s").format(
                        sql.Identifier(table), sql.Identifier(column)
                    ),
                    (f"%{marker}%",),
                ).fetchone()
            )[0]
        )
    return total


def _self_check() -> dict[str, object]:
    source_url = os.getenv("PARTSIGNAL_TEST_DATABASE_URL")
    if source_url is None and os.getenv("APP_ENV") == "test":
        source_url = os.getenv("DATABASE_URL")
    if not source_url:
        raise SanitizationError("self-check 需要显式 PARTSIGNAL_TEST_DATABASE_URL")
    database_name = f"partsignal_sanitize_{uuid.uuid4().hex[:12]}"
    if not SELF_CHECK_DATABASE.fullmatch(database_name):
        raise AssertionError("self-check database allowlist 失效")
    target_url = _database_url(source_url, database_name)
    admin_url = _psycopg_url(source_url)
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    try:
        backend_dir = Path(__file__).resolve().parents[4] / "backend"
        sqlalchemy_url = target_url.replace("postgresql://", "postgresql+psycopg://", 1)
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            check=True,
            cwd=backend_dir,
            env={**os.environ, "DATABASE_URL": sqlalchemy_url},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        marker = "SELF_CHECK_SECRET_MARKER"
        with psycopg.connect(target_url) as connection:
            _seed_self_check(connection, marker)
            connection.commit()
            counts_before = _table_counts(connection)
            shape_before = _shape_profile(connection)
            state_before = {
                "user_revision": int(_value(connection, "SELECT revision FROM users")),
                "fact_status": str(_value(connection, "SELECT status FROM fact_versions")),
                "created_at": _value(connection, "SELECT created_at FROM users"),
                "created_by": _value(connection, "SELECT created_by FROM ai_channels"),
            }
            connection.commit()

            try:
                _sanitize_connection(connection, inject_constraint_failure=True)
            except psycopg.errors.CheckViolation:
                connection.rollback()
            else:
                raise AssertionError("约束失败未触发 rollback")
            if _marker_count(connection, marker) == 0:
                raise AssertionError("约束失败后出现部分脱敏提交")
            connection.commit()

            try:
                with connection.transaction():
                    connection.execute(
                        "UPDATE alembic_version SET version_num = 'wrong_revision'"
                    )
                    _validate_schema(connection)
            except SanitizationError:
                pass
            else:
                raise AssertionError("错误 revision 未 fail closed")

            try:
                with connection.transaction():
                    connection.execute("ALTER TABLE products ADD COLUMN unknown_secret text")
                    _validate_schema(connection)
            except SanitizationError:
                pass
            else:
                raise AssertionError("未知字段未 fail closed")

            for statement, label in (
                (
                    "ALTER TABLE products ADD CONSTRAINT self_check_schema_drift "
                    "CHECK (revision >= 0)",
                    "约束漂移",
                ),
                (
                    "CREATE TRIGGER self_check_schema_drift BEFORE UPDATE ON products "
                    "FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change()",
                    "USER trigger 漂移",
                ),
            ):
                try:
                    with connection.transaction():
                        connection.execute(statement)
                        _validate_schema(connection)
                except SanitizationError:
                    pass
                else:
                    raise AssertionError(f"{label}未 fail closed")
            if _validate_schema(connection) != EXPECTED_SCHEMA_SHA256:
                raise AssertionError("schema drift 测试未精确 rollback")

            result = _sanitize_connection(connection)
            if _marker_count(connection, marker) != 0:
                raise AssertionError("敏感 marker 未清零")
            counts_after = _table_counts(connection)
            expected_counts = {**counts_before, "sessions": 0}
            if counts_after != expected_counts:
                raise AssertionError("业务表 row count 未保持或 sessions 未清零")
            if _shape_profile(connection) != shape_before:
                raise AssertionError("标识、URL、JSON、正文或文件字段的实际长度桶未保持")
            state_after = {
                "user_revision": int(_value(connection, "SELECT revision FROM users")),
                "fact_status": str(_value(connection, "SELECT status FROM fact_versions")),
                "created_at": _value(connection, "SELECT created_at FROM users"),
                "created_by": _value(connection, "SELECT created_by FROM ai_channels"),
            }
            if state_before != state_after:
                raise AssertionError("status/revision/timestamp/FK 未保持")
            _verify_connection(connection)
        return {
            "revision": result["revision"],
            "schema_signature": result["schema_signature"],
            "checks": {
                "marker_removed": True,
                "relationships_preserved": True,
                "counts_status_revision_time_preserved": True,
                "constraint_failure_rolled_back": True,
                "wrong_revision_failed_closed": True,
                "unknown_column_failed_closed": True,
                "constraint_drift_failed_closed": True,
                "user_trigger_drift_failed_closed": True,
                "length_buckets_preserved": True,
                "database_dropped": True,
            },
            "object_payload_copied": 0,
            **_checksums(),
        }
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name))
            )
            exists = _required_row(
                admin.execute(
                    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = %s)",
                    (database_name,),
                ).fetchone()
            )[0]
            if exists:
                raise AssertionError("self-check database 未精确删除")


def main() -> int:
    """执行固定命令并只输出非敏感 JSON。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("self-check", "sanitize", "verify"))
    command = parser.parse_args().command
    try:
        if command == "self-check":
            result = _self_check()
        else:
            with _target_connection(command) as connection:
                result = (
                    _sanitize_connection(connection)
                    if command == "sanitize"
                    else _verify_connection(connection)
                )
        print(json.dumps({"command": command, "status": "passed", **result}, sort_keys=True))
        return 0
    except (SanitizationError, psycopg.Error, subprocess.SubprocessError, AssertionError) as error:
        print(
            json.dumps(
                {"command": command, "status": "failed", "error_type": type(error).__name__},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
