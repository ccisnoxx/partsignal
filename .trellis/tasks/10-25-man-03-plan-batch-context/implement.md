# MAN-03 计划到建批上下文衔接

## 交付状态
本地实现、必要定向验证和独立只读复核完成，task=review，completedAt=null；未部署、未记录用户验收。父清单MAN-03更新为本地待审阅，下一推荐MAN-04，不提前实施。

## 实现与边界
- 计划详情的既有链接仍传plan_id/create；运行中心把URL身份交给BatchCreate并按plan_id挂载，所选计划通过既有planDetailOptions精确读取，不依赖列表过滤/分页是否包含该计划。
- 当前计划、revision与服务端问题×Profile×repeat矩阵直接展示；选择同步URL，刷新/Back/Forward恢复同一身份。加载/读取失败不自动替换计划。新命令在详情读取中/失败时禁用；401/403/404隐藏保留的详情/矩阵及写入/同键确认入口，可安全退出。
- 复用runPlanNow及原服务端最终校验、矩阵冻结与批次事务；没有API、Schema、权限、状态机或配置变化。入口仍仅MANUAL_ONLY，CRON深链不能绕过。
- 未确认的请求冻结原计划/矩阵、revision、key与PrincipalContinuation；Query刷新不替换原意图，未知结果显式同键确认。409显式重读再确认。发出请求/未知结果期间DirtyGuard覆盖计划身份变化；只是读取/选择时无多余离开确认。
- 旧读取由Query身份和组件key隔离；创建回执在取消列表查询的异步等待后再次核对组件生命周期。成功采用canonical batch ID并携带实际请求的plan_id，而非迟到回调捕获的其他URL。
- 计划入口说明与人工SOP更新。没有跨Domain导入内部组件，没有第二套矩阵计算或新的依赖。三个业务源码文件为局部改动；原74条暂存删除及其他未提交工作均保留。

## 实际定向命令与结果
前端：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/domains/geo-runs/batch-create.test.tsx src/domains/geo-runs/runs-page.test.tsx src/domains/geo-plans/plans-page.test.tsx src/domains/geo-runs/runs.model.test.ts
npm --prefix frontend run test -- src/domains/geo-runs/batch-create.test.tsx
```
第一组选集42通过；修复读取拒绝后的缓存展示并增加交错用例后，建批选集15通过，复用其他未变的30用例结果，共45个有效定向用例。覆盖来源计划不在列表、当前矩阵、401/403/404初读失败、成功后403（普通/未知请求）、503显式恢复、切换后迟到旧读取、未知结果冻结旧revision/key、409重读、CRON拒绝、canonical来源导航、迟到完成不能覆盖新计划。RunsPage中的虚构人工提交fixture同时补上MAN-02要求的显式NONE，不涉及历史业务数据。

最初新增mock参数被TypeScript泛型推导为never；显式标注测试请求形状后typecheck通过，未改公共协议或放宽产品类型。

```sh
# frontend目录
./node_modules/.bin/eslint src/domains/geo-runs/batch-create.tsx src/domains/geo-runs/batch-create.test.tsx src/domains/geo-runs/runs-page.tsx src/domains/geo-runs/runs-page.test.tsx src/domains/geo-plans/plan-detail.tsx src/domains/geo-plans/plans-page.test.tsx --max-warnings 0
npm run build
```
ESLint通过；最终新增测试后对batch-create.test.tsx再做定向lint通过。typecheck与最终生产构建通过，保留既有大chunk提示。根API/数据库和后端源码未变，未重复后端单元、合同生成、迁移门禁或完整测试。

## 一次本地真实HTTP页面流程
使用专用PostgreSQL17（17340）和已有questions/plans fixtures创建虚构人工计划甲/乙；本地FastAPI18320，production preview4175。没有mock业务HTTP，没有创建真实平台或接入外部采集服务。

实际入口为本轮临时browser-server.py启动既有应用；浏览器命令`MAN03_BROWSER_META=<本轮0600临时元数据> node --input-type=module`，使用@playwright/test Chromium。

验证：从计划甲详情通过键盘进入“运行中心”，URL与名称/当前矩阵匹配；切换乙后URL同步，Back返回甲、Forward返回乙、reload仍是乙；375/768/1024/1440无横向溢出；确认前0个run POST，显式确认后仅1个POST201，expected_revision对应乙，canonical batch URL和选中批次保留乙；0 pageerror。此流程1项通过。后续403缓存边界修复仅改变拒绝访问分支，以2个定向组件用例补证，复用未改变的正常页面流程证据。

这不包含截图上传、真实Provider/平台、Worker业务执行或线上验收，浏览器上传NOT_RUN_NO_EXISTING_PLATFORM继续保留。

## 独立只读复核
复用独立review agent只读比较本轮baseline，重点复核URL/key、迟到读取/回执、冻结原request及幂等身份、409与来源导航。发现P2：详情先成功再401/403/404时Query保留data，仍展示缓存详情，未知结果仍可确认。主代理修复：隐藏缓存详情与写入入口、命令守卫阻止不可访问时发出操作，内部原request/DirtyGuard保留。新增先成功再403的普通/未知用例均通过；窄复核确认闭合，无新增阻断项。复核者未改文件或执行测试。

## 验证范围与剩余工作
仅本轮前端局部功能及定向真实页面验证，未运行完整make verify/全量E2E/Docker构建/发布门禁。没有操作线上、提交/推送、新增自动跟进或接入浏览器自动化；没有重查OSS历史。MAN-04～06及原有外部验收条件待后续推进。

## 最终差异和清理
收尾清理本轮API、preview、Chromium、专用PG及数据、production dist、临时脚本/会话元数据/baseline/marker；不保留非源码产物或后台服务。最终结果在下方补充；Git HEAD与index必须和基线逐字节一致。

最终清理完成：API退出时fixture已回收业务测试库；专用PG只剩postgres库后停止并删除精确目录；preview和Chromium已关闭。17340/18320/4175无残留监听，dist与本轮临时脚本/0600会话元数据/baseline/marker删除。无新增Playwright产物。HEAD/index与基线完全一致，原74条暂存删除保留，git diff --check通过。只清除本会话task指针，task保持review，不归档或提交。
