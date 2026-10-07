# GEO-903 设计

运维编排拥有一致性集合与新建/清理隔离环境；扫描只读PG并调用既有领域投影。pg_dump custom格式与同RR导出snapshot读取库存，复用冻结约束与migration版本。对象通过现有signed GET读取真实字节，核对数据库size/SHA256，missing/损坏/鉴权不可用分别报告；不下载引用URL，不改证据/公式。

备份所有文件及清单使用独立backup key的AES-256-GCM流式认证加密，AAD绑定固定逻辑文件名；备份key不进入集合。秘密包与manifest本身加密，输出不包含secret/路径/DSN/原文。恢复先完整验证认证/摘要，再新建唯一带owner数据库，仅接受loopback admin连接，绝不接受现成VERIFY_DATABASE_URL。失败也按marker精确删除临时库和目录。

Browser部署检查需要显式环境证据，与真实PG会话行数、Settings配置和材料根目录扫描结合；部署或材料存在时拒绝core-only集合的N/A，要求802专用卷/私钥保护和恢复撤销演练。当前本机无材料，生产904/906另核实。

不启动Worker/Beat/API；不恢复Redis消息或beat文件，调度窗口/发送账本由PG权威守护。外部可取消I/O有timeout；失败输出固定码，保持原错误非零。


最终恢复通过认证dump导出SQL，在新建owner空库内将唯一空search_path精确改为pg_catalog,public，并由psql单事务/ON_ERROR_STOP执行；不改历史函数、迁移、约束或trigger。当前SQL-string内联失败有真实PG诊断；版本或导出格式变化需重验，匹配异常明确停止。

结构库存核对约束/索引属性、归属和列名（历史DROP COLUMN的attnum留孔不能跨恢复比较）；函数/trigger定义和启用属性逐字核对。CHECK文本经dump/reparse的等价括号/cast不做通用语义比较；原认证DDL导入不变，实际隔离测试验证答案不可变23514及旧窗口并发去重。

来源3秘密与当前配置恒时配对；恢复用加密proof核对后应用包内秘密，实际验证Session token hash及对象签名。创建确认丢失仍按owner清理；SIGTERM/SIGINT进入固定取消异常、kill/wait PG子进程后finally回收。SIGKILL/断电无法自动回收，按精确name/marker核查，未确认owner不得擅删。
