/**
 * Session snapshot from /api/session — the client-side counterpart of the
 * server guards. MP-02 routing and the admin gate build on this.
 *
 * isError is surfaced so MP-02 can render a stated error when the membership
 * resolution itself fails — never a silent fallback (MP-02 §12).
 */
import { useQuery } from "@tanstack/react-query";
import type { SessionInfo } from "@shared/types";

export function useSession(): {
  session: SessionInfo | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery<SessionInfo>({ queryKey: ["/api/session"] });
  return { session: data, isLoading, isError };
}
