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

type OutreachAction = "email" | "export";
type OutreachPreview = {
  action: OutreachAction;
  request: { kind: "item" | "volunteer"; id: string; title: string; orgName: string } | null;
  recipients: AudienceRow[];
  requestedCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  preferenceExcludedCount: number;
  confirmationToken: string;
  subject?: string;
  message?: string;
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
  const [selected, setSelected] = useState<{
    requestKind: "item" | "volunteer";
    requestId: string;
    requestTitle: string;
    userIds: Set<string>;
  } | null>(null);
  const [action, setAction] = useState<OutreachAction | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<OutreachPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const PAGE_SIZE = 25;

  const url = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    return `/api/admin/analytics/audience?${params.toString()}`;
  }, [page]);

  const { data, isLoading, isError, refetch } = useQuery<AudienceResponse>({ queryKey: [url] });

  const rows = data?.rows ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const selectedCount = selected?.userIds.size ?? 0;

  function toggleRow(row: AudienceRow): void {
    setPreview(null);
    setNotice(null);
    setError(null);
    setSelected((current) => {
      if (!current) {
        return {
          requestKind: row.requestKind as "item" | "volunteer",
          requestId: row.requestId,
          requestTitle: row.requestTitle,
          userIds: new Set([row.userId]),
        };
      }
      if (current.requestKind !== row.requestKind || current.requestId !== row.requestId) return current;
      const userIds = new Set(current.userIds);
      if (userIds.has(row.userId)) userIds.delete(row.userId);
      else userIds.add(row.userId);
      return userIds.size === 0 ? null : { ...current, userIds };
    });
  }

  async function loadPreview(nextAction: OutreachAction): Promise<void> {
    if (!selected || busy) return;
    if (nextAction === "email" && (!subject.trim() || !message.trim())) {
      setError("Enter a subject and message before reviewing the email.");
      return;
    }
    setAction(nextAction);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/analytics/outreach/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: nextAction,
          requestKind: selected.requestKind,
          requestId: selected.requestId,
          userIds: [...selected.userIds],
          ...(nextAction === "email" ? { subject: subject.trim(), message: message.trim() } : {}),
        }),
      });
      const body = (await response.json()) as OutreachPreview & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "The outreach preview could not be loaded.");
      setPreview(body);
    } catch (err) {
      setAction(null);
      setError(err instanceof Error ? err.message : "The outreach preview could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(): Promise<void> {
    if (!selected || !preview || !action || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { confirmationToken: preview.confirmationToken };
      if (action === "export") {
        const response = await fetch("/api/admin/analytics/outreach/export", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? "The export could not be created.");
        }
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "eligible-request-viewers.csv";
        link.click();
        URL.revokeObjectURL(downloadUrl);
        setNotice(`Downloaded ${preview.eligibleCount} eligible viewer${preview.eligibleCount === 1 ? "" : "s"}.`);
      } else {
        const response = await fetch("/api/admin/analytics/outreach/send", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { message?: string };
        if (!response.ok) throw new Error(body.message ?? "The email could not be sent.");
        setNotice(body.message ?? "Outreach email sent.");
      }
      setPreview(null);
      setAction(null);
      setSelected(null);
      setSubject("");
      setMessage("");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The outreach action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

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
          <div className="anl-outreach-intro">
            <p className="adm-note">
              Select signed-in viewers from one request at a time to review an email or export a follow-up list.
              Eligibility is checked again before any download or send. Volunteer follow-ups require the viewer&apos;s
              matching-alert consent.
            </p>
            {notice && <p className="adm-result" role="status">{notice}</p>}
            {error && <p className="adm-danger" role="alert">{error}</p>}
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table anl-audience-table" aria-label="Audience table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Select</span></th>
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
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.firstName} ${r.lastName} for ${r.requestTitle}`}
                        checked={
                          selected?.requestKind === r.requestKind &&
                          selected.requestId === r.requestId &&
                          selected.userIds.has(r.userId)
                        }
                        disabled={
                          busy ||
                          (selected !== null && (selected.requestKind !== r.requestKind || selected.requestId !== r.requestId))
                        }
                        onChange={() => toggleRow(r)}
                      />
                    </td>
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

          {selected && (
            <section className="anl-outreach-panel" aria-label="Request viewer outreach">
              <h3>Follow up with selected viewers</h3>
              <p className="adm-note">
                {selectedCount} selected for <strong>{selected.requestTitle}</strong>. A recipient can only be sent this
                request&apos;s follow-up once; previous deliveries are not repeated.
              </p>
              <label className="anl-outreach-field">
                Email subject
                <input
                  value={subject}
                  maxLength={160}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={busy || preview !== null}
                />
              </label>
              <label className="anl-outreach-field">
                Email message
                <textarea
                  value={message}
                  maxLength={5000}
                  rows={6}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={busy || preview !== null}
                />
              </label>
              <div className="adm-btn-row">
                <button type="button" className="adm-btn" disabled={busy} onClick={() => void loadPreview("email")}>
                  Review email
                </button>
                <button type="button" className="adm-btn adm-btn-outline" disabled={busy} onClick={() => void loadPreview("export")}>
                  Review export
                </button>
                <button
                  type="button"
                  className="adm-btn adm-btn-outline"
                  disabled={busy}
                  onClick={() => {
                    setSelected(null);
                    setPreview(null);
                    setAction(null);
                    setError(null);
                  }}
                >
                  Clear selection
                </button>
              </div>
            </section>
          )}

          {preview && action && (
            <section className="anl-outreach-confirm" aria-label="Confirm outreach">
              <h3>{action === "email" ? "Review email outreach" : "Review export"}</h3>
              {action === "email" && (
                <div className="anl-email-preview">
                  <strong>Subject: {preview.subject}</strong>
                  <p>{preview.message}</p>
                </div>
              )}
              <p>
                {preview.eligibleCount} eligible signed-in viewer{preview.eligibleCount === 1 ? "" : "s"} will be{" "}
                {action === "email" ? "contacted" : "included in the download"}.
              </p>
              {preview.ineligibleCount > 0 && (
                <p className="adm-note">
                  {preview.ineligibleCount} selected viewer{preview.ineligibleCount === 1 ? " is" : "s are"} no longer
                  eligible and will not be included.
                  {preview.preferenceExcludedCount > 0 &&
                    ` ${preview.preferenceExcludedCount} ${preview.preferenceExcludedCount === 1 ? "has" : "have"} not opted in to volunteer matching alerts.`}
                </p>
              )}
              {preview.recipients.length > 0 && (
                <ul className="anl-recipient-preview">
                  {preview.recipients.map((recipient) => (
                    <li key={recipient.userId}>{recipient.firstName} {recipient.lastName} — {recipient.email}</li>
                  ))}
                </ul>
              )}
              <div className="adm-btn-row">
                <button type="button" className="adm-btn" disabled={busy || preview.eligibleCount === 0} onClick={() => void confirmAction()}>
                  {busy ? "Working…" : action === "email" ? `Confirm send to ${preview.eligibleCount}` : `Confirm download of ${preview.eligibleCount}`}
                </button>
                <button type="button" className="adm-btn adm-btn-outline" disabled={busy} onClick={() => { setPreview(null); setAction(null); }}>
                  Cancel
                </button>
              </div>
            </section>
          )}

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
