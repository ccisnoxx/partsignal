# 冻结部署与恢复计划

## 输入与所有权

本地输入/远端基线见 evidence/local-input.json、remote-before.json、db-before.json。源码 owner 是精确 commit archive；服务 owner 是固定 Compose project/service/image，不是 current。公网 owner 是现有 Hostdzire Nginx 回环代理。current 只作为通过验收的记录链接，本任务不写 Nginx、不 reload。

新release `preview-20260930-111500-2f171300`。源archive 1941504 bytes，SHA `c83c6ece8f11e1c4fa4d340dc50fd7dde6b828948598febd255f75577ef8e0d2`。远端路径 `/root/partsignal/releases/preview-20260930-111500-2f171300.tar.gz`，以 open(xb) 排他传输，核对SHA后排他创建同名release目录。

旧release `preview-20260929-082104-4e85aaf9`，旧backend ID `sha256:434a136729a8f2eb33ba260a870cd3f3f9f37a6ffeba1e5999a967cfae893642`，旧frontend ID `sha256:e98d2c8c65074f6051235eae59cf770d5239ea4fcd3987796c94945d9b3710cb`。两个回退tag和RepoDigest/platform见remote-before；不retag或删除。

## 备份与配置

首次写入运行 rollout-remote.py backup：锁 `/root/partsignal/shared/.runtime-gate-rollout.lock`；排他备份目录 `/root/partsignal/shared/runtime-gate-rollout-backups/preview-20260930-111500-2f171300`（0700）。env.staging.original为0600、1583 bytes、原SHA `05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85`。postgres.dump为0600的pg_dump -Fc一致性快照，实际bytes/SHA在backup成功后冻结，再进入prepare。pg_restore --list仅解析目录、不恢复业务数据库。数据库备份保留加密AI credential，与原env中的加密主密钥成对保存在同一受控目录；不下载、不解密、不输出。该本机恢复材料不是异地灾备完成声明。

候选仅将CONTENT_GENERATOR=deterministic改为openai-compatible，1587 bytes，候选SHA `3f43478292b82002c4bc6bae44adb580f939f6c74219346d0cb5364fc41141cf`。其他键、顺序和值逐字节保持。拒绝重复/未知键、控制字符、插值、symlink和权限漂移；candidate Settings使用新image、无网络的一次性容器，Compose在release配置链接临时引用shared内候选时检查，内部JSON逐键比较实际env和三个原数据mount，不输出正文。候选校验后release链接恢复shared/.env.staging。

所有Compose命令显式--project-name partsignal-staging；进程环境最小化，固定两个image repository/data root，拒绝ambient COMPOSE_PROJECT_NAME/DOCKER_HOST影响；candidate断言实际config name。

共享env/current的本任务写入owner只有本执行器，参与配置写入的操作须持同一锁；flock是协作式独占锁，checksum检查+replace不是针对不遵守锁的任意root并发写者的系统级原子CAS。不对该外部场景声称保护；发现checksum或current漂移停止。本任务没有其他已授权env/current写入。每阶段重核env SHA、Jobs门禁。安装前同目录候选root:root/0600/regular；停API和Scheduler、复核active Jobs=0，再停Worker并复核；发现Job则恢复原服务且不安装env。无并发在途业务可进入后，旧SHA CAS及os.replace/fsync原子安装。文件变更不代表旧进程热加载；三个消费者均停止后才安装，随后由同一候选源码和env重建。

## 升级路径

不调用redeploy-staging-fast.sh。其原检出区clean要求不满足且.env.example发生注释改变，不能声称资格门禁通过。使用独立有备份、冻结身份、审查和恢复路径的手工升级，按deploy-staging.sh的fast执行顺序手工升级（不是fast wrapper），所有消费命令固定--no-build --pull never。4e85aaf9..2f171300的Alembic versions/Compose/deploy-staging.sh/安全snippet没有变化，远端prepare还diff -qr；schema仍0043_geo_platform_identity。候选prepare只build一次，candidate阶段排他冻结image identity到配对备份目录candidate-images.json；switch前后核对ID/RepoDigest，执行config/up existing postgres redis fake-oss/read-only preflight/up worker scheduler/api frontend，不执行migrate和initialize-accounts，不执行drop、volume down、数据搬移或clean-init。initialize-accounts原实现只在用户名不存在时插入，既有账号不覆盖；本次更直接跳过它。候选影响当前容器前先run --rm --no-deps候选preflight-integrity，结果必须[]。

候选backend/frontend tags唯一且必须不存在后才build；记录新旧ID、RepoDigest和linux/amd64。所有one-off必须--rm；正常容器7个。复用原数据目录和网络标签。不使用--remove-orphans、network override或Production脚本。

## 失败恢复准确入口

本地将本文件夹evidence/rollout-remote.py经stdin交给 `ssh hostdzire python3 - rollback`。该冻结入口先保留状态，要求active Jobs=0（有RUNNING则等待现有合同终态，不重放），停止API/Scheduler/Worker，原env备份SHA校验、候选SHA CAS、同目录0600暂存原子恢复。校验旧images精确ID，旧release Compose执行 `up -d --wait --no-build --pull never postgres redis fake-oss worker scheduler api frontend`；不恢复数据库、不删除新Job或Version。旧env字面deterministic对应旧代码的历史已知语义，不能宣称旧Worker no-egress；原有enabled配置保持且不发起额外生成。

current若尚旧则无需变更；若已新，则先完成旧容器/公网/模式复验，再执行 `ssh hostdzire python3 - rollback-current`（同一冻结脚本经stdin），该阶段CAS要求current精确新release，并以同目录排他symlink+os.replace恢复 `releases/preview-20260929-082104-4e85aaf9`。CAS发现并发env/current漂移立即停止，不覆盖。任何步骤失败保留所有现场，禁止临时改源码/脚本。

## 单次业务验证

可见浏览器已有管理员会话；不读取密码或Cookie/browser state。复用现有Product c44dc902-283e-4e25-b96b-158e0b451a2a、PUBLIC Fact 965f1c89-5cfb-49a7-9d88-4f49660f15e9、Platform b1f25fd0-b4b7-4ce7-aa60-313da2242bc6、Prompt 3406aad6-60e9-4762-affa-8f16961523fc/rev0，正常UI新建清楚命名的ContentTask；generation-options显示既有模型后，仅点击一次确认生成。最多一个Job，不无条件重试。只读DB/UI Usage与Worker allowlist completion及单次adapter调用代码共同证明调用一次；不声称独立供应商计费系统遥测。不审核、不发布、不自然化、不删除。

候选健康/模式/历史连续性和真实生成全部通过才执行current stage。切换后再次健康/lineage/备份/旧资源核验，并fresh最终独立高风险复核。secret边界只输出ID、enum、bytes/SHA、布尔状态、必要Usage指标；不保存原始Provider或完整进程日志。
