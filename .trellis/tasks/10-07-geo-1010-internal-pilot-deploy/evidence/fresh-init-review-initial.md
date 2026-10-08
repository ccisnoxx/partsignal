# Fresh reset 初次独立复核

复核对象是候选实际diff `candidate-after-runtime-doc-fix.patch`，SHA256 `58298da8dc54d9cb51e3459b0d2ba0fd66c0554f298d5782b6d37d649f1d5fd3`。只读critical reviewer `/root/fresh_reset_review` 发现并交付如下结果；这是对初次候选的调查，不是修正后源码或目标部署接受。

P1发布阻断：`production_fresh_reset.py:197` 收集Linux mountinfo后只检查三个叶目录，没有拒绝root本身是同device bind mount。`Path.is_mount()`不足以识别该输入，首次reset能将映射源内容清空。应在首次删除前与guarded checkpoint明确核对root mount边界，并补拒绝回归。已交回实现owner修正，必须完成修正后的独立复核。

部署附录reset-data命令缺少`PARTSIGNAL_RUNTIME_ENV_FILE`的问题已由主代理补齐，reviewer确认修正生效。

其余已检查范围：叶目录与符号链接删除语义、FD/device/inode、部分删除及同run/candidate续跑、目录替换拒绝、maintenance lock/supervisor、fresh部署准备、bootstrap/activation、fresh NOT_APPLICABLE回滚与旧upgrade/recovery。除root挂载缺口外未确认其他阻断问题。

复核核对正式验证记录和六份日志SHA；fresh独立13项、Production scripts harness（内嵌fresh12项）、旧recovery19/failure7/registry4/signal组通过。没有重复测试、Git/SSH、文件写入或私有配置读取。真实Linux bind、Host服务静止/删除、空库迁移、真实AI/OSS及目标activation未验证。Linux只读mountinfo解析通过不能替代删除边界证明。
