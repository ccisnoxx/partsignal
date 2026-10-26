# MAN-05 多张截图整理、合成与提交

## 用户结果

人工录入可选择多张PNG/JPEG/WebP截图，按阅读顺序预览、上移/下移和移除；本地合成为一张PNG，确认合成预览后上传并沿用已有草稿/正式提交流程。单张选择继续既有直接上传行为。原始本地文件不修改。

## 已核对合同

- `contracts/database.md` 的GEO答案与临时草稿、`geo_manual_collection.py`和`geo_answer_files.py`均要求单个`screenshot_file_id`，截图VERIFIED、OPERATION_SCREENSHOT、INTERNAL/RESTRICTED、1..10MiB、PNG/JPEG/WebP，上传者及对象完整性由服务端重验。
- `RunUpload`已有SHA256→intent→PUT→complete，未知传输不重发字节，complete/abort先读取状态恢复，主体continuation与卸载守卫。
- `ManualEditor`依据上传阻塞禁止保存、提交、替换关联，并由DirtyGuard覆盖离开；新截图只有VERIFIED后替换当前草稿引用。

## 验收

- [x] 单张上传和既有失败恢复保持；多张选择/追加、键盘排序/移除、原图预览及合成预览可用。
- [x] 多张截图按排序后的原像素自上而下拼接为PNG，不自动缩放、裁剪或有损压缩；原文件不修改。
- [x] 输入格式/大小、损坏图、合成容量与输出10MiB限制有明确失败反馈；失败保留本地顺序及原已校验关联，不创建伪成功文件。
- [x] 本地整理、合成、未知上传期间禁止保存/提交并提示离开；可显式放弃本地整理，上传未知则继续原恢复流程。
- [x] 只有VERIFIED结果关联草稿；新Run、卸载或主体变化后的迟到合成/上传不能关联新页面或发送旧文件。
- [x] Object URL、ImageBitmap、Canvas与取消信号有释放路径；MAN-01～04不重复实施，MAN-06不实施。
- [x] 必要定向验证通过，更新任务/父清单/SOP，保留原未提交和74项暂存删除。

## 当前操作边界

仅本地实现及必要定向验证，完成保持review，不等同部署/用户验收。保留`NOT_RUN_NO_EXISTING_PLATFORM`，不接入浏览器自动化、不创建平台、不操作线上、不提交推送、不新增自动跟进、不重查OSS自然清理。
