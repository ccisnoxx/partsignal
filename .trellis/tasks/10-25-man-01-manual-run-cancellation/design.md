# MAN-01 设计

取消是Run生命周期命令；新增geo_manual_run_cancellations为一Run一条不可变历史，不把用户理由写进错误字段或低敏审计。0069加法迁移，无回填；Run status/revision、finished_at与取消记录/批次/审计同事务。记录包含run_id PK/FK RESTRICT、cancelled_by User FK RESTRICT、reason trim1～2000无NUL、cancelled_at、run_revision≥1、draft_revision≥0，接入用户历史引用计数。数据库记录插入核对MANUAL/CANCELLED/NOT_STARTED、无回答、实际Run版本/完成时间及草稿版本，Run延迟守卫保证新增人工取消不能无留痕；旧CANCELLED不回填。禁止记录UPDATE/DELETE/TRUNCATE，downgrade 55000前向恢复。

POST /observation-runs/{run_id}/manual-cancel，expected_revision+expected_draft_revision+reason，沿EngineerUser/CSRF；服务端current_actor_command重验User/HTTP Session，再Batch→Run→Draft锁。无需Profile/config锁，因为取消不出网/不收集，须允许失效配置下结束待办；与既有保存/提交共同Batch→Run锁序，没有反向获取配置锁。取消原因不外发、不进审计，只审计状态/版本。无HTTP幂等重放；重复与并发一个成功，其余409；网络/异常提交未知仅GET详情核对。

保留原cancellable/run_transition及通用API状态机，读取只向MANUAL投影CANCEL；batch的整批cancel_available仍false。manual-entry投影CANCEL不依赖采集资格；UI复用该已存在的RR读模型冻结Run/草稿双版本，无新增准备端点。详情增加nullable cancellation，现存历史缺记录时保持null，不伪造理由。取消保留GeoManualDraft与所有文件引用，不创建副本、不改变清理策略；保留期后仍按原0064墓碑/清理管理，正式答案不可变。

前端在Run详情提供取消按钮与原因表单，离开未保存录入先走原DirtyGuard。异步query/mutation有当前主体/卸载守卫；确认前读最新manual-entry，409冻结理由待显式GET，未知只GET Run详情，已接受后刷新失败仍显示接受事实。取消后的记录作为只读展示，不推测本地资源动作/批次状态。只实现单Run入口，后续MAN功能不启动。
