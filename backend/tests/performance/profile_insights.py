"""读取指定隔离数据库的 CPU 诊断；不含认证、不作为 P95 通过证据。"""

import cProfile
import os
import pstats
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_insights import GeoOverviewFilters
from app.services.geo_answer_insights import get_insights


def profile(url, output):
    engine = create_engine(url, isolation_level="REPEATABLE READ")
    filters = GeoOverviewFilters(date_from="2026-09-02T00:00:00Z", date_to="2026-10-02T00:00:00Z")
    with Session(engine, autoflush=False) as db:
        count = db.scalar(select(func.count()).select_from(GeoObservationRun))
        profile = cProfile.Profile()
        profile.runcall(get_insights, db, filters)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w") as stream:
        stream.write(f"诊断时数据库Run数={count}；cProfile有额外成本，非P95基准。\n")
        pstats.Stats(profile, stream=stream).sort_stats("cumulative").print_stats(50)
    engine.dispose()


def main():
    profile(os.environ["GEO_PERF_DATABASE_URL"], Path(os.environ["GEO_PERF_PROFILE_OUTPUT"]))


if __name__ == "__main__":
    main()
