# I03-1 审计设计

- 以活动执行入口为证据主线：`Makefile`、`.github/workflows/ci.yml`、Compose、Dockerfile、部署脚本、Playwright 配置和 package scripts。
- 对 `frontend-v1`、`frontend-v2` 与 `legacy` 字符串按语义分类：目录/source path 才可能是重复源码；镜像仓库名、历史文档、拒绝 V1 的负例和业务 legacy 数据不视为第二套源码。
- OpenAPI 生成链只比较权威输入、生成文件路径、脚本与调用图；`contracts/openapi.yaml`、生成文件和检查脚本相对基线无差异时复用 I02-3 通过证据。
- clean-checkout 风险以 Git 可达性为准：tracked diff、untracked 文件、staging、分支/commit、I02 日志与多代理审计包分别记录，不用当前工作目录可运行替代可恢复组装证明。
- 独立复核在审计报告形成后进行，复核者只读检查全部活动引用、21 个未跟踪维护文件和恢复边界。
