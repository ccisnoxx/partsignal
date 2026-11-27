# W01 设计边界

- `/api/v1/workbench` 是页面唯一业务读取；count、links、attention、workflow health 与 GEO rate 直接渲染服务端投影。
- action/attention href 原样保留，客户端只做穷尽展示映射和日期/百分比格式化。
- initial loading、fatal/retry 与成功的 empty/zero/null 各自保持不同可观察状态。
- 响应式与浏览器缩放只允许页面自然换行/重排，不隐藏主操作、制造根级横向溢出或改变键盘顺序。
