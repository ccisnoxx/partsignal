# 发布管理最终批准视觉资产

> 以下截图由当前实现连接隔离的真实 API、PostgreSQL 与对象存储生成，未使用请求 mock；截图完成后临时数据库与存储均已删除。

| 页面 | 对应候选 | 最终截图 | SHA-256 | 尺寸 | 主题 | 批准者 | 北京时间 | 批准原话 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 发布管理待处理 | `../candidates/desktop-light.png` | `publications-1440x1000-light.png` | `3e34faabbfb10538b9b4c3939f959f1cccbd8a8d43f3e94d401fab2a40a5f88e` | 1440×1000 | light | 用户 | 2026-08-03 23:23:30 | 采用这版，但是我想知道是否是以.trellis/spec/frontend/visual-system.md和.trellis/spec/frontend/index.md为规范 |
| 发布管理待处理（移动端） | `../candidates/mobile-light.png` | `publications-375x900-light.png` | `8df56bac9c68838c5fe8310156cc9cdcb39920dc9950b95a3518a5b78cf03ea1` | 375×900 | light | 用户 | 2026-08-03 23:23:30 | 采用这版，但是我想知道是否是以.trellis/spec/frontend/visual-system.md和.trellis/spec/frontend/index.md为规范 |
| 发布工作详情 | `../candidates/desktop-dark-drawer.png` | `publication-work-drawer-1440x1000-dark.png` | `7c61f5f5ebad76259570db45d1549bb7a9a6fd846a38b70c392d1f387d7bd40c` | 1440×1000 | dark | 用户 | 2026-08-03 23:23:30 | 采用这版，但是我想知道是否是以.trellis/spec/frontend/visual-system.md和.trellis/spec/frontend/index.md为规范 |

## 批准边界

- 批准范围是信息层级、首屏密度、响应式卡片与详情抽屉构图；动态业务标识、时间、文本、数量和服务端动作不是固定产品常量。
- 三张最终截图均来自真实接口数据；候选图仅用于前期构图比较，不作为正式验收资产或自动化视觉基线。
- 本次批准不自动修改现有截图测试基线；后续只有在明确需要稳定像素回归时才建立基线。
