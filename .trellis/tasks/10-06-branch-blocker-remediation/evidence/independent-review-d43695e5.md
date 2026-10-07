# 固定 CI 入口增量独立复审

APPROVE，仅针对 d43695e5e5eac3ba8babdea22092cfcb2097144c 相对 aa7f3db8c222cd8b9a48bffbf24884c4c34e8151 的 CI 入口修复增量。主代理根据fresh critical_reviewer最终交付保存；未确认P1/P2，不是整历史分支或GitHub人工批准。

实际diff仅.github/workflows/ci.yml。审查读取固定Git源码，未提交治理文档未用于结论；全程只读，没有重跑测试或触发CI。

已核实三个缺失条件由现有入口建立：

- workflow:59复制.env.example；Makefile:54使用开发Compose backend-test；compose.dev.yaml:127根合同只读挂载/contracts。
- compose.dev.yaml:133要求fake-oss健康；:147固定测试对象端点http://fake-oss:9000。Dockerfile:18镜像依赖环境直接运行Python，无运行期uv同步；HTTP健康检查失败阻止测试。
- Makefile:55必跑宿主恢复入口；test-geo-recovery-integration.py:33从test profile读取测试身份，验证唯一PG16容器及回环端口并设置GEO_RECOVERY_PG_CONTAINER；geo_recovery_support.py:48使用该容器真实工具，:89缺工具直接fail不skip。

普通集合ignore恢复文件后，第二段明确执行整个恢复文件六场景（含参数化密钥负例）；Make错误无忽略标记，wrapper返回pytest退出码。普通集合、Compose、PG*污染、容器身份/端口、恢复测试任一失败仍阻断。

现有workflow宿主DB/Redis/对象配置不会替换Compose显式测试环境；恢复wrapper覆盖DB/Redis URL，fixture覆盖对象端点为自身临时HTTP服务。宿主GitHub services的5432/6379与Compose 55432/56379、对象19001不冲突；job无PG*环境，POSTGRES_*不符合该前缀。随机来源/恢复库和工具测试库限制保留。

原始CI日志核实54StorageUnavailable+6FileNotFoundError+6恢复setup errors=60failed/1193passed/6errors。clean aa完整门禁record与日志SHA256一致，相同Make入口1253普通PG+6真实恢复通过；d436 dry-run/sample配置检查exit0。两提交之间Makefile/Compose/Dockerfile/测试/应用/迁移/恢复源码未变，旧行为证据可复用于未变入口实现和测试集合完整性。

覆盖限制：d436在GitHub Ubuntu runner实际冷启动、镜像构建和完整远端CI未执行。本地证据不能替代新SHA CI结果；不接受whole-branch、其他task、main/RC或生产。GEO-1007已接受的严格恢复不变。
