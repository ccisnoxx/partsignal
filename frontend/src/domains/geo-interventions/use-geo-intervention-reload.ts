import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import {
  fetchGeoInterventionDetail,
  geoInterventionKeys,
  invalidateGeoInterventionQueries,
} from './geo-intervention.api';
import type { GeoInterventionOut } from './geo-intervention.model';

export function useGeoInterventionReload(initial: GeoInterventionOut | null) {
  const queryClient = useQueryClient();
  const [liveIntervention, setLiveIntervention] = useState<GeoInterventionOut | null>(initial);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);
  const reloadingRef = useRef(false);

  function clearReloadState() {
    setReloadError(null);
    setReloadNotice(null);
  }

  async function reloadLatest(options: {
    target: GeoInterventionOut | null;
    isSubmitting: boolean;
    formatNotice: (latest: GeoInterventionOut) => string;
  }): Promise<boolean> {
    const { target, isSubmitting, formatNotice } = options;
    if (!target || reloadingRef.current || isSubmitting) return false;
    reloadingRef.current = true;
    setReloading(true);
    setReloadError(null);
    setReloadNotice(null);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      const latest = await fetchGeoInterventionDetail(target.id);
      if (!continuation.isCurrent()) return false;
      setLiveIntervention(latest);
      setReloadNotice(formatNotice(latest));
      await Promise.all([
        invalidateGeoInterventionQueries(queryClient, {
          campaignIds: [target.campaign_id, latest.campaign_id],
          opportunityId: latest.opportunity_id,
          interventionId: latest.id,
        }),
        queryClient.invalidateQueries({ queryKey: geoInterventionKeys.campaignChoices() }),
        queryClient.invalidateQueries({ queryKey: geoInterventionKeys.assigneeChoices() }),
      ]);
      return continuation.isCurrent();
    } catch (err) {
      if (!continuation || continuation.isCurrent()) {
        setReloadError(err instanceof Error ? err.message : '重新加载最新 GEO 干预记录失败');
      }
      return false;
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }

  return {
    liveIntervention,
    reloading,
    reloadError,
    reloadNotice,
    clearReloadState,
    reloadLatest,
  };
}
