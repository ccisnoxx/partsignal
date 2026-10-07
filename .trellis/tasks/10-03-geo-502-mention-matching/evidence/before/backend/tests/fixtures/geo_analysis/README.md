# GEO 共享语料与分析金标

状态：GEO-005 / R0 测试基础设施；本目录不表示回答级 GEO 业务已经实现。

## 目录与权威

| 文件 | 用途 |
|---|---|
| `v1/corpus.json` | 唯一产品、监测身份、公开事实、问题、原回答与原始引用语料 |
| `v1/gold/analysis.json` | 独立的人工预期：提及、推荐/位置、引用分类、声明与复核原因 |
| `v1/schema.json` | Draft 2020-12 测试文件合同，所有对象禁止额外字段 |
| `../../geo_fixtures.py` | Python 加载、Schema、关系与敏感数据校验的唯一所有者 |

JSON 是 UTF-8 文本，事实正文只用 Markdown。`fixture_version`、`gold_version` 为独立的语料/预期版本，当前均为 `1.0.0`；`dataset_id` 固定为 `geo-005-v1`，`synthetic=true` 必填。ID 为带类型前缀的稳定测试身份，不能当成数据库 UUID 或生产记录。采集时间固定为 UTC；不根据运行时日期改写。新增小场景递增对应次版本，修改已有语义或字段须建立新 major 目录，保留旧版本供已知消费者使用；同步更新 Schema 常量与消费者，不提供猜测性兼容回退。

Schema 只定义测试输入和人工预期，局部 `label`、`category` 与 `review_required_reasons` 不是公共 API 枚举。公共接口仍由 [OpenAPI](../../../../contracts/openapi.yaml) 定义。未来消费者须在对应任务中把语料显式转换为 generated DTO/领域输入，不能把 JSON 直接冒充未实现的 Run、AnalysisRevision、Review 或旧 GeoObservation。

## 字段与关联

- `products`：虚构品牌和型号；`subjects`：身份、别名与域名字典。OWN_PRODUCT 绑定语料 Product，其余身份不复制产品事实。
- `fact_versions`：同产品、非空 `APPROVED`/`PUBLIC` Markdown。金标的事实引用按产品校验；没有可判断事实保留 `UNJUDGEABLE`，不能猜测结果。
- `questions`：实际文本、显式意图、点名属性、语言/地区和监测身份范围。点名属性不从文本猜测。
- `answers`：问题引用、完整原文、固定采集元数据；未知 web search 保留 `null`。模式/环境元数据仅用于后续筛选输入，不实现采集、状态或指标资格。
- `citations`：回答引用、原 URL、标题和从 1 开始的连续原始顺序；允许同 URL 多次出现，保留原始证据。
- `gold.cases`：每个回答一份预期；证据摘录必须来自对应原文。歧义别名保留候选身份列表和 `mentioned=null`；不任选一个对象。
- `expected.recommendations`：`RECOMMENDED`、`CONSIDERED`、`NOT_RECOMMENDED`、`UNKNOWN`。仅可靠有序推荐有 `rank`；无序推荐保留 `null` 和复核原因；出现名字不等于推荐。
- `expected.citations`：引用 ID、人工标准化 URL、派生来源类别/对象。与原始引用分开；规范化、去重及域名归属算法属于后续任务。
- `expected.claims`：对象、声明类型、原文、同产品事实、verdict、severity 和判断说明；复核原因另存。人工预期不会由加载器重算。

当前 13 个场景覆盖质量策略 §6 的精确型号、型号后缀、大小写/连字符、同名品牌、否定提及、仅列举、有序/无序推荐、条件替代、参数数字冲突、事实不足、注入文本及中英混合。重复 URL 和 unknown/null 可供后续指标任务使用。本轮不冻结尚需产品裁决的指标分母、尝试选择或公式，不提供运行状态、复核生命周期或伪成功响应。

## 敏感数据规则

1. 所有公司、客户、产品、型号、参数、回答、引用标题和金标均手工虚构；禁止粘贴生产数据、真实平台响应、客户资料、产品机密或用真实名称冒充测试创作。变更时人工审查语料来源与内容。
2. 只允许 `https://[子域名.]geo-fixture-<用途>.test/...`，禁止其他主机、HTTP、userinfo、端口、query、fragment 和反斜杠。域名是不可作为生产输入的测试标记；加载器从不 DNS 查询或请求这些地址。未来本地模拟服务须显式映射自己的 loopback 测试入口，不能把这些字符串直接送入真实 transport。
3. 禁止凭据、Cookie、Authorization、敏感 Header、密码、私钥、会话数据、浏览器存储和签名 URL。Schema 禁止额外配置字段；校验器遍历全部文字与 Markdown，拒绝敏感标记和非测试 URL。拒绝测试在内存中合成无效标记，不在语料文件保存凭据。
4. PUBLIC 是虚构事实的测试分级，不能授权真实数据外发。本目录的加载和 CI 校验完全离线，不启动 fake provider、真实 AI、浏览器或数据库。
5. 错误只显示固定规则/位置，不显示 JSON 值、摘录、Schema error message 或响应正文。扫描是有限的自动防线，不能识别所有真实公司名、秘密或混淆编码；人工审查仍是必需证据，不能据扫描通过声称通用 DLP。
6. 注入文本只是无可信权限的原文输入，不调用工具、不执行脚本、不改变预期。后续分析安全验收须用真实分析边界证明，加载通过不等于分析器通过。

## 加载与验证

从仓库根目录运行：

```bash
make test-geo-fixtures
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_fixtures.py
npm --prefix frontend run test -- src/test/geo-fixtures.test.ts
```

后端 pytest（现有 tests import 路径）可 `from geo_fixtures import load_geo_fixtures`，返回 `{corpus, gold}`。每次重新读取 JSON 并校验，不缓存可变对象；需要反例时修改本次返回对象并调用 `validate_geo_fixtures`。未知版本、缺文件和非法 JSON 明确失败。

前端/Vitest 与后续 Playwright 的 Node 测试环境可从 `frontend/src/test/geo-fixtures.ts` 导入 `loadGeoFixtures`，运行时读取同一 JSON 并重新解析为新对象；返回 `unknown`，消费者须显式转换，不建立 API DTO 或第二套校验/分析规则。这样前端构建不静态依赖 Docker 上下文之外的文件。格式与隐私以 Python gate 为权威，`make test-unit` 会执行该校验；前端加载测试只证明 JSON 在其测试工具链可消费、顺序/null 保留与测试隔离。浏览器及运行时模块不得导入测试辅助入口。

新增或修改金标须说明依据，审查前后预期，禁止为使分析器通过而机械更新快照。GEO-402 将建设 fake provider，GEO-501 将定义分析合同；后续分析/指标/E2E 各任务补充自己保护的行为，本任务不提前实现它们。
