/**
 * ADMIN-09 — ROLE MANAGEMENT (staff admin only).
 *
 * A searchable list of every membership across every organization — the one
 * place staff roles are visible and changeable. Staff roles (staff_admin /
 * staff_approver) exist only in the platform owner organization; owner /
 * member only in member orgs, so the role selector offers only the roles
 * legal for the row's org kind. The server refuses to demote the last active
 * staff admin; the change takes effect the next time the affected user's
 * session is resolved.
 *
 * An "Invite new staff member" panel above the table lets staff admins
 * onboard new staff directly from the UI (closes O4 from ADMIN-03 §11).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";

type Row = {
  id: string;
  userId: string;
  role: "owner" | "member" | "staff_admin" | "staff_approver";
  status: "pending" | "active" | "removed";
  firstName: string;
  lastName: string;
  email: string;
  orgName: string;
  type: "Staff" | "Member";
  orgKind: "member_org" | "platform_owner";
  orgStatus: "pending" | "approved" | "disabled";
};

const FAILURE = "That did not save. Nothing was changed.";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";

const ROLE_NAMES: Record<Row["role"], string> = {
  owner: "Owner",
  member: "Member",
  staff_admin: "Staff admin",
  staff_approver: "Staff approver",
};

const STATUS_NAMES: Record<Row["status"], string> = {
  pending: "Pending",
  active: "Active",
  removed: "Removed",
};

/** The roles a row may legally move to, by its org kind. */
function legalRoles(row: Row): Row["role"][] {
  if (row.orgKind !== "platform_owner") return ["owner", "member"];
  if (row.status === "pending" && row.role === "member") return ["member", "staff_approver"];
  const staffRoles: Row["role"][] = ["staff_admin", "staff_approver"];
  return staffRoles.includes(row.role) ? staffRoles : [row.role, ...staffRoles];
}

/** Lifecycle choices served by ADMIN-09 for this row's current state. */
function legalStatuses(row: Row): Row["status"][] {
  const allowed = new Set<Row["status"]>([row.status]);
  if (row.status === "pending") {
    allowed.add("removed");
    if (row.orgKind === "member_org" && row.role === "member" && row.orgStatus === "approved") {
      allowed.add("active");
    }
  } else if (row.status === "active") {
    allowed.add("removed");
  } else if (row.orgKind === "member_org" && row.role === "member") {
    allowed.add("pending");
  }
  return (["pending", "active", "removed"] as Row["status"][]).filter((status) => allowed.has(status));
}

type PendingChange =
  | { kind: "role"; row: Row; toRole: Row["role"] }
  | { kind: "status"; row: Row; toStatus: Row["status"] };

type InviteFields = {
  firstName: string;
  lastName: string;
  email: string;
  role: "staff_admin" | "staff_approver";
};

const BLANK_INVITE: InviteFields = { firstName: "", lastName: "", email: "", role: "staff_approver" };

