import type { QueryClient } from '@tanstack/react-query';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import type { ReviewRequest } from './review.model';

type ReviewCommand = {
  owner: PrincipalContinuation;
  payload: ReviewRequest;
  phase: 'pending' | 'unknown';
  error?: unknown;
};
type Journal = { commands: Map<string, ReviewCommand>; listeners: Set<() => void> };
// 无幂等键。pending/unknown 的阻断属于主体会话，关闭详情不能授权重发。
// 这里仅保存命令现场；运行、analysis 与有效结果仍由单 detail 投影拥有。
const journals = new WeakMap<QueryClient, Journal>();
function journal(client: QueryClient) {
  let value = journals.get(client);
  if (!value) {
    value = { commands: new Map(), listeners: new Set() };
    journals.set(client, value);
  }
  return value;
}
function readReviewCommand(client: QueryClient, runId: string) {
  const command = journal(client).commands.get(runId);
  return command?.owner.isCurrent() ? command : undefined;
}
function subscribeReviewCommands(client: QueryClient, listener: () => void) {
  const value = journal(client);
  value.listeners.add(listener);
  return () => { value.listeners.delete(listener); };
}
function beginReviewCommand(client: QueryClient, runId: string, payload: ReviewRequest) {
  if (readReviewCommand(client, runId)) return undefined;
  const command: ReviewCommand = { owner: capturePrincipalContinuation(client), payload, phase: 'pending' };
  const value = journal(client);
  value.commands.set(runId, command);
  value.listeners.forEach((listener) => listener());
  return command;
}
function finishReviewCommand(client: QueryClient, runId: string, command: ReviewCommand, error?: unknown) {
  if (!command.owner.isCurrent() || readReviewCommand(client, runId)?.owner !== command.owner) return;
  const value = journal(client);
  if (error === undefined) value.commands.delete(runId);
  else value.commands.set(runId, { ...command, phase: 'unknown', error });
  value.listeners.forEach((listener) => listener());
}
export { beginReviewCommand, finishReviewCommand, readReviewCommand, subscribeReviewCommands };
