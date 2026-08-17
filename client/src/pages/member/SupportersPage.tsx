/**
 * MP-13 — YOUR DONORS/VOLUNTEERS (docs/specs/MP-13.md).
 *
 * Read-only. Two independent tables, one per branch: item donors and
 * volunteers. Each table loads from its own endpoint and fails on its own —
 * a failed query renders a stated error, never an empty table, which would
 * be indistinguishable from having no supporters (§12). Empty states render
 * independently (§9); a newly approved organization sees both at once.
 *
 * Desktop capture (docs/screenshots/MP-13-desktop.png): items cell renders
 * one line per pledged item, `{quantity}x {item name}`, no separators (§5);
 * roles cell is comma-separated role names verbatim from the source data.
 * Dates are MM/DD/YYYY. No control exists beyond Back (§6). The mobile
 * capture named in the spec does not exist on disk, so mobile follows §10's
 * stated default: each row becomes a stacked card with labeled fields, no
 * columns dropped, Notes stays visible.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";

type DonorRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  requestTitle: string;
  lines: { itemName: string; quantity: number }[];
  createdAt: string;
};

type VolunteerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  requestTitle: string;
  roles: { roleName: string }[];
  createdAt: string;
};

type TableState<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: T[] };

const TABLE_ERROR = "Something went wrong loading this table. Please refresh the page and try again.";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function SupportersPage() {
  const [donors, setDonors] = useState<TableState<DonorRow>>({ kind: "loading" });
  const [volunteers, setVolunteers] = useState<TableState<VolunteerRow>>({ kind: "loading" });
  const [orgName, setOrgName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/supporters/donors", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { orgName: string; donors: DonorRow[] };
      })
      .then((data) => {
        if (cancelled) return;
        setOrgName((prev) => prev || data.orgName);
        setDonors({ kind: "ready", rows: data.donors });
      })
      .catch(() => {
        if (!cancelled) setDonors({ kind: "error" });
      });
    fetch("/api/dashboard/supporters/volunteers", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { orgName: string; volunteers: VolunteerRow[] };
      })
      .then((data) => {
        if (cancelled) return;
        setOrgName((prev) => prev || data.orgName);
        setVolunteers({ kind: "ready", rows: data.volunteers });
      })
      .catch(() => {
        if (!cancelled) setVolunteers({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mp13-page">
      <div className="mp11-band">
        <h1 className="mp11-band-title">YOUR DONORS/VOLUNTEERS</h1>
      </div>

      <div className="mp13-util">
        <Link href="/dashboard" className="mp13-back">
          &lt; Back
        </Link>
        <span className="mp13-org">{orgName}</span>
      </div>

      <section className="mp13-section">
        <h2 className="mp13-heading">ITEM DONORS</h2>
        {donors.kind === "error" && <p className="mp13-error">{TABLE_ERROR}</p>}
        {donors.kind === "ready" && donors.rows.length === 0 && <p className="mp13-empty">No item donors yet.</p>}
        {donors.kind === "ready" && donors.rows.length > 0 && (
          <table className="mp13-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone Number</th>
                <th>Request</th>
                <th>Items</th>
                <th>Claimed Date</th>
              </tr>
            </thead>
            <tbody>
              {donors.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Name">{`${row.firstName} ${row.lastName}`.trim()}</td>
                  <td data-label="Email">{row.email}</td>
                  <td data-label="Phone Number">{row.phone ?? ""}</td>
                  <td data-label="Request">{row.requestTitle}</td>
                  <td data-label="Items">
                    {row.lines.map((line, i) => (
                      <span className="mp13-line" key={i}>
                        {line.quantity}x {line.itemName}
                      </span>
                    ))}
                  </td>
                  <td data-label="Claimed Date">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mp13-section">
        <h2 className="mp13-heading">VOLUNTEERS</h2>
        {volunteers.kind === "error" && <p className="mp13-error">{TABLE_ERROR}</p>}
        {volunteers.kind === "ready" && volunteers.rows.length === 0 && (
          <p className="mp13-empty">No volunteers yet.</p>
        )}
        {volunteers.kind === "ready" && volunteers.rows.length > 0 && (
          <table className="mp13-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone Number</th>
                <th>Notes</th>
                <th>Request</th>
                <th>Roles</th>
                <th>Expressed Interest Date</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Name">{`${row.firstName} ${row.lastName}`.trim()}</td>
                  <td data-label="Email">{row.email}</td>
                  <td data-label="Phone Number">{row.phone ?? ""}</td>
                  <td data-label="Notes">{row.notes ?? ""}</td>
                  <td data-label="Request">{row.requestTitle}</td>
                  <td data-label="Roles">{row.roles.map((r) => r.roleName).join(", ")}</td>
                  <td data-label="Expressed Interest Date">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
