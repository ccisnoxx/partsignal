"""GEO-905：实际认证请求、100k流发送与生命周期测量，不缓冲响应正文。"""

import asyncio
import csv
import gc
import json
import math
import os
import time
from pathlib import Path
from urllib.parse import urlencode

import psycopg
import pytest
from sqlalchemy import event

from app.main import app
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_geo_overview import overview_api
from tests.performance.seed_geo import seed

__all__ = ["analysis_engine", "answer_database", "harness", "plan_database", "review_api",
           "run_database", "overview_api"]
pytestmark = pytest.mark.performance


def rss_bytes():
    # 目标运行入口是Linux容器；不把平台不可用猜成0。
    return int(Path('/proc/self/statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE')


def write(output, name, value):
    output.mkdir(parents=True, exist_ok=True)
    (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


async def export(api, query, *, stop_after=None):
    stats = {"rows": 0, "bytes": 0, "chunks": 0, "rss_samples": [], "as_of": None}
    previous = None
    started = time.perf_counter()
    first = None

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        nonlocal first, previous
        if message['type'] == 'http.response.start':
            assert message['status'] == 200
            headers = dict(message['headers'])
            assert headers[b'cache-control'] == b'no-store'
            stats['as_of'] = headers[b'x-report-as-of'].decode()
            return
        body = message.get('body', b'')
        if not body:
            return
        first = first or time.perf_counter() - started
        stats['chunks'] += 1
        stats['bytes'] += len(body)
        records = csv.reader(body.decode('utf-8-sig').splitlines())
        if stats['chunks'] == 1:
            columns = next(records)
            stats['columns'] = columns
        for record in records:
            row = dict(zip(stats['columns'], record, strict=True))
            assert row['as_of'] == stats['as_of']
            key = row['created_at'], row['run_id']
            if previous:
                assert key[0] < previous[0] or (key[0] == previous[0] and key[1] > previous[1])
            previous = key
            stats['rows'] += 1
        if stats['rows'] % 1000 == 0:
            stats['rss_samples'].append([stats['rows'], rss_bytes()])
        if stop_after and stats['rows'] >= stop_after:
            raise asyncio.CancelledError()

    cookie = '; '.join(f'{key}={value}' for key, value in api.engineer.cookies.items())
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
             "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": "/api/v1/geo/reports/runs.csv", "raw_path": b"/api/v1/geo/reports/runs.csv",
             "query_string": urlencode(query).encode(), "root_path": "",
             "headers": [(b'host', b'testserver'), (b'cookie', cookie.encode())],
             "client": ('127.0.0.1', 10000), "server": ('testserver', 80)}
    try:
        await app(scope, receive, send)
    except asyncio.CancelledError:
        if not stop_after:
            raise
    stats['seconds'] = time.perf_counter() - started
    stats['first_chunk_seconds'] = first
    return stats


def test_100k_capacity_queries_and_stream(overview_api):
    api = overview_api
    output = Path(os.environ.get('GEO_CAPACITY_OUTPUT', '/tmp/geo905-capacity'))
    cases = seed(api, output)
    engine = api.harness.factory.kw['bind']
    query = {"created_from": "2025-10-01T00:00:00Z", "created_to": "2026-10-02T00:00:00Z"}
    captured = []

    def capture(_conn, _cursor, statement, parameters, _context, _executemany):
        if statement.lstrip().upper().startswith('SELECT') and 'geo_' in statement:
            captured.append((statement, parameters))

    event.listen(engine, 'before_cursor_execute', capture)
    results, plans = {}, {}
    try:
        scenarios = [
            ('runs_first', '/api/v1/geo/observation-runs', query, .5),
            ('runs_deep', '/api/v1/geo/observation-runs', query | {'page': 4000}, .5),
            ('runs_review', '/api/v1/geo/observation-runs', query | {'needs_review': 'true'}, .5),
            ('batches', '/api/v1/geo/observation-batches', query, .5),
            ('batches_status', '/api/v1/geo/observation-batches',
             query | {'status': 'RUNNING'}, .5),
            ('run_detail', f'/api/v1/geo/observation-runs/{cases[0].run_id}', {}, .8),
        ]
        for name, path, filters, limit in scenarios:
            timings, counts = [], []
            for iteration in range(22):
                captured.clear()
                start = time.perf_counter()
                response = api.engineer.get(path, params=filters)
                assert response.status_code == 200, response.text
                value = response.json()
                assert value.get('items', [value])
                if 'runs_' in name:
                    assert value['total'] == (17500 if name == 'runs_review' else 100000)
                if iteration >= 2:
                    timings.append(time.perf_counter() - start)
                    counts.append(len(captured))
            p95 = sorted(timings)[math.ceil(len(timings) * .95) - 1]
            assert len(set(counts)) == 1
            results[name] = {'p95_seconds': p95, 'target_seconds': limit,
                             'samples_seconds': timings, 'select_counts': counts,
                             'passed': p95 < limit}
            with psycopg.connect(api.harness.database.url) as conn:
                plans[name] = [conn.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql,
                                           args).fetchone()[0][0] for sql, args in captured]
            write(output, 'capacity-queries.json', results)
            write(output, 'capacity-plans.json', plans)
            print(f'{name}: P95={p95:.3f}s', flush=True)
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    if os.environ.get('GEO_CAPACITY_PHASE', 'candidate') != 'baseline':
        assert all(row['passed'] for row in results.values()), results
    gc.collect()
    stream_query = {'date_from': query['created_from'], 'date_to': query['created_to']}
    before = engine.pool.checkedout()
    stats = asyncio.run(export(api, stream_query))
    write(output, 'stream.json', stats)
    assert stats['rows'] == 100000 and stats['chunks'] >= 100000
    assert stats['first_chunk_seconds'] < 2.0
    warm = next(value for n, value in stats['rss_samples'] if n >= 5000)
    assert max(value for n, value in stats['rss_samples'] if n >= 5000) - warm < 32 * 1024**2
    assert engine.pool.checkedout() == before
    aborted = asyncio.run(export(api, stream_query, stop_after=1000))
    write(output, 'stream-cancel.json', aborted)
    assert aborted['rows'] == 1000 and engine.pool.checkedout() == before
