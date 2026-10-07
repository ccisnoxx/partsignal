# 实施与验证

原候选门禁记录：`/Users/sc/.codex/reviews/partsignal/geo1010-candidate-gate-20261007T172107Z-6a1_ywwm/gate-result.json`。原日志 SHA256=`4af1e37923176adf7d1bdf8b81b2b062e81a9136799257e4aadd9cbda00715d3`，exit 2；1253 PG integration（45 warnings）、6恢复、1性能与32真实页面E2E已通过，GEO栈在工厂配置拒绝后未就绪。fixture/部署脚本门禁尚未执行。

修正 owner 为 shell 模式分支，新增明确 false，不放宽 geo_e2e_runtime 的拒绝。infra spec 旧“机会始终关闭”已过期，改为 canonical MANUAL true、GEO-408 false。既有真实 GEO E2E 已能捕获此错，因此不增加重复结构断言测试。待实际定向与新候选完整门禁结果后更新本记录。

2026-10-07T17:53:03.202761Z–17:54:32.855793Z运行原始e2e-geo.sh，exit0；enabled/api-disabled/monitoring-disabled三个phase均passed，每阶段secret_scan=0与owned cleanup成功。记录见[evidence/targeted-check.json](./evidence/targeted-check.json)。bash -n exit0。完整门禁仍待修正后新固定SHA，不将定向通过冒充最终门禁。
