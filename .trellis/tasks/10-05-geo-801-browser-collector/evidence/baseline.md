相关单元：104项通过。命令：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_worker_configuration.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_configuration.py -q
配置基线：UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-configuration.py；18组通过、启动外部调用0。Docker Engine 29.5.2、Compose5.3.1可用。
