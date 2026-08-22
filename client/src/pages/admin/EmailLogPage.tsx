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
import type { EmailFailureCategory } from "@shared/types";

type LogRow = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  templateKey: string;
  toEmail: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  error: string | null;
  failureCategory: EmailFailureCategory | null;
  resendOfId: string | null;
  entityType: string | null;
  entityId: string | null;
  entity: { name: string; path: string | null } | null;
};

type ResendEligibility = { allowed: true } | { allowed: false; reason: string };

type ResendAttempt = {
  id: string;
  createdAt: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  toEmail: string;
  error: string | null;
  sentAt: string | null;
};

type ListResponse = { rows: LogRow[]; failureCount: number; anyExist: boolean };

type PreviewResponse =
  | { subject: string; html: string; previewUnavailable?: never }
  | { previewUnavailable: true; reason: string; subject?: never; html?: never };

type DetailResponse = LogRow & {
  payload: Record<string, unknown>;
  providerMessageId: string | null;
  toPersonId: string | null;
  resendEligibility: ResendEligibility;
  resendAttempt: ResendAttempt | null;
};

const STUCK_MS = 15 * 60 * 1000;

/** Human-readable label for a failure category. */
const CATEGORY_LABELS: Record<EmailFailureCategory, string> = {
  config: "Configuration error",
  render: "Template error",
  provider_timeout: "Provider timeout",
  provider: "Provider error",
  sweep: "Stranded send",
};

/**
 * Plain-language explanation of what each category means for an admin reading
 * a failed email row.
 */
const CATEGORY_EXPLANATIONS: Record<EmailFailureCategory, string> = {
  config:
    "A required server configuration was missing when this email was attempted — typically an environment variable such as EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, or POSTMARK_SERVER_TOKEN. Fix the configuration and resend.",
  render:
    "The email template could not be rendered because a required variable was missing, empty, or the template itself threw an error. This usually means the underlying data changed between when the action was taken and when the email was dispatched.",
  provider_timeout:
    "The request to the email provider timed out before a response arrived. The provider may or may not have delivered this email — verify in the Postmark dashboard before resending to avoid a duplicate.",
  provider:
    "The email provider returned an error or the network connection failed during the send attempt. Check the error detail below and the Postmark dashboard for more context.",
  sweep:
    "The application restarted or the process stopped while this email was mid-send. If the row was in 'sending' state, the provider may have already delivered it — verify before resending.",
};

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