export function RolesPage() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  // Invite form state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteFields, setInviteFields] = useState<InviteFields>(BLANK_INVITE);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const currentUserId = session?.user?.id;
  const currentUserEmail = session?.user?.email;

  useEffect(() => {
    if (pending) {
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [pending]);

  const listQuery = useQuery<{ memberships: Row[] }>({ queryKey: ["/api/admin/roles"] });
  const rows = listQuery.data?.memberships ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((r) =>
      [
        `${r.firstName} ${r.lastName}`,
        r.email,
        r.orgName,
        r.type,
        ROLE_NAMES[r.role],
        STATUS_NAMES[r.status],
      ].some((v) =>
        v.toLowerCase().includes(needle),
      ),
    );
  }, [rows, search]);

  async function confirmChange() {
    if (!pending) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/roles/${pending.row.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pending.kind === "role" ? { role: pending.toRole } : { status: pending.toStatus },
        ),
      });
      let message = FAILURE;
      try {
        const payload = (await res.json()) as { message?: string };
        if (payload.message) message = payload.message;
      } catch {
        /* non-JSON body — keep the generic failure line */
      }
      setResult({ kind: res.ok ? "ok" : "error", text: message });
      if (res.ok) setPending(null);
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
      await queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/admin/members"),
      });
    }
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteResult(null);

    // Client-side self-invite guard
    if (
      currentUserEmail &&
      inviteFields.email.trim().toLowerCase() === currentUserEmail.toLowerCase()
    ) {
      setInviteResult({ kind: "error", text: "You cannot invite yourself via this form." });
      return;
    }

    setInviteBusy(true);
    try {
      const res = await fetch("/api/admin/staff/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: inviteFields.firstName.trim(),
          lastName: inviteFields.lastName.trim(),
          email: inviteFields.email.trim().toLowerCase(),
          role: inviteFields.role,
        }),
      });
      let message = FAILURE;
      try {
        const payload = (await res.json()) as { message?: string };
        if (payload.message) message = payload.message;
      } catch {
        /* non-JSON body */
      }
      if (res.ok) {
        setInviteResult({ kind: "ok", text: message });
        setInviteFields(BLANK_INVITE);
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      } else {
        setInviteResult({ kind: "error", text: message });
      }
    } catch {
      setInviteResult({ kind: "error", text: FAILURE });
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div>
      <h1 className="adm-heading">Roles</h1>

      {/* Invite panel */}
      <div className="adm-panel">
        <button
          className="adm-btn"
          type="button"
          onClick={() => {
            setInviteOpen((o) => !o);
            setInviteResult(null);
          }}
          aria-expanded={inviteOpen}
        >
          {inviteOpen ? "Cancel invite" : "Invite new staff member"}
        </button>

        {inviteOpen && (
          <form onSubmit={(e) => void submitInvite(e)} className="adm-invite-form">
            <div className="adm-invite-fields">
              <label className="adm-label">
                First name
                <input
                  className="adm-note"
                  type="text"
                  value={inviteFields.firstName}
                  onChange={(e) => setInviteFields((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  disabled={inviteBusy}
                  autoComplete="given-name"
                />
              </label>
              <label className="adm-label">
                Last name
                <input
                  className="adm-note"
                  type="text"
                  value={inviteFields.lastName}
                  onChange={(e) => setInviteFields((f) => ({ ...f, lastName: e.target.value }))}
                  required
                  disabled={inviteBusy}
                  autoComplete="family-name"
                />
              </label>
              <label className="adm-label">
                Email address
                <input
                  className="adm-note"
                  type="email"
                  value={inviteFields.email}
                  onChange={(e) => setInviteFields((f) => ({ ...f, email: e.target.value }))}
                  required
                  disabled={inviteBusy}
                  autoComplete="email"
                />
              </label>
              <label className="adm-label">
                Role
                <select
                  className="adm-note"
                  value={inviteFields.role}
                  onChange={(e) =>
                    setInviteFields((f) => ({ ...f, role: e.target.value as InviteFields["role"] }))
                  }
                  disabled={inviteBusy}
                >
                  <option value="staff_approver">Staff approver</option>
                  <option value="staff_admin">Staff admin</option>
                </select>
              </label>
            </div>

            {inviteResult && (
              <p className={inviteResult.kind === "ok" ? "adm-ok" : "adm-alert"}>{inviteResult.text}</p>
            )}

            <button className="adm-btn adm-btn-primary" type="submit" disabled={inviteBusy}>
              {inviteBusy ? "Sending invite…" : "Send invite"}
            </button>
          </form>
        )}
      </div>

      <input
        className="adm-note"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email, organization, type, status, or role"
        aria-label="Search memberships"
      />

      {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="adm-muted">{search.trim() === "" ? "No memberships." : "No memberships match that search."}</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Organization</th>
               <th>Type</th>
              <th>Status</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="adm-row">
                <td>{`${row.firstName} ${row.lastName}`.trim()}</td>
                <td>{row.email}</td>
                <td>{row.orgName}</td>
                 <td>{row.type}</td>
                 <td>
                   <select
                     value={
                       pending?.kind === "status" && pending.row.id === row.id
                         ? pending.toStatus
                         : row.status
                     }
                     disabled={busy}
                     aria-label={`Status for ${row.firstName} ${row.lastName} at ${row.orgName}`}
                     onChange={(e) => {
                       const toStatus = e.target.value as Row["status"];
                       setResult(null);
                       setPending(
                         toStatus === row.status ? null : { kind: "status", row, toStatus },
                       );
                     }}
                   >
                     {legalStatuses(row).map((status) => (
                       <option key={status} value={status}>
                         {STATUS_NAMES[status]}
                       </option>
                     ))}
                   </select>
                 </td>
                <td>
                  <select
                     value={
                       pending?.kind === "role" && pending.row.id === row.id
                         ? pending.toRole
                         : row.role
                     }
                    disabled={busy}
                    aria-label={`Role for ${row.firstName} ${row.lastName} at ${row.orgName}`}
                    onChange={(e) => {
                      const toRole = e.target.value as Row["role"];
                      setResult(null);
                       setPending(
                         toRole === row.role ? null : { kind: "role", row, toRole },
                       );
                    }}
                  >
                    {legalRoles(row).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_NAMES[r]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pending && (() => {
        const isSelfDemotion =
           pending.kind === "role" &&
          currentUserId !== undefined &&
          pending.row.userId === currentUserId &&
          pending.row.role === "staff_admin" &&
          pending.toRole !== "staff_admin";
         const isSelfRemoval =
           pending.kind === "status" &&
           currentUserId !== undefined &&
           pending.row.userId === currentUserId &&
           pending.row.orgKind === "platform_owner" &&
           pending.row.status === "active" &&
           pending.toStatus === "removed";
        const isAllianceInviteConversion =
           pending.kind === "role" &&
          pending.row.orgKind === "platform_owner" &&
          pending.row.status === "pending" &&
          pending.row.role === "member" &&
          pending.toRole === "staff_approver";
        return (
          <div ref={confirmRef} className="adm-confirm">
             {(isSelfDemotion || isSelfRemoval) && (
              <p className="adm-alert">
                 {isSelfRemoval
                   ? "You cannot remove your own staff membership because that would lock you out of staff access."
                   : "Warning: you are demoting your own staff admin role. You will lose admin access the next time your session is resolved and will not be able to undo this yourself."}
              </p>
            )}
            {isAllianceInviteConversion ? (
              <p>
                Convert {`${pending.row.firstName} ${pending.row.lastName}`.trim()}&apos;s pending member invitation
                at {pending.row.orgName} to Staff approver? This activates the existing account immediately, records
                your approval, and sends the normal staff sign-in email. No duplicate account will be created.
              </p>
             ) : pending.kind === "role" ? (
              <p>
                Change {`${pending.row.firstName} ${pending.row.lastName}`.trim()} at {pending.row.orgName} from{" "}
                {ROLE_NAMES[pending.row.role]} to {ROLE_NAMES[pending.toRole]}? The change applies the next time their
                session is resolved.
              </p>
             ) : (
               <p>
                 Change {`${pending.row.firstName} ${pending.row.lastName}`.trim()} at{" "}
                 {pending.row.orgName} from {STATUS_NAMES[pending.row.status]} to{" "}
                 {STATUS_NAMES[pending.toStatus]}?
                 {pending.toStatus === "active"
                   ? " This approves the membership and sends the normal member login email."
                   : pending.toStatus === "pending"
                     ? " This returns the membership to the normal approval queue."
                     : " They will lose access through this membership."}
               </p>
            )}
             <button
               className="adm-btn adm-btn-primary"
               disabled={busy || isSelfDemotion || isSelfRemoval}
               onClick={() => void confirmChange()}
             >
               {isAllianceInviteConversion
                 ? "Convert to Staff approver"
                 : pending.kind === "role"
                   ? "Change role"
                   : "Change status"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        );
      })()}
    </div>
  );
}
