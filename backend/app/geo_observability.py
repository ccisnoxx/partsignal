"""受保护运维CLI；无公开HTTP路由，无网络provider或对象写探针。"""

import argparse
import json
import sys

from sqlalchemy.orm import Session

from app.geo_ops_health import component_health
from app.services.geo_ops_metrics import render_metrics
from app.services.geo_ops_queries import read_snapshot
from app.services.geo_ops_runtime import observability_engine


def main() -> None:
    parser = argparse.ArgumentParser(description="GEO低敏运维指标与本机健康")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("snapshot", help="只读JSON诊断（包含有限稳定ID，仅限运维）")
    commands.add_parser("metrics", help="Prometheus textfile，无业务资源ID标签")
    health = commands.add_parser("health", help="本机循环/PG/Redis/Celery健康")
    health.add_argument("component", choices=["worker", "scheduler"])
    args = parser.parse_args()
    try:
        if args.command == "health":
            result = component_health(args.component)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            raise SystemExit(0 if result["status"] == "ok" else 1)
        engine = observability_engine()
        try:
            with Session(bind=engine) as db:
                snapshot = read_snapshot(db)
        finally:
            engine.dispose()
        print(
            render_metrics(snapshot)
            if args.command == "metrics"
            else json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
        )
    except Exception:
        # metrics失败必须撤销成功信号，采集方即使exit1也应原子替换textfile。
        if args.command == "metrics":
            print("# TYPE geo_observability_up gauge\ngeo_observability_up 0")
        else:
            print('{"status":"unavailable","error_code":"OBSERVABILITY_UNAVAILABLE"}')
        print("GEO运维观测不可用；检查数据库/schema与固定健康字段。", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
