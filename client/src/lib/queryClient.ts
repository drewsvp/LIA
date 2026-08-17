/**
 * Shared TanStack Query client. Default queryFn treats the query key's first
 * element as the URL, so surfaces write useQuery({ queryKey: ["/api/…"] }).
 */
import { QueryClient } from "@tanstack/react-query";

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }): Promise<unknown> {
  const url = queryKey[0];
  if (typeof url !== "string") throw new Error("Query key must start with a URL string");
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
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

/** JSON request helper for mutations. Throws on non-2xx with the body text. */
export async function apiRequest(method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}
