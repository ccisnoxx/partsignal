import { describe, expect, it } from 'vitest';
import { auditActionLabel, parseAuditLogDetailResponse, resolveAuditRelatedLink } from '@/domains/audit/audit.model';

const logId = '10000000-0000-4000-8000-000000000001';
const surfaceId = 'a0000000-0000-4000-8000-000000000001';
const profileId = 'a0000000-0000-4000-8000-000000000002';
function detail(action: string, kind: string, targetId: string, parentId: string | null, status = 'AVAILABLE') {
  return { id: logId, actor_id: null, actor: null, business_module: 'CONFIGURATION', action, target_type: kind, target_id: targetId, outcome: 'SUCCESS', primary_task: 'VIEW_LOG_DETAIL', request_id: 'geo-audit', created_at: '2026-10-02T08:00:00Z', changes: [{ field: 'revision', before: 1, after: 2 }], facts: { revision: 2 }, result_message: '配置操作已完成', error_code: null, related_entry: { status, kind, parent_id: parentId } };
}
describe('GEO 配置审计投影', () => {
  it('两种配置各生命周期动作可解析，关联入口定位 canonical 资源与所属', () => {
    for (const action of ['created', 'updated', 'enabled', 'disabled', 'deleted']) {
      const surface = parseAuditLogDetailResponse(detail(`geo_engine_surface.${action}`, 'GeoEngineSurface', surfaceId.toUpperCase(), null), logId);
      const profile = parseAuditLogDetailResponse(detail(`geo_collection_profile.${action}`, 'GeoCollectionProfile', profileId.toUpperCase(), surfaceId.toUpperCase()), logId);
      expect(auditActionLabel(surface.action)).toContain('观测面');
      expect(auditActionLabel(profile.action)).toContain('采集配置');
      expect(resolveAuditRelatedLink(surface)).toEqual({ href: `/configuration/geo-surfaces?surface_id=${surfaceId}`, label: '查看观测面' });
      expect(resolveAuditRelatedLink(profile)).toEqual({ href: `/configuration/geo-surfaces?tab=profiles&surface_id=${surfaceId}&profile_id=${profileId}`, label: '查看采集配置' });
    }
  });
  it('已删除资源保留审计事实且不生成失效入口', () => {
    const missing = parseAuditLogDetailResponse(detail('geo_collection_profile.deleted', 'GeoCollectionProfile', profileId, null, 'MISSING'), logId);
    expect(missing.facts).toEqual({ revision: 2 });
    expect(resolveAuditRelatedLink(missing)).toBeUndefined();
  });
});
