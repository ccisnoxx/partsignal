import type { QueryClient } from '@tanstack/react-query';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import type { components } from '@/shared/api/generated/schema';

type RetryCommand = {
  owner: PrincipalContinuation;
  target: Pick<components['schemas']['GeoRunDetail']['run'], 'id' | 'batch_id' | 'revision' | 'attempt_no'>;
  phase: 'pending' | 'unknown' | 'rejected' | 'created';
  error?: unknown;
};
type Journal = { commands: Map<string, RetryCommand>; listeners: Set<() => void> };
// 无幂等键的命令阻断属于会话，不属于详情组件；关闭详情不能授权重发。
// 只保留命令回执状态，业务状态仍由 GET 投影裁决；主体 epoch 变化即失效。
const journals = new WeakMap<QueryClient, Journal>();
function journal(client: QueryClient) {
  let value = journals.get(client);
  if (!value) {
    value = { commands: new Map(), listeners: new Set() };
    journals.set(client, value);
  }
  return value;
}
function readRetryCommand(client: QueryClient, id: string) {
  const command = journal(client).commands.get(id);
  return command?.owner.isCurrent() ? command : undefined;
}
function subscribeRetryCommands(client: QueryClient, listener: () => void) {
  const listeners = journal(client).listeners;
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function beginRetryCommand(client: QueryClient, target: RetryCommand['target']) {
  if (readRetryCommand(client, target.id)) return undefined;
  const command: RetryCommand = {
    target: { id: target.id, batch_id: target.batch_id, revision: target.revision, attempt_no: target.attempt_no },
    owner: capturePrincipalContinuation(client), phase: 'pending',
  };
  const value = journal(client);
  value.commands.set(target.id, command);
  value.listeners.forEach((listener) => listener());
  return command;
}
function updateRetryCommand(client: QueryClient, id: string, owner: PrincipalContinuation, update?: Pick<RetryCommand, 'phase' | 'error'>) {
  const command = readRetryCommand(client, id);
  if (!command || command.owner !== owner || command.phase === 'created') return;
  const value = journal(client);
  if (update) value.commands.set(id, { ...command, ...update });
  else value.commands.delete(id);
  value.listeners.forEach((listener) => listener());
}
export { beginRetryCommand, readRetryCommand, subscribeRetryCommands, updateRetryCommand };
