/**
 * ADMIN-03 — MEMBER APPROVAL QUEUE (docs/specs/ADMIN-03.md).
 *
 * Where staff approve people invited to join a member organization (§1).
 * Tabs Pending / Active / Removed (§4); each row names the person, their
 * organization, role, inviter, and invite date. Active organization owners
 * appear as read-only roster entries; owner activation remains part of
 * organization approval, never this member approval workflow. The detail adds the one
 * piece of context that makes this queue safe (§4): the person's other
 * active memberships — a person already active elsewhere is a known
 * quantity. A needs_review flag is information, not a block (§7), so it
 * renders as a line with a link to the People review surface. Approve is
 * disabled with the §8 reason while the organization is not approved (§7:
 * an active membership at an unapproved org would open a dead dashboard).
 * Reject takes an optional note that lands in the audit trail (D15) and
 * sends nothing; reinstate returns a removed row to PENDING (§6), never
 * straight to active, so the approval email still runs.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OrganizationLoginAsControls } from "../../components/OrganizationContext";
import { useSession } from "../../hooks/useSession";
import { ListCount, ListPagination, ListSearch, SortableHeader, type SortDirection } from "../../components/admin/ListControls";
import { invalidateAdminList } from "../../components/admin/invalidateAdminList";

type Tab = "pending" | "active" | "removed";

type QueueRow = {
  id: string;
  status: string;
  role: "owner" | "member";
  createdAt: string;
  firstName: string;
  lastName: string;
  email: string;
  orgName: string;
  orgId: string;
  orgStatus: "pending" | "approved" | "disabled";
  inviterFirstName: string | null;
  inviterLastName: string | null;
};

type Detail = {
  membership: {
    id: string;
    role: string;
    status: string;
    invitedAt: string;
    approvedAt: string | null;
  };
  person: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    needsReview: boolean;
  };
  organization: { id: string; name: string; status: "pending" | "approved" | "disabled" };
  inviter: { name: string } | null;
  otherMemberships: { orgName: string; role: string }[];
};

type PendingConfirm = { kind: "approve" } | { kind: "reject" } | null;

/** §8 verbatim. */
const PENDING_EMPTY = "No members are waiting for approval.";
const FAILURE = "That did not save. Nothing was changed.";
const REVIEW_FLAG = "This person's record is flagged for review.";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";
const DETAIL_ERROR = "Something went wrong loading this member. Please refresh the page and try again.";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function inviterName(row: QueueRow): string {
  const name = `${row.inviterFirstName ?? ""} ${row.inviterLastName ?? ""}`.trim();
  return name === "" ? "—" : name;
}

function roleName(role: string): string {
  return role === "owner" ? "Owner" : "Member";
}

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
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

