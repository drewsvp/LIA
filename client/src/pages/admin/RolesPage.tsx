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
import { useMemo, useState } from "react";
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

/** The roles a row may legally move to, by its org kind. */
function legalRoles(row: Row): Row["role"][] {
  if (row.orgKind !== "platform_owner") return ["owner", "member"];
  if (row.status === "pending" && row.role === "member") return ["member", "staff_approver"];
  const staffRoles: Row["role"][] = ["staff_admin", "staff_approver"];
  return staffRoles.includes(row.role) ? staffRoles : [row.role, ...staffRoles];
}

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
  const [pending, setPending] = useState<{ row: Row; toRole: Row["role"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Invite form state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteFields, setInviteFields] = useState<InviteFields>(BLANK_INVITE);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const currentUserId = session?.user?.id;
  const currentUserEmail = session?.user?.email;

  const listQuery = useQuery<{ memberships: Row[] }>({ queryKey: ["/api/admin/roles"] });
  const rows = listQuery.data?.memberships ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((r) =>
      [`${r.firstName} ${r.lastName}`, r.email, r.orgName, ROLE_NAMES[r.role]].some((v) =>
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
        body: JSON.stringify({ role: pending.toRole }),
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
        placeholder="Search by name, email, organization, or role"
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
                <td>{row.status}</td>
                <td>
                  <select
                    value={pending?.row.id === row.id ? pending.toRole : row.role}
                    disabled={busy}
                    aria-label={`Role for ${row.firstName} ${row.lastName} at ${row.orgName}`}
                    onChange={(e) => {
                      const toRole = e.target.value as Row["role"];
                      setResult(null);
                      setPending(toRole === row.role ? null : { row, toRole });
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
          currentUserId !== undefined &&
          pending.row.userId === currentUserId &&
          pending.row.role === "staff_admin" &&
          pending.toRole !== "staff_admin";
        const isAllianceInviteConversion =
          pending.row.orgKind === "platform_owner" &&
          pending.row.status === "pending" &&
          pending.row.role === "member" &&
          pending.toRole === "staff_approver";
        return (
          <div className="adm-confirm">
            {isSelfDemotion && (
              <p className="adm-alert">
                Warning: you are demoting your own staff admin role. You will lose admin access the next time your
                session is resolved and will not be able to undo this yourself.
              </p>
            )}
            {isAllianceInviteConversion ? (
              <p>
                Convert {`${pending.row.firstName} ${pending.row.lastName}`.trim()}&apos;s pending member invitation
                at {pending.row.orgName} to Staff approver? This activates the existing account immediately, records
                your approval, and sends the normal staff sign-in email. No duplicate account will be created.
              </p>
            ) : (
              <p>
                Change {`${pending.row.firstName} ${pending.row.lastName}`.trim()} at {pending.row.orgName} from{" "}
                {ROLE_NAMES[pending.row.role]} to {ROLE_NAMES[pending.toRole]}? The change applies the next time their
                session is resolved.
              </p>
            )}
            <button className="adm-btn adm-btn-primary" disabled={busy || isSelfDemotion} onClick={() => void confirmChange()}>
              {isAllianceInviteConversion ? "Convert to Staff approver" : "Change role"}
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
