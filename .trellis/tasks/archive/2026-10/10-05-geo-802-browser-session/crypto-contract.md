# GEO-802 加密子模块合同

后端 `app.services.geo_browser_session_vault.BrowserSessionVault(root: str, public_key_file: str)`：
- write(reference: UUID, profile_id: UUID, expires_at: datetime, plaintext: str) -> str：新随机reference文件不可覆盖，返回完整密文字节SHA256。公钥仅RSA >=3072 bits，RSA-OAEP SHA256+MGF1 SHA256包裹随机32-byte AES key；AES256GCM随机12-byte nonce，ciphertext含tag。API不得能解密。
- read(reference: UUID, expected_sha256: str) -> str：读取完整密文封装JSON字符串，校验大小、哈希，nofollow、普通文件、受限权限。缺对象AppError GEO_BROWSER_SESSION_MISSING/409；损坏AppError GEO_BROWSER_SESSION_UNREADABLE/409；根/公钥/IO配置AppError DEPENDENCY_UNAVAILABLE/503。固定中文摘要，不携带secret/path/异常正文。
- delete(reference: UUID) -> None：缺失幂等，其他IO失败DEPENDENCY_UNAVAILABLE/503。文件仅由UUID派生，不允许用户路径。目录必须存在、不跟随symlink、不允许other权限；文件0600，fsync原子持久化。无需普通对象存储。
- envelope仅闭合version=1, algorithm='RSA-OAEP-SHA256+A256GCM', reference,profile_id,expires_at,aad,wrapped_key,nonce,ciphertext。expires_at使用UTC datetime.isoformat(timespec='microseconds')；aad='partsignal:geo-browser-session:v1:{reference}:{profile_id}:{expires_at}'；Base64标准编码。

`app.services.geo_browser_storage_state.validate_storage_state(value: str, website_url: str, expires_at: datetime, now: datetime) -> str`：Playwright storage state JSON cookies/origins闭合，128KiB上限，secret值不入repr/error。根据surface唯一HTTPS hostname限定Cookie domain（前导点可接受，只能精确host，不允许任意父域）与origins同HTTPS origin；cookie同Playwright真实字段，origin localStorage name/value。拒绝重复JSON键/NaN/不合法类型、过期cookies；期限为未来最多30日且不晚于任一持久cookie期限；sessioncookie expires=-1可用显式期限。返回紧凑canonical JSON；拒绝一律GEO_BROWSER_SESSION_INVALID/422固定摘要，不暴露字段值。至少一cookie或localStorage记录。

Node `browser-collector/src/session.mjs`：export decryptSessionEnvelope(envelope: string, privateKeyPem: string, expected: {reference:string,profileId:string,expiresAt:string}) -> storageState object；严格校验封装/算法/base64/绑定/期限，privateDecrypt OAEP SHA256，AES-GCM AAD/tag，拒绝错key/跨profile/篡改/过期，错误固定code摘要，禁止异常正文日志。可以增加withAuthorizedSession：每次先调用注入的authorize获取当前授权密文，再解密并传给consumer，finally清空可清除buffers；不绕过授权直接读取卷。私钥只Collector拥有，文件读取用nofollow/受限权限。不得创建网络consumer、真实adapter/模拟站、截图、trace、queue或业务状态。普通runtime保持network none和NOT_IMPLEMENTED。
