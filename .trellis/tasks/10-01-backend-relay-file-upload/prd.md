# 后端中转文件上传

用户于 2026-10-01 明确选择浏览器 → PartSignal 后端 → OSS，并选择本轮只实现代码和定向验证，保留当前 staging release。此前真实 OSS 配置与浏览器直传验收不再作为本轮交付；父任务保留未完成的部署事实。

## 范围

实现统一文件传输端点，迁移平台 Logo、GEO、发布证据三个现有入口；保留上传意图、创建者权限、会话/CSRF、完整性校验、HEAD complete、abort、限时下载与清理墓碑。无数据库迁移、凭据变更、OSS ACL/CORS 修改、线上配置安装或 release 重载。

## 验收

- 意图返回应用内 PUT 路径，不再向浏览器签发 OSS 上传 capability。
- 后端只接受有效 PENDING 意图创建者的原始字节，限制实际大小、接收时间并核对 SHA-256；校验通过后才写入存储。
- 传输保持 PENDING，complete 继续真实 HEAD 后 VERIFIED；abort/complete/清理不能与存储写入交错而复活已清理对象。
- 三个前端入口提交会话绑定 CSRF；GEO与发布证据保留transfer失败abort、complete失败单独重试。Logo保留基线行为：transfer或complete失败均尝试abort，不宣称其有单独complete重试。
- 支持原有 2/10/20/50 MiB 类别上限；候选 Nginx 模板仅文件传输路径放宽至 50 MiB，运行中 Nginx 不修改。
- 定向后端/前端/契约与文件流程验证通过，独立高风险复核 NO BLOCKER，secret scan clean。
- 原检出区 HEAD/AGENTS diff、其他 worktree 和 Hostdzire current/release/image/配置均保持不变。
