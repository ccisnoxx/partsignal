# I01 旧深链接与根路由收敛

## Goal

验收 `02-information-architecture-and-routing.md` 登记的旧地址均通过显式 route replace 收敛到唯一 canonical 地址，并保留认证、权限、查询转换、浏览器历史和错误边界。

## Requirements

- 前置 P08、C08、U07、G08、A11、S03、W01 均已按本轮证据完成；权威为路由蓝图、测试与验收规范及任务清单 I01。
- 只使用显式 file route 与各领域 canonical search parser；只转换等价的 snake_case 白名单字段，丢弃未知字段，不引入通用重定向器或 identity 查询。
- 匿名 deep link 的原始站内 URL 由单一 return-to owner 校验；拒绝 scheme/host、双斜杠、反斜杠、控制字符、畸形或重复编码和 `/login` 自循环。
- must-change-password 优先进入 `/account/security`；管理旧地址先 canonicalize，再由既有 ADMIN boundary 裁决；未知 SPA path 显式 404，缺失资源保留 canonical 页面错误。
- replace 后 direct、refresh、Back、Forward 保持正确；静态资源仍由外部 owner 处理。

## Acceptance Criteria

- [x] route-local unit 覆盖各领域 query 白名单、未知字段丢弃与 Publishing 优先级；return-to unit 覆盖合法站内地址和全部拒绝类别。
- [x] 当前 production artifact 在 mobile/desktop 覆盖全部登记 pathname、query/workspace/Publishing、登录回跳、权限、浏览器历史和 404/资源错误。
- [x] 记录实际代码、验收证据、独立复核、残余风险及 I02 后继；检查 diff/工作树。

## Notes

- 设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- 初始候选的 route-local/return-to 测试为 2 files / 26 tests，production artifact mobile+desktop 为 12/12；其后独立复核确认两个测试未捕获的兼容缺口：`/audit?target_id=` 被静默丢弃，以及非法 `platform_profile_id` / `platform` 被错送进 Workspace。
- 修复集中在 `frontend/src/routes/-legacy-routing.model.ts`：旧 `target_id` 现在经既有 `auditSearchSchema` 转为 canonical `targetId`；平台选中值只有通过 canonical UUID 规则时才小写规范化并进入 `?tab=accounts`，非法值回到平台列表 parser。没有新增通用 redirect、identity 查询或未知字段透传。
- 修复前新增断言稳定复现 2 failed / 8 passed；修复后 route-local + return-to 为 2 files / 28 tests。定向 ESLint、typecheck 与 `git diff --check` 通过。
- 当前 production build 上的 `legacy-routing.spec.ts` 为 mobile+desktop 12/12；六类场景覆盖全部登记 pathname、query/workspace/Publishing 优先级、两个非法平台入口、Audit `targetId`、replace 的 refresh/Back/Forward、匿名回跳、must-change、ENGINEER 403、根 404 与 canonical Content Task 404。只有既有大 chunk 警告。
- 独立只读复核在修复后结论为 **NO BLOCKER**，确认两项阻断均解除，未扩大 query 白名单或改变认证/权限 owner。剩余覆盖限制为：Back/Forward 以代表 route 证明机制、资源错误以 Content Task 为代表、static asset 404 属外部 owner，且未单独测大写 UUID；均不构成 I01 阻断。
- 原检出区保持干净。I01 已满足 I02 前置，下一步执行当前候选的完整仓库质量门禁，不引用历史 V2 结果。
