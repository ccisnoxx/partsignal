# MAN-06 原始文本证据页面上传与关联实施记录

## 交付状态

2026-10-25：本地实现、必要定向验证及独立只读复核完成，task=`review`、`completedAt=null`；未部署、未记录用户验收。MAN-01～05不重复实施，当前MAN-01～06全部为本地review。父清单保持in_progress，下一步可审阅已有成果，部署/用户验收另行授权，不据功能完成自动创建新任务或全量门禁。

## 文件合同与实现

- 核对文件服务、`geo_answer_files.py`、人工草稿/提交Schema和数据库合同：已有EVIDENCE、text/plain、1..50MiB、VERIFIED、INTERNAL/RESTRICTED、当前上传者及实际对象HEAD size/hash/type校验；raw/screenshot ID必须不同，冻结require_screenshot仍由服务端裁决。无后端、根API、Schema、数据库、部署或依赖变化。
- 原raw ID只从retained草稿保留，新增/移除无法表达。现纳入RHF：默认恢复已有ID，VERIFIED后替换当前值，移除显式null；保存/提交以当前表单ID为唯一来源。重读只推进CAS基线，保留本地ID，显式采用服务端草稿才reset。移除不DELETE文件或历史。
- 原摘要为服务端闭合不透明元数据，不增加可编辑字段。文件ID未改时原样保留；替换/移除省略旧摘要，后端现有默认生成未知摘要。没有猜测结束原因、解析正文或复制旧摘要到新文件。
- 新RawTextUpload仅接受浏览器明确text/plain且非空、≤50MiB的File，不凭后缀或空MIME猜类型，不改编码或字节，不把文本塞入回答原文或raw summary。页面提示上传前人工检查敏感信息，不自动宣称脱敏。
- 截图与文本是第二个真实消费者，抽出geo-runs内的`useManualFileUpload`及共同反馈，唯一持有SHA→intent→应用内PUT→complete、未知状态读取/abort和主体continuation。仅固定两种业务文件策略，没有新增通用上传框架或平行网络实现；RunUpload继续持有多图本地整理。
- intent必须为PENDING，并匹配本次所选文件category/access/type/size/hash后才发送字节；只有匹配原intent的VERIFIED结果才回调关联。complete/abort未知时先读取，不重传字节；主体变化/卸载后迟到结果不关联。
- 两类上传分别持有阻塞槽，ManualEditor以OR聚合，保护保存、提交、移除、重读/采用和离开。一个文件完成不解除另一个未确认上传的阻塞。Run写资格丢失后仍可按原主体恢复/放弃原intent。
- `runs.api.ts`仅把四处通用文件请求错误上下文由“截图”改为“证据”，路径、请求、权限和返回合同不变。SOP同步入口/限制/移除/恢复说明，SHA256清单仅同步SOP对应行。

## 结构复审

ManualEditor局部增量后503行，已按项目500行设计门槛复审。它仍拥有同一个人工表单的CAS、保存/提交、未知结果与恢复一致性边界，未新增网络文件生命周期职责；上传已抽到203行独立Hook，字段视图已在manual-editor-view。独立复核未发现必须再拆的真实职责边界，不为三行做机械切割，也不拆散现有原子表单命令。

## 实际定向命令与结果

