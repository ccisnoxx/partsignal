"""当前操作者命令边界：User → 请求 Session，必须先于业务资源锁。"""

from collections.abc import Collection, Iterator
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import CURRENT_SESSION_ID, assert_account_types
from app.errors import AppError
from app.models.identity import SessionRecord, User
from app.schemas.common import AccountType


def discard_auth_heartbeat(db: Session) -> None:
    """活动提示不裁决资格；不得让自动 flush 在 User 锁前获取 Session 写锁。"""
    for record in list(db.dirty):
        if isinstance(record, SessionRecord):
            db.expire(record, ["last_seen_at"])


def require_command_session(db: Session, actor_id: UUID, *, lock: bool = False) -> None:
    """只复核认证入口绑定的会话；内部直接命令没有 HTTP 会话上下文。"""
    session_id = db.info.get(CURRENT_SESSION_ID)
    if session_id is None:
        return
    statement = select(
        SessionRecord.user_id,
        SessionRecord.revoked_at,
        SessionRecord.expires_at,
        func.clock_timestamp(),
    ).where(SessionRecord.id == session_id)
    if lock:
        # 不加载 joined User；此处 User 已锁定，Session SHARE 排斥撤销/删除。
        statement = statement.with_for_update(read=True, of=SessionRecord)
    with db.no_autoflush:
        row = db.execute(statement).one_or_none()
    if row is None or row[0] != actor_id or row[1] is not None or row[2] <= row[3]:
        raise AppError("AUTH_REQUIRED", "登录会话无效或已过期", 401)


@contextmanager
def current_actor_command(
    db: Session, actor: User, *, allowed: Collection[AccountType]
) -> Iterator[User]:
    """命令持有身份锁直到业务 commit；调用者不得预先持有业务资源锁。"""
    try:
        with db.no_autoflush:
            discard_auth_heartbeat(db)
            # SHARE 阻止身份修改/删除，兼容 FK KEY SHARE 与同用户并发资源命令。
            current = db.scalar(
                select(User)
                .where(User.id == actor.id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
            if current is None or not current.is_active:
                raise AppError("AUTH_REQUIRED", "账号已停用或不存在", 401)
            if current.must_change_password:
                raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
            assert_account_types(current, allowed)
            require_command_session(db, current.id, lock=True)
            yield current
    except Exception:
        db.rollback()
        raise
