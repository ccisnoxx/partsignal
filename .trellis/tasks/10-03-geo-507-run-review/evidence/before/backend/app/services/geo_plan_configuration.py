"""计划写命令与创建身份共用的配置集合规范化。"""

from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration


def canonical_configuration(
    value: GeoMonitoringPlanConfiguration,
) -> GeoMonitoringPlanConfiguration:
    fields = value.model_dump(exclude={"expected_revision"})
    fields["subjects"] = sorted(fields["subjects"], key=lambda s: s["subject_id"])
    for name in ("prompt_variant_ids", "collection_profile_ids"):
        fields[name] = sorted(fields[name])
    return GeoMonitoringPlanConfiguration.model_validate(fields)
