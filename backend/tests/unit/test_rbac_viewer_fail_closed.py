"""三级 RBAC 自动化全路由自省测试：确保 VIEWER 对全部非自助写接口和未授权读接口 fail-closed。"""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from typing import Any

from fastapi.routing import APIRoute

from app.deps import assert_account_types
from app.errors import AppError
from app.main import app
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_runs import GeoRunStatus
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.geo_batch_policy import BatchRunState, batch_workflow
from app.services.geo_run_policy import RunCommandAvailability, RunState, run_workflow

# 允许已认证用户（含 VIEWER）自助调用的认证接口
_SELF_SERVICE_AUTH_OPS = frozenset(
    {
        "getCurrentUser",
        "getAuthSession",
        "getCsrfToken",
        "changePassword",
        "logout",
    }
)

# 显式授权给 VIEWER 的只读 GET operation_id 白名单
_VIEWER_READ_ALLOWLIST = frozenset(
    {
        # 身份自助
        "getCurrentUser",
        "getAuthSession",
        "getCsrfToken",
        # GEO 总览、回答洞察、报告与运行/证据只读下钻
        "getGeoOverview",
        "listGeoOverviewRuns",
        "getGeoAnswerInsights",
        "listGeoAnswerInsightRuns",
        "listGeoInsightCitations",
        "listGeoInsightClaims",
        "listGeoInsightQualityRuns",
        "getGeoReportPreview",
        "getGeoPrintReport",
        "exportGeoRunsCsv",
        "exportGeoCitationsCsv",
        "exportGeoClaimsCsv",
        "exportGeoOpportunitiesCsv",
        "listGeoObservationBatches",
        "getGeoObservationBatch",
        "listGeoObservationBatchRuns",
        "listGeoObservationRuns",
        "getGeoObservationRun",
        # 旧人工观测历史只读视图
        "getGeoInsights",
        "listGeoObservations",
        "listGeoObservationItems",
        "getGeoObservation",
        "getGeoObservationDetail",
        "listGeoObservationPublications",
        # 产品资料、平台、问题主题、已发布文章及证据文件只读查看
        "listProducts",
        "getProduct",
        "getProductDetail",
        "getProductFactsDraft",
        "listProductFactHistory",
        "listFactVersions",
        "getFactVersion",
        "listPlatformProfiles",
        "getPlatformProfile",
        "listQueryTopics",
        "listQueryTopicItems",
        "listPublishedArticles",
        "getPublishedArticle",
        "getFileRecord",
        "getFileDownloadUrl",
        # 统一文章与多 URL 发布台账、产品资料只读查看（Slice 1B）
        "listArticles",
        "getArticle",
        "listArticlePublications",
        "listProductMaterials",
    }
)

# 通过 handler 内 assert_account_types 或公共辅助函数强制校验 ADMIN/ENGINEER 的写路由
_INLINE_GUARDED_WRITE_OPS = frozenset(
    {
        "bulkUpdateUserStatus",
        "updateUser",
        "createPlatformPrompt",
        "updatePlatformPrompt",
        "deletePlatformPrompt",
        "updatePlatformProfile",
        "enablePlatformProfile",
        "disablePlatformProfile",
        "createPlatformPromptVersion",
        "updatePlatformPromptVersionDraft",
        "publishPlatformPromptVersion",
        "archivePlatformPromptVersion",
        "restorePlatformPromptVersion",
        "bindPlatformPromptVersion",
        "submitProductFactReview",
        "approveContentVersion",
        "requestContentVersionChanges",
        "deletePlatformAccount",
        "createPublicationWork",
        "updatePublicationPreparation",
        "markPublicationPlatformReview",
        "registerPublicationResult",
        "switchPublicationContentVersion",
        "verifyPublicationWork",
        "closePublicationWork",
        "openPublishedContentIssue",
        "createPublishedContentRepairTask",
        "resolvePublishedContentIssue",
        "deleteGeoObservation",
        "createGeoObservation",
        "createGeoOptimizationContentTask",
    }
)


def _iter_api_routes(routes: Any) -> Iterator[APIRoute]:
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _iter_api_routes(route.original_router.routes)


def _collect_allowed_types(route: APIRoute) -> set[AccountType] | None:
    """从依赖树提取 require_account_types 允许的集合；若仅用 CurrentUser 则返回 None。"""
    allowed: set[AccountType] | None = None

    def walk(dep: Any) -> None:
        nonlocal allowed
        call = dep.call
        qual = getattr(call, "__qualname__", "")
        if "require_account_types" in qual and getattr(call, "__closure__", None):
            for cell in call.__closure__:
                val = cell.cell_contents
                if isinstance(val, tuple) and val and all(isinstance(x, AccountType) for x in val):
                    allowed = set(val) if allowed is None else allowed & set(val)
        for sub in dep.dependencies:
            walk(sub)

    walk(route.dependant)
    return allowed


