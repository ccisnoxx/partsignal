"""浏览器会话聚合：Profile 锁内裁决引用，撤销墓碑先于卷清理。"""

import hmac
import os
import stat
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.geo_browser_sessions import GeoBrowserSession
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.schemas.geo_browser_sessions import (
    BrowserSessionAction,
    BrowserSessionHealth,
    GeoBrowserSessionContext,
    GeoBrowserSessionEnvelope,
    GeoBrowserSessionImport,
    GeoBrowserSessionMetadata,
)
from app.services.geo_browser_session_vault import BrowserSessionVault
from app.services.geo_browser_storage_state import validate_storage_state
from app.services.geo_surface_locks import command, lock_profile


def _vault() -> BrowserSessionVault:
    return BrowserSessionVault(
        settings.geo_browser_session_root, settings.geo_browser_session_public_key_file
    )


def _audit(
    db: Session,
    profile: GeoCollectionProfile,
    actor: User,
    request_id: str,
    action: str,
    reference: UUID,
) -> None:
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=f"geo_browser_session.{action}",
            target_type="GeoCollectionProfile",
            target_id=profile.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="浏览器会话管理操作已完成",
            details={"facts": {"revision": profile.revision, "session_reference": str(reference)}},
        ),
    )


def _changed(profile: GeoCollectionProfile, *, invalidate: bool = False) -> None:
    profile.session_revision += 1
    profile.revision += 1
    profile.updated_at = max(datetime.now(UTC), profile.updated_at)
    if invalidate:
        profile.is_active = False
        profile.last_test_status = "UNTESTED"
        profile.last_tested_at = None
        profile.last_test_error_code = None
        profile.last_test_error_summary = None
        profile.test_attempt_id = None


def _browser(profile: GeoCollectionProfile) -> None:
    if profile.collection_mode != "BROWSER":
        raise AppError("GEO_BROWSER_PROFILE_REQUIRED", "仅浏览器配置支持会话管理", 409)


def _rows(db: Session, profile_id: UUID, *, lock: bool = False) -> list[GeoBrowserSession]:
    query = select(GeoBrowserSession).where(GeoBrowserSession.profile_id == profile_id)
    if lock:
        query = query.order_by(GeoBrowserSession.id).with_for_update()
    return list(db.scalars(query.execution_options(populate_existing=True, autoflush=False)))


def _health(row: GeoBrowserSession, now: datetime) -> BrowserSessionHealth:
    if row.revoked_at is None and row.expires_at <= now:
        return "EXPIRED"
    return cast(BrowserSessionHealth, row.health)


def _import_website(profile: GeoCollectionProfile, surface: GeoEngineSurface | None) -> str | None:
    if (
        surface is not None
        and surface.compliance_status == "APPROVED"
        and profile.login_state == "AUTHENTICATED"
        and surface.website_url is not None
        and surface.website_url.startswith("https://")
    ):
        return surface.website_url
    return None


def _context(db: Session, profile: GeoCollectionProfile) -> GeoBrowserSessionContext:
    rows = _rows(db, profile.id)
    row = next((item for item in rows if item.revoked_at is None), None)
    if row is None and rows:
        row = max(rows, key=lambda item: (item.created_at, item.id))
    pending = sum(item.revoked_at is not None and item.purged_at is None for item in rows)
    actions: list[BrowserSessionAction] = []
    surface = db.get(GeoEngineSurface, profile.engine_surface_id)
    if _import_website(profile, surface) is not None:
        actions.append("IMPORT")
    if row is not None and row.revoked_at is None:
        actions += ["CHECK_HEALTH", "REVOKE"]
    if pending:
        actions.append("PURGE")
    return GeoBrowserSessionContext(
        profile_id=profile.id,
        profile_revision=profile.revision,
        session=GeoBrowserSessionMetadata(
            session_reference=row.id,
            health=_health(row, datetime.now(UTC)),
            expires_at=row.expires_at,
            imported_at=row.created_at,
            last_checked_at=row.last_checked_at,
            revoked_at=row.revoked_at,
            purged_at=row.purged_at,
        )
        if row is not None
        else None,
        cleanup_pending_count=pending,
        available_actions=actions,
        login_probe="NOT_IMPLEMENTED",
    )


