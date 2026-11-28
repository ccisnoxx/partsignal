"""Slice 1B：新增统一文章与多 URL 发布台账、产品轻量资料及轻量 AI 生稿快照，并回填存量已核验文章。"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path

import sqlalchemy as sa

from alembic import op
from app.geo_citation_urls import normalize_citation_url

revision = "0081_articles_publications"
down_revision = "0080_rbac_viewer_role"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def _backfill_existing_published_articles() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT
                pa.id AS published_article_id,
                pw.content_task_id,
                pw.content_version_id,
                pw.platform_profile_id,
                pw.platform_profile_name_snapshot,
                pw.platform_account_id,
                pw.platform_account_label_snapshot,
                pw.actual_title,
                pw.final_url,
                pw.published_at,
                pw.created_by AS work_created_by,
                ct.product_id,
                ct.created_by AS task_created_by,
                COALESCE(ct.assignee_id, ct.created_by) AS owner_id,
                cv.title,
                cv.summary,
                cv.body_markdown,
                cv.tags,
                cv.source_type,
                pv.id AS verification_id,
                pv.actor_id AS verified_by,
                pv.created_at AS verified_at
            FROM published_articles pa
            JOIN publication_works pw ON pw.id = pa.id
            JOIN content_tasks ct ON ct.id = pw.content_task_id
            JOIN content_versions cv ON cv.id = pw.content_version_id
            JOIN publication_verifications pv ON pv.id = pa.verification_id
            ORDER BY pv.created_at ASC, pa.id ASC
            """
        )
    ).mappings().all()
    seen_urls: set[str] = set()
    for row in rows:
        if not row["final_url"] or not row["actual_title"] or row["published_at"] is None:
            continue
        try:
            url_info = normalize_citation_url(row["final_url"])
        except ValueError:
            continue
        if url_info.normalized_url in seen_urls:
            continue
        seen_urls.add(url_info.normalized_url)
        article_id = uuid.uuid4()
        rev_id = uuid.uuid4()
        pub_id = uuid.uuid4()
        event_id = uuid.uuid4()
        origin = "SYSTEM_AI" if row["source_type"] != "HUMAN" else "HUMAN"
        c_hash = hashlib.sha256(
            f"{row['title']}\n---\n{row['summary']}\n---\n{row['body_markdown']}".encode()
        ).hexdigest()
        bind.execute(
            sa.text(
                """
                INSERT INTO articles (
                    id, product_id, title, summary, body_markdown, target_keywords,
                    origin_type, status, current_revision, revision, owner_id,
                    created_by, updated_by, source_content_task_id, source_content_version_id,
                    created_at, updated_at
                ) VALUES (
                    :id, :product_id, :title, :summary, :body_markdown, :target_keywords,
                    :origin_type, 'PUBLISHED', 1, 0, :owner_id,
                    :created_by, :updated_by, :task_id, :version_id,
                    :ts, :ts
                )
                """
            ),
            {
                "id": article_id,
                "product_id": row["product_id"],
                "title": row["title"],
                "summary": row["summary"] or "",
                "body_markdown": row["body_markdown"],
                "target_keywords": list(row["tags"] or []),
                "origin_type": origin,
                "owner_id": row["owner_id"],
                "created_by": row["task_created_by"],
                "updated_by": row["verified_by"],
                "task_id": row["content_task_id"],
                "version_id": row["content_version_id"],
                "ts": row["verified_at"],
            },
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO article_revisions (
                    id, article_id, revision_no, title, summary, body_markdown,
                    content_hash, change_summary, created_by, created_at
                ) VALUES (
                    :id, :article_id, 1, :title, :summary, :body_markdown,
                    :content_hash, '0081 迁移回填存量已核验发布成果', :created_by, :ts
                )
                """
            ),
            {
                "id": rev_id,
                "article_id": article_id,
                "title": row["title"],
                "summary": row["summary"] or "",
                "body_markdown": row["body_markdown"],
                "content_hash": c_hash,
                "created_by": row["verified_by"],
                "ts": row["verified_at"],
            },
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO article_publications (
                    id, article_id, article_revision_id, platform_profile_id,
                    platform_name_snapshot, platform_account_id, platform_account_label_snapshot,
                    actual_title, final_url, normalized_url, hostname, published_at,
                    registration_status, verification_status, verified_at, verified_by,
                    source_published_article_id, notes, revision, registered_by,
                    created_at, updated_at
                ) VALUES (
                    :id, :article_id, :rev_id, :platform_profile_id,
                    :platform_name, :account_id, :account_label,
                    :actual_title, :final_url, :normalized_url, :hostname, :published_at,
                    'REGISTERED', 'VERIFIED', :verified_at, :verified_by,
                    :source_pa_id, '', 0, :registered_by,
                    :verified_at, :verified_at
                )
                """
            ),
            {
                "id": pub_id,
                "article_id": article_id,
                "rev_id": rev_id,
                "platform_profile_id": row["platform_profile_id"],
                "platform_name": row["platform_profile_name_snapshot"],
                "account_id": row["platform_account_id"],
                "account_label": row["platform_account_label_snapshot"],
                "actual_title": row["actual_title"],
                "final_url": url_info.original_url,
                "normalized_url": url_info.normalized_url,
                "hostname": url_info.hostname,
                "published_at": row["published_at"],
                "verified_at": row["verified_at"],
                "verified_by": row["verified_by"],
                "source_pa_id": row["published_article_id"],
                "registered_by": row["work_created_by"],
            },
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO article_publication_events (
                    id, article_publication_id, action, snapshot_payload, comment, actor_id, created_at
                ) VALUES (
                    :id, :pub_id, 'VERIFIED_SYNCED', CAST(:payload AS JSONB),
                    '0081 迁移回填存量核验发布', :actor_id, :ts
                )
                """
            ),
            {
                "id": event_id,
                "pub_id": pub_id,
                "payload": json.dumps(
                    {
                        "source_published_article_id": str(row["published_article_id"]),
                        "verification_id": str(row["verification_id"]),
                        "final_url": url_info.original_url,
                    }
                ),
                "actor_id": row["verified_by"],
                "ts": row["verified_at"],
            },
        )


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0081_unified_articles_and_publications.sql").read_text(encoding="utf-8"))
    _backfill_existing_published_articles()


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0081_articles_publications is forbidden to protect unified article and publication history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