def test_viewer_cannot_access_any_non_auth_mutating_route() -> None:
    violations: list[str] = []
    for route in _iter_api_routes(app.routes):
        methods = set(route.methods) - {"HEAD", "OPTIONS"}
        if methods <= {"GET"}:
            continue
        if route.path in {"/api/v1/auth/login", "/api/health/live", "/api/health/ready"}:
            continue
        if route.path.startswith("/api/internal/"):
            # 内部机机回调不使用用户 Cookie 认证。
            continue
        if route.operation_id in _SELF_SERVICE_AUTH_OPS:
            continue
        allowed = _collect_allowed_types(route)
        if allowed is not None:
            if AccountType.VIEWER in allowed:
                violations.append(
                    f"{sorted(methods)} {route.path} ({route.operation_id}) allows VIEWER"
                )
            continue
        if route.operation_id in _INLINE_GUARDED_WRITE_OPS:
            src = inspect.getsource(route.endpoint)
            if (
                "assert_account_types" not in src
                and "_run_publication_command" not in src
                and "set_platform_profile_status" not in src
            ):
                violations.append(
                    f"{sorted(methods)} {route.path} ({route.operation_id})"
                    " missing inline role guard"
                )
            continue
        violations.append(
            f"{sorted(methods)} {route.path} ({route.operation_id})"
            " lacks explicit account_type guard"
        )
    assert not violations, "以下写路由未对 VIEWER 实施 fail-closed 拦截:\n" + "\n".join(violations)


def test_viewer_get_routes_match_explicit_allowlist() -> None:
    viewer_allowed_gets: set[str] = set()
    unguarded_gets: list[str] = []
    for route in _iter_api_routes(app.routes):
        methods = set(route.methods) - {"HEAD", "OPTIONS"}
        if "GET" not in methods:
            continue
        if route.path in {"/api/health/live", "/api/health/ready"}:
            continue
        allowed = _collect_allowed_types(route)
        if allowed is None:
            if route.operation_id in _SELF_SERVICE_AUTH_OPS:
                viewer_allowed_gets.add(route.operation_id or route.path)
            else:
                src = inspect.getsource(route.endpoint)
                if "assert_account_types" not in src:
                    unguarded_gets.append(f"GET {route.path} ({route.operation_id})")
        elif AccountType.VIEWER in allowed:
            viewer_allowed_gets.add(route.operation_id or route.path)
    assert not unguarded_gets, "以下 GET 路由缺少显式角色依赖:\n" + "\n".join(unguarded_gets)
    unexpected = viewer_allowed_gets - _VIEWER_READ_ALLOWLIST
    assert not unexpected, f"发现未登记在白名单内的 VIEWER 可读路由: {sorted(unexpected)}"


def test_assert_account_types_rejects_viewer_on_engineer_and_admin() -> None:
    viewer = User(
        username="leader",
        display_name="业务领导",
        password_hash="x",
        account_type=AccountType.VIEWER.value,
        is_active=True,
    )
    for allowed in ((AccountType.ADMIN,), (AccountType.ADMIN, AccountType.ENGINEER)):
        try:
            assert_account_types(viewer, allowed)
        except AppError as exc:
            assert exc.status_code == 403
            assert exc.code == "PERMISSION_DENIED"
        else:
            raise AssertionError(f"VIEWER 应当被 {allowed} 拒绝")
    assert_account_types(viewer, (AccountType.ADMIN, AccountType.ENGINEER, AccountType.VIEWER))


def test_geo_run_and_batch_workflow_hide_mutations_for_viewer() -> None:
    pending_manual = RunState(
        status=GeoRunStatus.PENDING,
        collection_mode=GeoCollectionMode.MANUAL,
        external_call_state="NOT_STARTED",
        error_stage=None,
        has_answer=False,
        has_successor=False,
    )
    commands = RunCommandAvailability(manual_entry=True, cancel=True, retry=True)
    run_proj = run_workflow(
        pending_manual,
        actor_type=AccountType.VIEWER,
        actor_active=True,
        collection_eligible=True,
        commands=commands,
    )
    assert run_proj.available_actions == []

    batch_proj = batch_workflow(
        [BatchRunState("cell-1", 1, pending_manual)],
        requested_run_count=1,
        matrix_committed=True,
        actor_type=AccountType.VIEWER,
        actor_active=True,
        collection_eligibility={"cell-1": True},
        run_commands=commands,
        cancel_available=True,
    )
    assert batch_proj.available_actions == []
