# GEO-1009 候选收口

按用户本轮顺序执行：固定0b232f2ce268c7e78836a2f2ce811c9eaa45944c触发一次CI（run37572374117）；不新增运行源码。通过后复用既有整PR审查、六项修复和CI入口fresh复审，核对任务接受及覆盖缺口，完成整PR接受与Ready。获准后合并main，在clean main=origin/main固定commit执行一次run-verify完整门禁；同commit产生确定性source archive、真实镜像身份/非空RepoDigest、manifest与v1.0.0-rc1 tag。所有时间/退出码/日志摘要保存。

明确授权：本轮用户已授权条件满足后的治理提交/推送、PR Ready、main合并及RC冻结。该授权不包括真实服务器生产写入、开放流量或把合成Gate当现场验收。GEO-1007恢复接受保留，不重复；其他任务仅按实际完整合同/证据接受，不补造历史。

成本：分支CI一次，失败先诊断/定向；clean main完整门禁一次；旧证据输入未变即复用，不额外全量。部署候选producer必须真正通过，不使用测试逃生。固定tag/archive/manifest不可覆盖。

候选身份输入：当前缺明确RC镜像repository与可执行的已验证previous V2回退镜像；历史I04 rollback已被授权删除。构建/manifest阶段需真实身份输入，不能猜测或伪造。仓库外受控目录保存原始日志/产物，工作区需要clean时不写tracked证据。

用户随后明确允许追加这一次delivery远端CI；run37581493190固定c6b310f5已执行。该追加授权仅一次，不自动扩展为第三次运行；失败继续定向定位，不从头重复本地全套。后续Ready/main/RC仍以准入条件实际满足为前提。

用户再次明确允许本次delivery37584298170，旧单元/PG/本地完整验证继续复用。本次实际失败，仅定位并修受影响Production自检；旧失败保持，第四次CI不自动触发，Ready/main/RC仍以准入条件闭合为前提。

用户针对0475a776明确允许第五次delivery CI37594203220；预算已用于该run，实际FAILURE。只处理失败的GEO API enabled错误详情断言、对应定向验证及固定新提交复审；第六CI未授权，整PR接受/main收口仍以新SHA远端通过为前提。此前成功且输入未变的证据继续复用。

用户再次明确允许本次delivery CI37598569164；旧成功单元、PG与本地完整验证输入未变继续复用。固定8d2结果成功后，按已有条件授权进入整PR代码接受/Ready/合并main及一次clean main门禁。原五次失败与预算历史保留；不自动运行第七次CI，不重做恢复1008接受。
