# 证据数据边界

原始证据采用独立两表；引用派生分类不属于此聚合。schema version1的summary只有payload_format(JSON/TEXT/DOM/null)、payload_bytes(非负integer/null)、finish_reason(STOP/LENGTH/CONTENT_FILTER/OTHER/null)，拒绝任意外部字符串/对象/扩展键。

正文保留原文，不trim/渲染HTML；数据库generated SHA256覆盖UTF8。Citation保留原URL、规范URL、hostname、首次position、全部occurrences和采集title/source。一个规范URL一行；不同引用不能占同一实际位置。引用集合在父快照citation_count和Run采集事实同事务deferred检查，提交后Run已COLLECTED，禁止新增引用。UPDATE/DELETE无条件拒绝。快照prompt必须等于冻结Run输入，collected_at与Run一致。

内部文件资格函数供后续submit调用，不创建快照/推进状态/commit。锁Run后按UUID排序文件，必须上传者匹配、VERIFIED、INTERNAL或RESTRICTED；截图OPERATION_SCREENSHOT且image/png/jpeg/webp，raw为EVIDENCE且text/plain（JSON以安全文本字节保存），大小/sha/type经实际HEAD确认。数据库最终防线保护资格并冻结引用文件的身份/内容元数据/状态，GC纳入两项新外键。没有秘密内容扫描器假装识别所有secret；后续适配器负责raw脱敏/截图裁剪，本次禁止secret进入summary且不提供任意provider数据通道。

Run→文件的锁序不反向锁Batch，GC只锁文件，不锁Run。提交事实要求有snapshot时Run不能退回PENDING/RUNNING，进入采集后状态必须有snapshot。旧0049若存在无证据采集事实，迁移原子拒绝，不编造历史。物理删除/保留政策留GEO-901，当前RESTRICT且不开放聚合删除。

迁移在预检前锁 Run 表 SHARE ROW EXCLUSIVE，并保持至提交；已开始的旧写事务先完成再被预检观察，安装守卫前不存在新旧写入间隙。只读复核提出合法单字符host/末尾:: IPv6与迁移写入间隙，修正及定向反例见实施记录。
