# 本地Redis隔离依据

第一次canonical E2E在创建任何资源前明确拒绝DB14非空，保留manual-real-stack-redis14-rejected.log；不删除未知键。只读检查DB13/12/11/10/9均keys=0、外部client=0，选择固定DB13后再次运行；既有runner仍执行独占/端口preflight及owned cleanup。不是重试相同阻断，也不flush未知DB14。
