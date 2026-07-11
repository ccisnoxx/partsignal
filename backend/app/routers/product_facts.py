"""产品、规范化事实工作区和不可变事实版本接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, not_found
from app.models import (
    ClaimEvidenceLink,
    Evidence,
    FactClaim,
    FactReviewRecord,
    FactVersion,
    FileRecord,
    ParameterEvidenceLink,
    PartParameter,
    Product,
    ReferencePart,
    ReplacementEvidenceLink,
    ReplacementRelation,
    User,
)
from app.schemas import (
    CommandRequest,
    CreateVersionRequest,
    EvidenceData,
    FactClaimData,
    FactVersionList,
    FactVersionOut,
    PartParameterData,
    ProductCreate,
    ProductFactsBody,
    ProductFactsDraft,
    ProductFactsDraftUpdate,
    ProductList,
    ProductOut,
    ProductUpdate,
    ReferencePartData,
    ReplacementRelationData,
)

router = APIRouter(prefix="/api/v1", tags=["product-facts", "review"])

ProductEditor = EngineerUser
ProductReviewer = EngineerUser


def normalize_identity(value: str) -> str:
    """以大小写和常见分隔符无关的形式比较型号身份。"""
    return "".join(character for character in value.casefold().strip() if character.isalnum())


def ensure_unique(values: list[str], label: str) -> None:
    """客户端键必须在所属集合内唯一。"""
    if len(values) != len(set(values)):
        raise AppError("VALIDATION_ERROR", f"{label}包含重复 client_key", 422)


def fact_version_out(version: FactVersion) -> FactVersionOut:
    """将冻结 JSON 快照投影为契约响应。"""
    return FactVersionOut(
        id=version.id,
        product_id=version.product_id,
        version=version.version,
        status=version.status,
        snapshot=ProductFactsBody.model_validate(version.snapshot_json),
        change_summary=version.change_summary,
        revision=version.revision,
        created_by=version.created_by,
        approved_by=version.approved_by,
        created_at=version.created_at,
        approved_at=version.approved_at,
    )


def load_fact_body(db: Session, product: Product) -> ProductFactsBody:
    """从规范化工作表重建唯一的 API 事实表示。"""
    references = list(
        db.scalars(select(ReferencePart).where(ReferencePart.product_id == product.id))
    )
    evidences = list(db.scalars(select(Evidence).where(Evidence.product_id == product.id)))
    parameters = list(
        db.scalars(select(PartParameter).where(PartParameter.product_id == product.id))
    )
    replacements = list(
        db.scalars(select(ReplacementRelation).where(ReplacementRelation.product_id == product.id))
    )
    claims = list(db.scalars(select(FactClaim).where(FactClaim.product_id == product.id)))
    reference_keys = {item.id: item.client_key for item in references}
    evidence_keys = {item.id: item.client_key for item in evidences}
    parameter_evidence: dict[uuid.UUID, list[str]] = {item.id: [] for item in parameters}
    replacement_evidence: dict[uuid.UUID, list[str]] = {item.id: [] for item in replacements}
    claim_evidence: dict[uuid.UUID, list[str]] = {item.id: [] for item in claims}
    for parameter_link in db.scalars(
        select(ParameterEvidenceLink)
        .join(PartParameter, PartParameter.id == ParameterEvidenceLink.parameter_id)
        .where(PartParameter.product_id == product.id)
    ):
        parameter_evidence[parameter_link.parameter_id].append(
            evidence_keys[parameter_link.evidence_id]
        )
    for replacement_link in db.scalars(
        select(ReplacementEvidenceLink)
        .join(ReplacementRelation, ReplacementRelation.id == ReplacementEvidenceLink.replacement_id)
        .where(ReplacementRelation.product_id == product.id)
    ):
        replacement_evidence[replacement_link.replacement_id].append(
            evidence_keys[replacement_link.evidence_id]
        )
    for claim_link in db.scalars(
        select(ClaimEvidenceLink)
        .join(FactClaim, FactClaim.id == ClaimEvidenceLink.claim_id)
        .where(FactClaim.product_id == product.id)
    ):
        claim_evidence[claim_link.claim_id].append(evidence_keys[claim_link.evidence_id])
    return ProductFactsBody(
        reference_parts=[
            ReferencePartData(
                client_key=item.client_key,
                part_number=item.part_number,
                manufacturer=item.manufacturer,
                category=item.category,
            )
            for item in references
        ],
        parameters=[
            PartParameterData(
                client_key=parameter.client_key,
                owner_key="product"
                if parameter.owner_product_id is not None
                else reference_keys[parameter.reference_part_id],  # type: ignore[index]
                key=parameter.key,
                name=parameter.name,
                value_type=parameter.value_type,
                min_value=parameter.min_value,
                typical_value=parameter.typical_value,
                max_value=parameter.max_value,
                text_value=parameter.text_value,
                unit=parameter.unit,
                test_conditions=parameter.test_conditions,
                is_critical=parameter.is_critical,
                evidence_keys=parameter_evidence[parameter.id],
            )
            for parameter in parameters
        ],
        replacement_relations=[
            ReplacementRelationData(
                client_key=item.client_key,
                reference_part_key=reference_keys[item.reference_part_id],
                replacement_level=item.replacement_level,
                conditions=item.conditions,
                exclusions=item.exclusions,
                evidence_keys=replacement_evidence[item.id],
            )
            for item in replacements
        ],
        evidences=[
            EvidenceData(
                client_key=item.client_key,
                type=item.type,
                title=item.title,
                version=item.version,
                source_url=item.source_url,
                file_id=item.file_record_id,
                confidentiality=item.confidentiality,
            )
            for item in evidences
        ],
        claims=[
            FactClaimData(
                client_key=item.client_key,
                type=item.type,
                text=item.text,
                evidence_keys=claim_evidence[item.id],
            )
            for item in claims
        ],
    )


def validate_fact_graph(db: Session, payload: ProductFactsBody, require_complete: bool) -> None:
    """校验事实图引用；提交快照时额外强制证据完整性。"""
    ensure_unique([item.client_key for item in payload.reference_parts], "参考型号")
    ensure_unique([item.client_key for item in payload.parameters], "参数")
    ensure_unique([item.client_key for item in payload.replacement_relations], "替代关系")
    ensure_unique([item.client_key for item in payload.evidences], "证据")
    ensure_unique([item.client_key for item in payload.claims], "事实表达")
    reference_keys = {item.client_key for item in payload.reference_parts}
    evidence_keys = {item.client_key for item in payload.evidences}
    if require_complete and not (
        payload.parameters
        or payload.replacement_relations
        or any(claim.type == "APPROVED" for claim in payload.claims)
    ):
        raise AppError("VALIDATION_ERROR", "事实版本必须包含参数、替代关系或已批准表达", 422)
    for evidence in payload.evidences:
        if evidence.source_url is None and evidence.file_id is None:
            if require_complete:
                raise AppError("VALIDATION_ERROR", "快照证据必须有来源 URL 或已验证文件", 422)
            continue
        if evidence.file_id is not None:
            file_record = db.get(FileRecord, evidence.file_id)
            if file_record is None or file_record.status != "VERIFIED":
                raise AppError("VALIDATION_ERROR", "事实只能引用已验证文件", 422)
    for parameter in payload.parameters:
        if parameter.owner_key != "product" and parameter.owner_key not in reference_keys:
            raise AppError("VALIDATION_ERROR", "参数 owner_key 未指向产品或参考型号", 422)
        if not set(parameter.evidence_keys).issubset(evidence_keys):
            raise AppError("VALIDATION_ERROR", "参数引用了未知证据", 422)
        if require_complete and parameter.is_critical and not parameter.evidence_keys:
            raise AppError("VALIDATION_ERROR", "关键参数必须关联证据", 422)
    for relation in payload.replacement_relations:
        if relation.reference_part_key not in reference_keys:
            raise AppError("VALIDATION_ERROR", "替代关系引用了未知参考型号", 422)
        if not set(relation.evidence_keys).issubset(evidence_keys):
            raise AppError("VALIDATION_ERROR", "替代关系引用了未知证据", 422)
        if require_complete and not relation.evidence_keys:
            raise AppError("VALIDATION_ERROR", "替代关系必须关联证据", 422)
    for claim in payload.claims:
        if not set(claim.evidence_keys).issubset(evidence_keys):
            raise AppError("VALIDATION_ERROR", "事实表达引用了未知证据", 422)
        if (
            require_complete
            and claim.type in {"APPROVED", "REQUIRED_DISCLOSURE"}
            and not claim.evidence_keys
        ):
            raise AppError("VALIDATION_ERROR", "已批准表达和必要披露必须关联证据", 422)


@router.get("/products", response_model=ProductList, operation_id="listProducts")
def list_products(
    db: DbSession,
    _user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
) -> ProductList:
    """分页搜索产品稳定身份。"""
    query = select(Product)
    count_query = select(func.count()).select_from(Product)
    if search:
        pattern = f"%{search.strip()}%"
        condition = or_(Product.part_number.ilike(pattern), Product.brand.ilike(pattern))
        query = query.where(condition)
        count_query = count_query.where(condition)
    total = int(db.scalar(count_query) or 0)
    items = list(
        db.scalars(
            query.order_by(Product.created_at).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return ProductList(
        items=[ProductOut.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createProduct",
)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductOut:
    """创建公司产品，不推断任何产品参数。"""
    product = Product(
        part_number=payload.part_number.strip(),
        normalized_part_number=normalize_identity(payload.part_number),
        brand=payload.brand.strip(),
        normalized_brand=normalize_identity(payload.brand),
        category=payload.category.strip(),
    )
    db.add(product)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="product.created",
        target_type="Product",
        target_id=product.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return ProductOut.model_validate(product)


@router.get("/products/{product_id}", response_model=ProductOut, operation_id="getProduct")
def get_product(product_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> ProductOut:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    return ProductOut.model_validate(product)


@router.patch("/products/{product_id}", response_model=ProductOut, operation_id="updateProduct")
def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductOut:
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "产品已被其他请求修改", 409)
    identity_changed = (
        product.part_number != payload.part_number.strip()
        or product.brand != payload.brand.strip()
        or product.category != payload.category.strip()
    )
    if identity_changed and db.scalar(
        select(FactVersion.id)
        .where(
            FactVersion.product_id == product.id,
            FactVersion.status.in_(["APPROVED", "RETIRED"]),
        )
        .limit(1)
    ):
        raise AppError(
            "IMMUTABLE_VERSION",
            "产品已有批准事实版本，型号、品牌和分类不能原地修改",
            409,
        )
    product.part_number = payload.part_number.strip()
    product.normalized_part_number = normalize_identity(payload.part_number)
    product.brand = payload.brand.strip()
    product.normalized_brand = normalize_identity(payload.brand)
    product.category = payload.category.strip()
    product.status = payload.status.value
    product.revision += 1
    append_audit(
        db,
        actor_id=editor.id,
        action="product.updated",
        target_type="Product",
        target_id=product.id,
        request_id=request.state.request_id,
        details={"revision": product.revision, "status": product.status},
    )
    db.commit()
    return ProductOut.model_validate(product)


@router.get(
    "/products/{product_id}/facts",
    response_model=ProductFactsDraft,
    operation_id="getProductFactsDraft",
)
def get_product_facts(
    product_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> ProductFactsDraft:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    body = load_fact_body(db, product)
    return ProductFactsDraft(
        **body.model_dump(), product_id=product.id, revision=product.facts_revision
    )


@router.put(
    "/products/{product_id}/facts",
    response_model=ProductFactsDraft,
    operation_id="replaceProductFactsDraft",
)
def replace_product_facts(
    product_id: uuid.UUID,
    payload: ProductFactsDraftUpdate,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> ProductFactsDraft:
    """在单一事务中替换规范化事实工作区。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    if product.facts_revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "事实工作区已被其他请求修改", 409)
    body = ProductFactsBody.model_validate(payload.model_dump(exclude={"expected_revision"}))
    validate_fact_graph(db, body, require_complete=False)
    # 工作区是可变聚合；关联表依赖实体，必须按依赖方向删除后重建。
    db.execute(
        delete(ParameterEvidenceLink).where(
            ParameterEvidenceLink.parameter_id.in_(
                select(PartParameter.id).where(PartParameter.product_id == product.id)
            )
        )
    )
    db.execute(
        delete(ReplacementEvidenceLink).where(
            ReplacementEvidenceLink.replacement_id.in_(
                select(ReplacementRelation.id).where(ReplacementRelation.product_id == product.id)
            )
        )
    )
    db.execute(
        delete(ClaimEvidenceLink).where(
            ClaimEvidenceLink.claim_id.in_(
                select(FactClaim.id).where(FactClaim.product_id == product.id)
            )
        )
    )
    db.execute(delete(PartParameter).where(PartParameter.product_id == product.id))
    db.execute(delete(ReplacementRelation).where(ReplacementRelation.product_id == product.id))
    db.execute(delete(FactClaim).where(FactClaim.product_id == product.id))
    db.execute(delete(Evidence).where(Evidence.product_id == product.id))
    db.execute(delete(ReferencePart).where(ReferencePart.product_id == product.id))
    references: dict[str, ReferencePart] = {}
    for reference_data in body.reference_parts:
        reference_model = ReferencePart(
            product_id=product.id,
            client_key=reference_data.client_key,
            part_number=reference_data.part_number,
            normalized_part_number=normalize_identity(reference_data.part_number),
            manufacturer=reference_data.manufacturer,
            normalized_manufacturer=normalize_identity(reference_data.manufacturer),
            category=reference_data.category,
        )
        db.add(reference_model)
        references[reference_data.client_key] = reference_model
    evidences: dict[str, Evidence] = {}
    for evidence_data in body.evidences:
        evidence_model = Evidence(
            product_id=product.id,
            client_key=evidence_data.client_key,
            type=evidence_data.type.value,
            title=evidence_data.title,
            version=evidence_data.version,
            source_url=str(evidence_data.source_url) if evidence_data.source_url else None,
            file_record_id=evidence_data.file_id,
            confidentiality=evidence_data.confidentiality.value,
        )
        db.add(evidence_model)
        evidences[evidence_data.client_key] = evidence_model
    db.flush()
    for parameter_data in body.parameters:
        parameter_model = PartParameter(
            product_id=product.id,
            owner_product_id=product.id if parameter_data.owner_key == "product" else None,
            reference_part_id=None
            if parameter_data.owner_key == "product"
            else references[parameter_data.owner_key].id,
            client_key=parameter_data.client_key,
            key=parameter_data.key,
            name=parameter_data.name,
            value_type=parameter_data.value_type.value,
            min_value=parameter_data.min_value,
            typical_value=parameter_data.typical_value,
            max_value=parameter_data.max_value,
            text_value=parameter_data.text_value,
            unit=parameter_data.unit,
            test_conditions=parameter_data.test_conditions,
            is_critical=parameter_data.is_critical,
        )
        db.add(parameter_model)
        db.flush()
        db.add_all(
            ParameterEvidenceLink(parameter_id=parameter_model.id, evidence_id=evidences[key].id)
            for key in parameter_data.evidence_keys
        )
    for relation_data in body.replacement_relations:
        relation_model = ReplacementRelation(
            product_id=product.id,
            reference_part_id=references[relation_data.reference_part_key].id,
            client_key=relation_data.client_key,
            replacement_level=relation_data.replacement_level.value,
            conditions=relation_data.conditions,
            exclusions=relation_data.exclusions,
        )
        db.add(relation_model)
        db.flush()
        db.add_all(
            ReplacementEvidenceLink(replacement_id=relation_model.id, evidence_id=evidences[key].id)
            for key in relation_data.evidence_keys
        )
    for claim_data in body.claims:
        claim_model = FactClaim(
            product_id=product.id,
            client_key=claim_data.client_key,
            type=claim_data.type.value,
            text=claim_data.text,
        )
        db.add(claim_model)
        db.flush()
        db.add_all(
            ClaimEvidenceLink(claim_id=claim_model.id, evidence_id=evidences[key].id)
            for key in claim_data.evidence_keys
        )
    product.facts_revision += 1
    append_audit(
        db,
        actor_id=editor.id,
        action="product_facts.replaced",
        target_type="Product",
        target_id=product.id,
        request_id=request.state.request_id,
        details={"revision": product.facts_revision},
    )
    db.commit()
    return ProductFactsDraft(
        **body.model_dump(), product_id=product.id, revision=product.facts_revision
    )