/** Inline badge for a failure category — compact, coloured label for the list. */
function CategoryBadge({ category }: { category: EmailFailureCategory }): ReactElement {
  return (
    <span className="adm-category-badge" data-category={category} title={CATEGORY_EXPLANATIONS[category]}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/** Status cell text with stuck indicator. */
function StatusCell({ row }: { row: LogRow }): ReactElement {
  return (
    <>
      {row.status}
      {isStuck(row) && <span className="adm-stuck"> Queued but not dispatched.</span>}
      {row.status === "failed" && row.failureCategory && (
        <>
          {" "}
          <CategoryBadge category={row.failureCategory} />
        </>
      )}
    </>
  );
}

export function EmailLogPage(): ReactElement {
  const [filters, setFilters] = useState(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "preview">("details");
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendOk, setResendOk] = useState<boolean | null>(null);
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

  const previewKey = selectedId ? `/api/admin/email/${selectedId}/preview` : null;
  const {
    data: previewData,
    isLoading: previewLoading,
    isError: previewError,
  } = useQuery<PreviewResponse>({
    queryKey: [previewKey ?? "preview-none"],
    enabled: previewKey !== null && detailTab === "preview",
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
    setResendOk(null);
    try {
      const res = await fetch(`/api/admin/email/${row.id}/resend`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      const msg = body?.message ?? "That did not save. Nothing was changed.";
      setResendMsg(msg);
      setResendOk(res.ok && msg.startsWith("Sent"));
      await queryClient.invalidateQueries({ queryKey: [listKey] });
      if (detailKey) await queryClient.invalidateQueries({ queryKey: [detailKey] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
    } catch {
      setResendMsg("That did not save. Nothing was changed.");
      setResendOk(false);
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
        <p className={`adm-result${resendOk === false ? " adm-result-fail" : ""}`} role="status">
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
                    className={[
                      row.id === selectedId ? "adm-row-selected" : "",
                      row.status === "failed" ? "adm-row-failed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    onClick={() => {
                      setSelectedId(row.id);
                      setDetailTab("details");
                      setResendMsg(null);
                      setResendOk(null);
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
                      <StatusCell row={row} />
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

            <div className="adm-tabs">
              <button
                type="button"
                className={`adm-tab${detailTab === "details" ? " adm-tab-current" : ""}`}
                onClick={() => setDetailTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`adm-tab${detailTab === "preview" ? " adm-tab-current" : ""}`}
                onClick={() => setDetailTab("preview")}
              >
                Preview email
              </button>
            </div>

            {detailTab === "preview" && (
              <div className="adm-email-log-preview">
                {previewLoading && <p className="adm-muted">Loading preview…</p>}
                {previewError && (
                  <p className="adm-result adm-result-fail">
                    The preview could not be loaded. Check your connection and try again.
                  </p>
                )}
                {previewData && previewData.previewUnavailable && (
                  <p className="adm-muted">{previewData.reason}</p>
                )}
                {previewData && !previewData.previewUnavailable && (
                  <>
                    <dl className="adm-detail-list">
                      <dt>Subject</dt>
                      <dd>{previewData.subject}</dd>
                    </dl>
                    <iframe
                      title="Email preview"
                      srcDoc={previewData.html}
                      sandbox="allow-same-origin"
                      style={{ width: "100%", height: 480, border: "1px solid #ccc", background: "#fff" }}
                    />
                    <button
                      type="button"
                      className="adm-link-btn adm-preview-newtab"
                      onClick={() => {
                        const blob = new Blob([previewData.html], { type: "text/html" });
                        const url = URL.createObjectURL(blob);
                        const tab = window.open(url, "_blank", "noopener,noreferrer");
                        // Revoke after the tab has had time to load
                        if (tab) {
                          tab.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
                        } else {
                          setTimeout(() => URL.revokeObjectURL(url), 10_000);
                        }
                      }}
                    >
                      Open in new tab ↗
                    </button>
                  </>
                )}
              </div>
            )}

            {detailTab === "details" && (
              <>
            {/* Failure diagnosis block */}
            {detail.status === "failed" && (
              <div className="adm-failure-block">
                <div className="adm-failure-header">
                  {detail.failureCategory ? (
                    <>
                      <CategoryBadge category={detail.failureCategory} />
                      <span className="adm-failure-title">{CATEGORY_LABELS[detail.failureCategory]}</span>
                    </>
                  ) : (
                    <span className="adm-failure-title">Send failed</span>
                  )}
                </div>
                {detail.failureCategory && (
                  <p className="adm-failure-explanation">{CATEGORY_EXPLANATIONS[detail.failureCategory]}</p>
                )}
                {detail.error && (
                  <details className="adm-failure-detail">
                    <summary>Error detail</summary>
                    <pre className="adm-error-text">{detail.error}</pre>
                  </details>
                )}
              </div>
            )}

            {/* Resend action */}
            {detail.status === "failed" && (
              <div className="adm-resend-block">
                {detail.resendEligibility.allowed ? (
                  <>
                    <button
                      type="button"
                      className="adm-btn adm-btn-resend"
                      disabled={resending}
                      onClick={() => void resend(detail)}
                    >
                      {resending ? "Resending…" : "Resend this email"}
                    </button>
                    <p className="adm-resend-note">
                      The email will be re-built from current data and sent as a new attempt. The original failed row
                      stays unchanged.
                    </p>
                  </>
                ) : (
                  <div className="adm-resend-blocked">
                    <span className="adm-resend-blocked-label">Resend blocked</span>
                    <p className="adm-resend-blocked-reason">{detail.resendEligibility.reason}</p>
                  </div>
                )}
              </div>
            )}

            {/* Linked resend attempt */}
            {detail.resendAttempt && (
              <div className="adm-resend-attempt">
                <h3 className="adm-subheading adm-subheading-sm">Resend attempt</h3>
                <dl className="adm-detail-list">
                  <dt>Time</dt>
                  <dd>{fmtTimestamp(detail.resendAttempt.createdAt)}</dd>
                  <dt>Status</dt>
                  <dd className={detail.resendAttempt.status === "failed" ? "adm-error-text" : undefined}>
                    {detail.resendAttempt.status}
                    {detail.resendAttempt.status === "sent" && detail.resendAttempt.sentAt && (
                      <> · sent {fmtTimestamp(detail.resendAttempt.sentAt)}</>
                    )}
                  </dd>
                  {detail.resendAttempt.error && (
                    <>
                      <dt>Error</dt>
                      <dd className="adm-error-text">{detail.resendAttempt.error}</dd>
                    </>
                  )}
                  <dt>Row</dt>
                  <dd>
                    <button
                      type="button"
                      className="adm-link-btn"
                      onClick={() => {
                        setSelectedId(detail.resendAttempt!.id);
                        setDetailTab("details");
                        setResendMsg(null);
                        setResendOk(null);
                      }}
                    >
                      View resend row →
                    </button>
                  </dd>
                </dl>
              </div>
            )}

            {/* Original failed row this is a resend of */}
            {detail.resendOfId && (
              <div className="adm-resend-origin">
                <button
                  type="button"
                  className="adm-link-btn"
                  onClick={() => {
                    setSelectedId(detail.resendOfId!);
                    setDetailTab("details");
                    setResendMsg(null);
                    setResendOk(null);
                  }}
                >
                  ← View original failed row
                </button>
              </div>
            )}

            <dl className="adm-detail-list">
              <dt>Recipient</dt>
              <dd>{detail.toEmail}</dd>
              <dt>Status</dt>
              <dd>
                <StatusCell row={detail} />
              </dd>
              <dt>Created</dt>
              <dd>{fmtTimestamp(detail.createdAt)}</dd>
              <dt>Sent</dt>
              <dd>{detail.sentAt ? fmtTimestamp(detail.sentAt) : "—"}</dd>
              <dt>Provider message id</dt>
              <dd>{detail.providerMessageId ?? "—"}</dd>
              {/* Error shown in failure block above for failed rows; show here for other statuses */}
              {detail.status !== "failed" && detail.error && (
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

            <h3 className="adm-subheading">Payload</h3>
            <pre className="adm-payload">{JSON.stringify(detail.payload, null, 2)}</pre>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
