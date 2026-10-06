"""误投稳定 ID 不能让普通 API Worker 改写 Browser 或人工 Run。"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import geo_runs


@pytest.mark.parametrize("mode", ["BROWSER", "MANUAL"])
def test_non_api_message_is_not_claimed_or_mutated(monkeypatch, mode):
    run = SimpleNamespace(
        status="PENDING", revision=0, input_snapshot={"profile": {"collection_mode": mode}}
    )

    class ReadSession:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, *args):
            return run

    # 若进入第二段事务/资格读取即失败；不靠 mock 成功返回来证明未写。
    monkeypatch.setattr(geo_runs, "SessionLocal", ReadSession)
    assert geo_runs.claim_collection_run(uuid4()) is None
    assert run.status == "PENDING" and run.revision == 0
