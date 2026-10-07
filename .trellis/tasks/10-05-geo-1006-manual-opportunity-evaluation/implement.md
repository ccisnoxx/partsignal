# GEO-1006 实现与验证

## 实现

新增 ADMIN + CSRF POST /api/v1/geo/opportunities/evaluate，必填窗口/范围/revision/幂等键，Subject/Surface/Profile及模式可选。31天同步窗口，ALL/FILTERED语义见design和Runbook。复用既有evaluate_opportunities规则及机会写入；锁内当前ADMIN/active/改密/认证会话重验。规则明确读取不可变revision，保留旧revision历史，不默用current代替请求。

0066 加法迁移保存actor+key摘要唯一的不可变回执，规则/User FK RESTRICT，用户删除owner计入该历史；User/Session→请求锁→原机会锁序。领域服务commit=False由外层拥有回执与低敏审计提交；失败整体回滚。同用户同规范请求返回原摘要/原as_of；变参409；新key显式评估新证据仍沿原机会/结果去重。运维观测迁到最终管理入口提交边界。旧测试/隔离E2E seed改用ADMIN，不建立生产CLI或权限旁路。

返回规则×scope评估结果数量（含无候选）、created/existing_reused/skipped互斥分区、原因代码及计数、revision/as_of/运行ID/replayed。不自动Action/Retest、不接线周期任务/Beat/CRON。

新增geo_opportunity.evaluated白名单及数量/原因低敏字段；审计对象以现有UNSUPPORTED关联政策展示，前端只扩展白名单和中文标签。根OpenAPI/database、生成类型、两个Runbook同步。

## 验证与修正

完整原始命令日志和分类见evidence/validation-results.json；日志中的数据库userinfo已脱敏。45个独立PG用例、121个后端单元、24个前端审计用例最终通过，无PG skip；合同、mypy、前端类型、API生成一致性、目标lint通过。证据复用遵守相关行为未变化原则。

初轮新测试共享module数据库却断言全表审计计数，身份变更后未恢复污染后项；限定本次target并finally恢复后通过。多过滤正例错误读取analysis input，改读Run.input_snapshot后通过。前端新夹具UNSUPPORTED kind及导航空值与既有合同不符，修正后通过。根合同追加schema最初重复已有GeoCollectionMode，严格生成器发现后删除重复声明。固定operation inventory/422总数及迁移head断言同步新增入口/0066；新增长行由目标lint发现后修正。未放宽生产守卫或吞错。

全局git diff --check仍报告未改动GEO-1001审计文档尾随空白；28个本任务路径no-index空白检查无错误（exit1只表示内容不同）。SQLAlchemy已有metadata循环/dialect警告保留，无新数据库合同差异。

## 交付限制

当前代码为本地候选，未提交、推送、归档、部署或执行生产写入。没有评估操作页面；获准管理员API客户端显式执行，Runbook详述内部试运行。0066生产前滚、实际目标/同候选评估与MANUAL正式闭环及业务签署尚未执行，属于GEO-1009/1010。未运行全仓make verify、浏览器矩阵/页面E2E、真实性能/真实外部AI；已执行入口真实HTTP+PG验证覆盖该API认证/CSRF/事务合同。

## 独立复核

首轮fresh critical_reviewer确认Runbook两处0065候选head漂移，已统一0066；其他权限/幂等/历史/事务审查无确认问题。复核指出失败诊断和提交回滚覆盖缺口，补充audit/commit两类真实PG故障，HTTP500及ASGI traceback均无秘密哨兵，业务/审计计数不变。首次from None实现被测试证伪：安装版本Starlette将__context__提升为__cause__；退出except后抛安全异常的修正及2项故障验证通过。拆分迁移测试后单项通过。第二轮fresh只读复核确认异常/回滚修正与迁移测试拆分无新增缺陷，再指出expand表0065漏改；主代理随后统一三处0066，更新能力矩阵/流程过期声明及hash。审计Bundle已关闭并校验通过，digest两次复核均验收；首轮无独立前后快照，写入证据unknown，第二轮1617维护源文件无差异。audit_id=20261006T051325Z-geo-1006-14f7608a。task/manifest仅置review，待人工接受，不done。