@router.get(
    "/products/{product_id}/fact-versions",
    response_model=FactVersionList,
    operation_id="listFactVersions",
)
def list_fact_versions(product_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> FactVersionList:
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    versions = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == product_id)
            .order_by(FactVersion.version.desc())
        )
    )
    return FactVersionList(items=[fact_version_out(item) for item in versions])


@router.post(
    "/products/{product_id}/fact-versions",
    response_model=FactVersionOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createFactVersion",
)
def create_fact_version(
    product_id: uuid.UUID,
    payload: CreateVersionRequest,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    """从规范化工作区构造完整快照；客户端不能提交快照内容。"""
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise not_found("产品")
    body = load_fact_body(db, product)
    validate_fact_graph(db, body, require_complete=True)
    next_version = (
        int(
            db.scalar(
                select(func.coalesce(func.max(FactVersion.version), 0)).where(
                    FactVersion.product_id == product.id
                )
            )
            or 0
        )
        + 1
    )
    version = FactVersion(
        product_id=product.id,
        version=next_version,
        snapshot_json=body.model_dump(mode="json"),
        change_summary=payload.change_summary,
        created_by=editor.id,
    )
    db.add(version)
    db.flush()
    append_audit(
        db,
        actor_id=editor.id,
        action="fact_version.created",
        target_type="FactVersion",
        target_id=version.id,
        request_id=request.state.request_id,
        details={"version": next_version},
    )
    db.commit()
    return fact_version_out(version)


@router.get(
    "/fact-versions/{fact_version_id}",
    response_model=FactVersionOut,
    operation_id="getFactVersion",
)
def get_fact_version(
    fact_version_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> FactVersionOut:
    version = db.get(FactVersion, fact_version_id)
    if version is None:
        raise not_found("事实版本")
    return fact_version_out(version)


def transition_fact_version(
    *,
    db: Session,
    version: FactVersion,
    payload: CommandRequest,
    actor: User,
    request_id: str,
    action: str,
) -> FactVersionOut:
    """集中执行事实版本状态机、证据门禁、乐观锁和审计。"""
    if version.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "事实版本已被其他请求修改", 409)
    transitions = {
        "submit": ("DRAFT", "PENDING_REVIEW"),
        "approve": ("PENDING_REVIEW", "APPROVED"),
        "request-changes": ("PENDING_REVIEW", "CHANGES_REQUESTED"),
        "retire": ("APPROVED", "RETIRED"),
    }
    expected, target = transitions[action]
    if version.status != expected:
        raise AppError(
            "INVALID_STATE_TRANSITION", f"事实版本不能从 {version.status} 执行 {action}", 409
        )
    version.status = target
    version.revision += 1
    if action == "approve":
        version.approved_by = actor.id
        version.approved_at = datetime.now(UTC)
    db.add(
        FactReviewRecord(
            fact_version_id=version.id,
            action=action,
            comment=payload.comment,
            actor_id=actor.id,
        )
    )
    append_audit(
        db,
        actor_id=actor.id,
        action=f"fact_version.{action}",
        target_type="FactVersion",
        target_id=version.id,
        request_id=request_id,
        details={"status": target, "revision": version.revision},
    )
    db.commit()
    return fact_version_out(version)


@router.post(
    "/fact-versions/{fact_version_id}/submit",
    response_model=FactVersionOut,
    operation_id="submitFactVersion",
)
def submit_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    editor: ProductEditor,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    return transition_fact_version(
        db=db,
        version=version,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
        action="submit",
    )


@router.post(
    "/fact-versions/{fact_version_id}/approve",
    response_model=FactVersionOut,
    operation_id="approveFactVersion",
)
def approve_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    return transition_fact_version(
        db=db,
        version=version,
        payload=payload,
        actor=reviewer,
        request_id=request.state.request_id,
        action="approve",
    )


@router.post(
    "/fact-versions/{fact_version_id}/request-changes",
    response_model=FactVersionOut,
    operation_id="requestFactVersionChanges",
)
def request_fact_changes(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    return transition_fact_version(
        db=db,
        version=version,
        payload=payload,
        actor=reviewer,
        request_id=request.state.request_id,
        action="request-changes",
    )


@router.post(
    "/fact-versions/{fact_version_id}/retire",
    response_model=FactVersionOut,
    operation_id="retireFactVersion",
)
def retire_fact_version(
    fact_version_id: uuid.UUID,
    payload: CommandRequest,
    request: Request,
    db: DbSession,
    reviewer: ProductReviewer,
    _csrf: CsrfProtected,
) -> FactVersionOut:
    version = db.scalar(
        select(FactVersion).where(FactVersion.id == fact_version_id).with_for_update()
    )
    if version is None:
        raise not_found("事实版本")
    return transition_fact_version(
        db=db,
        version=version,
        payload=payload,
        actor=reviewer,
        request_id=request.state.request_id,
        action="retire",
    )
