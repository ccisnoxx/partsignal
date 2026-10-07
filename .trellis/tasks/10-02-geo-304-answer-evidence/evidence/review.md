# GEO-304 独立只读复核

critical_reviewer fresh、fork_turns=none；起点是 evidence/candidate.diff 与冻结candidate目录，避免把全脏树归入GEO-304。实际只读工具事件见 review-tool-evidence.json，非自报推断。

三项确认P2均解除：单字符DNS/末尾:: IPv6被SQL误拒绝（改host形状，91 passed包含真实PG往返）；迁移普通预检期间旧采集穿越（先Run表SHARE ROW EXCLUSIVE，真实旧写锁等待和55000原子拒绝专项1 passed）；起点generated类型缺四组件（生成及contract-check退出0）。复核补读当前源码和实际日志后，没有新增确认未修复问题。

覆盖两表、全部0050函数/触发器、Schema、URL规范化/位置去重、summary闭合、文件HEAD/资格、GC/RC/RR锁、不可变/完整提交/历史迁移。边界：当时完整integration尚运行，未认定通过；自动API/BROWSER窗口和采集后FAILED主要静态核对；真实OSS、未来submit授权/Run锁/HEAD接线不是已验证流程。工具事件确认无写入；审计Bundle关闭校验结果后补记录。
