/**
 * ADMIN-01 — ORGANIZATION APPROVAL QUEUE (docs/specs/ADMIN-01.md).
 *
 * Tabs Pending (default) / Approved / Disabled; one row per organization
 * (name, city, contact, submitted); selecting a row loads the full detail —
 * every MP-03 field, populations including any free-text other value labeled
 * as such, missing logo marked "Not provided" (§5, §8). Actions follow the
 * status conditionals exactly: pending → Approve + Disable, approved →
 * Disable only, disabled → Approve (§8). Every action confirms first with
 * the spec's verbatim copy and states its outcome in place, including what
 * happened to the welcome email (§4, §9). Staying on the queue after each
 * action is deliberate — staff work through several at a sitting (§2).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";

type QueueRow = {
  id: string;
  name: string;
  city: string | null;
  status: "pending" | "approved" | "disabled";
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  createdAt: string;
};

type Detail = {
  organization: {
    id: string;
    name: string;
    websiteUrl: string | null;
    mission: string | null;
    phone: string | null;
    logoUrl: string | null;
    populationsOther: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    addressFormatted: string | null;
    status: "pending" | "approved" | "disabled";
    approvedAt: string | null;
    createdAt: string;
  };
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  populations: { id: string; name: string }[];
};

type Tab = "pending" | "approved" | "disabled";
type PendingAction = { kind: "approve" | "disable" } | null;

/** §9 verbatim. */
const NOT_PROVIDED = "Not provided";
const PENDING_EMPTY = "No organizations are waiting for approval.";
const FAILURE = "That did not save. Nothing was changed.";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";
const DETAIL_ERROR = "Something went wrong loading this organization. Please refresh the page and try again.";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

/** Pull the server's message out of apiRequest's "STATUS: body" error text. */
function serverMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const body = text.slice(text.indexOf(":") + 1).trim();
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message !== "") return parsed.message;
  } catch {
    /* not JSON — fall through */
  }
  return FAILURE;
}

