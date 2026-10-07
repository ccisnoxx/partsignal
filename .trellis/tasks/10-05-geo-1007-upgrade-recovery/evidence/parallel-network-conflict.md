# 本地检查调度冲突

主代理将生产脚本 Engine network compatibility 与隔离恢复Compose同时启动，两者均使用固定 partsignal-staging network。production-policy-final.log 在 Engine 自检清理阶段因网络被本次隔离Compose使用而 exit1；属于本次调度环境冲突，不能当通过或产品失败。Compose 使用独立PG目录继续演练并精确清理后，生产自检改为串行运行，最终结果另存 production-policy-serial.log。后续两个固定网络检查必须串行。
