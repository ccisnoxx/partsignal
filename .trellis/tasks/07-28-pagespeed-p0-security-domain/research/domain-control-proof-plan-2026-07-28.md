# Research: Cloudflare 域名控制权证明计划

- Query: 定位当前 Cloudflare API 的安全调用机制，以只读 GET 复核
  `962850.xyz` Zone、记录数和权威 NS，并准备一次性随机 TXT 的创建、四端可见性
  验证、精确删除和四端 NXDOMAIN 验证命令；本次不得执行 POST/DELETE。
- Scope: mixed
- Date: 2026-07-28

## Findings

### 1. 本次边界与结果

- 本次只执行了 Cloudflare `GET /zones`、`GET /zones/{zone_id}/dns_records`
  和公共 DNS 查询；没有发送 POST、PATCH、PUT 或 DELETE。
- 只读 GET 于 `2026-07-28T05:49:30Z` 再次确认：
  - Zone 名称为 `962850.xyz`，状态 `active`，类型 `full`；
  - Zone ID 存在且符合 32 位小写十六进制格式；原值未输出或保存，脱敏导出只保留
    SHA-256 指纹；
  - API `result_info.total_count=14`，完整分页结果也是 14 条；
  - API 分配的权威 NS 为 `jule.ns.cloudflare.com` 和
    `neil.ns.cloudflare.com`。
- 两个权威 NS 均以 `aa` 标志返回相同 SOA serial `2409161408` 和相同 NS
  集合；`1.1.1.1`、`8.8.8.8` 返回的 NS 集合也一致。
- 完整脱敏派生导出见
  `research/cloudflare-zone-sanitized-2026-07-28.json`。14 条记录全部保留
  `name/type/ttl/proxied/priority（如有）/target.kind`，删除 record/account
  标识、comment、tag 和原始 target；所有 target 仅保存 `[REDACTED]` 与精确
  API content 字符串的 SHA-256。

### 2. 当前凭据来源和安全调用机制

仓库和本机当前环境中没有发现 Cloudflare 凭据变量。现有机制位于 Hostdzire：

| 项目 | 已确认内容 |
|---|---|
| 凭据来源类型 | Hostdzire root-only `acme.sh` account configuration |
| 凭据文件 | `hostdzire:/root/.acme.sh/account.conf`，`0600 root:root` |
| 证书任务配置 | `hostdzire:/root/.acme.sh/962850.xyz_ecc/962850.xyz.conf`，`0600 root:root` |
| DNS provider 实现 | `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh`，`0755 root:root` |
| 实际已配置变量名 | `SAVED_CF_Token`、`SAVED_CF_Account_ID` |
| 本次 GET 鉴权 | 在 Hostdzire 进程内读取上述配置，以 Bearer token 调用 API；值不进入命令参数、环境输出或仓库 |

只列机制、不列值的代码模式：

- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh:24-38`：
  优先读取 `CF_Token`、`CF_Account_ID`、可选 `CF_Zone_ID`，token 模式保存为
  account/domain config。
- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh:170-203`：
  如有显式 `CF_Zone_ID` 则校验该 Zone，否则按 Zone name，并在存在
  `CF_Account_ID` 时增加 account filter。
- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh:231-235`：
  token 模式使用 `Authorization: Bearer ...`。
- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh:78-91`：
  TXT 创建前按 `type/name` 查询，POST body 使用明确的 TXT
  `name/content/ttl`。
- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh:131-149`：
  删除前按 `type/name/content` 定位，并调用 record ID 形式的 DELETE。

当前 `acme.sh` 机制可复用，但正式控制权证明不直接调用其 `dns_cf_add/rm`
封装：证明需要同时记录 POST 返回 ID、四个 DNS 端点的可见性和删除后
NXDOMAIN。下面的一次性脚本只复用同一凭据来源，在 Python 进程内持有 token，
不会把 token 放到 `curl` 参数或日志中。

### 3. 正式 TXT 证明的最小不变量

1. 名称使用
   `_partsignal-control-<UTC YYYYMMDDHHMMSS>-<96-bit random>.962850.xyz`。
   单个 label 不超过 63 字节，96 位随机量使碰撞可忽略。
2. 内容使用 `partsignal-control-v1=<256-bit random>`；只含随机证明数据，
   不含账户、token、主机、邮箱、内部地址或其他业务信息。
3. POST 前只对 API 和两个权威 NS 做不存在检查。不要预查公共 resolver，
   否则会先缓存 NXDOMAIN，拖延创建后的公共可见性证明。
4. POST body 固定为
   `type=TXT`、随机 FQDN、随机 content、`ttl=60`、`proxied=false`。
5. POST 返回的 `result.id` 必须是 32 位小写十六进制；仅在进程内保留，用它
   精确 DELETE。日志只保存 record ID 的 SHA-256，不保存 ID。
6. 创建后必须同时满足：
   - 两个 API 当前返回的权威 NS：`NOERROR`、`aa`、唯一 TXT 内容精确相等；
   - `1.1.1.1`、`8.8.8.8`：`NOERROR`、唯一 TXT 内容精确相等。
7. 无论可见性轮询成功、超时还是被中断，脚本均进入 `finally` 删除路径；
   HTTP 结果不确定时按随机 FQDN 重新 GET，仅当唯一 TXT 的 content hash
   匹配本次随机值时恢复其 record ID。
8. DELETE 后先确认 API 对随机 FQDN 返回零记录，再等待四个 DNS 端点均返回
   `NXDOMAIN`。公共 resolver 可能保留最多 60 秒的正缓存，脚本给 10 分钟上限。
9. 审计 JSONL 只输出随机 FQDN、content/record ID 哈希、公开 NS、状态和时间；
   不输出 token、账户 ID、Zone ID、record ID 或 TXT content。

### 4. 待主 Agent 执行的精确命令

以下命令尚未执行。应从仓库根目录运行；当前用户授权覆盖这一次随机 TXT 的
新增、两权威 NS + `1.1.1.1` + `8.8.8.8` 验证、删除和删除后 NXDOMAIN
验证。命令依赖已在 Hostdzire 确认存在的 `/usr/bin/python3` 3.11 和
`/usr/bin/dig` 9.18。

```bash
set -o pipefail
PROOF_LOG=".trellis/tasks/07-28-pagespeed-p0-security-domain/research/domain-control-proof-evidence-$(date -u +%Y%m%dT%H%M%SZ).jsonl"

ssh hostdzire 'python3 -' <<'PY' | tee "$PROOF_LOG"
import datetime
import hashlib
import json
import re
import secrets
import shlex
import signal
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

ZONE_NAME = "962850.xyz"
ACCOUNT_CONF = "/root/.acme.sh/account.conf"
API_BASE = "https://api.cloudflare.com/client/v4"
PUBLIC_RESOLVERS = ("1.1.1.1", "8.8.8.8")
DNS_TIMEOUT_SECONDS = 600
DNS_POLL_SECONDS = 5


def utc_now():
    """返回秒级 UTC 审计时间。"""
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def audit(event, **fields):
    """只输出脱敏 JSONL，不输出任何凭据或原始 DNS 标识。"""
    print(
        json.dumps(
            {"at": utc_now(), "event": event, **fields},
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )


def abort_on_signal(signum, _frame):
    """把终止信号转换为异常，使 finally 仍有机会精确删除记录。"""
    raise InterruptedError(f"received signal {signum}")


for signal_name in ("SIGINT", "SIGTERM", "SIGHUP"):
    signal.signal(getattr(signal, signal_name), abort_on_signal)


def read_credentials():
    """只从 root-only acme.sh 配置读取所需变量，值仅保留在本进程内存中。"""
    config = {}
    with open(ACCOUNT_CONF, encoding="utf-8") as handle:
        for raw_line in handle:
            match = re.fullmatch(
                r"(SAVED_CF_(?:Token|Account_ID))=(.*)\n?",
                raw_line,
            )
            if not match:
                continue
            parsed = shlex.split(match.group(2))
            if len(parsed) == 1:
                config[match.group(1)] = parsed[0]

    token = config.get("SAVED_CF_Token")
    account_id = config.get("SAVED_CF_Account_ID")
    if not token or not account_id:
        raise RuntimeError("required acme.sh Cloudflare variables are missing")
    return token, account_id


def cf_request(token, method, path, query=None, body=None):
    """调用 Cloudflare API；失败仅报告 HTTP 状态和错误码。"""
    url = API_BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)

    data = None
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "partsignal-domain-control-proof/1",
    }
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            error_payload = json.loads(error.read())
            codes = [
                item.get("code")
                for item in error_payload.get("errors", [])
            ]
        except (ValueError, AttributeError):
            codes = []
        raise RuntimeError(
            f"Cloudflare {method} {path} HTTP {error.code}; codes={codes}"
        ) from None

    if not payload.get("success"):
        codes = [
            item.get("code")
            for item in payload.get("errors", [])
        ]
        raise RuntimeError(
            f"Cloudflare {method} {path} failed; codes={codes}"
        )
    return payload


