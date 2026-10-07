# 完整门禁失败分类

## make verify：真实栈 23 passed / 2 failed

1. `frontend/tests/e2e/geo-real-stack.spec.ts:292` 的既有 Flow A：上传意图、PUT 与完成接口成功，`transferRequest.postDataBuffer()` 却为 `null`，导致字节断言失败。该断言与文件上传实现未被 GEO-209 修改。GEO-106 的 implement.md 第28行记录了相同症状；这里不宣称底层浏览器原因已经确认。
2. `frontend/tests/e2e/surfaces-real-stack.spec.ts:100` 的既有 GEO-205 用例：以共享 `content_editor` 账号和 seed 初始密码登录返回401。当前完整运行中 `auth-session-real-stack.spec.ts:624` 先通过强制改密，`:665`、`:682-684` 将该账号初始密码改为随机新密码；后执行的 surfaces 用例仍用旧密码，构成已确认测试间账号污染。GEO-209 使用独立随机 ENGINEER 账号，不读写该共享账号。该 surfaces 文件在本任务起点已经存在且为 untracked，未被本任务修改。

相关完整命令退出2，并未继续 fixture、部署脚本及 Compose 的后半门禁。后半检查分别实际执行；不把这些补充检查合成为 make verify 成功。没有重试未变化的全部真实栈，也没有修改范围外测试或放宽安全边界。

## 首次 make test-deploy-scripts：测试环境并行冲突

前端容器、GEO fixture/config、进程与数据库生命周期均通过，随后 post-run secret regression 失败。主代理将此命令与 make e2e 同时运行，事前漏查 secret regression 也使用4174和同一 Playwright产物目录，导致测试入口冲突。相关源码未修改；改为等待 E2E 完全退出后串行重跑脚本门禁。本条是执行安排错误，不是功能失败；最终结果见 validation-results.json。

## make e2e：计划真实栈通过，通用 fixture 497 passed / 52 skipped / 1 failed

`make e2e` 显式使用 `PARTSIGNAL_E2E_SPEC=tests/e2e/plans-real-stack.spec.ts`，只过滤真实栈前半，后半仍运行默认全部550个 mobile/desktop fixture 用例。前半Plan为1 passed且secret scan clean、独占DB/storage/Redis/端口均清理成功；后半52个真实栈专用用例按模式跳过，其余497项通过。失败在未修改的 `frontend/tests/e2e/system-users.spec.ts:162`：点击删除后立即读取 `requestRecords.at(-1)`，实际仍为前一次 update/revision10，预期delete/revision18。相邻`:185`用例采用poll等待真实删除记录并通过；当前断言存在异步时序窗口，深层原因未进一步确认，也未将其称为已修复或已确定flake。失败上下文已保存fixture-users-error-context.md。标准最终scan clean，命令退出2。

本任务不修改System Users实现/fixture或上述范围外用例，不重跑未变化的全部页面矩阵，不把497通过隐去1失败。没有新增GEO-209范围内失败。

串行 `make test-deploy-scripts` 最终退出0，前端容器、GEO fixture/config、进程/数据库/敏感产物生命周期、staging/production脚本检查全部通过，详见deploy-scripts-serial.log。没有将首次执行冲突标为成功。
