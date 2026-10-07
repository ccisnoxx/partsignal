# GEO-307 完整门禁失败分类

完整命令：`DATABASE_URL=postgresql+psycopg://partsignal:geo307-local-test-only@127.0.0.1:55457/partsignal REDIS_URL=redis://127.0.0.1:56397/15 make e2e`。实际exit 2，真实栈24 passed / 2 failed，GEO-307用例通过，标准secret scan clean。以下失败用例均未被本任务修改。

1. `frontend/tests/e2e/geo-real-stack.spec.ts:292`：Flow A上传intent、PUT、complete成功，Playwright `transferRequest.postDataBuffer()`返回null，预期字节断言失败。与GEO-209及更早GEO-106记录同症状；没有足够证据宣称底层浏览器原因已确认。
2. `frontend/tests/e2e/surfaces-real-stack.spec.ts:100`：以共享content_editor账号的seed密码登录返回401。前执行auth-session测试改写该账号密码，后surfaces沿用初始密码；GEO-209已确认并记录同一测试间账号污染。GEO-307未读写该账号或改动相关用例。

因Make在真实栈失败处退出，fixture未自动执行。随后独立执行`npm --prefix frontend run e2e`，498 passed / 54 skipped、exit 0、secret scan clean。54跳过是按模式跳过的真实栈专用用例，包含新GEO-307用例；新用例另在真实栈实际执行通过。最终定向真实栈为1 passed/exit 0/scan clean。

没有将补充fixture或定向检查合成为完整make e2e成功，没有修改范围外用例或放宽认证/审计边界，没有因原失败未变化而盲重跑完整门禁。完整日志见make-e2e.log；前序证据见`.trellis/tasks/10-02-geo-209-plan-ui/evidence/gate-failure-classification.md`。
