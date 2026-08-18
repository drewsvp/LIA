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
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Row = {
  id: string;
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
  return row.orgKind === "platform_owner" ? ["staff_admin", "staff_approver"] : ["owner", "member"];
}

export function RolesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<{ row: Row; toRole: Row["role"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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

  return (
    <div>
      <h1 className="adm-heading">Roles</h1>

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

      {pending && (
        <div className="adm-confirm">
          <p>
            Change {`${pending.row.firstName} ${pending.row.lastName}`.trim()} at {pending.row.orgName} from{" "}
            {ROLE_NAMES[pending.row.role]} to {ROLE_NAMES[pending.toRole]}? The change applies the next time their
            session is resolved.
          </p>
          <button className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void confirmChange()}>
            Change role
          </button>
          <button className="adm-btn" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
