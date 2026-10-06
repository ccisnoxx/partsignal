"""校验并清理单次 E2E 运行独占的 Redis 与本机端口。"""

from __future__ import annotations

import argparse
import socket

from redis import Redis


FIXED_PORTS = (8000, 9001, 4174)
EXACT_REDIS_KEYS = {b"celery", b"unacked", b"unacked_index", b"unacked_mutex"}
KOMBU_BINDING_PREFIX = b"_kombu.binding."
CLIENT_NAME = "partsignal-e2e-environment"


def redis_client(redis_url: str) -> tuple[Redis, int]:
    """建立带名称的 helper 连接，并返回 URL 中的 logical DB。"""
    client = Redis.from_url(redis_url, client_name=CLIENT_NAME)
    database = int(client.connection_pool.connection_kwargs.get("db", 0))
    if database == 0:
        client.close()
        raise ValueError("E2E Redis 必须使用非 0 logical DB")
    return client, database


def assert_exclusive(client: Redis, database: int) -> None:
    """拒绝目标 logical DB 中 helper 之外的外部客户端。"""
    external = [
        item
        for item in client.client_list()
        if int(item.get("db", -1)) == database and item.get("name") != CLIENT_NAME
    ]
    if external:
        raise RuntimeError(f"E2E Redis DB {database} 存在外部客户端")


def assert_ports_released(storage_port: int) -> None:
    """通过逐一绑定证明本套件固定端口均未被监听。"""
    ports = (*FIXED_PORTS, storage_port)
    if len(set(ports)) != len(ports):
        raise ValueError("E2E 对象存储端口不得与固定服务端口重复")
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as error:
                raise RuntimeError(f"E2E 端口 {port} 已被占用") from error


def preflight(redis_url: str, storage_port: int) -> None:
    """在创建任何测试资源前确认 Redis 与端口均可独占。"""
    client, database = redis_client(redis_url)
    try:
        assert_exclusive(client, database)
        if client.dbsize() != 0:
            raise RuntimeError(f"E2E Redis DB {database} 启动前必须为空")
        assert_ports_released(storage_port)
    finally:
        client.close()


def cleanup(redis_url: str, storage_port: int) -> None:
    """仅删除可证明归属本套件的 Redis 键，并复核端口释放。"""
    client, database = redis_client(redis_url)
    try:
        assert_exclusive(client, database)
        keys = list(client.scan_iter())
        unknown = [
            key
            for key in keys
            if key not in EXACT_REDIS_KEYS and not key.startswith(KOMBU_BINDING_PREFIX)
        ]
        if unknown:
            raise RuntimeError(f"E2E Redis DB {database} 存在未知键，拒绝清理")
        if keys:
            client.delete(*keys)
        if client.dbsize() != 0:
            raise RuntimeError(f"E2E Redis DB {database} 清理后不为空")
    finally:
        client.close()
    assert_ports_released(storage_port)
    print(f"E2E_CLEANUP redis_db={database} keys={len(keys)} status=deleted")
    print(
        "E2E_CLEANUP "
        f"ports={','.join(str(port) for port in (*FIXED_PORTS, storage_port))} "
        "status=released"
    )


def main() -> None:
    """执行 environment preflight 或 cleanup。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("preflight", "cleanup"))
    parser.add_argument("--redis-url", required=True)
    parser.add_argument("--storage-port", type=int, required=True)
    args = parser.parse_args()
    if args.action == "preflight":
        preflight(args.redis_url, args.storage_port)
        return
    cleanup(args.redis_url, args.storage_port)


if __name__ == "__main__":
    main()
