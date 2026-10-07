# 固定 28e92111 CI 增量独立复审

审查结论：**APPROVE**。仅批准固定 `28e921112aadb9f00da9449f71c4a616babc972d` 相对父提交 `14dd7594452e4080826b15f64683eb3990450704` 的 GNU CRLF 修复与 CI 分组代码；没有确认需修改候选的阻断 finding。后续远端验证仍 pending，不能据此宣称完整 CI、GEO-1009、main、RC 或生产已通过。

独立审查者：`/root/ci_gnu_fixed_review`，fresh `critical_reviewer`，fork=none。源码与原始材料只读核对，不执行测试、构建、CI、远端写入或文件修改。配置与执行审计见 `/Users/sc/.codex/audits/multi-agent/partsignal-2069b161/20261007T044009Z-pr-acceptance-rc-96e216df/03-ci-gnu-review.summary.json`。本文件由主代理保存该独立审查结论，不是主代理自审。

## 源码结论

- `deploy/scripts/test-frontend-container.sh:24` 以 POSIX printf 生成实际 CR；38/43/48/54 的可选 CR 和行尾锚定保留 Cache-Control 精确值，额外值与后缀不能因此通过。fallback 正文比较、Vary、sourceMappingURL、404、镜像内 map 禁止及原清理路径保持。
- `.github/workflows/ci.yml:6` 默认 full，缺省也回落 full。原步骤顺序、命令、安装项、services、env、两路 shard/单 worker 未变；Redis DB15、E2E DB14 和 Browser 独立隔离入口保留。
- delivery 的 job 名与日志明确 partial，只跳过六项前序检查及 frontend shard。bootstrap/迁移、Playwright 安装、build/deploy、根 make e2e 与末端两项 Compose config 必跑，没有 continue-on-error。E2E 自建数据库、替身和服务，未发现对被跳过 integration 成功副作用的新增依赖。
- 未知输入在首个 verify step 退出2，早于 checkout/setup/install；保证仅指 verify，不扩大为所有其他 job 都没启动。

## 证据复核

原始日志哈希与记录一致。run37572374117 绑定0b232f2c且最终 FAILURE：3865 backend unit、1308 frontend unit、591/717 两路 shard、1253 PG（1958.72秒，45 warnings）及6真实PG16恢复通过；应用镜像构建后 frontend-container 自检退出1、make退出2，后续 deploy/E2E/Compose 没有通过证据。

原生完整 canonical frontend 自检通过；真实 HTTP/资产经过 Linux GNU grep3.11，旧脚本退出1、新脚本退出0。分组验证比较原 full steps/services/env、六项条件及剩余必跑命令，实际执行 guard 得 full/delivery=0、unknown=2。三个受影响文件哈希与固定28源码一致，旧脚本哈希对应父版本。这些执行发生于14dd+dirty patch，不能写成clean28重跑；只有grep在Linux，其余shell在Mac，不能称完整Linux runner验证。

## 准入边界

CI规范允许旧成功前序（实际相关输入未变）+ 将来固定候选成功delivery CI + fresh独立增量复核组合关闭PR代码准入；目前缺将来定向CI成功结果。必须记录group/headSha/runID/逐阶段结论及shard跳过，不把delivery standalone或旧失败run写成全量通过。本轮一次CI预算尚未调整，不能自动追加运行；PR继续Draft。clean main全门禁不可免除，既有恢复1008接受完整保留。
