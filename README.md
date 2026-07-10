# PartSignal

PartSignal（元件信号）是面向电子元器件国产替代业务的多平台 GEO 内容运营系统。

系统以经过审核的产品事实为唯一来源，使用 AI 生成适配官网、行业网站、论坛和问答平台的差异化内容，并通过人工审核、人工发布登记和 GEO 观测形成运营闭环。

## 当前范围

- 产品、参考型号、替代关系和证据管理。
- 不可变事实版本和审核流程。
- 多平台差异化内容生成与版本管理。
- 人工发布登记和发布页面验证。
- AI 搜索提及、推荐、引用和准确性观测。
- 第一阶段不实现跨平台自动发布。

## 技术基线

- 前端：React、TypeScript、Vite。
- 后端：Python、FastAPI、Pydantic、SQLAlchemy、Alembic。
- 数据：PostgreSQL、Celery、Redis。
- 文件：阿里云 OSS。
- 部署：Docker Compose、Nginx、双 VPS WireGuard 入口。

## 项目文档

- [项目会话归档](./docs/GEO项目会话归档.md)
- [产品与业务方案](./docs/GEO多平台内容运营系统方案设计.md)
- [前后端技术与部署方案](./docs/GEO系统前后端技术与部署方案.md)

## 状态

项目处于 MVP 设计与工程初始化阶段。
