# Hostdzire 开发环境 V2 全量重建执行证据

## 结论

- target：SSH alias `hostdzire` / hostname `scrapy`
- user authorization：`APPROVED_DESTRUCTIVE_DEVELOPMENT_REBUILD`
- release：`mvp-20260830-133651-a663bcce`
- source commit：`a663bcce9fd49da9c5aea7f257372fc318447234`
- completed at：`2026-08-30T13:41:50+08:00`
- result：`PASSED`
- secret exposure：`NONE`

用户批准的开发环境永久重置、clean main clone、Staging full deploy、真实运行态验收和 `current` 更新均已完成。其他 Compose project、Nginx、Production artifact、共享环境文件和 Docker 基础镜像未修改。

## 已永久删除

### 旧容器

```text
scheduler e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8
worker    dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d
api       0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94
frontend  7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75
fake-oss  57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34
postgres  680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc
redis     4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba
```

完成后逐 ID 复核均不存在。

### 旧业务数据

以下三个 leaf 被删除后按固定 metadata 重建为空目录，再由新运行态写入：

```text
/root/partsignal-data/postgres | owner=70:0  | mode=0700 | device=2049
/root/partsignal-data/redis    | owner=999:0 | mode=0755 | device=2049
/root/partsignal-data/objects  | owner=0:0   | mode=0755 | device=2049
```

最终运行态 size 分别为 `50,287,737`、`18,814`、`12,288` bytes。旧数据未备份、未 quarantine，不能恢复。

### 旧运行应用镜像

```text
backend  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f
frontend sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111
```

两者已 untag/delete，最终复核为 `DELETED`。PostgreSQL、Redis base 和 A1 candidate image 保持存在。

## 新 release 与运行身份

- fresh Host clone：`/root/partsignal/releases/mvp-20260830-133651-a663bcce`
- `HEAD == origin/main == a663bcce9fd49da9c5aea7f257372fc318447234`
- working tree clean
- `.env.staging -> /root/partsignal/shared/.env.staging`
- backend tag：`partsignal-backend:mvp-20260830-133651-a663bcce`
- backend runtime image ID：`sha256:799dd42a837ff2cf274676f6a94b706fd4f137db817e62789d365efecb29b7e0`
- frontend tag：`partsignal-frontend:mvp-20260830-133651-a663bcce`
- frontend runtime image ID：`sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e`

七个新容器均属于 `partsignal-staging`，API/PostgreSQL/Redis/Worker/Scheduler 为 healthy，所有目标 restart=`0`、OOM=`false`；Frontend/fake-oss 运行正常。最终 `target_container_count=7`。

## 数据库与账号

- Alembic 从空库依次执行 `0001` 至 `0043_geo_platform_identity`。
- actual revision：`0043_geo_platform_identity`
- initialized accounts：`admin|content_editor`
- 未读取或输出任何密码。

## 对象存储验收

通过新 API 容器与 fake-oss 的内部签名协议对唯一对象执行：

```text
PUT 204
HEAD metadata/size/SHA-256 matched
GET 200 and bytes matched
DELETE 204
post-delete HEAD 404
```

结果：`fake_oss_put_head_get_delete=passed`；测试对象和 metadata 已删除。

## 网络与公网验收

```text
listener 19000 present
listener 19001 present
listener 19080 present
https://geo.962850.xyz/api/health/live  200
https://geo.962850.xyz/api/health/ready 200
https://geo.962850.xyz/                 200
https://geo.962850.xyz/products         200
frontend title                          passed
```

Nginx target 仍为 `/etc/nginx/sites-available/partsignal-staging.conf`，SHA-256 仍为 `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`，`nginx -t` successful；没有 write/reload。

## 范围外资源核验

`cliproxyapi`、`md2word-p0`、`sub2api-plus`、`vaultwarden` 的原 container full ID 均保持 running。未执行 Docker prune、network 删除、历史 image/release/archive 清理、Production A2/manifest/quarantine/rollback 或 DNS/TLS/Nginx 修改。

## current

全部验收通过后，`/root/partsignal/current` 已通过不可覆盖临时 symlink 原子更新为：

```text
/root/partsignal/releases/mvp-20260830-133651-a663bcce
```
