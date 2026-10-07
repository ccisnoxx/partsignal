"""隔离 test 进程入口；生产 API/Worker、Collector 与事务语义保持原样。"""

from __future__ import annotations

import importlib
import re
import sys
from dataclasses import replace
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from tests.geo_e2e_environment import (
    MODES,
    PROVIDER_API_URL,
    PROVIDER_URL,
    validate_owned_environment,
)

PROMPT_PATTERN = re.compile(
    r"GEO408 (SUCCESS|RATE_LIMIT|UNKNOWN|INTERNAL|BUDGET) "
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.ASCII,
)
_assembled = False
_entries: dict[str, Any] = {}


def scenario_name(prompt: str) -> str:
    match = PROMPT_PATTERN.fullmatch(prompt)
    if match is None or str(UUID(match[2])) != match[2]:
        raise ValueError("GEO E2E 仅允许闭合的虚构 GEO408 prompt")
    return match[1]


def fictional_input(snapshot: dict[str, Any]) -> dict[str, Any]:
    """仅虚构且无产品绑定的快照可成为 PUBLIC；INTERNAL 场景继续测试生产拒绝。"""
    name = scenario_name(snapshot["prompt"]["prompt_text"])
    subjects = snapshot["subjects"]
    if not subjects or any(
        item["product_id"] is not None or not item["canonical_name"].startswith("GEO408 ")
        for item in subjects
    ):
        raise ValueError("GEO E2E PUBLIC 输入必须为无产品绑定的虚构监测身份")
    return {**snapshot, "data_classification": "INTERNAL" if name == "INTERNAL" else "PUBLIC"}


def scenario_payload(prompt: str, attempt_no: int) -> dict[str, Any]:
    if type(attempt_no) is not int or attempt_no < 1:
        raise ValueError("GEO E2E 必须读取真实 attempt_no")
    name = scenario_name(prompt)
    mode = "citations"
    if attempt_no == 1 and name == "RATE_LIMIT":
        mode = "429"
    elif attempt_no == 1 and name == "UNKNOWN":
        mode = "disconnect"
    return {
        "mode": mode,
        "answer_text": "GEO408 仅供测试的虚构回答；不得用于真实选型。",
        "partial_usage": True,
        "reported_cost": True,
        "web_search_observed": None,
    }


def require_provider_url(value: str) -> None:
    if value != PROVIDER_API_URL:
        raise ValueError("GEO E2E 请求只能发送至精确回环 provider API")


def assemble() -> None:
    """只在独立工厂进程中装配一次；先验证，后批准，最后导入业务调用者。"""
    global _assembled
    if _assembled:
        return
    environment = validate_owned_environment()
    # 工厂必须先于消费者导入，保证默认参数与 from-import 都读取同一个测试 registry。
    if any(name.startswith("app.services.") for name in sys.modules) or any(
        name in sys.modules
        for name in ("app.main", "app.worker", "app.collectors.openai_compatible")
    ):
        raise RuntimeError("GEO E2E 必须从独立工厂入口启动，禁止污染已装配业务进程")
    from app.collectors import registry
    from app.config import settings

    if (
        settings.database_url != environment.database_url
        or settings.redis_url != environment.redis_url
        or settings.environment != "test"
        or not settings.ai_allow_local_http
        or (settings.geo_monitoring_enabled, settings.geo_api_collection_enabled)
        != MODES[environment.mode]
        or settings.geo_browser_collection_enabled
        or settings.geo_opportunity_evaluation_enabled
    ):
        raise ValueError("GEO E2E 当前 Settings 与已验证环境不一致")
    if settings.geo_daily_budget_limit is not None:
        raise ValueError("GEO E2E 不允许继承全局日预算；预算场景使用显式批次预算")
    registry.collector_registry = registry.CollectorRegistry(
        [
            replace(registry.collector_registry.resolve("openai-compatible-chat"), approved=True),
            registry.collector_registry.resolve("manual"),
        ]
    )
    _install_diagnostics()
    _install_batch_inputs()
    _install_collector()
    _assembled = True


