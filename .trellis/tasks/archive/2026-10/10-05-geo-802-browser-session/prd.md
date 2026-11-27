# GEO-802 Task Brief

## 1. 基本信息
GEO-802：实现浏览器会话加密引用和撤销流程；R7；负责人主代理；分支 geo/GEO-802；状态 review（本地实现与验证完成，待人工验收）。唯一依赖 GEO-801 manifest=done、Trellis=completed，2026-10-05 人工接受。无提交/发布授权。

## 2. 目标
管理员可安全导入人工登录后导出的 Playwright storage state，查看加密会话存储健康、撤销并通过新导入恢复。Collector service identity 是密文访问的唯一 API 主体，只有独立 Collector 持私钥、在内存解密。

## 3. 关联需求
WBS GEO-802完整行；PRD §10.2/11.3/14、AC-SEC-01、AC-AUDIT-02；Worker §12.4；Security §6/10/11/12；TEST-GEO-SEC-001/008；Accepted ADR-002/003/005。

## 4. 必读文档
用户指定README、delivery01/02/04/05/manifest、产品愿景与PRD、domain/state、technical01/05/06/07/08及ADR002/003/005；根与backend/frontend AGENTS、Trellis workflow、相关backend/frontend/infra spec；当前OpenAPI/database的Profile/Run合同、0046/0048/0053/0062及代码/测试；GEO801记录。大型合同按受影响完整component/operation定位，复用无关既有合同。

## 5. 当前行为
Profile仅保存闭合非敏感settings，不含secret/reference。无会话持久化、导入/撤销/health API。Browser骨架network none、session probe NOT_IMPLEMENTED、未注册真实adapter。

## 6. 目标行为
会话独立聚合保存UUID引用、Profile绑定、密文哈希、有效期、健康与撤销/清理事实；受保护卷只保存AES-GCM+RSA-OAEP密文。API公钥可加密但不能解密，私钥仅Collector持有。管理员导入/检查/撤销均受权限、CSRF和安全审计保护。专用Collector能力凭据绑定现有ADMIN User身份，只授权访问本端点、重新验证当前Profile/Surface/开关和引用，访问审计成功提交后才返回密文。

## 7. 范围内
- [x] session reference、本地存储health、人工导入/撤销/重新导入恢复。
- [x] 专用卷/公私钥隔离、访问身份/审计与redaction。
- [x] contract/DDL/迁移/管理UI/定向单元、PG、前端及E2E验证。

## 8. 范围外
803模拟站/adapter套件，804真实平台adapter，805截图，806在线登录探测/频率治理，807真实试点，901自动保留清理/903完整备份恢复；无真实AI、账号登录、MFA绕过、生产启用、无关重构或新身份系统。

## 9. 业务不变量
PG权威；Redis只传ID；Router无事务写入；Cookie不进DB、普通OSS、日志、audit、截图、URL/query/mutation cache。Profile/settings/Run历史无secret；已有终态/历史不改写；UNKNOWN不回退；导入不启用Profile/adapter或伪造PASSED。撤销单向且不可恢复为同一引用。

## 10. 契约变化
OpenAPI：GET Profile browser-session context，POST import/health/revoke/purge；internal Collector access POST。请求storage_state为writeOnly SecretStr，闭合metadata/actions与稳定错误。Database：geo_browser_sessions、未撤销Profile唯一、FK RESTRICT、撤销终态/不可变身份守卫；0063_geo_browser_sessions，无历史回填。

## 11. 后端实现
复用command User→Surface→Profile锁序，再按UUID锁session；命令比较Profile revision。import先写随机ID不可覆盖密文，再原子提交引用+旧引用撤销+Profile停用/UNTESTED+audit；失败不发布引用。revoke先提交墓碑，再清理密文，删除失败保留purged_at=NULL显式待办，再调用可恢复。health只读取密文完整性与有效期，不解密或探测真实平台。access专用身份、当前资格与引用锁内仲裁，成功audit原子提交后返回密文；撤销先获得锁则零释放，已释放材料需消费方清理临时context，本任务不接线真实collect。

## 12. 前端实现
现有/configuration/geo-surfaces Profile详情的管理员Browser会话面板，URL继续复用profile_id。独立query owner，服务端动作；文件只用File ref和本次请求内存，不使用useMutation传递secret；输入不回显/preview/持久化。loading/empty/error/conflict、显式reload与重新确认、键盘/焦点、principal epoch。

## 13. 测试计划
Unit：格式/secret错误、密文/nonce/关联数据、文件nofollow/权限/删除；跨语言恢复和错误key。PG：身份/CSRF/CAS/审计原子、替换撤销、缺文件/篡改、清理失败恢复、并发与DB直接SQL及TRUNCATE反例；空库/head前滚及旧数据不变。Frontend：服务端动作、精确请求、secret不进cache、409不重放；真实栈定向导入→health→撤销→新引用恢复E2E。普通测试仅临时密钥与虚构state。

## 14. 验收标准
ADMIN成功导入仅返回metadata；ENGINEER/匿名/错误service token拒绝。已撤销/过期/跨Profile/cipher篡改无法授权解密。审计/错误/日志无canary；DB无secret或cipher正文、普通OSS无对象。新进程用独立私钥恢复相同state；原引用永久撤销。

## 15. 验证命令
git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration；精确PG/跨语言/前端/目标E2E。命令结果见implement.md和evidence，不把未执行写成通过。

## 16. 数据和上线
0063加法迁移先于API部署；无回填。卷与key独立保管，API只挂公钥、Collector只挂私钥。默认无配置时功能明确不可用，Browser仍关闭/network none/STOP。生产配置和真实访问需相应批准；撤销后恢复为新引用，不复活旧材料。停止入口/前向修复，不downgrade删除撤销历史。

## 17. 风险与停止条件
DB/卷不共同事务：墓碑阻断读取与显式清理待办；进程崩溃未引用密文按受保护卷运维处理，不虚构补偿成功。health AVAILABLE只证明本地完整性，不证明平台登录有效；在线探测后续任务负责。已释放内存不能远程追回，本任务无真实consumer。只按用户五类业务条件blocked，测试失败准确记录并定位。

## 18. 完成证据
基线、最终命令、首次失败及定向修正、独立只读复核、任务文件差异与已验证审计Digest均保存在evidence；详见implement.md。只标记review，尚未人工接受或发布。

## 19. 后续任务
803、804（依赖802+803）、805、806、807；不在本任务实施。

## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-802 的实现与测试证据。”据此记录manifest=done、Trellis=completed。上文实施与review阶段记录保留为验收前历史；本次仅完成验收记录，不修改其他任务状态或实施后续任务，不提交、推送或归档。
