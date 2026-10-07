# 固定00b4eca2 staging自检环境归属独立复审

**APPROVE，仅适用于本次staging自检环境归属修复。** fresh critical_reviewer `/root/staging_owned_env_review`，fork=none，独立只读复核 `00b4eca271c635c1fc4b6b0c5fbc08d1dfd680bd` 相对父提交 `c6b310f568798a6f068869870c648189ff7d604d`，未确认需要修改或阻断该增量的finding。不得据此称delivery CI、整PR、main门禁、RC或GEO-1009通过。本文件由主代理保存独立返回结论；审计20261007T063635Z-staging-ci-owned-env-review-860d9308 closed/verify通过，全部tracked文件前后hash零变化。

## 实际源码与不变量

- `deploy/scripts/test-deploy-staging.sh:97`原样复制权威staging Compose及当前唯一include，没有生成替代模型。`../.env.staging`由此前已生成/验证preview.env副本满足，`--env-file /dev/null`、选定frontend与真实Compose解析仍保留；include及env路径分别见compose.staging.yaml:3、11、30、65。
- 112行起单服务、镜像、无depends_on、无links四项断言未放宽；14行安全头、preview配置与私有归档检查、134行起full/fast/invalid模拟及顺序断言保留。实际Compose、部署入口、workflow、应用与依赖没有变化。
- 5行创建独立临时目录，新增文件在目录内，由7行起原精确清理/trap覆盖；mkdir/cp/Compose失败仍由set -eu传播，失败不能越过到成功输出。不读取、创建或覆盖checkout私有.env.staging，frontend配置输出不携带生成秘密。
- Makefile:120→staging自检、ci.yml:92→make build test-deploy-scripts真实调用链未变，没有新增skip、假成功或部署回退。

## 证据核实

固定脚本blob SHA256=e5a7a3c50b6cbd2554299180fecc0ef262c0d1623588aa54614f258251389f2d，与工作树、执行记录及反例一致；元数据与受控副本相符，所核对七份执行/获取日志哈希一致。

原生完整自检exit0。无私有env隔离checkout在Compose5.3.1旧/新均exit0，不能当红绿。Linux Compose2.38.2组件实际执行真实入口：旧因.env.staging缺失exit1、修复exit0。驱动把原始Compose/include和环境按相同绝对路径docker cp到network-none容器，传入原参数；其余自检Mac。客户端hash与[官方ARM64校验文件](https://github.com/docker/compose/releases/download/v2.38.2/docker-compose-linux-aarch64.sha256)一致；原远端日志的[固定runner清单](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md)列出2.38.2。没有证明整套Linux runner或其x86_64架构执行。

初次mount输入不可见exit1日志保留，未冒充目标反例。成功执行记录准确为c6+dirty修改，blob哈希绑定随后候选，不伪称clean00重新执行。

run37581493190真实head=c6、最终FAILURE。GNU frontend修复远端通过，后续staging缺私有环境失败；余下部署/E2E/末端Compose未执行，delivery前序skip不计通过。任务记录没有改写失败。复核者不执行测试/构建/CI/写入或再委派。

## 剩余条件

修复后固定候选尚无完整远端执行证据，后序E2E/部署与clean main门禁未闭合，第三次CI不在此前授权内。用户恢复GEO-1007/delivery1008原接受未受增量影响。