def get_zone(token, account_id):
    """按 zone name + account filter 精确取得唯一 Zone。"""
    payload = cf_request(
        token,
        "GET",
        "/zones",
        {
            "name": ZONE_NAME,
            "account.id": account_id,
            "per_page": 50,
        },
    )
    zones = [
        zone
        for zone in payload.get("result", [])
        if zone.get("name") == ZONE_NAME
    ]
    if len(zones) != 1:
        raise RuntimeError(f"expected one exact zone, got {len(zones)}")
    zone = zones[0]
    if not re.fullmatch(r"[0-9a-f]{32}", str(zone.get("id", ""))):
        raise RuntimeError("zone id format is invalid")
    return zone


def list_records_by_name(token, zone_id, fqdn):
    """查询名称后再次在本地做精确匹配，拒绝模糊结果。"""
    payload = cf_request(
        token,
        "GET",
        f"/zones/{zone_id}/dns_records",
        {
            "name": fqdn,
            "match": "all",
            "page": 1,
            "per_page": 100,
        },
    )
    return [
        record
        for record in payload.get("result", [])
        if record.get("name") == fqdn
    ]


def dig_txt(server, fqdn, authoritative):
    """返回 DNS status、flags 和拼接后的 TXT answers；不打印 answer。"""
    command = [
        "dig",
        f"@{server}",
        fqdn,
        "TXT",
        "+time=2",
        "+tries=1",
        "+noall",
        "+comments",
        "+answer",
    ]
    if authoritative:
        command.append("+norecurse")

    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if result.returncode != 0:
        return {
            "status": "COMMAND_ERROR",
            "flags": set(),
            "answers": [],
        }

    status_match = re.search(r"status: ([A-Z]+),", result.stdout)
    flags_match = re.search(r";; flags: ([^;]*);", result.stdout)
    status = status_match.group(1) if status_match else "PARSE_ERROR"
    flags = (
        set(flags_match.group(1).split())
        if flags_match
        else set()
    )

    answers = []
    for line in result.stdout.splitlines():
        if not line or line.startswith(";"):
            continue
        fields = line.split(None, 4)
        if len(fields) != 5 or fields[3].upper() != "TXT":
            continue
        try:
            answers.append("".join(shlex.split(fields[4])))
        except ValueError:
            return {
                "status": "PARSE_ERROR",
                "flags": flags,
                "answers": [],
            }
    return {"status": status, "flags": flags, "answers": answers}


def dns_matches(result, mode, content, authoritative):
    """验证可见时的精确内容，或删除后的真实 NXDOMAIN。"""
    if authoritative and "aa" not in result["flags"]:
        return False
    if mode == "visible":
        return (
            result["status"] == "NOERROR"
            and result["answers"] == [content]
        )
    if mode == "nxdomain":
        return (
            result["status"] == "NXDOMAIN"
            and result["answers"] == []
        )
    raise ValueError(f"unknown DNS mode: {mode}")


def wait_for_dns(name_servers, fqdn, content, mode):
    """轮询两个当前权威 NS 和两个固定公共 resolver。"""
    endpoints = [
        (f"authoritative:{server}", server, True)
        for server in name_servers
    ]
    endpoints.extend(
        (f"recursive:{server}", server, False)
        for server in PUBLIC_RESOLVERS
    )
    pending = {label: (server, authoritative) for label, server, authoritative in endpoints}
    last = {}
    deadline = time.monotonic() + DNS_TIMEOUT_SECONDS

    while pending and time.monotonic() < deadline:
        for label, (server, authoritative) in list(pending.items()):
            result = dig_txt(server, fqdn, authoritative)
            last[label] = {
                "status": result["status"],
                "answer_count": len(result["answers"]),
                "authoritative_answer": "aa" in result["flags"],
            }
            if not dns_matches(result, mode, content, authoritative):
                continue
            audit(
                f"dns_{mode}",
                fqdn=fqdn,
                endpoint=label,
                status=result["status"],
            )
            pending.pop(label)
        if pending:
            time.sleep(DNS_POLL_SECONDS)

    if pending:
        raise RuntimeError(
            f"DNS {mode} timeout; pending={sorted(pending)}; last={last}"
        )


