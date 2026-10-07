"""1000-root投影成本及真实Redis/Celery十路并发；仅使用本地provider。"""

import base64
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from celery.contrib.testing.worker import start_worker
from redis import Redis
from sqlalchemy import select

from app.config import settings
from app.geo_fake_server import running_geo_fake
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_observability import GeoOperationHealth
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.services import geo_analysis_dispatch
from app.services.geo_run_lifecycle import database_now, refresh_batch
from app.worker import celery_app, collect_geo_run
from tests.integration.geo_plans_support import (
    plans_api,
    questions_api,
    questions_engine,
)
from tests.integration.geo_worker_support import prepared_worker_graph
from tests.integration.test_geo_batch_creation import create, large_matrix
from tests.integration.test_geo_collection_admission import profile_limits

__all__ = ['plans_api', 'questions_api', 'questions_engine']
pytestmark = pytest.mark.performance


def save(name, value):
    output = Path(os.environ.get('GEO_CAPACITY_OUTPUT', '/tmp/geo905-capacity'))
    output.mkdir(parents=True, exist_ok=True)
    (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def test_1000_batch_creation_and_projection(plans_api):
    api = plans_api
    payload = large_matrix(api)
    start = time.perf_counter()
    response = create(api, payload, 'capacity-1000')
    seconds = time.perf_counter() - start
    assert response.status_code == 201, response.text
    batch_id = UUID(response.json()['batch_id'])
    samples = []
    for _ in range(22):
        with api.api.factory.begin() as db:
            batch = db.scalar(select(GeoObservationBatch)
                              .where(GeoObservationBatch.id == batch_id).with_for_update())
            now = database_now(db)
            started = time.perf_counter()
            refresh_batch(db, batch, now)
            samples.append(time.perf_counter() - started)
            assert batch.status == 'QUEUED' and batch.revision == 1
    with api.api.factory() as db:
        rows = db.execute(select(GeoObservationRun.run_cell_key, GeoObservationRun.attempt_no)
                          .where(GeoObservationRun.batch_id == batch_id)).all()
    assert len(rows) == len({r.run_cell_key for r in rows}) == 1000
    assert {r.attempt_no for r in rows} == {1}
    save('batch.json', {'roots': len(rows), 'creation_seconds': seconds,
                        'projection_samples_seconds': samples[2:],
                        'projection_p95_seconds': sorted(samples[2:])[18]})
    assert seconds < 5.0
    assert create(api, payload, 'capacity-1000').json() == response.json()


def test_ten_celery_workers_claim_and_duplicate_messages(plans_api, monkeypatch):
    queue = f'geo905-{uuid4().hex}'
    redis = Redis.from_url(settings.redis_url)
    barrier = threading.Barrier(10, timeout=15)
    with (running_geo_fake() as provider,
          prepared_worker_graph(plans_api, monkeypatch, provider) as graph):
        # 无db参数的Celery/heartbeat观测也必须写本fixture，不能污染持久开发库。
        engine = graph.api.api.factory.kw['bind']
        monkeypatch.setattr(settings, 'database_url',
                            engine.url.render_as_string(hide_password=False))
        profile_limits(graph, concurrency=10, per_minute=600)
        first = graph.create(repeat_count=10)
        with graph.api.api.factory() as db:
            batch_id = db.get(GeoObservationRun, first).batch_id
            identities = list(db.scalars(select(GeoObservationRun.id)
                                         .where(GeoObservationRun.batch_id == batch_id)))
        # 十个真实HTTP请求必须同时到达：证明外部I/O没有持有批次/准入锁。
        original = provider.state.record

        def concurrent(identity, body):
            result = original(identity, body)
            barrier.wait()
            return result

        monkeypatch.setattr(provider.state, 'record', concurrent)
        # 本测量只拥有采集，不在默认队列生成不被消费的分析消息。
        monkeypatch.setattr(geo_analysis_dispatch, 'dispatch_collected_run',
                            lambda *_args: False)
        monkeypatch.setattr('app.worker.dispatch_collected_run', lambda *_args: False)
        completed = set()
        finished = threading.Event()
        errors = []

        def received(sender=None, **kwargs):
            if sender.name == collect_geo_run.name:
                if kwargs.get('state') != 'SUCCESS':
                    errors.append(kwargs.get('state'))
                completed.add(kwargs['task_id'])
                if len(completed) == 20:
                    finished.set()

        from celery.signals import task_postrun

        task_postrun.connect(received, weak=False)
        started = time.perf_counter()
        try:
            for identity in identities * 2:
                collect_geo_run.apply_async(args=[str(identity)], queue=queue, retry=False)
            messages = redis.lrange(queue, 0, -1)
            assert len(messages) == 20
            for raw in messages:
                message = json.loads(raw)
                body = json.loads(base64.b64decode(message['body']))
                assert len(body[0]) == 1 and UUID(body[0][0]) in identities
                assert body[1] == {}
            with start_worker(celery_app, pool='threads', concurrency=10, queues=[queue],
                              perform_ping_check=False, shutdown_timeout=20, loglevel='ERROR'):
                assert finished.wait(30), '十路采集未在限时内完成'
            assert not errors
            with graph.api.api.factory() as db:
                rows = list(db.scalars(select(GeoObservationRun)
                                       .where(GeoObservationRun.batch_id == batch_id)))
                answers = list(db.scalars(select(GeoAnswerSnapshot.run_id)
                                          .where(GeoAnswerSnapshot.run_id.in_(identities))))
            assert len(rows) == len(answers) == 10
            assert all(r.status == 'COLLECTED' and r.external_call_state == 'COMPLETED'
                       and r.lease_token is None for r in rows)
            calls = provider.state.snapshot(graph.call_id)['count']
            assert calls == 10 and redis.llen(queue) == 0
            with graph.api.api.factory() as db:
                health = db.get(GeoOperationHealth, 'collect_task')
                assert health.success_count == 20 and health.failure_count == 0
            save('workers.json', {'concurrency': 10, 'messages': 20, 'runs': len(rows),
                                  'provider_calls': calls,
                                  'seconds': time.perf_counter() - started,
                                  'pool': 'threads', 'external_platform_calls': 0})
        finally:
            task_postrun.disconnect(received)
            redis.delete(queue)
            redis.close()


def test_ten_prefork_processes_consume_startup_configuration(plans_api, monkeypatch):
    """独立进程使用实际Settings/PG/Redis；虚构adapter资格只存在于测试入口。"""
    queue = f'geo905-prefork-{uuid4().hex}'
    barrier = threading.Barrier(10, timeout=15)
    with (running_geo_fake() as provider,
          prepared_worker_graph(plans_api, monkeypatch, provider) as graph):
        profile_limits(graph, concurrency=10, per_minute=600)
        first = graph.create(repeat_count=10)
        with graph.api.api.factory() as db:
            batch_id = db.get(GeoObservationRun, first).batch_id
            identities = list(db.scalars(select(GeoObservationRun.id)
                                         .where(GeoObservationRun.batch_id == batch_id)))
        original = provider.state.record

        def concurrent(identity, body):
            result = original(identity, body)
            barrier.wait()
            return result

        monkeypatch.setattr(provider.state, 'record', concurrent)
        code = """
import sys
from dataclasses import replace
from types import MappingProxyType
from app.collectors.registry import collector_registry
import app.worker as worker
# 仅fixture的虚构采集资格；不改变生产注册目录，不自动外发分析消息。
entry = replace(collector_registry.resolve('openai-compatible-chat'), approved=True)
collector_registry._entries = MappingProxyType({'manual': collector_registry.resolve('manual'),
                                              entry.key: entry})
worker.dispatch_collected_run = lambda *_: False
worker.celery_app.conf.task_default_queue = sys.argv[1]
worker.celery_app.worker_main(['worker', '--pool=prefork', '-Q', sys.argv[1],
                             '--loglevel=ERROR', '--without-gossip', '--without-mingle'])
"""
        engine = graph.api.api.factory.kw['bind']
        environment = {**os.environ, 'APP_ENV': 'test', 'CELERY_CONCURRENCY': '10',
                       'DATABASE_URL': engine.url.render_as_string(hide_password=False),
                       'GEO_MONITORING_ENABLED': 'true', 'GEO_API_COLLECTION_ENABLED': 'true',
                       'AI_ALLOW_LOCAL_HTTP': 'true'}
        with Redis.from_url(settings.redis_url) as redis:
            started = time.perf_counter()
            peak_pss = 0
            max_processes = 0
            # 不转储子进程env或原始Celery日志；失败只输出固定状态。
            worker = subprocess.Popen([sys.executable, '-c', code, queue], env=environment,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for identity in identities * 2:
                    collect_geo_run.apply_async(args=[str(identity)], queue=queue, retry=False)
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    assert worker.poll() is None, 'prefork进程提前退出'
                    children = Path(f'/proc/{worker.pid}/task/{worker.pid}/children')
                    processes = [str(worker.pid), *children.read_text().split()]
                    pss = 0
                    for pid in processes:
                        memory = Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines()
                        pss += int(next(line.split()[1] for line in memory
                                        if line.startswith('Pss:'))) * 1024
                    peak_pss = max(peak_pss, pss)
                    max_processes = max(max_processes, len(processes))
                    with graph.api.api.factory() as db:
                        states = list(db.scalars(select(GeoObservationRun.status)
                                                 .where(GeoObservationRun.id.in_(identities))))
                    if states == ['COLLECTED'] * 10 and redis.llen(queue) == 0:
                        break
                    time.sleep(.2)
                else:
                    pytest.fail('十路prefork未在限时内完成')
                elapsed = time.perf_counter() - started
                worker.terminate()  # warm shutdown：消费中的重复消息完成后退出。
                assert worker.wait(timeout=20) == 0
                assert max_processes == 11 and peak_pss > 0
                assert provider.state.snapshot(graph.call_id)['count'] == 10
                with graph.api.api.factory() as db:
                    answers = list(db.scalars(select(GeoAnswerSnapshot.run_id)
                                              .where(GeoAnswerSnapshot.run_id.in_(identities))))
                    assert len(answers) == 10
                save('prefork.json', {'concurrency': 10, 'messages': 20, 'runs': 10,
                                      'provider_calls': 10, 'collection_seconds': elapsed,
                                      'pool': 'prefork', 'peak_sampled_pss_bytes': peak_pss,
                                      'process_count': max_processes, 'external_platform_calls': 0})
            finally:
                if worker.poll() is None:
                    worker.terminate()
                    try:
                        worker.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        worker.kill()
                        worker.wait(timeout=5)
                redis.delete(queue)
