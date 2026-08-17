/**
 * ADMIN-02 — REQUEST APPROVAL QUEUE (docs/specs/ADMIN-02.md).
 *
 * Both request types share one queue (§1); the type filter narrows in place
 * and the status tabs are Pending (default) / Active / Archived (§4). The
 * detail panel shows the request the way the public will see it — image
 * included — because staff review the actual output, not a field list (§4),
 * and routinely add a themed image before approving (§5): the upload is the
 * single editable thing on this surface and writes image_url only (D11).
 * Approve confirms with the §8 copy naming the recipients; return-to-draft
 * demands a note and reminds the operator that no email goes out (D45);
 * archive confirms it stops public display; reinstate is archived-tab only.
 * Every result lands in place, verbatim from §8 where the spec binds it.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type RequestKind = "item" | "volunteer";
type Tab = "pending" | "active" | "archived";
type TypeFilter = "all" | "item" | "volunteer";

type QueueRow = {
  type: RequestKind;
  id: string;
  title: string;
  status: string;
  submittedAt: string | null;
  createdAt: string;
  orgId: string;
  orgName: string;
  orgCity: string | null;
  orgStatus: "pending" | "approved" | "disabled";
  childCount: number;
};

type ItemChild = {
  id: string;
  name: string;
  description: string | null;
  condition: string | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityReceived: number;
  quantityRemaining: number;
};

type RoleChild = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityConfirmed: number;
  quantityRemaining: number;
};

type Detail = {
  type: RequestKind;
  request: {
    id: string;
    title: string;
    description: string | null;
    details?: string | null;
    imageUrl: string | null;
    dropoffLocation?: string | null;
    eventLocation?: string | null;
    peopleHelped: number | null;
    deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
    deadlineDate: string | null;
    expiresOn: string | null;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    archivedReason: string | null;
  };
  organization: { id: string; name: string; city: string | null; status: "pending" | "approved" | "disabled" };
  orgContact: { name: string; email: string } | null;
  creator: { name: string; email: string } | null;
  requestContact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  children: ItemChild[] | RoleChild[];
};

type PendingConfirm = { kind: "approve" | "archive" } | null;

/** §8 verbatim. */
const PENDING_EMPTY = "No requests are waiting for approval.";
const FAILURE = "That did not save. Nothing was changed.";
const RETURN_PROMPT =
  "What needs to change? This note is saved to the request history. The organization is not emailed, so contact them directly.";
const NOT_PROVIDED = "Not provided";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";
const DETAIL_ERROR = "Something went wrong loading this request. Please refresh the page and try again.";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function deadlineLabel(detail: Detail["request"]): string {
  if (detail.deadlineType === "date_specific") return formatDate(detail.deadlineDate);
  return detail.deadlineType === "until_fulfilled" ? "Until fulfilled" : "Ongoing";
}

async function postJson(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: { message?: string } = {};
  try {
    payload = (await res.json()) as { message?: string };
  } catch {
    /* non-JSON body — fall through to the generic failure line */
  }
  return { ok: res.ok, message: payload.message ?? FAILURE };
}