项目根目录：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/domains/geo-runs/raw-text-upload.test.tsx src/domains/geo-runs/manual-raw-evidence.test.tsx src/domains/geo-runs/manual.model.test.ts src/domains/geo-runs/run-upload.test.tsx src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/runs.api.test.ts
```

首轮6文件共82例：80通过、2条新表单用例失败。原因是测试保存到revision4后还返回旧revision3提交回执，以及409会同时显示资格与错误两条alert而选择器要求唯一；产品正确拒绝不一致回执/保留错误，没有为测试放宽合同。

静态检查同时指出新模型测试fixture缺少API类型要求的answer_text/answer_format，以及一项未使用测试导入；补齐测试输入和移除导入。既有截图测试的虚构SHA也改成其实际File字节的SHA，与新增intent完整性验证一致，不改产品数据。

相关修正后执行：

```sh
npm --prefix frontend run test -- src/domains/geo-runs/manual-raw-evidence.test.tsx src/domains/geo-runs/manual.model.test.ts
npm --prefix frontend run typecheck
```

两文件16/16和最终typecheck通过；复用未变文本上传17、截图上传15、原人工表单21、请求适配13共66例的成功结果，总计82个有效用例，其中本轮新增27。没有声称修正后重跑全部82例。

`frontend/`目录：

```sh
./node_modules/.bin/eslint src/domains/geo-runs/manual-file-upload.tsx src/domains/geo-runs/raw-text-upload.tsx src/domains/geo-runs/raw-text-upload.test.tsx src/domains/geo-runs/manual-raw-evidence.test.tsx src/domains/geo-runs/run-upload.tsx src/domains/geo-runs/manual-editor.tsx src/domains/geo-runs/manual-editor-view.tsx src/domains/geo-runs/manual.model.ts src/domains/geo-runs/manual.model.test.ts src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/runs.api.ts --max-warnings 0
./node_modules/.bin/eslint src/domains/geo-runs/manual-raw-evidence.test.tsx src/domains/geo-runs/manual.model.test.ts --max-warnings 0
```

首轮只报未使用导入，修复后两文件lint通过，未变九文件结果复用；11个受影响源码/测试文件均有有效lint结果。

## 定向证据与独立复核

- 文本原字节用BOM、CRLF、tab和末尾空格计算实际SHA，断言PUT body是原File；不匹配的intent类别、类型、大小、哈希、级别、状态均在零PUT时失败。
- 覆盖格式/空文件/超限、complete失败只重试校验、未知PUT后显式放弃、读取VERIFIED后不重复complete、错误类别完成回执不关联、主体变化/卸载迟到和原主体恢复约束。
- 完整人工表单七例覆盖：新ID→canonical保存→新revision提交；显式null移除且不DELETE；409重读保留本地、采用才替换；失败保留旧ID/未保存回答且403后仍可abort；双上传交错阻塞；强制/非强制截图两分支。文本内容从不覆盖回答原文。
- 独立critical_reviewer只读比较本轮baseline、服务端合同与候选，前后两轮复核共享所有权、身份/未知恢复、摘要/CAS、双上传和最终测试断言，未发现确认缺陷或阻断项。复核者不改文件、不运行测试；实际执行记录由主代理提供，不能表述为独立重复执行。

## 验证范围与未验收边界

上述证据为Vitest/Testing Library组件、模型及受控API替身，使用实际File/SHA逻辑但不代表真实HTTP文件服务、对象存储、数据库事务或浏览器上传验收。没有启动浏览器、平台或线上服务。

只运行与共享上传提取、文本关联和表单风险直接相关的定向检查；无后端/API/Schema变化，未运行后端/数据库/合同/镜像/生产构建、全量E2E或完整make verify。MAN-01～05原交付状态沿用；受影响截图与表单行为在本轮选集复验，没有重跑无关模块。

保留`NOT_RUN_NO_EXISTING_PLATFORM`。不接入浏览器自动化、不创建平台、不操作线上、不提交推送、不新增自动跟进、不重查OSS自然清理。部署与真实用户验收仍待单独授权和记录。

## 最终保留与资源

最终执行git diff --check、git diff --cached --check、git status --short并逐文件比对本轮开始基线。预期11个既有文件发生本任务增量，新增4个源码/测试及4份任务资料；其他原有未提交内容、原74项暂存删除保留。HEAD/index不变，SOP校验清单仅第12行变化。

本轮没有启动浏览器、API、前端服务、数据库或容器；检查进程均已退出。删除CLI生成的两份未使用示例JSONL，最终核对后删除本轮系统临时基线/原文件副本，不保留报告、截图或其他非源码产物。只清除本会话活动任务指针，任务保留review，不归档、不提交。
