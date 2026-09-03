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

function recoverDashboardSession(): void {
  if (sessionRecoveryInFlight) return;
  // queryClient is initialized before any query or request can run.
  sessionRecoveryInFlight = queryClient
    .invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    .then(() => undefined)
    .finally(() => {
      sessionRecoveryInFlight = null;
    });
}

function reportDashboardAccessFailure(url: string, error: ApiResponseError): void {
  if (url.startsWith("/api/dashboard/") && isDashboardAccessError(error)) {
    recoverDashboardSession();
  }
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }): Promise<unknown> {
  const url = queryKey[0];
  if (typeof url !== "string") throw new Error("Query key must start with a URL string");
  return (await apiRequest("GET", url)).json();
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
    reportDashboardAccessFailure(url, error);
    throw error;
  }
  return res;
}
