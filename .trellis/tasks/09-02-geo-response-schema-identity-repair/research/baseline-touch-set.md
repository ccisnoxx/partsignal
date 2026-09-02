# GEO Schema Identity Prerequisite Baseline

- branch：`main`
- HEAD：`415ebbdea5b25fdfd5af934b3c981f2183c619b6`
- 创建本 prerequisite 前 status：547 项；创建后 548 项。
- 最初 545 项项目外 dirty baseline hash：`c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`。

过滤 parent task metadata、本 prerequisite 和 Wave 3 task directory 后，现有 out-of-scope porcelain hash 仍等于上述值。原始 545 项构成为 `.gitignore`、543 个删除项和 `backend/app/schemas/configuration.py`；全部保持不动。

本 Task 创建前以下两个候选文件无 diff：

- `backend/app/schemas/geo_files.py`
- `backend/tests/unit/test_runtime_response_metadata.py`

Wave 3 task directory 是已存在的独立 planning work，不进入本 prerequisite commit。并行 `.trellis/tasks/08-30-v2-live-readonly-acceptance` 不修改、不结束、不归档。

实施前后，过滤本 Task 的 exact files、parent approved planning files 与 Wave 3 planning directory后，out-of-scope hash 必须保持不变。若 hash 改变，定位外部并行变化并报告；不得自动恢复、删除、格式化或吸收。
