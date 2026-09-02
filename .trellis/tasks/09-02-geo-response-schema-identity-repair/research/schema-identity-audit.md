# GEO Response Schema Identity Audit

## Evidence Summary

- 静态 `components.schemas`：存在 `LegacyGeoObservation`、`ManualGeoObservation`、`GeoObservation`；generated client 使用同名 union。
- runtime `components.schemas`：存在 `LegacyGeoObservationOut`、`ManualGeoObservationOut`，不存在上述两个 canonical leaf names，也不单独注册 `GeoObservation`。
- 当前 production comparator 对 Wave 3 报 42 schema drift，其中 39 为自动 422，3 为本 Task 的 success discriminator mapping URI。
- `$ref` success closure 中共有 5 个 operation 依赖两个 runtime leaf components；完整清单见 `design.md`。
- `backend/app/services/geo_observation.py` 对旧 `*Out` 名称共有 6 个生产使用点，涉及 import、`model_validate()` 与 `isinstance()`；因此 compatibility aliases 是必须保留的 Python contract。

## Read-only Solution Probe

在独立 Python 进程中读取真实 `geo_files.py`，仅在内存中模拟：

1. 两个 class definition 使用 canonical names；
2. 在 union 前建立 `*Out = canonical class` direct aliases；
3. `GeoObservationOut` union 使用 canonical classes；
4. 以替换后的真实 module 装配真实 FastAPI app。

观测结果：

- runtime 生成 `LegacyGeoObservation` / `ManualGeoObservation` component keys；
- 不再生成 `LegacyGeoObservationOut` / `ManualGeoObservationOut` keys；
- 两个旧 alias 分别与 canonical class 为同一个 object；
- 5 个受影响 operation 的 success-only static/runtime projection 经 production `compare_response_contracts()` 返回 `[]`；
- 未模拟任何 router status metadata，因此三个直接 operation 仍有 14 条 Wave 3 non-success difference，证明 probe 没有提前掩盖后续工作。

该 probe 未写入文件、未修改 app runtime、合同、generated 或生产数据。

## Rejected Alternatives

- 修改 frozen OpenAPI/generated 追随 `*Out`：改变已冻结公共 identity，并把 runtime 偶然命名提升为第二 authority。
- route-local duplicate models：重复字段/validator，形成第二 schema source。
- Pydantic custom hook 或硬编码 `$ref`：重新引入 composition task 已移除的 private/custom schema maintenance。
- comparator 忽略 discriminator mapping：削弱 machine-contract coverage。
- 只修当前 3 个 failure：遗漏另两个通过 nested refs 依赖同一 identity 的 success operation。
