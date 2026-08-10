# 实施：Frontend V2 Content AI Production

1. Core 合并后重新审计 generation/retry/humanization 现有合同和 tests。
2. 实现按需 options/detail、create/retry/humanization mutations 与 job polling。
3. 扩展 Editor production surface、component tests 和 typed fixture。
4. 用独立 AI task 完成 fake provider/worker real-stack；retry failure 使用另一个独立任务或明确 setup。
5. 运行 generation targeted tests、V2 lint/typecheck/build、AI fixture 和 real-stack。

本任务保持 `planning`，不在 Core 分支实施。
