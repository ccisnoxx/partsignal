"""GEO-408 专用回环 provider；复用真实 TCP fake 的故障与逐次计数。"""

from __future__ import annotations

import signal
import threading
from contextlib import suppress
from uuid import UUID

from app.geo_fake_server import FakeMode, FakeScenario, GeoFakeServer, _Handler
from tests.geo_e2e_environment import validate_owned_environment


class GeoE2EHandler(_Handler):
    def do_GET(self) -> None:
        if self.path == "/v1/models":
            self._json(
                200,
                {
                    "object": "list",
                    "data": [{"id": "geo-fixture-model", "object": "model", "owned_by": "GEO408"}],
                },
            )
            return
        super().do_GET()

    def _scenario(self, attempt_id: UUID, scenario: FakeScenario, noise: str) -> None:
        # 父 handler 已真实追加 POST；仅 Collector 成功场景延迟，诊断默认不延迟。
        if scenario.mode == FakeMode.CITATIONS:
            self.server.state.stopping.wait(3)
        super()._scenario(attempt_id, scenario, noise)


def main() -> None:
    validate_owned_environment()
    server = GeoFakeServer(19012)
    server.RequestHandlerClass = GeoE2EHandler

    def stop(signum: int, frame: object) -> None:
        server.state.stopping.set()
        # shutdown 必须在 serve_forever 所在线程之外调用。
        threading.Thread(target=server.shutdown).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        print("GEO E2E provider listening on http://127.0.0.1:19012", flush=True)
        with suppress(KeyboardInterrupt):
            server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
