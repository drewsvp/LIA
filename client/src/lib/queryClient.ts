/**
 * Shared TanStack Query client. Default queryFn treats the query key's first
 * element as the URL, so surfaces write useQuery({ queryKey: ["/api/…"] }).
 */
import { QueryClient } from "@tanstack/react-query";

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`${status}: ${body}`);
    this.name = "ApiResponseError";
  }
}

const SESSION_QUERY_KEY = ["/api/session"] as const;
let sessionRecoveryInFlight: Promise<void> | null = null;
const recoveredSessionGenerations = new Set<unknown>();
const recoveredSessionGenerationOrder: unknown[] = [];
const MISSING_SESSION_GENERATION = Symbol("missing-session-generation");

function rememberRecoveredSessionGeneration(generation: unknown): void {
  if (recoveredSessionGenerations.has(generation)) return;
  recoveredSessionGenerations.add(generation);
  recoveredSessionGenerationOrder.push(generation);
  if (recoveredSessionGenerationOrder.length > 8) {
    recoveredSessionGenerations.delete(recoveredSessionGenerationOrder.shift());
  }
}

function dashboardScopeKey(session: unknown): string {
  if (typeof session !== "object" || session === null) return "missing";
  const value = session as {
    authenticated?: unknown;
    user?: { id?: unknown } | null;
    activeOrgId?: unknown;
    organizationContext?: { id?: unknown } | null;
    supporterContext?: { id?: unknown } | null;
  };
  return JSON.stringify([
    value.authenticated === true,
    value.user?.id ?? null,
    value.activeOrgId ?? null,
    value.organizationContext?.id ?? null,
    value.supporterContext?.id ?? null,
  ]);
}

function clearDashboardScopeQueries(): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const url = query.queryKey[0];
      return typeof url === "string" && url.startsWith("/api/dashboard/");
    },
  });
}

/**
 * Dashboard guards use 401/403 for expired authentication or organization
 * access, and a tagged 409 when a multi-organization member must choose an
 * organization. Other 409 responses are form-specific conflicts and must stay
 * visible to the form.
 */
export function isDashboardAccessError(error: unknown): error is ApiResponseError {
  if (!(error instanceof ApiResponseError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  if (error.status !== 409) return false;

  try {
    const body = JSON.parse(error.body) as { code?: unknown };
    return body.code === "ORG_SELECTION_REQUIRED";
  } catch {
    return false;
  }
}

function recoverDashboardSession(generation: unknown): void {
  if (recoveredSessionGenerations.has(generation)) return;
  rememberRecoveredSessionGeneration(generation);
  if (sessionRecoveryInFlight) return;
  // Refetch the active snapshot directly instead of invalidating it. The
  // dashboard gate keeps its last valid snapshot mounted during this bounded
  // recovery, preventing an access failure from remounting the failed query
  // and recursively requesting another recovery.
  sessionRecoveryInFlight = queryClient
    .refetchQueries({ queryKey: SESSION_QUERY_KEY, type: "active" })
    .then(() => undefined)
    .finally(() => {
      sessionRecoveryInFlight = null;
    });
}

function reportDashboardAccessFailure(
  url: string,
  error: ApiResponseError,
  sessionGeneration: unknown,
): void {
  if (url.startsWith("/api/dashboard/") && isDashboardAccessError(error)) {
    recoverDashboardSession(sessionGeneration);
  }
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }): Promise<unknown> {
  const url = queryKey[0];
  if (typeof url !== "string") throw new Error("Query key must start with a URL string");
  const data: unknown = await (await apiRequest("GET", url)).json();
  if (
    url === SESSION_QUERY_KEY[0] &&
    dashboardScopeKey(queryClient.getQueryData(SESSION_QUERY_KEY)) !== dashboardScopeKey(data)
  ) {
    // Clear old organization/user data before Query publishes the new session
    // snapshot. This covers ordinary invalidations as well as access-failure
    // recovery; the keyed dashboard gate separately resets component-local
    // state for the same scope transition.
    clearDashboardScopeQueries();
  }
  return data;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
  },
});

/** Read the server's optional message without hiding a transport or parse error. */
export function getApiErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiResponseError)) return null;
  try {
    const body = JSON.parse(error.body) as { message?: unknown };
    return typeof body.message === "string" && body.message.length > 0 ? body.message : null;
  } catch {
    return null;
  }
}

/** Request helper for mutations. Throws on non-2xx with the body text. */
export async function apiRequest(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const sessionGeneration = url.startsWith("/api/dashboard/")
    ? (queryClient.getQueryData(SESSION_QUERY_KEY) ?? MISSING_SESSION_GENERATION)
    : MISSING_SESSION_GENERATION;
  const res = await fetch(url, {
    method,
    credentials: "include",
    signal,
    headers: body !== undefined && !isFormData ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const error = new ApiResponseError(res.status, text);
    reportDashboardAccessFailure(url, error, sessionGeneration);
    throw error;
  }
  return res;
}
