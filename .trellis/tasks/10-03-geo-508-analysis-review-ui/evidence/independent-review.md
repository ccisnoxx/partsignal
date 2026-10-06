# 独立只读复核及处置

## 首轮 critical_reviewer

对象：GEO-508 candidate，review_of r4-ui-state-a2。确认 P2：runs.api.ts 回执 correction_payload 仅非 undefined，CORRECTED null/17 被当作成功，随后清除 journal/草稿。建议闭合回执并保持未知语义。其余严重处理、current/history、完整替换、409/new analysis、unknown跨卸载、principal epoch及混合批次轮询未确认问题。只读分析未改文件，也未跑宽测试。

主代理依据服务端原样保存 validated 请求的合同，使用已安装 replaceEqualDeep 核对回执与完整 generated 请求 payload 相等，comment 也与请求相等；避免复制四栏协议。API和组件负例 27 项通过，原畸形回执缺口已解除。

## 第二个 fresh critical_reviewer

对象：局部回执修订和新增负例。验证 replaceEqualDeep 在安装5.101.4中拒绝 null/17/undefined/空、缺键、额外键、嵌套类型变化，键序变化保持相等；确认旧缺口解除。另发现 P2：z.string.max(2000) 计 UTF-16，而表单/Python 合同计 Unicode codepoint；1001个emoji为具体合法失败反例。纯内存Node/Python只读证明，不写文件，不跑宽测试。

主代理按明确修复建议改为 Array.from(value).length <= 2000，保留NUL限制和请求精确匹配，并增加2000emoji成功回执测试。该最后单行修正由主代理自查和定向测试验证，未声称再次独立复核最终行。回执提交、unknown/journal及安全合同的两次独立复核结果保留；完整门禁由主代理执行。
