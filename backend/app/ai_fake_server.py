"""仅供本地端到端测试使用的显式 OpenAI-compatible 假服务。"""

from __future__ import annotations

import time

from fastapi import FastAPI, Header, HTTPException, Response

app = FastAPI(title="PartSignal fake AI provider")
completion_calls: dict[str, int] = {}
completion_payloads: dict[str, dict[str, object]] = {}


def validate_request_headers(
    authorization: str | None,
    x_e2e_region: str | None,
    x_e2e_secret: str | None,
) -> None:
    """确保三类调用都实际携带渠道配置的认证与自定义 Header。"""
    if not authorization or not x_e2e_region or not x_e2e_secret:
        raise HTTPException(status_code=400, detail="E2E 渠道 Header 缺失")


@app.get("/v1/models")
def list_models(
    authorization: str | None = Header(default=None),
    x_e2e_region: str | None = Header(default=None),
    x_e2e_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """返回固定虚构模型，便于验证真实模型发现协议。"""
    if not authorization:
        return {"data": []}
    validate_request_headers(authorization, x_e2e_region, x_e2e_secret)
    return {"data": [{"id": "e2e-model"}]}


@app.post("/v1/chat/completions")
def create_completion(
    payload: dict[str, object],
    response: Response,
    authorization: str | None = Header(default=None),
    x_e2e_region: str | None = Header(default=None),
    x_e2e_secret: str | None = Header(default=None),
) -> dict[str, object]:
    """返回可通过业务质量门禁的严格四字段虚构内容。"""
    validate_request_headers(authorization, x_e2e_region, x_e2e_secret)
    model_id = str(payload.get("model", ""))
    completion_calls[model_id] = completion_calls.get(model_id, 0) + 1
    completion_payloads[model_id] = payload
    if model_id.startswith("e2e-timeout-model-"):
        if completion_calls[model_id] == 2:
            time.sleep(11)
        if completion_calls[model_id] >= 3 and (
            authorization != "Bearer e2e-second-key-updated"
            or x_e2e_secret != "timeout-secret-updated"
        ):
            raise HTTPException(status_code=400, detail="E2E 当前凭据未生效")
    response.headers["x-request-id"] = "e2e-provider-request"
    return {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"title":"连接测试","summary":"测试",'
                        '"body_markdown":"不得将虚构验收数据用于真实选型。",'
                        '"tags":["test"]}'
                    )
                }
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
    }


@app.get("/e2e/calls/{model_id}")
def get_completion_calls(model_id: str) -> dict[str, int]:
    """仅向端到端测试暴露虚构模型调用次数。"""
    return {"count": completion_calls.get(model_id, 0)}


@app.get("/e2e/payloads/{model_id}")
def get_completion_payload(model_id: str) -> dict[str, object]:
    """仅向端到端测试暴露最近一次虚构请求体。"""
    payload = completion_payloads.get(model_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="E2E 模型尚未调用")
    return payload