def _loopback_transport(attempt_id: UUID | None = None) -> Any:
    from app.services.pinned_http import PinnedHTTPTransport

    class LoopbackTransport(PinnedHTTPTransport):
        def request(self, **arguments: Any) -> Any:
            require_provider_url(arguments["base_url"])
            if arguments["method"] == "POST":
                if attempt_id is None:
                    raise ValueError("GEO E2E POST 必须有独立 attempt UUID")
                headers = {
                    key: value
                    for key, value in arguments["headers"].items()
                    if key.lower() != "x-geo-attempt-id"
                }
                arguments["headers"] = {**headers, "X-GEO-Attempt-ID": str(attempt_id)}
            return super().request(**arguments)

    return LoopbackTransport(allow_local_http=True)


def _install_diagnostics() -> None:
    from app.services import openai_client

    original_client = openai_client.OpenAICompatibleClient

    class DiagnosticClient(original_client):
        def test_connection(self, **arguments: Any) -> str:
            # Profile reservation 指定其真实诊断 ID；模型诊断另生成 UUID。
            headers = {
                key: value
                for key, value in arguments["headers"].items()
                if key.lower() != "x-geo-attempt-id"
            }
            attempt = arguments.pop("_geo_e2e_attempt_id", None) or uuid4()
            self._transport = _loopback_transport(attempt)
            arguments["headers"] = headers
            return super().test_connection(**arguments)

        def discover_models(self, **arguments: Any) -> list[str]:
            self._transport = _loopback_transport()
            return super().discover_models(**arguments)

    openai_client.OpenAICompatibleClient = DiagnosticClient
    from app.services import geo_profile_tests

    reserve = geo_profile_tests._reserve

    def reserve_diagnostic(*arguments: Any, **keywords: Any) -> Any:
        reservation = reserve(*arguments, **keywords)
        values = dict(reservation.arguments)
        values["_geo_e2e_attempt_id"] = reservation.attempt_id
        return replace(reservation, arguments=values)

    geo_profile_tests._reserve = reserve_diagnostic


def _install_batch_inputs() -> None:
    from app.services.geo_batch_snapshots import BatchInputs

    original_input = BatchInputs.input_for

    def input_for(self: Any, prompt_id: UUID, profile_id: UUID) -> dict[str, Any]:
        return fictional_input(original_input(self, prompt_id, profile_id))

    BatchInputs.input_for = input_for


def _install_collector() -> None:
    import httpx

    from app.collectors.contracts import CollectionEstimate, Money
    from app.models.geo_runs import GeoObservationRun
    from app.services import geo_collection_execution, geo_runs

    production_build = geo_collection_execution.build_collector

    class ControlledCollector:
        def __init__(self, collector: Any, attempt_no: int) -> None:
            self.collector = collector
            self.attempt_no = attempt_no

        @property
        def registration(self) -> Any:
            return self.collector.registration

        def validate_profile(self, profile: Any) -> Any:
            return self.collector.validate_profile(profile)

        def estimate(self, request: Any) -> Any:
            if scenario_name(request.prompt_text) == "BUDGET":
                return CollectionEstimate(cost=Money(amount=Decimal("0.001200"), currency="USD"))
            return self.collector.estimate(request)

        def collect(self, request: Any, *, before_send: Any) -> Any:
            payload = scenario_payload(request.prompt_text, self.attempt_no)
            # 控制协议只有闭合 fixture 参数；先配置，再执行真实 Collector 的一次发送。
            with httpx.Client(trust_env=False, timeout=5, follow_redirects=False) as client:
                response = client.put(
                    f"{PROVIDER_URL}/__geo__/scenarios/{request.run_id}", json=payload
                )
                response.raise_for_status()
            return self.collector.collect(request, before_send=before_send)

    def build_collector(db: Any, request: Any) -> Any:
        from app.models.ai_generation import AIChannel

        channel = db.get(AIChannel, request.profile.ai_channel_id, populate_existing=True)
        if channel is None:
            raise ValueError("GEO E2E 渠道不存在")
        require_provider_url(channel.base_url)
        scenario_name(request.prompt_text)
        run = db.get(GeoObservationRun, request.run_id, populate_existing=True)
        if run is None:
            raise ValueError("GEO E2E Run 不存在")
        collector = production_build(db, request)
        # 只替换实例的传输装配；底层仍是生产 pinned transport 的 DNS/peer/发送实现。
        collector._transport = _loopback_transport(request.run_id)
        return ControlledCollector(collector, run.attempt_no)

    geo_collection_execution.build_collector = build_collector
    geo_runs.build_collector = build_collector


