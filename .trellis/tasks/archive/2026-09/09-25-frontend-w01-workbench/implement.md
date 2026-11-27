# W01 实施顺序

1. 复核 Workbench model/API/page、strict fixture、PostgreSQL integration 与 P/C/U/G real-stack 检查点。
2. 运行直接测试、PostgreSQL integration 与 production fixture mobile/desktop，检查唯一 aggregate、href、错误、键盘和四档响应式。
3. 用真实浏览器缩放机制验证 200% 下内容/操作可见、焦点可达且根无横向溢出；仅在发现实证缺口时修改实现或测试。
4. 独立复核、检查 diff/工作树、记录证据并关闭 W01，进入 I01。