def recover_record_id(token, zone_id, fqdn, content):
    """响应不确定时，只恢复唯一且内容哈希匹配的本次 TXT ID。"""
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    matches = [
        record
        for record in list_records_by_name(token, zone_id, fqdn)
        if record.get("type") == "TXT"
        and hashlib.sha256(
            str(record.get("content", "")).encode("utf-8")
        ).hexdigest()
        == content_hash
    ]
    if not matches:
        return None
    if len(matches) != 1:
        raise RuntimeError(
            f"recovery expected at most one owned TXT, got {len(matches)}"
        )
    record_id = str(matches[0].get("id", ""))
    if not re.fullmatch(r"[0-9a-f]{32}", record_id):
        raise RuntimeError("recovered record id format is invalid")
    return record_id


def delete_record(token, zone_id, record_id, fqdn, content):
    """按 POST 返回/严格恢复的 record ID 删除；网络不确定时最多重试五次。"""
    last_error = None
    for attempt in range(1, 6):
        try:
            payload = cf_request(
                token,
                "DELETE",
                f"/zones/{zone_id}/dns_records/{record_id}",
            )
            if payload.get("result", {}).get("id") != record_id:
                raise RuntimeError("DELETE response id does not match")
            audit(
                "record_deleted",
                fqdn=fqdn,
                record_id_sha256=hashlib.sha256(
                    record_id.encode("ascii")
                ).hexdigest(),
                attempt=attempt,
            )
            return
        except Exception as error:
            last_error = error
            recovered = recover_record_id(
                token,
                zone_id,
                fqdn,
                content,
            )
            if recovered is None:
                audit(
                    "record_delete_confirmed_by_get",
                    fqdn=fqdn,
                    attempt=attempt,
                )
                return
            if recovered != record_id:
                raise RuntimeError("recovered record id changed") from None
            time.sleep(min(2**attempt, 10))
    raise RuntimeError(f"record cleanup failed: {last_error}")


def wait_for_api_absence(token, zone_id, fqdn):
    """确认随机名称已从 Cloudflare API 消失。"""
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if not list_records_by_name(token, zone_id, fqdn):
            audit("api_absent", fqdn=fqdn)
            return
        time.sleep(2)
    raise RuntimeError("record is still present in Cloudflare API")