def __getattr__(name: str) -> Any:
    """Uvicorn/Celery 获取实际实例时才校验，普通单元导入不放宽生产状态。"""
    if name not in {"app", "celery_app"}:
        raise AttributeError(name)
    assemble()
    if name not in _entries:
        module = importlib.import_module("app.main" if name == "app" else "app.worker")
        _entries[name] = getattr(module, name)
        if name == "celery_app":
            _install_message_receipts()
    return _entries[name]


def message_receipts() -> Any:
    import os
    from pathlib import Path

    directory = Path(os.environ["PARTSIGNAL_E2E_GEO_MESSAGE_RECEIPTS"]).resolve()
    if (
        not directory.is_dir()
        or directory.name != "geo-message-receipts"
        or not directory.parent.name.startswith("partsignal-e2e-storage.")
    ):
        raise ValueError("GEO E2E 消息回执必须位于本轮独占临时目录")
    return directory


def _install_message_receipts() -> None:
    import json
    import os

    from celery.signals import task_postrun

    directory = message_receipts()

    def completed(sender: Any, task_id: str, args: Any, state: str, **keywords: Any) -> None:
        if sender.name != "partsignal.collect_geo_run":
            return
        identity, run_id = UUID(task_id), UUID(args[0])
        path = directory / str(identity)
        temporary = directory / f"{identity}.tmp"
        with temporary.open("x", encoding="utf-8") as output:
            json.dump({"run_id": str(run_id), "state": state}, output)
        os.replace(temporary, path)

    # test-only 完成事实解决 BRPOP→unacked 空窗；不是业务状态或第二套执行结果。
    task_postrun.connect(completed, weak=False)


def duplicate(run_identity: str) -> None:
    """真实投递两条相同稳定 ID 消息，并以 broker late-ack 状态证明它们已消费。"""
    import json
    import time

    from redis import Redis
    from sqlalchemy import select

    run_id = UUID(run_identity)
    if str(run_id) != run_identity:
        raise ValueError("GEO E2E duplicate 要求规范 Run UUID")
    assemble()
    from app.config import settings
    from app.db import SessionLocal
    from app.models.ai_generation import AIChannel
    from app.models.geo_runs import GeoObservationRun
    from app.worker import collect_geo_run

    with SessionLocal() as db:
        run = db.get(GeoObservationRun, run_id)
        # R4 页面等待分析完成；重复采集消息必须在最终状态下保持无操作。
        if run is None or run.status != "COMPLETED":
            raise ValueError("GEO E2E duplicate 只允许已完成分析的真实虚构 Run")
        if fictional_input(run.input_snapshot) != run.input_snapshot:
            raise ValueError("GEO E2E duplicate 冻结分类不符合虚构输入合同")
        channel = db.scalar(
            select(AIChannel).where(
                AIChannel.id == UUID(run.input_snapshot["profile"]["ai_channel_id"])
            )
        )
        if channel is None:
            raise ValueError("GEO E2E duplicate 渠道不存在")
        require_provider_url(channel.base_url)
    task_ids = {collect_geo_run.delay(run_identity).id for _ in range(2)}
    directory = message_receipts()
    deadline = time.monotonic() + 30
    with Redis.from_url(settings.redis_url) as broker:
        while True:
            with broker.pipeline() as pipeline:
                queued_raw, unacked_raw = (
                    pipeline.lrange("celery", 0, -1).hvals("unacked").execute()
                )
            queued = [json.loads(item) for item in queued_raw]
            unacked = [json.loads(item)[0] for item in unacked_raw]
            outstanding = {item.get("headers", {}).get("id") for item in [*queued, *unacked]}
            receipts = []
            for identity in task_ids:
                path = directory / str(UUID(identity))
                if path.is_file():
                    receipts.append(json.loads(path.read_text(encoding="utf-8")))
            if any(item != {"run_id": run_identity, "state": "SUCCESS"} for item in receipts):
                raise RuntimeError("GEO E2E duplicate Worker 回执失败或身份不匹配")
            if len(receipts) == 2 and not (task_ids & outstanding):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("GEO E2E duplicate 消息未在截止前消费")
            time.sleep(0.05)
    print(f"E2E_GEO_DUPLICATE run_id={run_id} status=consumed", flush=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="隔离 GEO E2E 的真实 broker 操作")
    parser.add_argument("action", choices=("duplicate",))
    parser.add_argument("run_id")
    arguments = parser.parse_args()
    duplicate(arguments.run_id)


if __name__ == "__main__":
    main()