def get_context(*, db: Session, profile_id: UUID, actor: User) -> GeoBrowserSessionContext:
    with command(db, actor):
        revision = db.scalar(
            select(GeoCollectionProfile.revision).where(GeoCollectionProfile.id == profile_id)
        )
        if revision is None:
            raise not_found("GEO 采集配置")
        profile = lock_profile(db, profile_id, revision)
        _browser(profile)
        return _context(db, profile)


def import_session(
    *, db: Session, profile_id: UUID, payload: GeoBrowserSessionImport, actor: User, request_id: str
) -> GeoBrowserSessionContext:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, payload.expected_revision)
        _browser(profile)
        surface = db.get(GeoEngineSurface, profile.engine_surface_id)
        website = _import_website(profile, surface)
        if website is None:
            raise AppError(
                "GEO_BROWSER_SESSION_IMPORT_FORBIDDEN",
                "导入需要已批准观测面、HTTPS网站和专用登录配置",
                409,
            )
        now = datetime.now(UTC)
        expires = payload.expires_at.astimezone(UTC)
        plaintext = validate_storage_state(
            payload.storage_state.get_secret_value(), website, expires, now
        )
        reference = uuid4()
        digest = _vault().write(reference, profile.id, expires, plaintext)
        del plaintext
        for row in _rows(db, profile.id, lock=True):
            if row.revoked_at is None:
                row.revoked_at, row.revoked_by, row.health = now, current.id, "REVOKED"
                _audit(db, profile, current, request_id, "revoked", row.id)
        # 先释放数据库当前引用唯一键，再插入新引用；两者同事务不可部分提交。
        db.flush()
        db.add(
            GeoBrowserSession(
                id=reference,
                profile_id=profile.id,
                cipher_sha256=digest,
                expires_at=expires,
                health="AVAILABLE",
                last_checked_at=now,
                created_by=current.id,
                created_at=now,
            )
        )
        _changed(profile, invalidate=True)
        _audit(db, profile, current, request_id, "imported", reference)
        db.flush()
        db.commit()
    return _cleanup_after_commit(db, profile.id, actor, request_id)


def _target(db: Session, profile: GeoCollectionProfile, reference: UUID) -> GeoBrowserSession:
    row = next((item for item in _rows(db, profile.id, lock=True) if item.id == reference), None)
    if row is None:
        raise not_found("浏览器会话引用")
    return row


def check_health(
    *,
    db: Session,
    profile_id: UUID,
    expected_revision: int,
    reference: UUID,
    actor: User,
    request_id: str,
) -> GeoBrowserSessionContext:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, expected_revision)
        _browser(profile)
        row = _target(db, profile, reference)
        if row.revoked_at is not None:
            raise AppError("GEO_BROWSER_SESSION_REVOKED", "会话引用已撤销", 409)
        now = datetime.now(UTC)
        if row.expires_at <= now:
            row.health = "EXPIRED"
            row.revoked_at, row.revoked_by = now, current.id
            _changed(profile, invalidate=True)
        else:
            try:
                _vault().read(row.id, row.cipher_sha256)
                row.health = "AVAILABLE"
            except AppError as error:
                if error.code not in {
                    "GEO_BROWSER_SESSION_MISSING",
                    "GEO_BROWSER_SESSION_UNREADABLE",
                }:
                    raise
                row.health = "MISSING" if error.code.endswith("MISSING") else "UNREADABLE"
            _changed(profile, invalidate=row.health != "AVAILABLE")
        row.last_checked_at = max(now, row.last_checked_at)
        _audit(db, profile, current, request_id, "health_checked", row.id)
        db.flush()
        db.commit()
    return _cleanup_after_commit(db, profile.id, actor, request_id)


def revoke_session(
    *,
    db: Session,
    profile_id: UUID,
    expected_revision: int,
    reference: UUID,
    actor: User,
    request_id: str,
) -> GeoBrowserSessionContext:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, expected_revision)
        _browser(profile)
        row = _target(db, profile, reference)
        if row.revoked_at is None:
            row.revoked_at, row.revoked_by, row.health = datetime.now(UTC), current.id, "REVOKED"
            _changed(profile, invalidate=True)
            _audit(db, profile, current, request_id, "revoked", reference)
            db.flush()
        db.commit()
    return _cleanup_after_commit(db, profile.id, actor, request_id)


