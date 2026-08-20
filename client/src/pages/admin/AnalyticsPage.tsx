/**
 * ADMIN-12 — Analytics (/admin/analytics).
 * Aggregate engagement report via /api/admin/analytics plus a paginated
 * audience table (signed-in viewers who did not convert) via
 * /api/admin/analytics/audience.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { EngagementReport } from "@/components/analytics/EngagementReport";

// ── Audience types ─────────────────────────────────────────────────────────

type AudienceRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  requestKind: string;
  requestId: string;
  requestTitle: string;
  orgName: string;
  lastViewedAt: string;
};

type AudienceResponse = {
  rows: AudienceRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Audience Table ─────────────────────────────────────────────────────────

function AudienceTable(): ReactElement {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const url = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    return `/api/admin/analytics/audience?${params.toString()}`;
  }, [page]);

  const { data, isLoading, isError } = useQuery<AudienceResponse>({ queryKey: [url] });

  const rows = data?.rows ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <section aria-label="Audience: signed-in viewers who did not convert">
      <h2 className="adm-subheading">
        Signed-In Viewers — Not Yet Converted
      </h2>
      <p className="adm-note">
        Users who viewed a request detail page while signed in but have not completed a conversion
        for that request.{" "}
        {!isLoading && !isError && total > 0 && (
          <>{total.toLocaleString()} record{total !== 1 ? "s" : ""} total.</>
        )}
      </p>

      {isError && (
        <p className="adm-error-text" role="alert">
          Audience data could not be loaded. Refresh to try again.
        </p>
      )}

      {isLoading && !isError && (
        <div className="adm-loading-list" aria-busy="true" aria-label="Loading audience data">
          <span /><span /><span />
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="adm-empty">
          {total === 0
            ? "No signed-in viewers without conversions found."
            : "No audience records match the current page."}
        </p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table anl-audience-table" aria-label="Audience table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Request</th>
                  <th scope="col">Type</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Last Viewed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.userId}-${r.requestKind}-${r.requestId}`}>
                    <td>
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="anl-email-cell">{r.email}</td>
                    <td>{r.requestTitle}</td>
                    <td className="anl-kind-cell">
                      {r.requestKind === "item" ? "Item" : "Volunteer"}
                    </td>
                    <td>{r.orgName}</td>
                    <td className="anl-ts-cell">{fmtTimestamp(r.lastViewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="anl-pagination" role="navigation" aria-label="Audience table pagination">
              <button
                type="button"
                className="adm-btn adm-btn-outline anl-page-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ← Prev
              </button>
              <span className="anl-page-info" aria-live="polite" aria-atomic="true">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="adm-btn adm-btn-outline anl-page-btn"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function AnalyticsPage(): ReactElement {
  return (
    <div className="adm-page">
      <h1 className="adm-heading">Analytics</h1>

      <EngagementReport apiUrl="/api/admin/analytics" />

      <hr className="anl-divider" />

      <AudienceTable />
    </div>
  );
}
