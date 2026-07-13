/** 人工发布工作台消费服务端候选、允许动作和异常状态，不复制发布状态机。 */
import { useLocation, useParams } from 'react-router-dom';
import { PublicationAttentionPage } from './PublicationAttentionPage';
import { PublicationDetailPage } from './PublicationDetailPage';
import { PublicationRepairPage } from './PublicationRepairPage';
import { PublicationWorkspace } from './PublicationWorkspace';

export function PublicationsPage() {
  const { publicationId, attentionId } = useParams<{
    publicationId?: string;
    attentionId?: string;
  }>();
  const location = useLocation();
  if (attentionId && location.pathname.endsWith('/repair')) {
    return <PublicationRepairPage attentionId={attentionId} />;
  }
  if (attentionId) return <PublicationAttentionPage attentionId={attentionId} />;
  if (publicationId) return <PublicationDetailPage publicationId={publicationId} />;
  return <PublicationWorkspace />;
}
