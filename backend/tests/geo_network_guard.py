"""仅对 GEO-402 合同测试启用的出站守卫；CI 越过回环立即失败。"""

import ipaddress
import socket

import pytest


@pytest.fixture(autouse=True)
def local_geo_network(monkeypatch):
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_resolve = socket.getaddrinfo

    def require_local(host):
        try:
            allowed = host == "localhost" or ipaddress.ip_address(host).is_loopback
        except ValueError:
            allowed = False
        if not allowed:
            raise AssertionError("GEO 合同测试禁止外部网络")

    def connect(connection, address):
        require_local(address[0])
        return original_connect(connection, address)

    def connect_ex(connection, address):
        require_local(address[0])
        return original_connect_ex(connection, address)

    def resolve(host, *args, **kwargs):
        require_local(host)
        return original_resolve(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", resolve)
