# Frontend V2 Phase 9 Staging current finalization 设计

## 1. 设计结论

复用上一任务的 protected snapshot 格式、原生 SSH/Docker/PostgreSQL/Nginx/curl 与 Runbook 的原子 symlink 替换。不开新浏览器 session，不新增脚本、远端审计目录、部署机制或状态源。

```text
冻结身份与历史证据
→ pre-current 运行态/HTTP 只读门禁
→ pre snapshot 与 after-browser 精确比较
→ 单次原子更新 current
→ post snapshot 仅允许 current 一行变化
→ post HTTP smoke
→ 继承 Browser Gate 并判定 MET/NOT_MET
```

## 2. 权威身份

| 角色 | 精确值 |
| --- | --- |
| candidate | `2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9` |
| release | `mvp-20260825-172239-2a6fd940b848` |
| pre-current | `releases/mvp-20260806-195740-afb1b8c82f40` |
| post-current | `releases/mvp-20260825-172239-2a6fd940b848` |
| backend/fake-oss image ID | `sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f` |
| candidate-aligned V1 image ID | `sha256:dfadfd534b11d80bdf993566c4b46cf9c6f87ef1283e303902d5b2130eca4fa4` |
| V2 image ID | `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` |
| prior protected SHA-256 | `b1cc9bce632d88bfecf03828d751a255280226f12a6eaef7e882b13c6e26b5a5` |

Tag、标题或健康状态都不能替代 image ID。

## 3. Protected snapshot

沿用上一任务的行格式，记录：

1. `postgres redis fake-oss api worker scheduler frontend` 的 container ID、config image、image ID、state、restart count；
2. `postgres redis api worker scheduler` 的 health；
3. Compose project 的 migrate container 排序集合；
4. `alembic_version`；
5. `current`；
6. Nginx target、site/security checksum。

快照通过 SSH 标准输出流回本地 Task evidence，不读取 environment、凭据或业务正文。pre-current 必须与上一任务远端 `candidate-protected.txt` 和 `after-browser.txt` 一致，并且 SHA-256 精确等于冻结值。

post-current 与 pre-current 的比较先删除各自唯一 `current|` 行后做字节级比较，再单独断言两行分别是预期旧值和新值。这样只表达一个允许变化，不维护第二份宽松 diff 规则。

## 4. 原子更新边界

只有全部只读门禁通过后，在 Hostdzire 单个 `set -eu` shell 中：

1. 断言目标 release 目录存在；
2. 断言固定临时 symlink 路径既不是普通文件也不是 symlink；
3. 创建指向 `releases/mvp-20260825-172239-2a6fd940b848` 的相对 symlink；
4. `mv -Tf` 在 `/root/partsignal` 同文件系统原子替换 `current`；
5. 立即断言 `readlink` 精确等于目标。

不删除、覆盖或改名任何 release。`current` 不触发流量、Compose、Nginx 或数据库变化。

## 5. HTTP 最小合同

pre/post 使用同一只读检查：

- public live/ready=200，ready 的 PostgreSQL/Redis=`ok`；
- `/login` 与代表 deep link 返回同一 V2 index，标题=`PartSignal Frontend V2`；
- HTML 引用的主 JS/CSS 均 200、hashed immutable、`Vary: Accept-Encoding`；HTML/client route=`no-cache`；
- missing asset=404、主 JS `.map`=404、JS 无 `sourceMappingURL`；
- HTML/JS/CSS 的 CSP、Trusted Types、HSTS、COOP、frame、nosniff、Referrer-Policy 与 cache 合同不变。

不扩大为完整 Browser Gate，也不使用登录凭据。

## 6. Browser Gate 继承条件

上一任务的完整 Browser Gate 绑定同一 fixed release/V2 image ID，并在结束时与冻结 protected snapshot 一致。若本 Task 证明 pre-current 仍等于该 snapshot、HTTP 合同未漂移，且 `current` 更新后除记录行外无任何变化，则该浏览器证据仍有效；`current` 不是流量开关，因此重跑不会增加与本次变更相关的证据。

任一 runtime/HTTP 差异都会使继承条件失效并直接判 `NOT_MET`，不尝试用浏览器重跑掩盖漂移。

## 7. 失败边界

- pre-current 任一门禁失败：不执行原子更新。
- `ln` 或 `mv` 失败：停止并如实记录；不进行补救性部署、重启、fallback 或 release 操作。
- post-current 任一非预期差异：停止新操作并判 `NOT_MET`；不把 symlink 改回旧值来掩盖证据。
- 文档只有在最终 `MET` 时更新；历史 `NOT_MET` 保持原文。
