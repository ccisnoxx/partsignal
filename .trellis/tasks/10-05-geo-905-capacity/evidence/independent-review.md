# GEO-905独立只读复核

critical_reviewer报告最终候选无未修复的确认问题；未运行测试/数据库/Git或编辑。确认两项P2并复核主代理修复：threads观测原先可能使用默认数据库，已绑定fixture并断言真实计数20/0（3项定向通过）；Make复用seed必须同时固定两种candidate phase，现已修正。

复核RR全过滤/total/latest/current/ASC-DESC/ties/空页、答案唯一不放大页，权限/敏感投影/错误映射不变。Worker默认1、范围1..10、PG准入/预算/lease/SENT所有权不变、外部I/O在事务外。46项读取回归已读取证据，prefork实测11进程PSS约796MiB，staging512MiB不得直接设10，production1GiB余量仍未验证。已检查安装Celery Linux prefork父退出子进程SIGKILL，不需新增生产生命周期设施。

复核结束时最终100k/完整integration尚未完成；没有将复核替代性能验收。20冻结输入/短回答/单引用、365天100k存量/30天8400候选、目标环境阈值和资源上限均为明确缺口。
