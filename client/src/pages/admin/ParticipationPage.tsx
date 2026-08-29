/**
 * ADMIN-15 — Donations & Volunteers.
 *
 * Read-only, staff-admin-only directory of the records created by the public
 * pledge and signup flows. Donations and volunteers are separate views so
 * each can keep its own empty/error state and pagination cursor.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ParticipationManager } from "../../components/admin/ParticipationManager";
import type {
  AdminDonationRow,
  AdminParticipationPage,
  AdminVolunteerRow,
} from "@shared/types";

type Tab = "donations" | "volunteers";
type Filters = {
  search: string;
  supporter: string;
  organization: string;
  request: string;
  from: string;
  to: string;
};

const PAGE_SIZE = 25;
const EMPTY_FILTERS: Filters = {
  search: "",
  supporter: "",
  organization: "",
  request: "",
  from: "",
  to: "",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildUrl(tab: Tab, filters: Filters, page: number, snapshotAt: string | null): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim() !== "") params.set(key, value.trim());
  }
  if (snapshotAt) params.set("snapshotAt", snapshotAt);
  return `/api/admin/participation/${tab}?${params.toString()}`;
}

function personName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim() || "Unnamed supporter";
}

function SupporterCell({
  row,
}: {
  row: { personId: string; personNeedsReview: boolean; firstName: string; lastName: string; email: string; phone: string | null };
}): ReactElement {
  const name = personName(row);
  return (
    <div className="adm-participation-supporter">
      {row.personNeedsReview ? (
        <Link href={`/admin/people/review?personId=${encodeURIComponent(row.personId)}`}>{name}</Link>
      ) : (
        <span>{name}</span>
      )}
      <a href={`mailto:${row.email}`}>{row.email}</a>
      {row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a> : <span className="adm-muted">No phone</span>}
    </div>
  );
}

function RequestCell({ row }: { row: { request: { id: string; type: "item" | "volunteer"; title: string } } }): ReactElement {
  return (
    <Link href={`/admin/requests/${row.request.type}/${row.request.id}`} className="adm-participation-request">
      {row.request.title}
    </Link>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}): ReactElement | null {
  if (total === 0) return null;
  return (
    <div className="adm-participation-pagination" aria-label="Pagination">
      <span>
        Page {page} of {totalPages} ({total.toLocaleString("en-US")} total)
      </span>
      <div>
        <button type="button" className="adm-btn adm-btn-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          className="adm-btn adm-btn-outline"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function DonationsView({
  filters,
  page,
  onPage,
  snapshotAt,
  onSnapshot,
}: {
  filters: Filters;
  page: number;
  onPage: (page: number) => void;
  snapshotAt: string | null;
  onSnapshot: (snapshotAt: string) => void;
}): ReactElement {
  const url = useMemo(() => buildUrl("donations", filters, page, snapshotAt), [filters, page, snapshotAt]);
  const query = useQuery<AdminParticipationPage<AdminDonationRow>>({ queryKey: [url] });
  const rows = query.data?.rows ?? [];
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  useEffect(() => {
    if (!snapshotAt && query.data?.snapshotAt) onSnapshot(query.data.snapshotAt);
  }, [onSnapshot, query.data?.snapshotAt, snapshotAt]);

  return (
    <section aria-labelledby="donations-heading">
      <h2 id="donations-heading" className="adm-subheading adm-participation-section-heading">
        Donations
      </h2>
      {query.isError && (
        <p className="adm-error-text" role="alert">
          Donations could not be loaded. Refresh to try again.
        </p>
      )}
      {query.isLoading && <p className="adm-muted">Loading donations…</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="adm-empty">{hasFilters ? "No donations match these filters." : "No donations recorded yet."}</p>
      )}
      {rows.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table adm-participation-table">
            <thead>
              <tr>
                <th>Supporter</th>
                <th>Notes</th>
                <th>Organization</th>
                <th>Request</th>
                <th>Date</th>
                <th>Items and quantities</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Supporter"><SupporterCell row={row} /></td>
                  <td data-label="Notes" className="adm-participation-notes">{row.notes ?? "—"}</td>
                  <td data-label="Organization">{row.organization.name}</td>
                  <td data-label="Request"><RequestCell row={row} /></td>
                  <td data-label="Date" className="adm-participation-date">{formatDateTime(row.createdAt)}</td>
                  <td data-label="Items">
                    <ul className="adm-participation-list">
                      {row.lines.map((line) => <li key={line.id}>{line.quantity} × {line.name}</li>)}
                    </ul>
                  </td>
                  <td data-label="Status">
                    <strong>{row.status === "active" ? "Active" : "Cancelled"}</strong>
                    {row.status === "cancelled" && (
                      <small className="adm-participation-cancelled">
                        {row.cancelledAt ? formatDateTime(row.cancelledAt) : ""}
                        {row.cancelledByName ? ` by ${row.cancelledByName}` : ""}
                        {row.cancellationReason ? ` — ${row.cancellationReason}` : ""}
                      </small>
                    )}
                  </td>
                  <td data-label="Actions"><ParticipationManager kind="donations" id={row.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={query.data?.totalPages ?? 1} total={query.data?.total ?? 0} onPage={onPage} />
    </section>
  );
}

function VolunteersView({
  filters,
  page,
  onPage,
  snapshotAt,
  onSnapshot,
}: {
  filters: Filters;
  page: number;
  onPage: (page: number) => void;
  snapshotAt: string | null;
  onSnapshot: (snapshotAt: string) => void;
}): ReactElement {
  const url = useMemo(() => buildUrl("volunteers", filters, page, snapshotAt), [filters, page, snapshotAt]);
  const query = useQuery<AdminParticipationPage<AdminVolunteerRow>>({ queryKey: [url] });
  const rows = query.data?.rows ?? [];
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  useEffect(() => {
    if (!snapshotAt && query.data?.snapshotAt) onSnapshot(query.data.snapshotAt);
  }, [onSnapshot, query.data?.snapshotAt, snapshotAt]);

  return (
    <section aria-labelledby="volunteers-heading">
      <h2 id="volunteers-heading" className="adm-subheading adm-participation-section-heading">
        Volunteers
      </h2>
      {query.isError && (
        <p className="adm-error-text" role="alert">
          Volunteers could not be loaded. Refresh to try again.
        </p>
      )}
      {query.isLoading && <p className="adm-muted">Loading volunteers…</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="adm-empty">{hasFilters ? "No volunteers match these filters." : "No volunteers recorded yet."}</p>
      )}
      {rows.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table adm-participation-table">
            <thead>
              <tr>
                <th>Supporter</th>
                <th>Notes</th>
                <th>Organization</th>
                <th>Request</th>
                <th>Date</th>
                <th>Selected roles</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Supporter"><SupporterCell row={row} /></td>
                  <td data-label="Notes" className="adm-participation-notes">{row.notes ?? "—"}</td>
                  <td data-label="Organization">{row.organization.name}</td>
                  <td data-label="Request"><RequestCell row={row} /></td>
                  <td data-label="Date" className="adm-participation-date">{formatDateTime(row.createdAt)}</td>
                  <td data-label="Roles">
                    <ul className="adm-participation-list">
                      {row.roles.map((role) => <li key={role.id}>{role.name}</li>)}
                    </ul>
                  </td>
                  <td data-label="Status">
                    <strong>{row.status === "active" ? "Active" : "Cancelled"}</strong>
                    {row.status === "cancelled" && (
                      <small className="adm-participation-cancelled">
                        {row.cancelledAt ? formatDateTime(row.cancelledAt) : ""}
                        {row.cancelledByName ? ` by ${row.cancelledByName}` : ""}
                        {row.cancellationReason ? ` — ${row.cancellationReason}` : ""}
                      </small>
                    )}
                  </td>
                  <td data-label="Actions"><ParticipationManager kind="volunteers" id={row.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={query.data?.totalPages ?? 1} total={query.data?.total ?? 0} onPage={onPage} />
    </section>
  );
}

export function ParticipationPage(): ReactElement {
  const [tab, setTab] = useState<Tab>("donations");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pages, setPages] = useState<Record<Tab, number>>({ donations: 1, volunteers: 1 });
  const [snapshots, setSnapshots] = useState<Record<Tab, string | null>>({ donations: null, volunteers: null });

  function updateFilter(key: keyof Filters, value: string): void {
    setFilters((current) => ({ ...current, [key]: value }));
    setPages({ donations: 1, volunteers: 1 });
    setSnapshots({ donations: null, volunteers: null });
  }

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
    setPages({ donations: 1, volunteers: 1 });
    setSnapshots({ donations: null, volunteers: null });
  }

  const page = pages[tab];
  return (
    <div className="adm-page adm-participation-page">
      <h1 className="adm-heading">Donations &amp; Volunteers</h1>
      <p className="adm-note">
        Participation history across all organizations. Staff admins can correct selections, cancel records, or
        reinstate them with an attributable reason.
      </p>

      <div className="adm-participation-filters" role="search" aria-label="Participation filters">
        <label className="adm-filter">
          Search all
          <input value={filters.search} placeholder="Name, email, organization, request" onChange={(e) => updateFilter("search", e.target.value)} />
        </label>
        <label className="adm-filter">
          Supporter
          <input value={filters.supporter} placeholder="Name or email" onChange={(e) => updateFilter("supporter", e.target.value)} />
        </label>
        <label className="adm-filter">
          Organization
          <input value={filters.organization} onChange={(e) => updateFilter("organization", e.target.value)} />
        </label>
        <label className="adm-filter">
          Request
          <input value={filters.request} onChange={(e) => updateFilter("request", e.target.value)} />
        </label>
        <label className="adm-filter">
          From
          <input type="date" value={filters.from} onChange={(e) => updateFilter("from", e.target.value)} />
        </label>
        <label className="adm-filter">
          To
          <input type="date" value={filters.to} onChange={(e) => updateFilter("to", e.target.value)} />
        </label>
        <button type="button" className="adm-btn adm-btn-outline adm-participation-clear" onClick={clearFilters}>
          Clear filters
        </button>
      </div>

      <div className="adm-tabs" role="tablist" aria-label="Participation type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "donations"}
          className={tab === "donations" ? "adm-tab adm-tab-current" : "adm-tab"}
          onClick={() => setTab("donations")}
        >
          Donations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "volunteers"}
          className={tab === "volunteers" ? "adm-tab adm-tab-current" : "adm-tab"}
          onClick={() => setTab("volunteers")}
        >
          Volunteers
        </button>
      </div>

      {tab === "donations" ? (
        <DonationsView
          filters={filters}
          page={page}
          snapshotAt={snapshots.donations}
          onSnapshot={(snapshotAt) => setSnapshots((current) => ({ ...current, donations: snapshotAt }))}
          onPage={(next) => setPages((current) => ({ ...current, donations: next }))}
        />
      ) : (
        <VolunteersView
          filters={filters}
          page={page}
          snapshotAt={snapshots.volunteers}
          onSnapshot={(snapshotAt) => setSnapshots((current) => ({ ...current, volunteers: snapshotAt }))}
          onPage={(next) => setPages((current) => ({ ...current, volunteers: next }))}
        />
      )}
    </div>
  );
}