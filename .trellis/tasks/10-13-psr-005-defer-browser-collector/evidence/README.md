# PSR-005 验收证据

证据owner为PSR-005，保留至任务人工接受后按Trellis归档策略处理；没有真实账号、会话、供应商凭据、生产配置或数据。

- references-before/after.tsv：用户指定精确词表的全量逐行分类与处置；402→372不是零引用承诺，历史源码/合同和禁用校验保留。
- changes.patch、changed-files.txt：相对本轮基线39份既有文件增量，排除前序dirty work；Trellis新增记录另见本目录上一级。
- make-default-plan.txt：六个默认Make目标的传递展开，无Browser专属执行。
- acceptance.py/log：可重复的只读入口/文档/SHA256验收，不启动服务、不输出私有环境值。
- 其余log：本轮实际执行的定向验证；playwright-list.log是包装器拒绝纯收集的失败证据，playwright-collection.log只证明31测试/19文件可收集，不能记E2E执行通过。

全部实际命令、结果、复用/未执行边界与清理信息以 ../implement.md 为准。
