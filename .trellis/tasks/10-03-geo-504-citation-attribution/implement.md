# GEO-504 实施与验证证据

状态：done（manifest）/ completed（Trellis）；2026-10-03 本会话用户已人工审查并接受实现与测试证据。只实施 GEO-504 / R4，当前分支 geo/GEO-504，无 Commit/PR/发布。

## 依赖、授权与基线

manifest GEO-501/GEO-106/GEO-304 均 done；对应 Trellis 均 completed，并分别记录2026-10-03/2026-10-02人工接受。GEO-504开始planned，完整12项preflight在编码前输出，随后manifest与Trellis进入in_progress。Task Brief按19节模板创建，设计/spec/文档/当前合同与前序任务记录见prd.md。

开始时工作树大量前序未提交/未跟踪文件，evidence/initial-status.txt和initial-file-hashes.json保留7614文件的状态/hash；evidence/before只保存本任务计划编辑的原始版本。保留审查使用本轮before/candidate增量，不把git HEAD到全体dirty改动误当成本任务。当前preservation-audit未发现范围外变更。

基线253定向unit、54真实PG分析/输入/原始证据集成及make contract-check均通过，精确argv/exit_code/log在baseline-unit、baseline-integration、baseline-contract证据。

## 实现、行为与不变量

1. geo_analysis.classify_citations消费冻结输入，输出geo-citations-v1、来源字典版本、引用分类、候选及复核原因；原始引用仍是权威，按position输出且保留occurrences。
2. geo_citation_rules拥有复制与匹配规则。hostname相等或以点加登记hostname结尾；不使用contains、路径/query/标题/正文、角色/父子关系或最长匹配猜归属；复用已安装idna3.18及304/Catalog规范化。
3. OWNED/OFFICIAL结合自有/竞品类型决定类别；经销商/OTHER按显式关系；REFERENCE_PART无法证明所有权保持UNKNOWN。第三方八类来源由显式版本化规则提供，不硬编码真实网站，未登记UNKNOWN。
4. 多对象保持全部候选、subject_id=null、CITATION_OWNERSHIP_AMBIGUOUS；类别一致仍可保留，冲突UNKNOWN/CITATION_SOURCE_AMBIGUOUS。对象域名和来源规则冲突不静默覆盖。保留规则hostname、关系、对象revision、EXACT/SUBDOMAIN证据。
5. 输入/规则/结果是frozen dataclass+tuple，不随DTO/调用者修改变化。原始引用单回答/稳定ID/规范URL/位置互斥在显式转换边界检查；坏枚举/规范身份明确失败。
6. project_citation_corrections复用501类型，仅本回答引用及本snapshot对象可修正。有效投影保留机器值/候选/证据/歧义，不原地改写；可清空归属，不选择current review或创建复核命令。

无OpenAPI、database、ORM、Alembic、权限/CSRF、Router、Worker、事务、锁顺序、持久化revision、Run状态机或Redis变化。纯输入同输出，不新增幂等记录/重试/第二hash。固定ValueError不回显URL；repr隐藏hostname/标题/正文。未知数据库错误沿既有精确处理，无新HTTP错误映射。

## 契约、数据库与迁移

根OpenAPI复用GeoAnswerCitationOut、GeoSourceCategory、GeoCitationCorrection；新增内部纯值不作为公共响应或假数据表。头仍0054_geo_analysis_contract，migration-head证据退出0。无本任务Alembic、历史回填、生产迁移、降级或数据删除。基线与新PG测试的answer_database按0049→head在独立临时库实际前滚；完整integration包含空库/0053非空前滚、ORM与不可变守卫验证，909项全部通过，23条既有SQLAlchemy反射/循环表排序warning。恢复本任务纯代码不删除历史；506后续需要在其合同任务保存派生结果和完整规则身份。

## 首轮失败、诊断与修复

- citation-unit-first：4 failed/60 passed。测试构造把Unicode直接放入仅接受规范ASCII的GeoRunDomainSnapshot，在算法之前被既有Schema拒绝；修正测试复制边界先复用normalize_catalog_hostname，没有放宽Schema/算法/IDNA要求。修正后引用/提及/推荐196通过。
- 初次局部ruff指出import排序/两行过长，修正新文件格式后通过。旧服务只做本任务局部编辑，未整文件格式化或重写其他规则。
- make-typecheck：exit2；直接调用带model_validator的canonical_identity在mypy上是decorator proxy不可调用。改为公开GeoAnswerCitationOut.model_validate入口，异常转固定不含输入的ValueError。make-typecheck-corrected通过163后端源文件及前端tsc；修正后引用66unit与3PG通过。

完整make-test-unit/integration启动时使用候选，公开校验入口修正发生于运行期间；其后额外重验直接受影响的66unit/3PG和typecheck。语义/合同及其他文件未变，不重复整套门禁以制造验证量；实际基线与修正时间均保留。

