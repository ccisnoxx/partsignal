"""同步采集 adapter 合同；此模块没有生产 adapter、工厂或网络请求。"""

from typing import Protocol, runtime_checkable

from app.collectors.contracts import CollectedAnswer, CollectionEstimate, CollectionRequest
from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorRegistration,
    ProfileBlocker,
)


class SendAuthorization(Protocol):
    def __call__(self) -> None:
        """由 Worker 在短事务内重验当前资格/lease/token 并原子持久化 SENT。

        失败必须阻止发送；返回后不能再执行无关等待。即使后续未发出字节，数据库 SENT
        仍按保守恢复处理，Collector 的 NOT_STARTED 不能单独撤销持久化发送标记。
        """
        ...


@runtime_checkable
class GeoCollector(Protocol):
    @property
    def registration(self) -> CollectorRegistration:
        """key/version/模式/六能力均由 GEO-204 的不可变元数据唯一拥有。

        收集前必须匹配 request 的 adapter_key/adapter_version；不得换 adapter 或版本。
        能力是可观测性声明，未知搜索/版本/usage/cost 仍须保留 None。
        """
        ...

    def validate_profile(self, profile: CollectionProfileSnapshot) -> tuple[ProfileBlocker, ...]:
        """纯配置校验复用 registration.validate_profile；无网络/事务/测试状态写入。

        当前执行资格由 Application Service 的 evaluate_profile 唯一裁决，校验通过不
        授予数据外发、预算、网络或 lease 权限。
        """
        ...

    def estimate(self, request: CollectionRequest) -> CollectionEstimate:
        """无外部 I/O；无法报价返回 cost=None，不以零费用伪装未知。"""
        ...

    def collect(
        self, request: CollectionRequest, *, before_send: SendAuthorization
    ) -> CollectedAnswer:
        """一次 attempt 至多发送一个业务请求，失败抛含显式 send state 的 CollectorError。

        完成 URL/DNS/peer/TLS 与当前授权检查后，在首个请求字节前恰好调用一次
        before_send；回调失败不能发送。发送后不自动 retry/redirect/切换地址，所有
        资源在成功或失败时释放。输入使用原 prompt，不附加品牌/事实/分析上下文。
        原始 bytes 只接受已清理凭据/账号信息的证据，HTML_TEXT 仅作文本。adapter
        必须限制传输大小；值对象构造校验失败应在 adapter 边界转为稳定异常。
        结果返回不表示落库成功，事务、文件提交与迟到结果裁决由 Application Service 拥有。
        """
        ...