def run():
    """执行一次创建、四端验证、精确删除和四端 NXDOMAIN 证明。"""
    token, account_id = read_credentials()
    zone = get_zone(token, account_id)
    zone_id = zone["id"]
    name_servers = sorted(
        str(server).lower()
        for server in zone.get("name_servers", [])
    )
    if len(name_servers) != 2:
        raise RuntimeError(
            f"expected exactly two authoritative name servers, got {len(name_servers)}"
        )

    record_page = cf_request(
        token,
        "GET",
        f"/zones/{zone_id}/dns_records",
        {"page": 1, "per_page": 1},
    )
    record_count = record_page.get("result_info", {}).get("total_count")
    audit(
        "zone_confirmed",
        zone=ZONE_NAME,
        status=zone.get("status"),
        zone_type=zone.get("type"),
        zone_id_sha256=hashlib.sha256(
            zone_id.encode("ascii")
        ).hexdigest(),
        record_count=record_count,
        authoritative_name_servers=name_servers,
    )

    timestamp = datetime.datetime.now(
        datetime.timezone.utc
    ).strftime("%Y%m%d%H%M%S")
    fqdn = (
        f"_partsignal-control-{timestamp}-{secrets.token_hex(12)}."
        f"{ZONE_NAME}"
    )
    content = f"partsignal-control-v1={secrets.token_hex(32)}"
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

    if list_records_by_name(token, zone_id, fqdn):
        raise RuntimeError("random proof name already exists in Cloudflare API")
    for server in name_servers:
        result = dig_txt(server, fqdn, authoritative=True)
        if not dns_matches(
            result,
            "nxdomain",
            content,
            authoritative=True,
        ):
            raise RuntimeError(
                f"preflight NXDOMAIN failed on authoritative:{server}"
            )

    audit(
        "challenge_preflight_ok",
        fqdn=fqdn,
        content_sha256=content_hash,
        authoritative_name_servers=name_servers,
    )

    record_id = None
    proof_error = None
    cleanup_error = None
    verification_error = None

    try:
        payload = cf_request(
            token,
            "POST",
            f"/zones/{zone_id}/dns_records",
            body={
                "type": "TXT",
                "name": fqdn,
                "content": content,
                "ttl": 60,
                "proxied": False,
            },
        )
        created = payload.get("result", {})
        candidate_id = str(created.get("id", ""))
        if re.fullmatch(r"[0-9a-f]{32}", candidate_id):
            record_id = candidate_id
        if (
            record_id is None
            or created.get("name") != fqdn
            or created.get("type") != "TXT"
            or created.get("content") != content
        ):
            raise RuntimeError("POST response does not match the challenge")

        audit(
            "record_created",
            fqdn=fqdn,
            content_sha256=content_hash,
            record_id_sha256=hashlib.sha256(
                record_id.encode("ascii")
            ).hexdigest(),
            ttl=created.get("ttl"),
            proxied=created.get("proxied"),
        )
        wait_for_dns(
            name_servers,
            fqdn,
            content,
            mode="visible",
        )
    except Exception as error:
        proof_error = error
        if record_id is None:
            try:
                record_id = recover_record_id(
                    token,
                    zone_id,
                    fqdn,
                    content,
                )
            except Exception as recovery_error:
                cleanup_error = recovery_error
    finally:
        if record_id is not None:
            try:
                delete_record(
                    token,
                    zone_id,
                    record_id,
                    fqdn,
                    content,
                )
            except Exception as error:
                cleanup_error = error

    if record_id is not None and cleanup_error is None:
        try:
            wait_for_api_absence(token, zone_id, fqdn)
            wait_for_dns(
                name_servers,
                fqdn,
                content,
                mode="nxdomain",
            )
        except Exception as error:
            verification_error = error

    if proof_error or cleanup_error or verification_error:
        audit(
            "proof_failed",
            fqdn=fqdn,
            content_sha256=content_hash,
            proof_error=(
                str(proof_error)
                if proof_error
                else None
            ),
            cleanup_error=(
                str(cleanup_error)
                if cleanup_error
                else None
            ),
            verification_error=(
                str(verification_error)
                if verification_error
                else None
            ),
        )
        raise RuntimeError(
            "control proof did not complete; inspect preceding sanitized events"
        )

    audit(
        "proof_complete",
        fqdn=fqdn,
        content_sha256=content_hash,
        endpoints=[
            *(f"authoritative:{server}" for server in name_servers),
            *(f"recursive:{server}" for server in PUBLIC_RESOLVERS),
        ],
    )


try:
    run()
except Exception as error:
    audit(
        "fatal",
        error_type=type(error).__name__,
        error=str(error),
    )
    raise SystemExit(1)
PY

test -s "$PROOF_LOG"
```

成功证据应包含且仅包含以下关键事件顺序：

1. `zone_confirmed`
2. `challenge_preflight_ok`
3. `record_created`
4. 四条 `dns_visible`
5. `record_deleted`
6. `api_absent`
7. 四条 `dns_nxdomain`
8. `proof_complete`

只有 `proof_complete` 且四个端点各自同时出现 `dns_visible` 和
`dns_nxdomain` 才能关闭写控制证明。`record_created` 不能单独视为成功。
如出现 `cleanup_error` 或 `verification_error`，立即把该项作为 P0 未关闭：
不得继续根域 DNS、全域 HSTS 或 preload 工作。

### 5. 只读复核命令

以下命令已执行，可供主 Agent 重跑。它们不读取或输出凭据：

```bash
for ns in jule.ns.cloudflare.com neil.ns.cloudflare.com; do
  dig "@$ns" 962850.xyz SOA \
    +norecurse +time=3 +tries=1 +noall +comments +answer
  dig "@$ns" 962850.xyz NS \
    +norecurse +time=3 +tries=1 +noall +answer
done

for resolver in 1.1.1.1 8.8.8.8; do
  dig "@$resolver" 962850.xyz NS \
    +time=3 +tries=1 +noall +comments +answer