## 实际检查与证据

所有检查通过evidence/run_check.py记录精确argv、真实exit_code及完整日志，不覆盖首轮失败。

| 命令 | 当前实际结果 | 证据前缀 |
|---|---|---|
| 基线定向unit | 253 passed | baseline-unit |
| 基线PG | 54 passed | baseline-integration |
| 基线make contract-check | exit0 | baseline-contract |
| 最终相关五文件unit | 270 passed（公开校验入口修正前） | citation-unit-final |
| 修正后引用unit | 66 passed | citation-conversion-fixed |
| 修正后引用PG | 3 passed | citation-integration-final |
| git diff --check | exit0 | git-diff-check |
| make lint | exit0；后端ruff及前端eslint | make-lint |
| 修正后定向ruff | exit0 | candidate-lint |
| make typecheck | 初次exit2；修正后exit0 | make-typecheck / make-typecheck-corrected |
| make test-unit | 3255后端 / 1141前端passed，exit0 | make-test-unit |
| make test-integration | 909 passed / 23既有warnings，447.87s，exit0 | make-test-integration |
| make contract-check | exit0 | candidate-contract |
| Alembic heads | 0054_geo_analysis_contract，exit0 | migration-head |

集成精确命令：

```bash
make test-integration COMPOSE='docker compose -p partsignal-geo504-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-504-citation-attribution/evidence/validation-compose.yaml'
```

专属Compose使用独占PG16/Redis/fake-OSS与test镜像，无用户DB/真实AI。配置是本任务测试记录，不修改deploy。unit预期为本测试文件手工编写的独立行为金标；共享v1原文/预期保持原样，对照引用类别及304去重/位置。共享金标subject_ids表达页面内容，不能作为hostname唯一归属；共有品牌/产品域名必须返回全部候选。

PG新增三项从真实原始引用和AnalysisInput读回执行阶段，写既有追加Review，比较完整Answer/Citation与分析行保持不变，测试越回答/越对象scope、同值UPDATE冻结、旧review不能重定向新analysis。本任务没有持久化机器引用分类，不以这些测试伪称506已接线。

## 增量审查、文档与状态

源码423/247行、测试438/238行，各自按真实分析/规则/验证边界分工。主代理完成实际candidate.patch自查，未发现隐藏fallback/contains误判、弱化边界、旧实现平行复制或范围外变更。本任务不实质修改高后果公共/持久化/权限/并发合同，未委派；不把自查称为独立复核。

Worker架构拥有稳定规则与复核边界；README/CHANGELOG/manifest/SHA和Task Brief记录状态与证据。implement/check.jsonl各两个有效spec/task设计资料索引，task.py validate通过无warning。现manifest仅GEO-504 planned→in_progress→review，Trellis=review、completedAt=null；不提交、推送、发布、归档或自行done。

## 未运行项、限制与后续

未运行make e2e、make build、make verify、浏览器矩阵、真实AI/生产smoke：无页面/完整用户旅程、打包、出站或部署变化；普通测试无需真实平台。没有生产前滚或历史重分析。

默认没有批准的真实第三方域名类别目录，内部调用者必须提供显式版本化规则；公共配置管理不属于504。引用匹配不证明网络所有权/页面内容/Article归属；共享域名宁可保留歧义，不根据路径或父子猜产品。人工投影不处理权限/当前review选择，公共复核仍后续508。机器引用结果尚无表/Worker接线/页面，本任务沿502/503纯阶段边界交付。

后续GEO-505事实、GEO-506组合与原子持久化/Worker、GEO-507/508查询及人工工作台、GEO-604洞察；指标、Opportunity、Browser均未实施。


## 最终交付

五项最低命令全部通过，完整integration909 passed/23既有SQLAlchemy迁移反射warning（与前序任务同类warning，未过滤或弱化防线）。根合同、generated、迁移及全部范围外开始文件保持；manifest除GEO-504条目外逐字不变。最终候选增量、文件hash/空白/保留审查、文档SHA和专属环境清理结果见evidence。

本轮最低完整门禁的显式用户要求是运行依据，没有另行运行full verify/E2E/浏览器矩阵。没有子代理委派或独立审查；自查限本任务纯阶段，不伪称高后果合同审查。

收尾git diff --check、整包SHA256SUMS、Task上下文校验和专属Compose清理均exit0。preservation-audit确认7614初始文件的范围外内容保持，新增范围外Task记录之外的文件仅引用规则/两个测试，其他任务manifest逐字不变。最终candidate.patch/final-file-hashes/validation-summary保留完整本轮交付。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-504 的实现与测试证据。”

据此将 manifest 的 GEO-504 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施交付记录与 evidence 中的 review 状态保留为人工验收前的历史记录；既有测试结果、warning 和未运行检查不改写。本次仅记录 GEO-504 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
