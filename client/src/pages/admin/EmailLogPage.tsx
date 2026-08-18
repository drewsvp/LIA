/**
 * ADMIN-06 — Email log (§4–§10). Every attempted send: filterable table,
 * failure banner with one-click filter, detail with full payload, resend on
 * failed rows only. Template keys never appear raw — readable names come
 * from the single shared mapping. Deep links (?status=failed from the nav
 * alert) preselect filters. D23: queued >15 minutes wears a distinct
 * "Queued but not dispatched." marker.
 */
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { EMAIL_TEMPLATE_NAMES, templateDisplayName } from "@shared/email-templates";

type LogRow = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  templateKey: string;
  toEmail: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  error: string | null;
  entityType: string | null;
  entityId: string | null;
  entity: { name: string; path: string | null } | null;
};

type ListResponse = { rows: LogRow[]; failureCount: number; anyExist: boolean };

type DetailResponse = LogRow & {
  payload: Record<string, unknown>;
  providerMessageId: string | null;
  toPersonId: string | null;
};

const STUCK_MS = 15 * 60 * 1000;

function laDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

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

function isStuck(row: LogRow): boolean {
  return (row.status === "queued" || row.status === "sending") && Date.now() - new Date(row.createdAt).getTime() > STUCK_MS;
}

/** Initial filter state honors the nav alert's ?status=failed deep link. */
function initialFilters(): { template: string; status: string; recipient: string; from: string; to: string } {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status") ?? "";
  return {
    template: params.get("template") ?? "",
    status: ["queued", "sending", "sent", "failed", "skipped"].includes(status) ? status : "",
    recipient: params.get("recipient") ?? "",
    from: params.get("from") ?? laDate(7),
    to: params.get("to") ?? "",
  };
}

export function EmailLogPage(): ReactElement {
  const [filters, setFilters] = useState(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.template) params.set("template", filters.template);
    if (filters.status) params.set("status", filters.status);
    if (filters.recipient.trim()) params.set("recipient", filters.recipient.trim());
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const qs = params.toString();
    return qs ? `/api/admin/email?${qs}` : "/api/admin/email";
  }, [filters]);

  const { data, isLoading } = useQuery<ListResponse>({ queryKey: [listKey] });
  const detailKey = selectedId ? `/api/admin/email/${selectedId}` : null;
  const { data: detail } = useQuery<DetailResponse>({
    queryKey: [detailKey ?? "detail-none"],
    enabled: detailKey !== null,
  });

  const templateOptions = useMemo(
    () => Object.entries(EMAIL_TEMPLATE_NAMES).sort((a, b) => a[1].localeCompare(b[1])),
    [],
  );

  function showFailures(): void {
    setFilters({ template: "", status: "failed", recipient: "", from: laDate(7), to: "" });
    setSelectedId(null);
  }

  async function resend(row: DetailResponse): Promise<void> {
    const confirmed = window.confirm(`Resend ${templateDisplayName(row.templateKey)} to ${row.toEmail}?`);
    if (!confirmed) return;
    setResending(true);
    setResendMsg(null);
    try {
      const res = await fetch(`/api/admin/email/${row.id}/resend`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setResendMsg(body?.message ?? "That did not save. Nothing was changed.");
      await queryClient.invalidateQueries({ queryKey: [listKey] });
      if (detailKey) await queryClient.invalidateQueries({ queryKey: [detailKey] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
    } catch {
      setResendMsg("That did not save. Nothing was changed.");
    } finally {
      setResending(false);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="adm-page">
      <h1 className="adm-heading">Email</h1>

      {data && data.failureCount > 0 && (
        <button type="button" className="adm-banner-fail" onClick={showFailures}>
          {data.failureCount} emails failed in the last 7 days.
        </button>
      )}

      <div className="adm-filter-row">
        <label className="adm-filter">
          Template
          <select
            value={filters.template}
            onChange={(e) => setFilters((f) => ({ ...f, template: e.target.value }))}
          >
            <option value="">All templates</option>
            {templateOptions.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-filter">
          Status
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped (disabled)</option>
          </select>
        </label>
        <label className="adm-filter">
          Recipient
          <input
            type="text"
            value={filters.recipient}
            placeholder="Any part of an address"
            onChange={(e) => setFilters((f) => ({ ...f, recipient: e.target.value }))}
          />
        </label>
        <label className="adm-filter">
          From
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="adm-filter">
          To
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
      </div>

      {resendMsg && (
        <p className="adm-result" role="status">
          {resendMsg}
        </p>
      )}

      <div className="adm-email-split">
        <div className="adm-email-table">
          {isLoading ? (
            <p className="adm-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="adm-muted">{data?.anyExist ? "No emails match your filters." : "No emails have been sent yet."}</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Template</th>
                  <th>Recipient</th>
                  <th>Related</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === selectedId ? "adm-row-selected" : undefined}
                    onClick={() => {
                      setSelectedId(row.id);
                      setResendMsg(null);
                    }}
                  >
                    <td>{fmtTimestamp(row.createdAt)}</td>
                    <td>{templateDisplayName(row.templateKey)}</td>
                    <td>{row.toEmail}</td>
                    <td>
                      {row.entity ? (
                        row.entity.path ? (
                          <Link href={row.entity.path} onClick={(e) => e.stopPropagation()}>
                            {row.entity.name}
                          </Link>
                        ) : (
                          row.entity.name
                        )
                      ) : row.entityType ? (
                        <span className="adm-muted">{row.entityType} (no longer exists)</span>
                      ) : (
                        <span className="adm-muted">—</span>
                      )}
                    </td>
                    <td>
                      {row.status}
                      {isStuck(row) && <span className="adm-stuck">Queued but not dispatched.</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {detail && (
          <aside className="adm-email-detail">
            <h2 className="adm-subheading">{templateDisplayName(detail.templateKey)}</h2>
            <dl className="adm-detail-list">
              <dt>Recipient</dt>
              <dd>{detail.toEmail}</dd>
              <dt>Status</dt>
              <dd>
                {detail.status}
                {isStuck(detail) && <span className="adm-stuck">Queued but not dispatched.</span>}
              </dd>
              <dt>Created</dt>
              <dd>{fmtTimestamp(detail.createdAt)}</dd>
              <dt>Sent</dt>
              <dd>{detail.sentAt ? fmtTimestamp(detail.sentAt) : "—"}</dd>
              <dt>Provider message id</dt>
              <dd>{detail.providerMessageId ?? "—"}</dd>
              {detail.error && (
                <>
                  <dt>Error</dt>
                  <dd className="adm-error-text">{detail.error}</dd>
                </>
              )}
              <dt>Related</dt>
              <dd>
                {detail.entity ? (
                  detail.entity.path ? (
                    <Link href={detail.entity.path}>{detail.entity.name}</Link>
                  ) : (
                    detail.entity.name
                  )
                ) : detail.entityType ? (
                  <span className="adm-muted">{detail.entityType} (no longer exists)</span>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
            {detail.status === "failed" && (
              <button type="button" className="adm-btn" disabled={resending} onClick={() => void resend(detail)}>
                {resending ? "Resending…" : "Resend"}
              </button>
            )}
            <h3 className="adm-subheading">Payload</h3>
            <pre className="adm-payload">{JSON.stringify(detail.payload, null, 2)}</pre>
          </aside>
        )}
      </div>
    </div>
  );
}
