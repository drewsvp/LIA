import { AsyncLocalStorage } from "node:async_hooks";

export type ActiveOrganizationContext = {
  id: string;
  organizationId: string;
  organizationName: string;
  startedAt: string;
  actorUserId: string;
};

const storage = new AsyncLocalStorage<ActiveOrganizationContext>();

export function runWithOrganizationContext<T>(
  context: ActiveOrganizationContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function currentOrganizationContext(): ActiveOrganizationContext | undefined {
  return storage.getStore();
}