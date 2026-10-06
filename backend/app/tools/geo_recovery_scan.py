"""只读恢复扫描，复用现有读模型和凭据边界，不改变历史或指标资格。"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.ai_generation import AIChannel, AIChannelHeader
from app.models.geo_files import FileRecord
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.schemas.geo_insights import GeoOverviewFilters
from app.services.credentials import CredentialCipher
from app.services.geo_overview import get_overview
from app.services.geo_read_queries import get_run


def semantic_digest(value: Any) -> str:
    """仅剔除本次读取时钟和临时下载 capability，保留全部业务字段。"""

    def normalize(item: Any) -> Any:
        if isinstance(item, dict):
            return {
                key: normalize(val) for key, val in item.items() if key not in {"as_of", "download"}
            }
        if isinstance(item, list):
            return [normalize(val) for val in item]
        return item

    encoded = json.dumps(normalize(value), sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def schema_digest(db: Session) -> dict[str, Any]:
    # CHECK/索引表达式经 PG dump/reparse 会改变等价 cast/括号表示。
    # 清单核对属性与归属；函数/trigger 逐字核对，执行保护由真实隔离写入反例验证。
    # 用列名而非attnum：历史DROP COLUMN留孔，dump/restore合法压缩物理列序号。
    definitions = db.execute(
        text("""
        SELECT 'constraint', c.conname, jsonb_build_array(
            c.contype, c.conrelid::regclass::text,
            ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,pos)
                  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.pos),
            CASE WHEN c.confrelid>0 THEN c.confrelid::regclass::text ELSE NULL END,
            ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,pos)
                  JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.pos),
            c.condeferrable, c.condeferred, c.convalidated, c.connoinherit,
            c.confupdtype, c.confdeltype, c.confmatchtype)::text
        FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
        UNION ALL
        SELECT 'trigger', t.tgname, jsonb_build_array(t.tgenabled, pg_get_triggerdef(t.oid))::text
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal
        UNION ALL
        SELECT 'index', c.relname, jsonb_build_array(
            i.indrelid::regclass::text, am.amname, i.indisunique, i.indisprimary,
            i.indisvalid, i.indimmediate, i.indnkeyatts, i.indnatts,
            ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,pos)
                  LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
                  ORDER BY k.pos))::text
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_am am ON am.oid=c.relam
        WHERE n.nspname='public' AND c.relkind='i'
        UNION ALL
        SELECT 'function', p.proname, pg_get_functiondef(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p')
        ORDER BY 1,2,3
    """)
    ).all()
    return {
        "count": len(definitions),
        "sha256": semantic_digest([list(row) for row in definitions]),
    }


def scan_database(db: Session, encoded_master_key: str) -> dict[str, Any]:
    """调用方先建立禁止 autoflush 的只读 RR 事务；返回摘要，无正文/密文。"""
    if db.autoflush or db.connection().get_isolation_level() != "REPEATABLE READ":
        raise ValueError("恢复扫描要求禁止autoflush的REPEATABLE READ")
    db.execute(text("SET TRANSACTION READ ONLY"))
    db.execute(text("SET LOCAL statement_timeout = '120s'"))
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    db.execute(text("SET LOCAL timezone = 'UTC'"))
    tables = db.scalars(
        text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    ).all()
    fingerprints: dict[str, Any] = {}
    preparer = db.get_bind().dialect.identifier_preparer
    for table in tables:
        digest = hashlib.sha256()
        count = 0
        name = preparer.quote_identifier(table)
        # 恢复门禁按完整行排序，不依赖 dump 物理行顺序或 ORM 是否加载全部字段。
        rows = db.execute(
            text(f"SELECT to_jsonb(t)::text FROM public.{name} t ORDER BY to_jsonb(t)::text")
        ).yield_per(1000)
        for row in rows:
            digest.update(row[0].encode("utf-8") + b"\n")
            count += 1
        fingerprints[table] = {"count": count, "sha256": digest.hexdigest()}

    credentials: list[dict[str, str]] = []
    cipher = CredentialCipher(encoded_master_key)
    values = [
        (str(identity), value, f"ai_channel:{identity}:api_key")
        for identity, value in db.execute(select(AIChannel.id, AIChannel.api_key_ciphertext))
    ] + [
        (str(identity), value, f"ai_channel_header:{identity}:value")
        for identity, value in db.execute(
            select(AIChannelHeader.id, AIChannelHeader.encrypted_value).where(
                AIChannelHeader.is_sensitive
            )
        )
    ]
    for identity, value, aad in sorted(values):
        try:
            cipher.decrypt(value, associated_data=aad)
            status = "DECRYPTED"
        except AppError:
            status = "CREDENTIAL_DECRYPTION_FAILED"
        credentials.append({"id": identity, "status": status})

    run_ids = db.scalars(select(GeoObservationRun.id).order_by(GeoObservationRun.id)).all()
    details: dict[str, Any] = {}
    actor = db.scalar(
        select(User)
        .where(User.is_active, User.account_type == "ADMIN", ~User.must_change_password)
        .order_by(User.id)
    )
    for run_id in run_ids:
        try:
            if actor is None:
                raise ValueError("恢复扫描缺少可用管理员")
            value = get_run(db, run_id=run_id, actor=actor).model_dump(mode="json")
            details[str(run_id)] = {"status": "READABLE", "sha256": semantic_digest(value)}
        except (AppError, ValueError):
            details[str(run_id)] = {"status": "RUN_DETAIL_UNREADABLE"}

    first, last = db.execute(
        select(func.min(GeoObservationRun.created_at), func.max(GeoObservationRun.created_at))
    ).one()
    overview: dict[str, Any] = {"status": "NO_RUNS"}
    if first is not None:
        filters = GeoOverviewFilters(date_from=first, date_to=last + timedelta(microseconds=1))
        try:
            value = get_overview(db, filters).model_dump(mode="json")
            overview = {"status": "READABLE", "sha256": semantic_digest(value)}
        except (AppError, ValueError):
            overview = {"status": "METRICS_UNREADABLE"}
    files = [
        {
            "id": str(row.id),
            "object_key": row.object_key,
            "size": row.size,
            "sha256": row.sha256,
            "content_type": row.content_type,
            "status": row.status,
        }
        for row in db.scalars(select(FileRecord).order_by(FileRecord.id))
    ]
    return {
        "migration_head": db.scalars(text("SELECT version_num FROM alembic_version")).all(),
        "tables": fingerprints,
        "schema": schema_digest(db),
        "credentials": credentials,
        "run_details": details,
        "overview": overview,
        "files": files,
        "browser_session_rows": db.scalar(text("SELECT count(*) FROM geo_browser_sessions")),
        "run_states": dict(
            (row[0], row[1])
            for row in db.execute(
                select(GeoObservationRun.status, func.count()).group_by(GeoObservationRun.status)
            ).all()
        ),
    }


def database_readable(scan: dict[str, Any]) -> bool:
    return (
        all(v["status"] == "DECRYPTED" for v in scan["credentials"])
        and all(v["status"] == "READABLE" for v in scan["run_details"].values())
        and scan["overview"]["status"] in {"READABLE", "NO_RUNS"}
    )