done
```

## Files Found

- `.trellis/tasks/07-28-pagespeed-p0-security-domain/prd.md`：R3 要求完整
  Zone、随机临时 TXT、双权威/双公共验证和删除后不存在。
- `.trellis/tasks/07-28-pagespeed-p0-security-domain/design.md:42-74`：
  定义域名台账来源、三层控制权证明和仓库脱敏边界。
- `.trellis/tasks/07-28-pagespeed-p0-security-domain/implement.md:50-59`：
  外部门禁仍待脱敏 Zone 派生清单和一次性 TXT 写证明。
- `.trellis/tasks/07-28-pagespeed-p0-security-domain/research/domain-inventory-2026-07-28.md:3-31`：
  记录此前只读 GET、凭据边界和待授权 TXT 证明。
- `.trellis/tasks/07-28-pagespeed-p0-security-domain/research/domain-inventory-2026-07-28.md:33-46`：
  记录原有 14 条 Zone 组成和不存在通配记录。
- `.trellis/tasks/07-28-pagespeed-p0-security-domain/research/cloudflare-zone-sanitized-2026-07-28.json`：
  本次完整 GET 的 14 条脱敏派生记录。
- `hostdzire:/root/.acme.sh/account.conf`：实际 token/account 变量的
  root-only `acme.sh` 来源；只检查变量名和权限。
- `hostdzire:/root/.acme.sh/dnsapi/dns_cf.sh`：当前 Cloudflare token
  鉴权、Zone 定位、TXT POST/DELETE 实现。

## External References

- Cloudflare List Zones：
  <https://developers.cloudflare.com/api/resources/zones/methods/list/>
  （API token 为首选鉴权；`Zone Read`；返回 Zone ID、status/type 和
  `name_servers`）。
- Cloudflare List DNS Records：
  <https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/>
  （`GET /zones/{zone_id}/dns_records`；返回 `result_info.total_count`；
  `ttl=1` 表示 Auto）。
- Cloudflare Create DNS Record：
  <https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/>
  （`POST /zones/{zone_id}/dns_records`；需要 `DNS Write`；TXT 支持明确
  name/content/ttl）。
- Cloudflare Delete DNS Record：
  <https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/delete/>
  （`DELETE /zones/{zone_id}/dns_records/{dns_record_id}`，返回删除的 ID）。
- Cloudflare TTL：
  <https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/>
  （DNS-only 非 Enterprise 最小显式 TTL 为 60 秒；Auto 为 300 秒）。

## Related Specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`：本证明跨越
  `acme.sh credential source → Cloudflare API → authoritative DNS →
  recursive resolver → sanitized evidence`；脚本在每个边界验证精确输入、
  返回形状和失败状态。
- `.trellis/spec/` 中没有专门拥有 Cloudflare/domain-infrastructure
  操作契约的包级规范；本任务的 `prd.md`、`design.md`、`implement.md`
  和既有 domain inventory 是本次更具体的权威约束。

## Caveats / Not Found

- 本计划后来已实际完成 TXT POST、双权威/双公共验证、按唯一 record ID DELETE、
  API absence 与四端 NXDOMAIN；结果见
  `domain-control-proof-evidence-20260728T055825Z.jsonl` 的
  `proof_complete`。
- 当前 token 的精确权限范围未通过 token verification endpoint 输出或存档；
  本次成功的随机 TXT 写后删证明只证明目标 Zone 的必要读写能力，不扩大为账户级
  权限结论。
- Zone 脱敏 JSON 是 API 记录的安全派生清单。Cloudflare 官方 BIND export 为
  `2432` 字节，解析为 8 A、3 MX、3 TXT 和 2 个 provider NS；其中 14 条用户
  记录与 API total count 一致。用户授权后，当前原文已保存到 Hostdzire root
  专用 `0700` 运维目录的 `0600` 文件；仓库只记录 SHA-256 和受控路径，不保存
  原文。Cloudflare 每次导出的 `;; Exported:` 时间注释会变化，因此当前落盘
  SHA-256 以脱敏 Zone JSON 为准。
- Aaitr 和当前开发工作站只读盘点已完成；其他 WireGuard/mesh 客户端和
  split-horizon resolver 仍是 `includeSubDomains` 前的独立门禁。TXT 证明不替代
  该清单。
- 信号处理和 `finally` 能覆盖正常异常、SIGINT/SIGTERM/SIGHUP，但无法覆盖
  Hostdzire 断电、内核崩溃或 `SIGKILL`。因此随机名称和 content hash 必须保留
  在审计日志中；若没有最终 `api_absent` + 四端 `dns_nxdomain`，应先按该随机
  FQDN 做 credentialed GET，确认唯一匹配后以其 record ID 删除，不能重跑并
  遗留旧记录。