def purge_sessions(
    *, db: Session, profile_id: UUID, expected_revision: int, actor: User, request_id: str
) -> GeoBrowserSessionContext:
    with command(db, actor) as current:
        profile = lock_profile(db, profile_id, expected_revision)
        _browser(profile)
        pending = [
            row
            for row in _rows(db, profile.id, lock=True)
            if row.revoked_at is not None and row.purged_at is None
        ]
        if pending:
            vault = _vault()
            for row in pending:
                vault.delete(row.id)
                row.purged_at = datetime.now(UTC)
            _changed(profile)
            for row in pending:
                _audit(db, profile, current, request_id, "purged", row.id)
            db.flush()
        result = _context(db, profile)
        db.commit()
        return result


def _cleanup_after_commit(
    db: Session, profile_id: UUID, actor: User, request_id: str
) -> GeoBrowserSessionContext:
    context = get_context(db=db, profile_id=profile_id, actor=actor)
    if context.cleanup_pending_count:
        try:
            return purge_sessions(
                db=db,
                profile_id=profile_id,
                expected_revision=context.profile_revision,
                actor=actor,
                request_id=request_id,
            )
        except AppError as error:
            if error.code not in {"DEPENDENCY_UNAVAILABLE", "REVISION_CONFLICT"}:
                raise
            # 撤销已提交；显式返回清理待办，管理员可恢复，不伪造卷删除。
            return get_context(db=db, profile_id=profile_id, actor=actor)
    return context


def _service_actor(db: Session, supplied_key: str | None) -> User:
    try:
        fd = os.open(
            settings.geo_browser_session_service_key_file,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        )
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
                raise ValueError
            key = stream.read(513).strip()
            if not 32 <= len(key) <= 512:
                raise ValueError
    except (OSError, ValueError):
        raise AppError("DEPENDENCY_UNAVAILABLE", "浏览器服务身份未就绪", 503) from None
    if supplied_key is None or not hmac.compare_digest(key, supplied_key.encode("utf-8")):
        raise AppError("PERMISSION_DENIED", "浏览器服务身份无效", 403)
    if settings.geo_browser_session_service_user_id is None:
        raise AppError("DEPENDENCY_UNAVAILABLE", "浏览器服务身份未就绪", 503)
    actor = db.get(User, settings.geo_browser_session_service_user_id)
    if actor is None:
        raise AppError("PERMISSION_DENIED", "浏览器服务身份无效", 403)
    return actor


def access_session(
    *, db: Session, reference: UUID, profile_id: UUID, supplied_key: str | None, request_id: str
) -> GeoBrowserSessionEnvelope:
    actor = _service_actor(db, supplied_key)
    with command(db, actor) as current:
        revision = db.scalar(
            select(GeoCollectionProfile.revision).where(GeoCollectionProfile.id == profile_id)
        )
        if revision is None:
            raise not_found("GEO 采集配置")
        profile = lock_profile(db, profile_id, revision)
        _browser(profile)
        surface = db.get(GeoEngineSurface, profile.engine_surface_id)
        if not settings.geo_monitoring_enabled or not settings.geo_browser_collection_enabled:
            raise AppError("COLLECTOR_DISABLED", "浏览器采集当前关闭", 409)
        if (
            surface is None
            or not surface.is_active
            or surface.compliance_status != "APPROVED"
            or (not profile.is_active or profile.login_state != "AUTHENTICATED")
        ):
            raise AppError("GEO_PROFILE_INELIGIBLE", "配置当前不允许读取浏览器会话", 409)
        row = _target(db, profile, reference)
        if row.revoked_at is not None:
            raise AppError("GEO_BROWSER_SESSION_REVOKED", "会话引用已撤销", 409)
        if row.expires_at <= datetime.now(UTC):
            raise AppError("PROFILE_NEEDS_REAUTH", "浏览器会话已过期，请人工重新登录导入", 409)
        envelope = _vault().read(row.id, row.cipher_sha256)
        _audit(db, profile, current, request_id, "accessed", row.id)
        db.flush()
        db.commit()
        return GeoBrowserSessionEnvelope(
            session_reference=row.id,
            profile_id=profile.id,
            expires_at=row.expires_at,
            envelope=envelope,
        )
