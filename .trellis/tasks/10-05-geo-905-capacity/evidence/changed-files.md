# GEO-905 实际修改文件

以本任务 evidence/before 为前像，加三份新维护源码/交付文档。不能将根Git全量diff归因于本任务。

- [.env.example](/Users/sc/PycharmProjects/partsignal/.env.example)
- [.env.production.example](/Users/sc/PycharmProjects/partsignal/.env.production.example)
- [Makefile](/Users/sc/PycharmProjects/partsignal/Makefile)
- [backend/app/config.py](/Users/sc/PycharmProjects/partsignal/backend/app/config.py)
- [backend/app/services/geo_read_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_read_queries.py)
- [backend/app/worker.py](/Users/sc/PycharmProjects/partsignal/backend/app/worker.py)
- [backend/tests/performance/README.md](/Users/sc/PycharmProjects/partsignal/backend/tests/performance/README.md)
- [backend/tests/performance/test_geo_capacity.py](/Users/sc/PycharmProjects/partsignal/backend/tests/performance/test_geo_capacity.py)
- [backend/tests/performance/test_geo_worker_capacity.py](/Users/sc/PycharmProjects/partsignal/backend/tests/performance/test_geo_worker_capacity.py)
- [backend/tests/unit/test_geo_worker_configuration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_worker_configuration.py)
- [deploy/compose.dev.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.dev.yaml)
- [deploy/compose.prod.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.prod.yaml)
- [deploy/compose.staging.yaml](/Users/sc/PycharmProjects/partsignal/deploy/compose.staging.yaml)
- [docs/geo-monitoring/03-technical/07-testing-and-quality.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/07-testing-and-quality.md)
- [docs/geo-monitoring/03-technical/08-deployment-and-operations.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/08-deployment-and-operations.md)
- [docs/geo-monitoring/04-delivery/12-r8-capacity-hardening.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/12-r8-capacity-hardening.md)
- [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [docs/geo-monitoring/CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md)
- [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md)
- [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)
- [docs/production-configuration.md](/Users/sc/PycharmProjects/partsignal/docs/production-configuration.md)

另新增本任务目录下prd/design/implement、task.json、implement/check上下文及evidence日志、JSON样本、计划、审计摘要、增量patch和两个复核脚本。

未修改：contracts/openapi.yaml、contracts/database.md、ORM、Alembic、geo_run_lifecycle.py、seed_geo.py、data-architecture及frontend；前像对比/入场hash证据保留。