function addressText(org: Detail["organization"]): string | null {
  if (org.addressFormatted) return org.addressFormatted;
  const cityLine = [org.city, org.state].filter(Boolean).join(", ");
  const parts = [org.addressLine1, org.addressLine2, [cityLine, org.postalCode].filter(Boolean).join(" ")].filter(
    (p) => p && p !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function OrganizationsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selectedId !== null) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  const listQuery = useQuery<{ organizations: QueueRow[] }>({
    queryKey: [`/api/admin/organizations?status=${tab}`],
  });
  const detailQuery = useQuery<Detail>({
    queryKey: [`/api/admin/organizations/${selectedId}`],
    enabled: selectedId !== null,
  });

  function switchTab(next: Tab) {
    setTab(next);
    setSelectedId(null);
    setPendingAction(null);
    setResult(null);
  }

  function selectRow(id: string) {
    setSelectedId(id);
    setPendingAction(null);
    setResult(null);
  }

  async function runAction(kind: "approve" | "disable") {
    if (!selectedId || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", `/api/admin/organizations/${selectedId}/${kind}`);
      const body = (await res.json()) as { message: string };
      setResult({ kind: "ok", text: body.message });
    } catch (err) {
      setResult({ kind: "error", text: serverMessage(err) });
    } finally {
      setBusy(false);
      setPendingAction(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations/${selectedId}`] });
      for (const status of ["pending", "approved", "disabled"]) {
        await queryClient.invalidateQueries({ queryKey: [`/api/admin/organizations?status=${status}`] });
      }
    }
  }

  const rows = listQuery.data?.organizations ?? [];
  const detail = detailQuery.data ?? null;
  const org = detail?.organization ?? null;
  const contact = detail?.contact ?? null;
  const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : null;

  return (
    <main className="adm-page">
      <h1 className="adm-heading">Organizations</h1>

      <div className="adm-tabs" role="tablist" aria-label="Organization status">
        {(["pending", "approved", "disabled"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "adm-tab adm-tab-current" : "adm-tab"}
            onClick={() => switchTab(t)}
          >
            {t === "pending" ? "Pending" : t === "approved" ? "Approved" : "Disabled"}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <p className="adm-note">Loading…</p>
      ) : listQuery.isError ? (
        <p className="adm-danger">{LIST_ERROR}</p>
      ) : rows.length === 0 ? (
        <p className="adm-note">
          {tab === "pending" ? PENDING_EMPTY : tab === "approved" ? "No approved organizations." : "No disabled organizations."}
        </p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>City</th>
              <th>Primary contact</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowContact = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ");
              return (
                <tr
                  key={row.id}
                  className={selectedId === row.id ? "adm-row adm-row-selected" : "adm-row"}
                  onClick={() => selectRow(row.id)}
                >
                  <td>{row.name}</td>
                  <td>{row.city ?? "—"}</td>
                  <td>{rowContact !== "" ? rowContact : "—"}</td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {selectedId !== null && (
        <section className="adm-detail" aria-label="Organization detail" ref={detailRef}>
          {detailQuery.isLoading ? (
            <p className="adm-note">Loading…</p>
          ) : detailQuery.isError || !org ? (
            <p className="adm-danger">{DETAIL_ERROR}</p>
          ) : (
            <>
              <h2 className="adm-detail-heading">{org.name}</h2>
              <dl className="adm-fields">
                <dt>Website</dt>
                <dd>
                  {org.websiteUrl ? (
                    <a href={org.websiteUrl} target="_blank" rel="noreferrer">
                      {org.websiteUrl}
                    </a>
                  ) : (
                    NOT_PROVIDED
                  )}
                </dd>
                <dt>Mission</dt>
                <dd>{org.mission ?? NOT_PROVIDED}</dd>
                <dt>Populations</dt>
                <dd>{detail!.populations.length > 0 ? detail!.populations.map((p) => p.name).join(", ") : NOT_PROVIDED}</dd>
                {org.populationsOther && (
                  <>
                    <dt>Other (free text)</dt>
                    <dd>{org.populationsOther}</dd>
                  </>
                )}
                <dt>Logo</dt>
                <dd>{org.logoUrl ? <img src={org.logoUrl} alt={`${org.name} logo`} className="adm-logo" /> : NOT_PROVIDED}</dd>
                <dt>Address</dt>
                <dd>{addressText(org) ?? NOT_PROVIDED}</dd>
                <dt>Phone</dt>
                <dd>{org.phone ?? NOT_PROVIDED}</dd>
                <dt>Primary contact</dt>
                <dd>{contactName && contactName !== "" ? contactName : NOT_PROVIDED}</dd>
                <dt>Contact email</dt>
                <dd>{contact?.email ?? NOT_PROVIDED}</dd>
                <dt>Contact phone</dt>
                <dd>{contact?.phone ?? NOT_PROVIDED}</dd>
                <dt>Submitted</dt>
                <dd>{formatDate(org.createdAt)}</dd>
                {org.approvedAt && (
                  <>
                    <dt>Approved on</dt>
                    <dd>{formatDate(org.approvedAt)}</dd>
                  </>
                )}
              </dl>

              <div className="adm-actions">
                {result && <p className={result.kind === "ok" ? "adm-result" : "adm-danger"}>{result.text}</p>}

                {pendingAction === null ? (
                  <div className="adm-btn-row">
                    {(org.status === "pending" || org.status === "disabled") && (
                      <button type="button" className="adm-btn" onClick={() => setPendingAction({ kind: "approve" })}>
                        Approve
                      </button>
                    )}
                    {(org.status === "pending" || org.status === "approved") && (
                      <button
                        type="button"
                        className="adm-btn adm-btn-outline"
                        onClick={() => setPendingAction({ kind: "disable" })}
                      >
                        Disable
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="adm-confirm">
                    <p className="adm-confirm-text">
                      {pendingAction.kind === "approve"
                        ? `Approve ${org.name}? This publishes the organization and emails ${contactName ?? NOT_PROVIDED} at ${contact?.email ?? NOT_PROVIDED}.`
                        : `Disable ${org.name}? Their active requests will stop appearing publicly. No email is sent.`}
                    </p>
                    <div className="adm-btn-row">
                      <button
                        type="button"
                        className="adm-btn"
                        disabled={busy}
                        onClick={() => void runAction(pendingAction.kind)}
                      >
                        {busy ? "Saving…" : pendingAction.kind === "approve" ? "Confirm approve" : "Confirm disable"}
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn-outline"
                        disabled={busy}
                        onClick={() => setPendingAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
