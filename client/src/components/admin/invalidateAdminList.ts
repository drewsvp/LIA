import type { QueryClient } from "@tanstack/react-query";

/** A list's query key is a single URL; matching a shorter URL as a key will not refresh it. */
export function invalidateAdminList(queryClient: QueryClient, path: string): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: query => {
      const key = query.queryKey[0];
      return typeof key === "string" && (key === path || key.startsWith(`${path}?`));
    },
  });
}