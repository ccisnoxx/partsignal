"""使用本地 CA 和真实 TLS socket 验证固定地址 HTTPS 出站边界。"""

from __future__ import annotations

import socket
import ssl
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from app.services.pinned_http import PinnedHTTPTransport, ResolvedAddress


class PeerOverrideSocket:
    """仅供本机测试路由使用；TLS 仍由真实 socket 和本地 CA 完成。"""

    def __init__(self, connection: socket.socket, peer_ip: str) -> None:
        self._connection = connection
        self._peer_ip = peer_ip

    def getpeername(self) -> tuple[str, int]:
        return self._peer_ip, 443

    def __getattr__(self, name: str) -> object:
        return getattr(self._connection, name)


def write_local_ca(tmp_path: Path, hostname: str) -> tuple[Path, Path, Path]:
    """生成只信任指定测试主机名的短期 CA 和服务端证书。"""
    now = datetime.now(UTC)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PartSignal Test CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    server_cert = (
        x509.CertificateBuilder()
        .subject_name(server_name)
        .issuer_name(ca_name)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    ca_path = tmp_path / "ca.pem"
    cert_path = tmp_path / "server.pem"
    key_path = tmp_path / "server-key.pem"
    ca_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    cert_path.write_bytes(server_cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        server_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return ca_path, cert_path, key_path


def test_real_https_preserves_sni_host_and_certificate_identity(tmp_path: Path) -> None:
    """地址固定后仍以原主机名完成 SNI、证书校验和 Host 发送。"""
    hostname = "provider.test"
    public_ip = "93.184.216.34"
    ca_path, cert_path, key_path = write_local_ca(tmp_path, hostname)
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(cert_path, key_path)
    sni_names: list[str | None] = []
    server_context.set_servername_callback(
        lambda _socket, server_name, _context: sni_names.append(server_name)
    )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    local_port = listener.getsockname()[1]
    received: list[bytes] = []
    server_errors: list[BaseException] = []

    def serve() -> None:
        try:
            raw, _address = listener.accept()
            with server_context.wrap_socket(raw, server_side=True) as tls:
                request = b""
                while b"\r\n\r\n" not in request:
                    request += tls.recv(4096)
                received.append(request)
                tls.sendall(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    b"Content-Length: 11\r\nConnection: close\r\n\r\n"
                    b'{"data":[]}'
                )
        except BaseException as error:  # 测试线程必须把失败传回主线程。
            server_errors.append(error)
        finally:
            listener.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    def resolve(_host: str, port: int, **_kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (public_ip, port))]

    def connect(_address: ResolvedAddress, timeout: float) -> socket.socket:
        connection = socket.create_connection(("127.0.0.1", local_port), timeout=timeout)
        return cast(socket.socket, PeerOverrideSocket(connection, public_ip))

    client_context = ssl.create_default_context(cafile=str(ca_path))
    transport = PinnedHTTPTransport(
        allow_local_http=False,
        resolver=resolve,
        connector=connect,
        tls_wrapper=lambda connection, server_name: client_context.wrap_socket(
            connection, server_hostname=server_name
        ),
    )
    response = transport.request(
        method="GET",
        base_url=f"https://{hostname}/v1",
        suffix="models",
        headers={"Authorization": "Bearer test-secret"},
        timeout_seconds=10,
        body=None,
    )
    thread.join(timeout=5)

    assert response.body == b'{"data":[]}'
    assert not server_errors
    assert sni_names == [hostname]
    assert b"Host: provider.test\r\n" in received[0]
