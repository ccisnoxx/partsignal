# MAN-05 多张截图整理、合成与提交实施记录

## 交付状态

2026-10-25：本地实现、必要定向验证及独立只读复核完成，任务保持`review`、`completedAt=null`。未部署、未记录用户验收。MAN-01～04保持原review并保留其改动，不重复实施；MAN-06仍规划，未获本轮实施授权。父清单下一可选MAN-06，推荐不代表执行授权。

## 合同核对与实现

- `contracts/database.md`、`geo_manual_collection.py`、`geo_answer_files.py`及文件服务继续拥有单个`screenshot_file_id`、VERIFIED、OPERATION_SCREENSHOT、INTERNAL/RESTRICTED、PNG/JPEG/WebP、1..10MiB、上传者和对象HEAD完整性合同；无API/Schema/数据库/后端/部署或依赖变化。
- 单张文件选择继续原直接上传。多张文件先在本地选择/追加、原图预览、按稳定身份上移/下移及移除，显式合成后预览PNG并可打开原尺寸，人工确认后才调用原上传链路。源文件不改动、不分别上传。
- `screenshot-composition.ts`拥有浏览器解码/画布边界：先逐张测量并关闭位图，再逐张原尺寸绘制并关闭，按排序左对齐、自上而下拼接。不重采样、不裁剪、不静默降低质量。PNG结果复用10MiB验证；本地容量单边16384像素/总计3200万像素，超出或坏图/编码失败明确报错，不伪造成功文件。
- `ScreenshotPreparation`拥有本地列表、Object URL、合成结果与取消信号。排列或追加/移除使旧结果失效；取消/失败保留原顺序；资源移除/替换/卸载时释放。成功、异常、解码及编码期间取消均有位图关闭和画布清空路径。
- `RunUpload`继续唯一拥有SHA→intent→PUT→complete及原状态读取/abort恢复。原网络阻塞与本地整理阻塞做OR投影给ManualEditor，保存/提交/替换关联及DirtyGuard不会因某一阶段结束而错误放行。远端失败/abort后本地整理保留；可继续调整或显式放弃。只有VERIFIED才替换表单文件引用并清理本地整理，随后沿用原草稿保存/正式提交。
- 本地选择绑定原主体continuation，合成前后及上传前重验；Run ID复用原ManualEditor组件key隔离；卸载后中止合成并忽略迟到结果。未知上传期间锁定本地替换，不能绕过原intent恢复重发字节。
- 人工SOP同步入口、容量、预览、临时性与恢复说明，仅更新SHA256清单的SOP对应行。

## 实际定向命令与结果

项目根目录：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run test -- src/domains/geo-runs/screenshot-composition.test.ts src/domains/geo-runs/screenshot-preparation.test.tsx src/domains/geo-runs/run-upload.test.tsx src/domains/geo-runs/manual-editor.test.tsx
```

四文件53个用例通过：合成I/O合同10、本地整理7、上传生命周期15、完整人工表单21，其中本轮新增21个。覆盖顺序/原尺寸绘制、坏图/容量/输出超限、解码/绘制/编码期间取消及迟到结果资源释放；排序追加使预览失效、移除后焦点、失败输入保留、主体变化/卸载隔离；上传前零请求、合成文件单PUT、未知结果只读核对、abort后本地阻塞、VERIFIED清理及原关联保留。

完整表单用例经过实际组件/请求适配链路，以受控API替身返回数据：预览确认前没有POST，PUT仅一次且body严格为合成器的PNG，intent/complete/manual-submit合计三次POST，只有complete返回VERIFIED后才替换旧截图ID，提交携带该VERIFIED ID及原回答。此证据不是实际HTTP/对象存储上传。

`frontend/`目录：

```sh
./node_modules/.bin/eslint src/domains/geo-runs/screenshot-composition.ts src/domains/geo-runs/screenshot-composition.test.ts src/domains/geo-runs/screenshot-preparation.tsx src/domains/geo-runs/screenshot-preparation.test.tsx src/domains/geo-runs/run-upload.tsx src/domains/geo-runs/run-upload.test.tsx src/domains/geo-runs/manual-editor.tsx src/domains/geo-runs/manual-editor.test.tsx --max-warnings 0
```

首轮类型检查发现noUncheckedIndexedAccess下的数组索引类型未明确，lint发现一个未使用测试导入。按既有非空列表/边界按钮不变量标注非空索引并移除导入，未放宽类型或增加重复guard；typecheck和8文件lint复跑通过。修改为运行时擦除的类型标注，不重复53个已通过的运行时用例。

最终补充原尺寸Blob链接和对应属性断言后执行：

```sh
npm --prefix frontend run test -- src/domains/geo-runs/screenshot-preparation.test.tsx
# frontend目录
./node_modules/.bin/eslint src/domains/geo-runs/screenshot-preparation.tsx src/domains/geo-runs/screenshot-preparation.test.tsx --max-warnings 0
# 项目根目录
npm --prefix frontend run typecheck
```

7个组件用例、两文件lint及最终typecheck通过；复用未改变的其余46个有效用例，共53个有效用例，不计成60个不同用例。没有触发全量重跑。

## 独立只读复核

独立critical_reviewer按本轮baseline副本比对候选，重点审查合成/上传状态所有权、主体/Run/卸载隔离、未知结果恢复、合成容量与资源释放；最终窄复核新增完整表单/聚合恢复测试及原尺寸链接。未发现确认缺陷或新增阻断项。建议补的toBlob编码期间取消用例已加入并通过。复核者没有修改文件或执行测试，不能把作者运行结果表述成审查者独立执行。

## 证据边界与保留项

按`docs/testing.md`只执行实际受影响的前端组件、类型和lint检查。合成模块测试替换ImageBitmap/Canvas边界，证明几何调用、容量/错误/取消和释放合同；没有使用真实浏览器解码/编码，也没有对真实栅格像素、真实焦点/响应式或平台上传作验收。组件/请求替身不代表线上、HTTP服务、对象存储、数据库事务或发布门禁通过。

未运行真实浏览器/全量E2E、完整make verify、生产构建、后端/数据库/合同/镜像/部署验证。既有单文件服务合同和后端源码不变，未重查相关后端门禁；MAN-01～04沿用原交付状态，未重复实施。仍需后续按实际环境记录部署与用户验收。

保留上传验收`NOT_RUN_NO_EXISTING_PLATFORM`。本轮未接入浏览器自动化、未创建平台、未操作线上、未提交/推送、未新增自动跟进、未重复检查OSS自然清理。

## 最终差异与清理

执行`git diff --check`、`git diff --cached --check`及`git status --short`，并逐文件与本轮开始时的完整基线核对。预期8个既有文件发生本任务增量，新增4份源码/测试和4份任务资料。其他原有未提交内容原样保留；HEAD与index逐字节不变，原74项暂存删除保留。SOP校验清单仅第12行变化，其他行保留。

本轮未启动浏览器、API、前端服务器、数据库或容器，测试/检查进程均已退出。删除任务CLI生成的两份未使用示例JSONL；最终核对后删除本轮系统临时基线/原文件副本，不保留截图、报告、后台服务或其他非源码产物。只清除本会话活动任务指针，任务保留review，不归档、不提交。
