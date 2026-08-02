# 内容审核视觉基线同步设计

## 1. 设计结论

不修改内容审核页面，也不修改视觉测试规则。现行页面正确消费服务端 `content.available_actions`；根因是旧自动快照仍绑定已被合同收敛替代的修订编辑态。最小修复是保留一份用户批准的当前只读预览原图，再用既有真实隔离 E2E 只生成并替换一张内容审核自动基线。

## 2. 根因与权威位置

```text
7df976d 保存内容审核修订编辑态基线
  → 2e59943 将 CREATE_REVISION 改为服务端 available_actions 权威投影
  → 当前 E2E 内容不提供 CREATE_REVISION
  → ContentEditorPage 正确默认显示只读预览态
  → content-review-light-1440x1000.png 仍停留在编辑态
  → 目标视觉用例以 4% 稳定像素差失败
```

| 责任 | 权威位置 | 本任务处理 |
| --- | --- | --- |
| 是否允许创建修订 | 服务端 `content.available_actions`、前端生成类型 | 只读核对，不修改 |
| 页面投影 | `frontend/src/features/content-editor/ContentEditorPage.tsx` | 只读核对，不修改 |
| 截图遮罩和阈值 | `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` | 原样复用，不修改 |
| 人工批准证据 | 当前任务 `assets/approved/` | 新增原图与 manifest |
| 自动回归资产 | `.../content-review-light-1440x1000.png` | 唯一自动基线变更 |

## 3. 人工批准与自动基线

### 3.1 人工批准原图

- 使用当前开发环境真实 API、`1440×1000` CSS 视口和浅色主题采集，不重绘、不压缩、不伪造动作或业务数据。
- 用户批准后保存为 `assets/approved/content-review-1440x1000-light.png`，manifest 登记原型 `07-25-frontend-visual-system-recalibration/assets/prototypes/12-content-review.png` 和全部批准元数据。
- 批准对象是：统一壳层、内容队列/正文/质量审核三栏关系、只读预览默认页签、摘要与标签层级、Markdown 预览面板及审核决策区域。
- 身份、标题、时间、状态、正文、标签、计数、按钮可用性和队列行数是动态业务状态，不成为固定产品事实。

### 3.2 自动视觉基线

- 继续由 `cross-page-visual-convergence.spec.ts` 在隔离 E2E 栈中生成。
- 继续使用 `visualMasks(page, 'content-review')` 遮罩身份和动态内容；三栏几何、标签页、卡片边界、行高、共享壳层和只读/编辑稳定结构不得新增遮罩。
- 继续使用 `maxDiffPixelRatio: 0.02`，不修改测试名称、顺序、项目或截图路径模板。
- 只将本次目标用例生成的唯一 content-review actual PNG 替换到现有基线路径，不使用 `--update-snapshots` 批量接受。

## 4. 执行顺序与任务切换

1. 用户批准候选图和本版最终规划。
2. 运行 `task.py start 08-02-content-review-visual-baseline-sync`，加载 `trellis-before-dev` 前端上下文。
3. 重跑目标视觉用例，确认 Dashboard 已通过且 content-review 是唯一失败。
4. 核对 actual PNG 后只替换 content-review 基线，再重跑目标视觉用例至通过。
5. 执行 `trellis-check`、资产/范围验证，展示精确提交清单并等待用户确认。
6. 独立提交本任务文件；按用户后续指示完成 archive 与会话日志收尾。
7. 重新运行 `task.py start 08-02-dashboard-visual-baseline-sync`，由 Dashboard 任务执行目标视觉用例、完整 `make e2e` 和剩余收尾。

## 5. E2E 环境边界

- 现有 Compose frontend 占用宿主机 `5173`；运行隔离 E2E 前只临时停止该服务，结束后无论成功失败均恢复。
- `.env` 中容器内 PostgreSQL/Redis 主机名在宿主机脚本中转换为项目既有映射端口，不输出密码、令牌或完整连接串。
- 每次运行必须核对隔离数据库和临时对象存储的精确删除输出；清理或 frontend 恢复失败时不得提交。

## 6. 失败处理与回滚

- 若 actual PNG 不是 `1440×1000`、候选不唯一或稳定构图偏离获批只读预览态，停止并重新请求视觉批准。
- 若目标用例还出现第三个独立失败，停止，不扩大本任务范围。
- 若内容审核断言通过但其他断言失败，只记录归因；不修改其他基线、测试或产品代码。
- 回滚只涉及当前任务批准资产和一张 content-review 自动基线；Dashboard 工作差异必须保持不变。
