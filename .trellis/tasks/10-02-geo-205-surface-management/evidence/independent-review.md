# GEO-205 独立只读复核

首次复核 /root/geo205_review 返回两项 P2：

1. `backend/app/errors.py:72` 的 `extra_forbidden` loc 透传未知键名。真实内存反例含 fictional-sensitive-key-marker-205。新增根级/settings 未知键回归，修前命令 `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_validation_error_safety.py -q` 为 3 passed / 2 failed，错误均为 marker 进入 response.text；结果已在工具输出确认。修后增加合法字段定位，总计6项通过。
2. `frontend/src/domains/geo-catalog/surfaces-page.tsx:42` invalidateQueries 复用无缓存首次 GET，旧快照可变为非 invalidated 或恢复已删除行。项目安装 QueryClient/Observer 内存反例 readCalls=1、revision0；新增 enable/delete 组件修前2项均 readCalls1!=2，日志 review-refresh-regression.before.log；修后4文件45项通过，日志 review-refresh-regression.log。

门禁缺口：容器缺少 /contracts/openapi.yaml，571 passed/1 setup error；测试服务只读挂载真实根合同后失败用例通过，完整门禁重跑。真实页面 DELETE 已204但Chromium报告ERR_ABORTED；不是写取消白名单，定位至空204未消费，采用既有auth-provider响应处理。当前真实栈1 passed，secret_scan clean，清理完成。

首次复核未确认其他权限/CSRF/资格/事务/锁/revision/删除/安全读投影问题；未覆盖真实自动adapter、连接测试、Plan/Run和后续历史引用（明确范围外）。仅只读，无文件写入，无全量重复验证。修复差异在 review-fixes.diff；另一个fresh critical_reviewer /root/geo205_review_fixes 独立复验已完成。

## 修复后独立复验结论

本轮未确认新的实质缺陷或发布阻断；两项原P2均关闭。未知键末级固定unknown-field，声明父字段/判别标签和合法定位保留；闭合GEO模型安全。先cancelQueries后guard/invalidate终止原retryer，不接受忽略AbortSignal的迟到结果；另使用安装版QueryClient/Observer不写文件反例验证无缓存Profile列表及Profile详情均第2次读取、旧信号取消、最后返回旧结果仍新revision/isInvalidated=false。只取消读取，不取消或重放写命令。

204 response.text仅在成功且openapi-fetch未消费的响应执行，没有二次消费或新请求，错误原样传播；真实E2E1passed/secret_scan clean，白名单只有精确GET。backend-test只读根合同挂载范围正确，完整572passed/6既有warnings。复验未重复全量门禁，未写文件/Git/外部写入。Surface enable/delete组件直接交错覆盖，Profile路径由既有组件/API、代码和安装版内存反例支撑，未新增Profile完整组件交错；真实adapter/连接测试/Plan/Run/未来历史仍范围外。
