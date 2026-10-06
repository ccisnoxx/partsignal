# 第四轮独立复核

历史缓存策略、原子绑定、missing/unknown/错配拒绝、同候选重入不补造、恢复新策略/回执重放均无确认阻断；受审12文件快照一致。发现正常registry未缓存镜像P1：begin-upgrade策略inspect在pull前，使正常交付失败。

主代理添加真实shell+状态所有者、镜像pull前inspect必失败的反例：registry-order-red.log预期红；抽取shared owner入场判定，verify-upgrade-entry完整consumer/只读判定→config/pull/image verification→begin原子策略/候选→run/up。registry-order-final.log两用例PASS，包括坏manifest不pull、不变状态。当前修复交第五轮fresh复核。

最新隔离PG全流程及串行发布自检待记录；历史误并行网络冲突不能算通过。现场/历史样本/进行中Engine SIGTERM覆盖缺口不变。
