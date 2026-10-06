# Task Brief：GEO-901 GEO 数据保留、归档和清理

## 1. 基本信息
Task ID GEO-901；R8；状态 review；当前主代理；分支 geo/GEO-901；依赖 GEO-707 done（manifest及人工接受记录已核对）。无提交/PR/部署授权。

## 2. 目标
限批、可 dry-run、可观察地清理到期未引用 raw payload、终态人工临时草稿和无引用文件，留下可重试文件墓碑及不可变草稿墓碑，保持所有引用证据和指标元数据。

## 3. 关联需求
PRD §14.3、AC-RUN-03/04、AC-METRIC-05、AC-SEC-02；CAP-GEO-06/16；数据架构§11、部署§11及manifest GEO-901。

## 4. 必读文档
已读取根/后端 AGENTS、Trellis workflow/backend与infra索引、数据库/错误/质量规范；GEO README/roadmap/WBS完整901行/execution guide/template/manifest/governance；PRD采集/证据/安全/验收、domain Run/Answer/Analysis、workflow人工录入、methodology资格与分母；技术架构、数据架构保留/文件/草稿、安全raw/Browser、测试矩阵及运维维护/Browser；Accepted ADR-001～006。大型OpenAPI按完整相关schema单元、database按文件/Answer/草稿/读模型合同读取。相关0050/0051/0063迁移、文件/草稿/Worker/Settings及测试已读。GEO-707与Browser范围调整记录已核对，不复制前序实施细节。

## 5. 当前行为
FileRecord已有限批与DELETING→DELETED两阶段；全部7项实际FK均参与引用检查，存储失败保留DELETING。未提供dry-run，VERIFIED从未绑定可能无期限。人工草稿只允许PENDING编辑/删除，因此取消后的临时材料无法清理；正式提交已删除草稿。答案/引用/analysis/review不可变。Browser本机无运行服务、配置或会话表。

## 6. 目标行为
保留所有引用；新增可选已批准期限，默认不启用新到期策略且Worker默认dry-run。raw候选保守界定EVIDENCE/text/plain，不推断文件内容。终态且无答案、NOT_STARTED、MANUAL的过期草稿可事务清理，PENDING不清理。草稿墓碑只保存run/revision/更新时间/期限/清理时间，无正文。文件元数据与SHA256永久保留。

## 7. 范围内
- [x] raw/无引用文件限批及dry-run；旧已到期文件处理复用权威文件服务。
- [x] 终态临时草稿、墓碑、文件解绑后7天保留。
- [x] 配置/Worker接线、低敏日志、迁移、测试与文档。
- [x] Browser本轮N/A依据；存在材料环境不得套用本轮N/A。

## 8. 范围外
GEO-902～906，尤其903备份恢复；PENDING草稿自动删除/新revision协议；引用raw到期删除及截图/Answer历史归档迁移；公共API/UI、真实AI/Browser、生产启用、无关重构、依赖升级。

## 9. 业务不变量
1. 7项实时文件FK保护全部引用；raw被引用同样保护。
2. Run/Answer/引用/analysis/review/成本/指标元数据不变。
3. PostgreSQL权威；Redis无正文；事务owner在service。
4. 先持久化墓碑再删存储；失败不删除记录。
5. 未批准生产期限不猜测：可选配置默认不启用，dry-run默认true。

## 10. 契约变化
OpenAPI、generated和HTTP不变。Database新增geo_manual_draft_tombstones，0064_geo_retention接0063，冻结DDL；终态DELETE必须有匹配墓碑、墓碑INSERT验证真实过期草稿，提交时确认草稿已删除；不可变墓碑。到期扫描索引。零回填，RESTRICT，无破坏性downgrade。

## 11. 后端实现
Router无变化。草稿Run→Draft→Files稳定排序、SKIP LOCKED、锁内重读终态/age；墓碑+删除+解绑期限同事务。文件GC复用7 FK检查、先DELETING提交、外部幂等delete、再DELETED；storage failure保留重试。限批每类不超过1000。新周期任务无payload，按部署配置重读PG，不依赖采集开关处理旧材料。

## 12. 前端实现
N/A；PENDING草稿保持，现有录入版本、query key/URL/页面不变。

## 13. 测试计划
Unit：配置合法范围、默认dry-run、Worker、非法批量/时区。PG：迁移前滚、保留精确边界、真实7 FK、原子墓碑、直接SQL反例、并发SKIP LOCKED及引用/GC交错。存储：本地真实字节替身、失败→重试、dry-run零I/O。新增测试只保护新合同。六项指定命令必运行；未改UI不跑浏览器矩阵，不执行发布阶段make verify或903恢复演练。

## 14. 验收标准
- dry-run无DML/状态/存储改变。
- 当前仍被引用的文件从不DELETING，指标/Run Detail仍可读取。
- 终态过期草稿清理后唯一不可变墓碑；PENDING及未到期均保留。
- 存储失败保留DELETING，下轮成功DELETED且hash/size/身份不变。
- 限批、锁竞争不重复业务写入；异常不伪成功。

## 15. 验证命令
`git diff --check`、`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make COMPOSE='docker compose -f .trellis/tasks/10-05-geo-901-retention/evidence/compose.yaml' test-integration`及目标PG。

## 16. 数据和上线
先迁移0064，部署默认dry-run；数据负责人批准保留天数后由管理员在runtime环境配置，先预览再显式关闭dry-run；本轮不配置生产策略。停止新retention任务/恢复dry-run保留全部墓碑；已删除临时对象无法由downgrade重建，需前向修复，备份演练属903。

## 17. 风险与停止条件
错删引用、草稿锁交错及存储部分失败由PG守卫与目标测试覆盖。只在用户五类阻断时blocked；验证环境失败分类记录并继续可完成范围。

## 18. 完成证据
evidence保存初始hash/计划文件before快照、compose、baseline及Browser依据。baseline首次命令错误文件退出4、纠正后69单元通过；29PG通过。最终精确命令/exit见implement.md及logs。Browser N/A仅本机开发/本轮隔离环境，生产false/无会话由904/906实测。

## 19. 后续任务
902可观察性、903恢复、904安全、905容量、906上线，均不在本轮实施。804～807继续deferred。
