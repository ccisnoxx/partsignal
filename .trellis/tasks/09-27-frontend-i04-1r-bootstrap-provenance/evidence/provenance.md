# I04-1 Production env execution provenance

## Source identity

- platform：Codex local session JSONL
- session ID：`01a0e19e-6636-75c2-a8a8-2703a2afe050`
- segment timestamp：`2026-09-27T01-28-01`
- segment bytes：`2245181`
- segment SHA-256：`7365a78ee15d1b9f10b3df28ec0837b6d291e6f7041e202292a9146bf33a5362`

原始 session 文件保持只读且不纳入仓库；下列 evidence 按 `call_id` 从 `response_item.payload.input/output` 恢复。input 保留原 UTF-8 内容并补一个仓库文本文件终止 LF；output 对 JSON array 做 `ensure_ascii=false`、sorted-key、compact canonical JSON 后补终止 LF。除该显式文本规范化外，内容不是重新编写的示例。

## Recovered calls

| purpose | call ID | raw input SHA-256 | raw output canonical SHA-256 |
|---|---|---|---|
| creator | `call_zbndroBvKc7Nu030G3L71zAd` | `21b0fdbb5e74fff4a7f6c99795c95a768100c61ccd2a5d34f700ac10562749e4` | `629f31e5b949ca64b40f8cdef6f1c3cdf8f1ed63ab49de42499760e7161ceb73` |
| validator | `call_BCV2dZYFx9rrvmh2WleUA4AL` | `41c51e37706a0cd2dd9d0d3cde76c7f1b8f6618876b14d980c697f096e6309c8` | `0bac671483ddfe6b25e9658f391799615f2b4a08641f529d07ff4b9bf3a3b74b` |
| final secret scan | `call_bHa5AZbOEwy2SmwILop69RNH` | `32edcdf142724a861e91b201b8b05625cab3a55d94b57930d560d2a727f463e3` | `a0dbbd6f44b9bef447104043a158a8170f307115e725b699a4ff6f1dad17029e` |

规范化 evidence 文件 SHA-256：

- creator input/output：`ed72fb965202a8b691d5e869eed0d3f3663a2fc142af1aaa823f48df1a1112c0` / `fbb22c1c6fa0067c888c6d0da8632205392dd381270a5694b9d7e4b81d22a577`
- validator input/output：`4ea46576db1a4e78106459f3be096a303ddaf9c54c65bd5a49c480b11bc0359f` / `6ece4e1d97e393eb58cd427b2f682671aef73cde238ccaee51159dffe51cdcf2`
- final secret scan input/output：`626412ae39863f0907188c52412c3f54d99ccb11b5307c5f1ee580bf4e6fc486` / `f99d9b354f39b4290eab4a0625cd51a0bcd24b9e69c9d46317eb9394a450c153`

## Secret check

- 检查类别：本地 Git-ignored `.env` 中真实 `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。
- 六份 recovered evidence 的 exact-value matches：`0`。
- evidence 只包含解析逻辑、键名、固定 Production 枚举、调用结构和脱敏状态输出；不包含任何 env 值。

## Review use

creator input 可以直接核对 `secrets.token_urlsafe`、`secrets.token_bytes(32)`、同目录随机 temp、`O_EXCL|O_NOFOLLOW`、`0600`、file fsync、`renameat2(..., RENAME_NOREPLACE=1)`、directory fsync、目标竞态和清理路径。validator input 可以核对键集合、重复/控制字符/source/substitution、URL/CORS/secret independence、Settings CLI、Compose parse 及“不启动服务”边界。secret-scan input 可以核对本地/远端 tracked files、普通日志、shell history、`/proc/*/cmdline` 与 Docker inspect 扫描范围。
