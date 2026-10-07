# 编码前基线

- `npm --prefix browser-collector test && npm --prefix browser-collector run typecheck`：exit 0；13 项 Node 单元通过，checkJs 通过。
- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_browser_boundary.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_suite.py -q`：exit 0；113 项通过。
- 浏览器 Playwright 1.61.1 已安装，Chromium executable 存在；现有 Docker Browser 镜像 geo801 存在。
- 分支 geo/GEO-803；前序大量未提交文件保留，baseline-sha256.json 用于核对本任务增量。
- 只读资料调用一次使用了错误 cwd，读取未成功；随后已从仓库根重新读取相关合同和类型，未把失败读取计为依据。
