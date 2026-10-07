# 前端与部署只读调查（主代理整理已返回的报告）

来源：frontend_deployment_security，固定 analyst；fresh/none。未写文件/运行测试/读取实际秘密/访问生产或平台；本文件由主代理保存。

## 结论

所读实现中未确认可利用的XSS/CSV/会话缺陷。目标环境未知仍阻断904；Browser平台批准对deferred core不适用，但实际启用API必须有真实范围匹配批准，当前inventory未知。人工截图内容脱敏依赖SOP/提交裁剪，现有HEAD/MIME/hash不检测图像中的秘密。

## 完整阅读记录

root/frontend/backend AGENTS；frontend index/quality/type；infra index/security/production-delivery；用户指定roadmap/WBS/security/testing/deployment/ADR006；904 prompt/Task Brief。

完整源码单位：run-detail及test、browser-session-panel/API及test、run-upload、共享client/queryclient/playwrightconfig；citation_urls/report_csv/answer_files；browser-session router/service/schema；Browser collector service/session；production/browser/sessions-overlay Compose；nginx configs；geoRecoveryEnv；901/903/804低敏JSON；browser-session-real-stack E2E。其它模块仅相关片段，不声称全量前端或认证审计。

## 安全检查定位与限制

- SEC001：browser-session-panel.tsx:92～119 直接短暂请求不进MutationCache，45～58/139～151清理与固定错误；browser-session.api.ts仅元数据及固定错误。ai-workspace直接await后清空输入。browser-session.test.tsx覆盖cache/storage/unmount。backend browser-session PG测试检查API/log/audit canary。本轮没有运行真实栈E2E；既有E2E源码使用canary检查DOM/storage/runtime errors，trace/video/screenshot关闭，不能证明任意图片脱敏。
- SEC004：run-detail.tsx:180文本、230安全href+rel、314 http(s)/无userinfo；markdown-editor ReactMarkdown+rehype-sanitize/skipHtml/noimg。geo_citation_urls.py闭合scheme/userinfo/control/IDNA、不fetch。run-detail、Markdown、insights-evidence组件和answer-contract单元测试覆盖HTML/危险链接。
- SEC005：geo_report_csv.py:110～132在所有文本列前缀检查Unicode空白/control后 =+-@，csv.writer转义；220～241仅URL hash/title/claim白名单；固定文件名/no-store。test_geo_reports.py单元35～61/211～260与集成185～202保护公式和隐藏正文/URL query不导出。
- SEC008：session router所有命令ADMIN+CSRF/no-store；internal专用key。service:313～374文件权限/常量时间/当前ADMIN/开关/合规/profile/ref/expiry/digest，审计先提交；245～264撤销先提交再清理。数据库不可恢复旧引用。storage health不是登录或collector readiness。

## 部署证据边界

production include browser compose 不等于启用geo-browser profile；API当前Settings、worker环境、Compose interpolation、实际profile/服务必须同环境核实。Browser骨架network none/read-only/drop ALL/defaultSTOP；sessions overlay只定义受保护密文、公钥、专用capability/collector私钥挂载，不能从仓库文件存在推断实际部署或无材料。nginx静态CSP/HSTS等不证明目标TLS/header/cache。

901材料JSON仅local dev；903环境为新建隔离restore source，其Browser N/A不适用于生产；804旧批准搜索仅仓库/已检查环境范围，不能推广到实际外部系统。geo-recovery.py browser_check使用操作人描述加Settings/PG检查，不自动发现整套部署；check-production-inputs.py没有自动落实Browserfalse/零材料验收。

## 尚缺依据

同一目标环境版本/时间、API和worker真实Browserfalse、零Browser enabled profile/服务、无capability/key/session挂载、PG零会话/引用以及所有受保护路径/卷无材料；实际启用API/platform approval inventory。任意一项未知不能给N/A，发现材料应保护和清理，不实施deferred804～807。