export function RequestsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selected, setSelected] = useState<{ type: RequestKind; id: string } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const listQuery = useQuery<{ requests: QueueRow[] }>({
    queryKey: [`/api/admin/requests?status=${tab}`],
  });
  const detailQuery = useQuery<Detail>({
    queryKey: [`/api/admin/requests/${selected?.type}/${selected?.id}`],
    enabled: selected !== null,
  });

  function switchTab(next: Tab) {
    setTab(next);
    resetPanel();
  }

  function resetPanel() {
    setSelected(null);
    setConfirm(null);
    setReturning(false);
    setNote("");
    setResult(null);
  }

  async function refreshAfterAction() {
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
    for (const status of ["pending", "active", "archived"]) {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/requests?status=${status}`] });
    }
    if (selected) {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/requests/${selected.type}/${selected.id}`] });
    }
  }

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setResult(null);
    try {
      const { ok, message } = await postJson(path, body);
      setResult({ kind: ok ? "ok" : "error", text: message });
      if (ok) {
        setConfirm(null);
        setReturning(false);
        setNote("");
      }
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await refreshAfterAction();
    }
  }

  async function uploadImage(file: File) {
    if (!selected) return;
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`/api/admin/requests/${selected.type}/${selected.id}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      let payload: { message?: string } = {};
      try {
        payload = (await res.json()) as { message?: string };
      } catch {
        /* fall through */
      }
      setResult({ kind: res.ok ? "ok" : "error", text: payload.message ?? FAILURE });
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      await refreshAfterAction();
    }
  }

  const rows = listQuery.data?.requests ?? [];
  const visible = rows.filter((r) => typeFilter === "all" || r.type === typeFilter);
  const detail = detailQuery.data ?? null;
  const request = detail?.request ?? null;

  // §6/§7: recipients preview for the approve confirmation, resolved the way
  // the server resolves them — contact then creator, deduped by address.
  const recipientEmails: string[] = [];
  if (detail) {
    for (const email of [detail.orgContact?.email, detail.creator?.email]) {
      if (email && !recipientEmails.some((e) => e.toLowerCase() === email.toLowerCase())) {
        recipientEmails.push(email);
      }
    }
  }
  const recipientsText =
    recipientEmails.length === 2
      ? `${recipientEmails[0]} and ${recipientEmails[1]}`
      : recipientEmails.length === 1
        ? recipientEmails[0]
        : "no one — no contact is on file";

  const orgNotApproved = detail !== null && detail.organization.status !== "approved";
  const noChildren = detail !== null && detail.children.length === 0;
  const approveBlockedReason = detail
    ? orgNotApproved
      ? `${detail.organization.name} is not approved yet, so this request cannot be published.`
      : noChildren
        ? detail.type === "item"
          ? "This request has no items and cannot be approved."
          : "This request has no roles and cannot be approved."
        : null
    : null;

  const emptyLine =
    tab === "pending" ? PENDING_EMPTY : tab === "active" ? "No active requests." : "No archived requests.";

  return (
    <div>
      <h1 className="adm-heading">Requests</h1>

      <div className="adm-tabs" role="tablist">
        {(["pending", "active", "archived"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "adm-tab adm-tab-on" : "adm-tab"}
            onClick={() => switchTab(t)}
          >
            {t === "pending" ? "Pending" : t === "active" ? "Active" : "Archived"}
          </button>
        ))}
      </div>

      <div className="adm-filter" role="group" aria-label="Type filter">
        {(["all", "item", "volunteer"] as TypeFilter[]).map((f) => (
          <button
            key={f}
            className={typeFilter === f ? "adm-filterbtn adm-filterbtn-on" : "adm-filterbtn"}
            onClick={() => setTypeFilter(f)}
          >
            {f === "all" ? "All" : f === "item" ? "Items" : "Volunteer"}
          </button>
        ))}
      </div>

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="adm-muted">{emptyLine}</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Organization</th>
              <th>Submitted</th>
              <th>{typeFilter === "volunteer" ? "Roles" : typeFilter === "item" ? "Items" : "Items / roles"}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.type}-${row.id}`}
                className={selected?.id === row.id ? "adm-row adm-row-on" : "adm-row"}
                onClick={() => {
                  setSelected({ type: row.type, id: row.id });
                  setConfirm(null);
                  setReturning(false);
                  setNote("");
                  setResult(null);
                }}
              >
                <td>{row.type === "item" ? "Item" : "Volunteer"}</td>
                <td>{row.title}</td>
                <td>
                  {row.orgName}
                  {row.orgCity ? ` — ${row.orgCity}` : ""}
                </td>
                <td>{formatDate(row.submittedAt)}</td>
                <td>{row.childCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected !== null && (
        <div className="adm-detail">
          {detailQuery.isError ? (
            <p className="adm-alert">{DETAIL_ERROR}</p>
          ) : detailQuery.isLoading || !detail || !request ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <>
              {/* §4: the request as the public will see it, image included. */}
              <h2 className="adm-subheading">{request.title}</h2>
              <p className="adm-muted">
                {detail.type === "item" ? "Item request" : "Volunteer request"} · {detail.organization.name}
                {detail.organization.city ? ` — ${detail.organization.city}` : ""}
              </p>
              {request.imageUrl ? (
                <img className="adm-img" src={request.imageUrl} alt={request.title} />
              ) : (
                <p className="adm-muted">Image: {NOT_PROVIDED}</p>
              )}
              {request.description ? <p>{request.description}</p> : <p className="adm-muted">Description: {NOT_PROVIDED}</p>}
              {detail.type === "volunteer" &&
                (request.details ? <p>{request.details}</p> : <p className="adm-muted">Details: {NOT_PROVIDED}</p>)}

              <dl className="adm-kv">
                <dt>Deadline</dt>
                <dd>{deadlineLabel(request)}</dd>
                {detail.type === "item" ? (
                  <>
                    <dt>Drop-off location</dt>
                    <dd>{request.dropoffLocation ?? NOT_PROVIDED}</dd>
                  </>
                ) : (
                  <>
                    <dt>Event location</dt>
                    <dd>{request.eventLocation ?? NOT_PROVIDED}</dd>
                  </>
                )}
                <dt>People helped</dt>
                <dd>{request.peopleHelped ?? NOT_PROVIDED}</dd>
                <dt>Request contact</dt>
                <dd>
                  {detail.requestContact
                    ? `${detail.requestContact.firstName} ${detail.requestContact.lastName} · ${detail.requestContact.email}${detail.requestContact.phone ? ` · ${detail.requestContact.phone}` : ""}`
                    : NOT_PROVIDED}
                </dd>
                <dt>Submitted</dt>
                <dd>{formatDate(request.submittedAt)}</dd>
                <dt>Created by</dt>
                <dd>{detail.creator ? `${detail.creator.name} · ${detail.creator.email}` : NOT_PROVIDED}</dd>
                {request.approvedAt && (
                  <>
                    <dt>Approved</dt>
                    <dd>{formatDate(request.approvedAt)}</dd>
                  </>
                )}
              </dl>

              {detail.type === "item" ? (
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Condition</th>
                      <th>Requested</th>
                      <th>Claimed</th>
                      <th>Received</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.children as ItemChild[]).map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.name}
                          {item.productUrl ? (
                            <>
                              {" "}
                              <a href={item.productUrl} target="_blank" rel="noreferrer">
                                link
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td>{item.condition ?? "—"}</td>
                        <td>{item.quantityRequested}</td>
                        <td>{item.quantityClaimed}</td>
                        <td>{item.quantityReceived}</td>
                        <td>{item.quantityRemaining}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Needed</th>
                      <th>Interested</th>
                      <th>Confirmed</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.children as RoleChild[]).map((role) => (
                      <tr key={role.id}>
                        <td>{role.name}</td>
                        <td>{role.quantityNeeded}</td>
                        <td>{role.quantityInterested}</td>
                        <td>{role.quantityConfirmed}</td>
                        <td>{role.quantityRemaining}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* §5: the one editable field — staff image, pending or active. */}
              {(request.status === "pending" || request.status === "active") && (
                <p className="adm-upload">
                  <label htmlFor="adm-request-image">Add or replace the image (saved immediately):</label>{" "}
                  <input
                    id="adm-request-image"
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadImage(file);
                    }}
                  />
                </p>
              )}

              {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

              <div className="adm-actions">
                {request.status === "pending" && (
                  <>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || approveBlockedReason !== null}
                      onClick={() => setConfirm({ kind: "approve" })}
                    >
                      Approve
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setReturning(true)}>
                      Return to draft
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: "archive" })}>
                      Archive
                    </button>
                  </>
                )}
                {request.status === "active" && (
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: "archive" })}>
                    Archive
                  </button>
                )}
                {request.status === "archived" && (
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/reinstate`)}
                  >
                    Reinstate
                  </button>
                )}
              </div>

              {/* §7: blocked reasons stated, not just a dead button. */}
              {request.status === "pending" && approveBlockedReason && (
                <p className="adm-alert">{approveBlockedReason}</p>
              )}

              {confirm?.kind === "approve" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>
                    Approve {request.title}? This publishes the request and emails {recipientsText}.
                  </p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/approve`)}
                  >
                    Approve
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {confirm?.kind === "archive" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>Archive {request.title}? It will stop appearing publicly. No email is sent.</p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/archive`)}
                  >
                    Archive
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {returning && (
                <div className="adm-confirm">
                  {/* §8 verbatim — the D45 reminder that Christina owns outreach. */}
                  <p>{RETURN_PROMPT}</p>
                  <textarea
                    className="adm-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    aria-label="Return-to-draft note"
                  />
                  <div>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || note.trim() === ""}
                      onClick={() =>
                        void act(`/api/admin/requests/${detail.type}/${request.id}/return-to-draft`, {
                          note: note.trim(),
                        })
                      }
                    >
                      Return to draft
                    </button>
                    <button
                      className="adm-btn"
                      disabled={busy}
                      onClick={() => {
                        setReturning(false);
                        setNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
