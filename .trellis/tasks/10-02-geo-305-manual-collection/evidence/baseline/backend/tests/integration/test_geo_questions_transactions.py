"""在真实事务边界证明唯一、CAS、删除交错与读取快照。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import UUID

import pytest
from sqlalchemy import select, text

from app.errors import AppError
from app.models.configuration import QueryTopic
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import User
from app.schemas.geo_prompt_variants import GeoPromptVariantCreate, GeoPromptVariantUpdate
from app.services import geo_prompt_variant_queries as queries
from app.services import geo_prompt_variants as commands
from app.services.content_planning import delete_query_topic
from tests.integration.geo_questions_support import QuestionsAPI, questions_api, questions_engine

pytestmark = pytest.mark.integration
__all__ = ["questions_api", "questions_engine"]


def test_parallel_create_has_one_identity_and_one_audit(questions_api: QuestionsAPI) -> None:
    api = questions_api
    barrier = Barrier(2)

    def create(actor_id):
        with api.factory() as db:
            actor = db.get(User, actor_id)
            barrier.wait(timeout=5)
            try:
                return commands.create_variant(
                    db=db,
                    query_topic_id=api.topic,
                    payload=GeoPromptVariantCreate.model_validate(api.payload()),
                    actor=actor,
                    request_id="geo202-parallel-create",
                ).id
            except AppError as exc:
                return exc.code

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(create, actor) for actor in (api.admin_id, api.engineer_id)]
        results = [f.result(timeout=10) for f in futures]
    assert sum(isinstance(r, UUID) for r in results) == 1
    assert "GEO_PROMPT_VARIANT_EXISTS" in results
    with api.factory() as db:
        assert (
            len(
                list(
                    db.scalars(
                        select(GeoPromptVariant).where(GeoPromptVariant.query_topic_id == api.topic)
                    )
                )
            )
            == 1
        )
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM audit_logs WHERE action='geo_prompt_variant.created' "
                    "AND target_id IN (SELECT CAST(id AS text) FROM geo_prompt_variants "
                    "WHERE query_topic_id=:topic)"
                ),
                {"topic": api.topic},
            )
            == 1
        )


def test_parallel_revision_has_one_winner(questions_api: QuestionsAPI) -> None:
    api = questions_api
    row = api.create()
    barrier = Barrier(2)

    def change(actor_id, prompt):
        with api.factory() as db:
            actor = db.get(User, actor_id)
            barrier.wait(timeout=5)
            try:
                return commands.update_variant(
                    db=db,
                    variant_id=UUID(row["id"]),
                    payload=GeoPromptVariantUpdate(expected_revision=0, prompt_text=prompt),
                    actor=actor,
                    request_id="geo202-parallel-update",
                ).revision
            except AppError as exc:
                return exc.code

    with ThreadPoolExecutor(2) as pool:
        futures = [
            pool.submit(change, api.admin_id, "管理员新文本"),
            pool.submit(change, api.engineer_id, "工程师新文本"),
        ]
        results = [f.result(timeout=10) for f in futures]
    assert sorted(str(r) for r in results) == ["1", "REVISION_CONFLICT"]


def test_topic_delete_wins_create_fails_without_orphan(questions_api: QuestionsAPI) -> None:
    api = questions_api
    entered = Event()

    def create():
        with api.factory() as db:
            actor = db.get(User, api.engineer_id)
            entered.set()
            try:
                commands.create_variant(
                    db=db,
                    query_topic_id=api.topic,
                    payload=GeoPromptVariantCreate.model_validate(api.payload()),
                    actor=actor,
                    request_id="geo202-delete-interleave",
                )
            except AppError as exc:
                return exc.code

    with api.factory() as deleter, ThreadPoolExecutor(1) as pool:
        deleter.scalar(select(QueryTopic).where(QueryTopic.id == api.topic).with_for_update())
        future = pool.submit(create)
        assert entered.wait(timeout=5)
        delete_query_topic(
            db=deleter,
            query_topic_id=api.topic,
            expected_revision=0,
            actor=deleter.get(User, api.admin_id),
            request_id="geo202-delete-topic",
        )
        assert future.result(timeout=10) == "NOT_FOUND"
    with api.factory() as db:
        assert not list(
            db.scalars(select(GeoPromptVariant).where(GeoPromptVariant.query_topic_id == api.topic))
        )


def test_creator_inactive_after_initial_read_is_rejected(questions_api: QuestionsAPI) -> None:
    api = questions_api
    with api.factory() as stale:
        actor = stale.get(User, api.engineer_id)
        with api.factory() as changer:
            user = changer.get(User, api.engineer_id)
            user.is_active = False
            user.revision += 1
            changer.commit()
        with pytest.raises(AppError) as caught:
            commands.create_variant(
                db=stale,
                query_topic_id=api.topic,
                payload=GeoPromptVariantCreate.model_validate(api.payload()),
                actor=actor,
                request_id="geo202-stale-actor",
            )
        assert caught.value.code == "AUTH_REQUIRED"
    with api.factory() as db:
        assert not list(
            db.scalars(select(GeoPromptVariant).where(GeoPromptVariant.query_topic_id == api.topic))
        )


def test_repeatable_read_keeps_topic_and_variant_in_one_snapshot(
    questions_api: QuestionsAPI,
) -> None:
    api = questions_api
    row = api.create()
    with api.factory() as reader:
        queries.read_snapshot(reader)
        before = queries.get_variant(reader, UUID(row["id"]))
        with api.factory() as writer:
            topic = writer.get(QueryTopic, api.topic)
            topic.canonical_question = "下一次读取才看到"
            topic.revision += 1
            writer.commit()
        after = queries.get_variant(reader, UUID(row["id"]))
        assert before == after
        assert reader.scalar(text("SHOW transaction_isolation")) == "repeatable read"
    with api.factory() as reader:
        assert (
            queries.get_variant(reader, UUID(row["id"])).query_topic.canonical_question
            == "下一次读取才看到"
        )


@pytest.mark.parametrize("topic_command", ["update", "delete"])
def test_same_actor_topic_command_and_variant_create_have_no_lock_cycle(
    questions_api: QuestionsAPI, monkeypatch: pytest.MonkeyPatch, topic_command: str
) -> None:
    """既有主题命令的成功审计 FK 锁必须能越过变体的身份守卫。"""
    from app.schemas.configuration import IntentType, QueryTopicUpdate
    from app.services.content_planning import update_query_topic

    api = questions_api
    actor_locked = Event()
    original = commands._lock_topic

    def observed_topic_lock(db, topic_id):
        # 进入这一边界时真实 User 锁已取得；不用 sleep 猜测事务调度。
        actor_locked.set()
        return original(db, topic_id)

    monkeypatch.setattr(commands, "_lock_topic", observed_topic_lock)

    def create():
        with api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            try:
                return commands.create_variant(
                    db=db,
                    query_topic_id=api.topic,
                    payload=GeoPromptVariantCreate.model_validate(api.payload()),
                    actor=db.get(User, api.admin_id),
                    request_id="geo202-same-actor-create",
                )
            except AppError as exc:
                return exc.code

    with api.factory() as topic_db, ThreadPoolExecutor(1) as pool:
        topic_db.execute(text("SET LOCAL statement_timeout = '5s'"))
        topic_db.scalar(select(QueryTopic).where(QueryTopic.id == api.topic).with_for_update())
        actor = topic_db.get(User, api.admin_id)
        future = pool.submit(create)
        assert actor_locked.wait(timeout=5)
        if topic_command == "delete":
            delete_query_topic(
                db=topic_db,
                query_topic_id=api.topic,
                expected_revision=0,
                actor=actor,
                request_id="geo202-same-actor-delete",
            )
            assert future.result(timeout=10) == "NOT_FOUND"
        else:
            update_query_topic(
                db=topic_db,
                query_topic_id=api.topic,
                payload=QueryTopicUpdate(
                    expected_revision=0,
                    canonical_question="同账号并发更新后的主题",
                    intent_type=IntentType.PRODUCT,
                    variants=["旧数组不得导入"],
                ),
                actor=actor,
                request_id="geo202-same-actor-update",
            )
            created = future.result(timeout=10)
            assert created.query_topic.canonical_question == "同账号并发更新后的主题"
            assert created.query_topic.revision == 1
    with api.factory() as db:
        assert db.scalar(
            text(
                "SELECT count(*) FROM audit_logs WHERE request_id IN "
                "('geo202-same-actor-update','geo202-same-actor-delete',"
                "'geo202-same-actor-create') "
                "AND actor_id=:actor"
            ),
            {"actor": api.admin_id},
        ) == (1 if topic_command == "delete" else 2)


def test_same_cookie_password_change_and_variant_create_have_no_session_user_cycle(
    questions_api: QuestionsAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """真实改密命令与认证 heartbeat 不能形成 Session→User 的反向锁环。"""
    from datetime import UTC, datetime

    from app.models.identity import SessionRecord
    from app.schemas.common import ChangePasswordRequest
    from app.security import hash_password
    from app.services.identity import change_password

    api = questions_api
    with api.factory() as setup:
        setup.get(User, api.admin_id).password_hash = hash_password("geo202-old-fake-password")
        setup.commit()
    actor_locked = Event()
    original = commands._lock_topic

    def observed_topic_lock(db, topic_id):
        actor_locked.set()
        return original(db, topic_id)

    monkeypatch.setattr(commands, "_lock_topic", observed_topic_lock)

    def create():
        with api.factory() as db:
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            current = db.scalar(select(SessionRecord).where(SessionRecord.user_id == api.admin_id))
            current.last_seen_at = datetime.now(UTC)  # 与真实认证依赖相同的 pending write。
            return commands.create_variant(
                db=db,
                query_topic_id=api.topic,
                payload=GeoPromptVariantCreate.model_validate(api.payload()),
                actor=current.user,
                request_id="geo202-same-cookie-create",
            )

    with api.factory() as password_db, ThreadPoolExecutor(1) as pool:
        password_db.execute(text("SET LOCAL statement_timeout = '5s'"))
        current = password_db.scalar(
            select(SessionRecord)
            .where(SessionRecord.user_id == api.admin_id)
            .with_for_update(of=SessionRecord)
        )
        current.last_seen_at = datetime.now(UTC)
        future = pool.submit(create)
        assert actor_locked.wait(timeout=5)
        change_password(
            db=password_db,
            current=current,
            payload=ChangePasswordRequest(
                old_password="geo202-old-fake-password", new_password="geo202-new-fake-password"
            ),
            request_id="geo202-same-cookie-password",
        )
        created = future.result(timeout=10)
        assert created.created_by == api.admin_id
    with api.factory() as db:
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM audit_logs WHERE request_id IN "
                    "('geo202-same-cookie-create','geo202-same-cookie-password')"
                )
            )
            == 2
        )