export function MembersPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [orgId, setOrgId] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"name" | "email" | "organization" | "role" | "inviter" | "createdAt">("createdAt");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const detailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedId !== null) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  const listQuery = useQuery<{ members: QueueRow[]; total: number; organizations: { id: string; name: string; status: string }[] }>({
    queryKey: [`/api/admin/members?status=${tab}&search=${encodeURIComponent(search)}&orgId=${encodeURIComponent(orgId)}&sort=${sort}&direction=${direction}&page=${page}&pageSize=25`],
  });
  const detailQuery = useQuery<Detail>({
    queryKey: [`/api/admin/members/${selectedId}`],
    enabled: selectedId !== null,
  });

  function switchTab(next: Tab) {
    setTab(next);
    setSelectedId(null);
    setConfirm(null);
    setRejectNote("");
    setResult(null);
    setPage(1);
  }

  async function refreshAfterAction() {
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
    await invalidateAdminList(queryClient, "/api/admin/members");
    if (selectedId) {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/members/${selectedId}`] });
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
        setRejectNote("");
      }
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await refreshAfterAction();
    }
  }

  const rows = listQuery.data?.members ?? [];
  const total = listQuery.data?.total ?? rows.length;
  const onSort = (column: typeof sort, next: SortDirection) => { setSort(column); setDirection(next); setPage(1); };
  const detail = detailQuery.data ?? null;
  const person = detail?.person ?? null;
  const personName = person ? `${person.firstName} ${person.lastName}`.trim() : "";

  const orgNotApproved = detail !== null && detail.organization.status !== "approved";

  const emptyLine = tab === "pending" ? PENDING_EMPTY : tab === "active" ? "No active members." : "No removed members.";
  const eligibleOrganizations = Array.from(
    new Map(
      rows
        .filter((row) => row.orgStatus === "approved")
        .map((row) => [row.orgId, { id: row.orgId, name: row.orgName }]),
    ).values(),
  );

  return (
    <div>
      <h1 className="adm-heading">Members</h1>

      <div className="adm-tabs" role="tablist">
        {(["pending", "active", "removed"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "adm-tab adm-tab-current" : "adm-tab"}
            onClick={() => switchTab(t)}
          >
            {t === "pending" ? "Pending" : t === "active" ? "Active" : "Removed"}
          </button>
        ))}
      </div>
      <ListSearch value={search} onChange={value => { setSearch(value); setPage(1); }} onClear={() => { setSearch(""); setOrgId(""); setPage(1); }}>
        <label className="adm-filter">Organization
          <select className="adm-select" value={orgId} onChange={e => { setOrgId(e.target.value); setPage(1); }}>
            <option value="">All organizations</option>
            {(listQuery.data?.organizations ?? []).map(org => <option key={org.id} value={org.id}>{org.name} ({org.status})</option>)}
          </select>
        </label>
      </ListSearch>
      <ListCount count={total} noun="members" />

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="adm-muted">{search || orgId ? "No members match your filters." : emptyLine}</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <SortableHeader label="Name" column="name" sort={sort} direction={direction} onSort={onSort} />
              <SortableHeader label="Email" column="email" sort={sort} direction={direction} onSort={onSort} />
              <SortableHeader label="Organization" column="organization" sort={sort} direction={direction} onSort={onSort} />
              <SortableHeader label="Role" column="role" sort={sort} direction={direction} onSort={onSort} />
              <SortableHeader label="Invited by" column="inviter" sort={sort} direction={direction} onSort={onSort} />
              <SortableHeader label="Invited" column="createdAt" sort={sort} direction={direction} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={selectedId === row.id ? "adm-row adm-row-on" : "adm-row"}
                onClick={() => {
                  setSelectedId(row.id);
                  setConfirm(null);
                  setRejectNote("");
                  setResult(null);
                }}
              >
                <td>{`${row.firstName} ${row.lastName}`.trim()}</td>
                <td>{row.email}</td>
                <td>{row.orgName}</td>
                <td>{roleName(row.role)}</td>
                <td>{inviterName(row)}</td>
                <td>{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ListPagination page={page} pageSize={25} total={total} onPage={setPage} />

      {selectedId !== null && (
        <div className="adm-detail" ref={detailRef}>
          {detailQuery.isError ? (
            <p className="adm-alert">{DETAIL_ERROR}</p>
          ) : detailQuery.isLoading || !detail || !person ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <>
              <h2 className="adm-subheading">{personName}</h2>
              <dl className="adm-kv">
                <dt>Email</dt>
                <dd>{person.email}</dd>
                <dt>Phone</dt>
                <dd>{person.phone ?? "Not provided"}</dd>
                <dt>Organization</dt>
                <dd>
                  {detail.organization.name}
                  {detail.organization.status !== "approved" ? ` (${detail.organization.status})` : ""}
                </dd>
                <dt>Role</dt>
                <dd>{roleName(detail.membership.role)}</dd>
                <dt>Invited by</dt>
                <dd>{detail.inviter?.name ?? "—"}</dd>
                <dt>Invited</dt>
                <dd>{formatDate(detail.membership.invitedAt)}</dd>
                {detail.membership.approvedAt && (
                  <>
                    <dt>Approved</dt>
                    <dd>{formatDate(detail.membership.approvedAt)}</dd>
                  </>
                )}
              </dl>

              {/* §4/§7: the context line that makes this queue safe. */}
              {detail.otherMemberships.length > 0 && (
                <p className="adm-muted">
                  {/* §8 verbatim prefix. */}
                  Also active at: {detail.otherMemberships.map((m) => m.orgName).join(", ")}
                </p>
              )}

              {/* §7: information, not a block. */}
              {person.needsReview && (
                <p className="adm-alert">
                  {REVIEW_FLAG} <a href="/admin/people/review">Open people review</a>
                </p>
              )}

              {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

              <div className="adm-actions">
                {detail.membership.role === "member" && detail.membership.status === "pending" && (
                  <>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || orgNotApproved}
                      onClick={() => setConfirm({ kind: "approve" })}
                    >
                      Approve
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: "reject" })}>
                      Reject
                    </button>
                  </>
                )}
                {detail.membership.role === "member" && detail.membership.status === "removed" && (
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/members/${detail.membership.id}/reinstate`)}
                  >
                    Reinstate
                  </button>
                )}
              </div>

              {/* §7/§8: a stated reason, not just a dead button. */}
              {detail.membership.role === "member" && detail.membership.status === "pending" && orgNotApproved && (
                <p className="adm-alert">
                  {detail.organization.name} is not approved yet, so this membership cannot be activated.
                </p>
              )}

              {detail.membership.role === "member" && confirm?.kind === "approve" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>
                    Approve {personName} at {detail.organization.name}? They will receive login information at{" "}
                    {person.email}.
                  </p>
                  <div className="adm-btn-row">
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy}
                      onClick={() => void act(`/api/admin/members/${detail.membership.id}/approve`)}
                    >
                      Approve
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {detail.membership.role === "member" && confirm?.kind === "reject" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>
                    Reject {personName} at {detail.organization.name}? They will not be notified.
                  </p>
                  <textarea
                    className="adm-note"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    rows={3}
                    placeholder="Optional note for the audit trail"
                    aria-label="Optional rejection note"
                  />
                  <div className="adm-btn-row">
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `/api/admin/members/${detail.membership.id}/reject`,
                          rejectNote.trim() === "" ? undefined : { note: rejectNote.trim() },
                        )
                      }
                    >
                      Reject
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {tab === "active" && session?.staffRole === "staff_admin"
        ? <OrganizationLoginAsControls organizations={eligibleOrganizations} />
        : null}
    </div>
  );
}
