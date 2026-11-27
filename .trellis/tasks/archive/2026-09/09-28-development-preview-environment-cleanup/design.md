# 设计与执行边界

使用clean-code-design，Settings/Compose/数据库仍拥有原合同；本地prepare-preview-env.py仅第一次生成并排他安装完整staging env，不作为新配置加载器，不改账号创建/AI配置owner。六个CSPRNG secret与derived数据库URL一次生成，后续复用。准备工具不Docker/SSH、不连接数据库/供应商，不输出secret。

服务器清理授权来自用户当前明确选择：测试数据可永久删除，配置和旧冻结证据保留。实际清点与精确候选脚本位于 /Users/sc/.codex/audits/development-preview-cleanup-20260928。先复核目录inode/容器ID/project/service/network labels、其他资源引用、冻结archive/manifest/image身份。保留config备份至0700 shared/retired-configuration。只替换geo项目site为无upstream的410离线入口，保留原listen/TLS/ACME与canonical安全snippet；nginx-t/reload失败先恢复原site，不删除数据。随后精确停止/删除7容器，删除空的3已核验网络，再次核对其他容器/mounts，删除测试数据和已清点项目条目，删除未被其他容器/冻结身份使用的具体image tags与unused baseline volume。无Compose down/prune/force rm。

旧冻结ID mvp-20260928-023635-649641cec3bd 的三个release条目及两个镜像保留，路径和SHA/ID不变；不生成manifest，不冻结新release。最终核验共享env与冻结证据、其他9容器与NGINX文件身份不变、project资源0、public410。本清理是用户开发阶段重置，不沿用Production clean-init/maintenance状态机。

当前main保留上一任务未提交变化，不回滚他人或历史候选。I04 formal cutover不继续；新开发预览部署以用户后续通知为准。

独立复核发现并已修正的删除保护：ROOT/releases/backups保存父目录与各顶层目标device/inode/type；停容器后再次严格比对映射。release只遍历冻结的65个删除名，不删除重枚举出的新条目；backups逐个删除原清点测试文件并rmdir，未知新文件保留并显式失败。其他容器bind检查realpath规范化后的双向祖先/后代/相等重叠，前置与删除前均核验。安全回归覆盖新增条目、同名替换、符号链接和路径重叠。
