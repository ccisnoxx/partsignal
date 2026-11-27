# GEO E2E 评估开关阶段隔离修复

GEO-1010-DEPLOY 的候选 `1ed8c4af1d62fb6d86b4401d0703a90bf629a839` 完整门禁在 GEO-408 enabled 栈启动时失败。canonical MANUAL UI 接受实现将 runner 的评估开关设为 true，独立 API 模式工厂 assemble 明确要求 false，API/Worker/Beat 均在装配前拒绝。

仅修改 deploy/scripts/e2e-local.sh 的 GEO 模式分支，使三个 API 模式显式关闭机会评估，canonical MANUAL 保留 true；修正过期 infra E2E spec。不得改变应用功能、工厂拒绝、安全边界、资源归属/清理或 Production 默认。此为独立缺陷记录，不是 GEO-1010 第四个 child，不登记新顶层数字 ID。

验收：shell 语法/diff 通过；三个 GEO 模式在真实受控栈启动并完成既有用例、secret scan 和 owned cleanup；修正后 main 固定新 SHA，再执行任务明确要求的完整 make verify。原失败及原 UI 接受证据保留，不将修正后的文件伪装成原接受哈希。
