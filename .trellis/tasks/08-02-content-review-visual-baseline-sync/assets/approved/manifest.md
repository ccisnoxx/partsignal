# 内容审核最终批准视觉资产

> 本目录保存用户明确批准的真实页面原图；自动视觉快照单独维护，不得替代本记录。

| 页面 | 对应原型 | 最终截图 | SHA-256 | 尺寸 | 主题 | 批准者 | 北京时间 | 批准原话 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 内容审核 | `.trellis/tasks/archive/2026-07/07-25-frontend-visual-system-recalibration/assets/prototypes/12-content-review.png` | `content-review-1440x1000-light.png` | `733c10a0f1fca70810ddd81d9432436abaf031a72dbc852a4313dcab89b3a9b6` | `1440×1000` | `light` | 用户 | `2026-08-02 11:17:34 CST` | `批准上图作为内容审核视觉锚点，并批准这版最终规划，以便下一步运行 task.py start 08-02-content-review-visual-baseline-sync` |

## 批准边界

- 原图由规划阶段的独立 `playwright-cli` 会话从当前开发环境和真实 API 数据采集，未重绘、压缩或伪造业务数据。
- 批准覆盖统一壳层、内容队列/正文/质量审核三栏关系、只读预览默认页签、摘要与标签层级、Markdown 预览面板及审核决策区域。
- 身份、标题、时间、状态、正文、标签、计数、按钮可用性和队列行数只记录采集时状态，不成为固定产品事实。
- 本批准只解除 `content-review-light-1440x1000.png` 的基线更新门，不批准其他页面、主题、视口、动作合同或测试规则变更。
