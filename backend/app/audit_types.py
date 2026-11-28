"""审计写入的强类型业务契约。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class AuditModule(StrEnum):
    """审计工作台使用的业务模块。"""

    IDENTITY = "IDENTITY"
    PRODUCT_FACTS = "PRODUCT_FACTS"
    CONTENT_PLANNING = "CONTENT_PLANNING"
    CONTENT_PRODUCTION = "CONTENT_PRODUCTION"
    CONTENT_REVIEW = "CONTENT_REVIEW"
    PUBLICATION = "PUBLICATION"
    GEO_OBSERVATION = "GEO_OBSERVATION"
    CONFIGURATION = "CONFIGURATION"
    FILE_MANAGEMENT = "FILE_MANAGEMENT"


class AuditOutcome(StrEnum):
    """一次业务命令的真实执行结果。"""

    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    DENIED = "DENIED"


RETAINED_AUDIT_ACTIONS = frozenset(
    {
        "user.created",
        "user.updated",
        "user.deleted",
        "user.exported",
        "user.password_changed",
        "user.password_reset",
        "ai_channel.created",
        "ai_channel.updated",
        "ai_channel.deleted",
        "ai_channel.api_key_replaced",
        "ai_channel.enabled",
        "ai_channel.disabled",
        "ai_channel_header.created",
        "ai_channel_header.updated",
        "ai_channel_header.deleted",
        "ai_model.created",
        "ai_model.updated",
        "ai_model.deleted",
        "ai_model.enabled",
        "ai_model.disabled",
        "ai_model.pricing_updated",
        "platform_profile.enabled",
        "platform_profile.disabled",
        "platform_prompt.created",
        "platform_prompt.updated",
        "platform_prompt.deleted",
        "platform_prompt_version.created",
        "platform_prompt_version.draft_updated",
        "platform_prompt_version.published",
        "platform_prompt_version.archived",
        "platform_prompt_version.restored",
        "platform_profile.prompt_version_bound",
        "platform_profile.health_check_settings_updated",
        "content_humanization_prompt.saved",
        "fact_version.approve",
        "content_version.approve",
        "content_version.deleted",
        "content_quality_check.requested",
        "publication_work.completed",
        "published_article.permanently_deleted",
        "published_article_health_check.run",
        "published_article_health_check.batch_run",
        "product.created",
        "product.updated",
        "product.deleted",
        "product_facts.review_confirmed",
        "fact_version.deleted",
        "content_task.deleted",
        "content_task.permanently_deleted",
        "content_task.batch_created",
        "work_assignment.updated",
        "content_campaign.created",
        "content_campaign.updated",
        "content_campaign.activated",
        "content_campaign.paused",
        "content_campaign.resumed",
        "content_campaign.completed",
        "content_campaign.archived",
        "content_campaign.deleted",
        "article.created",
        "article.updated",
        "article.ai_draft_generated",
        "article_publication.registered",
        "article_publication.updated",
        "article_publication.removed",
        "product_material.attached",
        "product_material.detached",
        "operating_cost_entry.created",
        "operating_cost_entry.voided",
        "query_topic.created",
        "query_topic.updated",
        "query_topic.deleted",
        "platform_type.deleted",
        "platform_profile.deleted",
        "platform_account.deleted",
        "geo_observation.deleted",
        "geo_report.export_started",
        "geo_report.print_prepared",
        "geo_observation_batch.created",
        "geo_observation_run.retried",
        "geo_observation_run.reanalyzed",
        "geo_observation_run.reviewed",
        "geo_manual_draft.saved",
        "geo_manual_observation.submitted",
        "geo_manual_observation.cancelled",
        "geo_manual_observation.failed",
        "geo_citation_link.confirmed",
        "geo_citation_link.rejected",
        "geo_citation_link.manual_linked",
        "geo_daily_checklist.ensured",
        "geo_direct_observation.created",
        "geo_report_snapshot.created",
        "geo_report_snapshot.revised",
        "geo_monitoring_plan.created",
        "geo_monitoring_plan.updated",
        "geo_monitoring_plan.activated",
        "geo_monitoring_plan.paused",
        "geo_monitoring_plan.resumed",
        "geo_monitoring_plan.archived",
        "geo_monitoring_plan.copied",
        "geo_monitoring_plan.deleted",
        "geo_prompt_variant.created",
        "geo_prompt_variant.updated",
        "geo_prompt_variant.enabled",
        "geo_prompt_variant.disabled",
        "geo_prompt_variant.deleted",
        "geo_engine_surface.created",
        "geo_engine_surface.updated",
        "geo_engine_surface.enabled",
        "geo_engine_surface.disabled",
        "geo_engine_surface.deleted",
        "geo_collection_profile.created",
        "geo_collection_profile.updated",
        "geo_collection_profile.enabled",
        "geo_collection_profile.disabled",
        "geo_collection_profile.deleted",
        "geo_collection_profile.tested",
        "geo_browser_session.imported",
        "geo_browser_session.health_checked",
        "geo_browser_session.revoked",
        "geo_browser_session.purged",
        "geo_browser_session.accessed",
        "geo_rule_set.updated",
        "geo_opportunity.opened",
        "geo_opportunity.evaluated",
        "geo_opportunity_schedule.configured",
        "geo_opportunity_schedule.activated",
        "geo_opportunity_schedule.paused",
        "geo_opportunity_schedule.resumed",
        "geo_opportunity.acknowledged",
        "geo_opportunity.dismissed",
        "geo_opportunity.resolved",
        "geo_opportunity.continued",
        "geo_opportunity.action_linked",
        "geo.retest.created",
        "geo_subject.created",
        "geo_subject.updated",
        "geo_subject.enabled",
        "geo_subject.disabled",
        "geo_subject.deleted",
        "geo_subject_alias.created",
        "geo_subject_alias.updated",
        "geo_subject_alias.deleted",
        "geo_subject_domain.created",
        "geo_subject_domain.deleted",
        "geo_intervention.created",
        "geo_intervention.updated",
        "geo_intervention.concluded",
        "geo_intervention.cancelled",
    }
)

type AuditSafeScalar = str | int | float | bool | None
type AuditSafeValue = AuditSafeScalar | list[AuditSafeScalar]

AUDIT_FACT_KEYS: dict[AuditModule, frozenset[str]] = {
    AuditModule.IDENTITY: frozenset(
        {"account_type", "is_active", "source", "status", "row_count", "revision"}
    ),
    AuditModule.PRODUCT_FACTS: frozenset(
        {
            "assignee_id",
            "file_id",
            "has_blocked_reason",
            "has_due_at",
            "priority",
            "product_id",
            "review_record_count",
            "revision",
            "status",
            "version",
        }
    ),
    AuditModule.CONTENT_PLANNING: frozenset(
        {
            "acknowledged_warnings",
            "assignee_id",
            "campaign_id",
            "category",
            "content_review_record_count",
            "content_version_count",
            "created_count",
            "currency",
            "fact_version_id",
            "generation_job_count",
            "geo_intervention_id",
            "has_blocked_reason",
            "has_due_at",
            "is_active",
            "monitoring_plan_count",
            "platform_count",
            "platform_profile_id",
            "platform_profile_version_id",
            "platform_type_id",
            "previous_active_version_id",
            "priority",
            "product_count",
            "publication_work_count",
            "reason",
            "replacement_version_id",
            "revision",
            "status",
            "topic_count",
            "version",
            "warning_cell_count",
        }
    ),
    AuditModule.CONTENT_PRODUCTION: frozenset(
        {
            "based_on_id",
            "content_version_id",
            "current_revision",
            "model_id",
            "origin_type",
            "product_id",
            "retry_of_id",
            "revision",
            "snapshot_id",
            "source_content_version_id",
            "status",
            "task_id",
            "version",
        }
    ),
    AuditModule.CONTENT_REVIEW: frozenset({"revision", "status"}),
    AuditModule.PUBLICATION: frozenset(
        {
            "article_id",
            "assignee_id",
            "attachment_count",
            "auto_opened_issue_count",
            "checked_count",
            "content_version_id",
            "fact_version_id",
            "has_blocked_reason",
            "has_due_at",
            "hostname",
            "platform_profile_id",
            "platform_profile_version_id",
            "priority",
            "publication_id",
            "publication_reference_count",
            "registration_status",
            "repair_task_id",
            "revision",
            "status",
            "status_event_count",
            "task_id",
            "trigger_status",
            "verification_status",
        }
    ),
    AuditModule.GEO_OBSERVATION: frozenset(
        {
            "scope",
            "evaluated_cells",
            "created",
            "existing_reused",
            "skipped",
            "unavailable_reasons",
            "action_id",
            "action_type",
            "assignee_id",
            "has_blocked_reason",
            "has_due_at",
            "priority",
            "target_type",
            "target_id",
            "revision",
            "status",
            "export_type",
            "as_of",
            "filter_sha256",
            "run_id",
            "analysis_revision_id",
            "review_id",
            "decision",
            "decision_id",
            "reason_code",
            "previous_attempt_id",
            "attempt_no",
            "draft_revision",
            "answer_snapshot_id",
            "article_count",
            "article_result_count",
            "attachment_count",
            "observation_count",
            "plan_id",
            "requested_run_count",
            "baseline_id",
            "baseline_batch_id",
            "batch_id",
            "campaign_id",
            "trigger_type",
            "opportunity_id",
            "outcome_verdict",
            "product_id",
            "publication_count",
            "query_topic_id",
            "root_observation_id",
            "supersedes_id",
            "link_id",
            "article_publication_id",
            "link_status",
            "error_code",
            "entry_kind",
            "target_date",
            "created_run_count",
            "snapshot_id",
            "report_kind",
        }
    ),
    AuditModule.CONFIGURATION: frozenset(
        {
            "account_count",
            "allowed_domain_count",
            "bound_platform_count",
            "bound_platform_ids",
            "channel_id",
            "configured",
            "header_name",
            "health_check_anomaly_threshold",
            "health_check_enabled",
            "health_check_interval_hours",
            "is_active",
            "is_sensitive",
            "model_count",
            "platform_account_count",
            "platform_profile_id",
            "platform_type_id",
            "previous_active_version_id",
            "previous_template_version_id",
            "price_currency",
            "pricing_configured",
            "protocol_type",
            "provider_brand",
            "reason",
            "reference_count",
            "replacement_version_id",
            "revision",
            "status",
            "template_id",
            "template_version_id",
            "test_status",
            "session_reference",
            "unbound_platform_count",
            "version",
        }
    ),
    AuditModule.FILE_MANAGEMENT: frozenset({"access_level", "category", "size", "status"}),
}

AUDIT_CHANGE_FIELDS: dict[AuditModule, frozenset[str]] = {
    AuditModule.IDENTITY: frozenset({"account_type", "display_name", "is_active"}),
    AuditModule.PRODUCT_FACTS: frozenset({"status"}),
    AuditModule.CONTENT_PLANNING: frozenset(
        {"generation_data_classification", "generation_input_configured", "status"}
    ),
    AuditModule.CONTENT_PRODUCTION: frozenset(),
    AuditModule.CONTENT_REVIEW: frozenset({"status"}),
    AuditModule.PUBLICATION: frozenset({"is_active", "status"}),
    AuditModule.GEO_OBSERVATION: frozenset(),
    AuditModule.CONFIGURATION: frozenset(
        {
            "allowed_domain_count",
            "is_active",
            "is_configured",
            "logo_configured",
            "name",
            "platform_type_id",
            "revision",
            "status",
            "website_configured",
        }
    ),
    AuditModule.FILE_MANAGEMENT: frozenset({"status"}),
}


def is_audit_safe_value(value: Any) -> bool:
    """审计详情只允许标量或一层标量数组。"""
    if value is None or isinstance(value, str | int | float | bool):
        return True
    return isinstance(value, list) and all(
        item is None or isinstance(item, str | int | float | bool) for item in value
    )


@dataclass(frozen=True, slots=True)
class AuditEntry:
    """一次追加式审计写入所需的完整字段。"""

    actor_id: uuid.UUID
    business_module: AuditModule
    action: str
    target_type: str
    target_id: uuid.UUID | str | None
    request_id: str
    outcome: AuditOutcome
    result_message: str
    error_code: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
