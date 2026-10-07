# GEO-1009 候选收口

按用户本轮顺序执行：固定0b232f2ce268c7e78836a2f2ce811c9eaa45944c触发一次CI（run37572374117）；不新增运行源码。通过后复用既有整PR审查、六项修复和CI入口fresh复审，核对任务接受及覆盖缺口，完成整PR接受与Ready。获准后合并main，在clean main=origin/main固定commit执行一次run-verify完整门禁；同commit产生确定性source archive、真实镜像身份/非空RepoDigest、manifest与v1.0.0-rc1 tag。所有时间/退出码/日志摘要保存。

明确授权：本轮用户已授权条件满足后的治理提交/推送、PR Ready、main合并及RC冻结。该授权不包括真实服务器生产写入、开放流量或把合成Gate当现场验收。GEO-1007恢复接受保留，不重复；其他任务仅按实际完整合同/证据接受，不补造历史。

成本：分支CI一次，失败先诊断/定向；clean main完整门禁一次；旧证据输入未变即复用，不额外全量。部署候选producer必须真正通过，不使用测试逃生。固定tag/archive/manifest不可覆盖。

候选身份输入：当前缺明确RC镜像repository与可执行的已验证previous V2回退镜像；历史I04 rollback已被授权删除。构建/manifest阶段需真实身份输入，不能猜测或伪造。仓库外受控目录保存原始日志/产物，工作区需要clean时不写tracked证据。

用户随后明确允许追加这一次delivery远端CI；run37581493190固定c6b310f5已执行。该追加授权仅一次，不自动扩展为第三次运行；失败继续定向定位，不从头重复本地全套。后续Ready/main/RC仍以准入条件实际满足为前提。
