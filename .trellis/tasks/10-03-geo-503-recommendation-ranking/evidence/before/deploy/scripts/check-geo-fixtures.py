#!/usr/bin/env python3
"""离线检查共享 GEO fixture；不连接数据库、provider 或生产配置。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend" / "tests"))

from geo_fixtures import (  # noqa: E402
    GeoFixtureError,
    load_geo_fixtures,
    load_geo_mention_fixtures,
)


def main() -> int:
    try:
        bundle = load_geo_fixtures()
        mentions = load_geo_mention_fixtures()
    except GeoFixtureError as error:
        print(str(error), file=sys.stderr)
        return 1
    corpus = bundle["corpus"]
    counts = {name: len(corpus[name]) for name in ("products", "questions", "answers", "citations")}
    print(f"GEO fixture v1 校验通过：{counts}；金标={len(bundle['gold']['cases'])}；外部调用=0")
    print(f"GEO-502 提及金标 v1 校验通过：场景={len(mentions['cases'])}；外部调用=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
