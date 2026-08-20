/**
 * ADMIN-08 — Digest subscribers (/admin/subscribers). Staff admin only.
 * The list is visible and manageable from the moment it is imported; the
 * send job is phase two (D46) and the surface says so. Unsubscribe never
 * deletes; export is the one export in the admin and names what it holds.
 *
 * Task 77: an "Upcoming Digest" section above the subscriber list lets staff
 * see every need in the current window and exclude (or re-include) individual
 * ones before the Thursday send. Exclusions are persisted in digest_exclusions
 * and respected by the digest job's needs selection.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

type SubRow = {
  id: string;
  personId: string | null;
  personName: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: "subscribed" | "unsubscribed" | "bounced";
  subscribedAt: string;
  unsubscribedAt: string | null;
  legacySource: string | null;
};

type DigestRun = {
  runDate: string;
  status: "running" | "sent" | "skipped_empty";
  needsCount: number | null;
  recipientsCount: number | null;
  note: string | null;
};

type ListResponse = {
  rows: SubRow[];
  counts: { subscribed: number; unsubscribed: number; bounced: number };
  anyExist: boolean;
  lastRun: DigestRun | null;
};

type UpcomingNeed = {
  id: string;
  type: "item" | "volunteer";
  name: string;
  orgName: string;
  imageUrl: string | null;
  excluded: boolean;
};

type UpcomingResponse = {
  window: { windowStart: string; windowEnd: string };
  needs: UpcomingNeed[];
};

function digestRunLine(run: DigestRun | null): string {
  if (run === null) return "The weekly digest goes out Thursday mornings. No digest has been sent yet.";
  if (run.status === "running") return `The digest for ${run.runDate} is being sent right now.`;
  if (run.status === "skipped_empty") {
    return `Last digest (${run.runDate}): skipped — no new needs since the previous digest. Nothing was sent.`;
  }
  return `Last digest (${run.runDate}): ${run.needsCount ?? 0} need(s) sent to ${run.recipientsCount ?? 0} subscriber(s).${
    run.note ? ` Note: ${run.note}` : ""
  }`;
}

function fmtDay(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Filters = { status: string; email: string; from: string; to: string };

const UPCOMING_KEY = "/api/admin/digest/upcoming";

function UpcomingDigestSection(): ReactElement {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<UpcomingResponse>({ queryKey: [UPCOMING_KEY] });

  async function toggleExclusion(need: UpcomingNeed): Promise<void> {
    const key = `${need.type}/${need.id}`;
    setBusyId(key);
    setActionMsg(null);
    try {
      const url = `/api/admin/digest/upcoming/${need.type}/${need.id}/exclude`;
      const method = need.excluded ? "DELETE" : "POST";
      const res = await fetch(url, { method, credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setActionMsg(body?.message ?? "That did not save. Nothing was changed.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: [UPCOMING_KEY] });
      setActionMsg(
        need.excluded
          ? `"${need.name}" will now be included in the digest.`
          : `"${need.name}" will be excluded from the digest.`,
      );
    } catch {
      setActionMsg("That did not save. Nothing was changed.");
    } finally {
      setBusyId(null);
    }
  }

  const included = data?.needs.filter((n) => !n.excluded) ?? [];
  const excluded = data?.needs.filter((n) => n.excluded) ?? [];

  return (
    <section className="adm-upcoming-digest">
      <h2 className="adm-subheading">Upcoming Digest</h2>

      {isError && (
        <p className="adm-error-text">Upcoming needs could not be loaded. Refresh to try again.</p>
      )}
      {isLoading && !isError && <p>Loading…</p>}

      {data && (
        <>
          <p className="adm-sub-note">
            Window: {fmtDateTime(data.window.windowStart)} – {fmtDateTime(data.window.windowEnd)} (LA time).{" "}
            {included.length === 0
              ? "No needs are currently in the upcoming digest."
              : `${included.length} need${included.length === 1 ? "" : "s"} will be included.`}
            {excluded.length > 0 && ` ${excluded.length} excluded.`}
          </p>

          {actionMsg && <p className="adm-action-msg">{actionMsg}</p>}

          {data.needs.length === 0 ? (
            <p className="adm-empty">No needs became active in this window yet.</p>
          ) : (
            <table className="adm-act-table">
              <thead>
                <tr>
                  <th>Need</th>
                  <th>Organization</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.needs.map((n) => {
                  const key = `${n.type}/${n.id}`;
                  return (
                    <tr key={key} style={n.excluded ? { opacity: 0.55 } : undefined}>
                      <td>{n.name}</td>
                      <td>{n.orgName}</td>
                      <td>{n.type === "item" ? "Item need" : "Volunteer need"}</td>
                      <td>
                        {n.excluded ? (
                          <span className="adm-badge adm-badge--warn">Excluded</span>
                        ) : (
                          <span className="adm-badge adm-badge--ok">Included</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void toggleExclusion(n)}
                          disabled={busyId === key}
                        >
                          {n.excluded ? "Re-include" : "Exclude"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

export function SubscribersPage(): ReactElement {
  // Default view: subscribed only, most recently subscribed first (§5).
  const [filters, setFilters] = useState<Filters>({ status: "subscribed", email: "", from: "", to: "" });
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.email.trim()) params.set("email", filters.email.trim());
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }, [filters]);

  const listKey = queryString ? `/api/admin/subscribers?${queryString}` : "/api/admin/subscribers";
  const { data, isLoading, isError } = useQuery<ListResponse>({ queryKey: [listKey] });
  const rows = data?.rows ?? [];

  async function unsubscribe(row: SubRow): Promise<void> {
    const confirmed = window.confirm(`Unsubscribe ${row.email}? They will not be notified.`);
    if (!confirmed) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/subscribers/${row.id}/unsubscribe`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setActionMsg(body?.message ?? "That did not save. Nothing was changed.");
      await queryClient.invalidateQueries({ queryKey: [listKey] });
    } catch {
      setActionMsg("That did not save. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(): Promise<void> {
    const confirmed = window.confirm(`Export ${rows.length} rows? The file contains email addresses.`);
    if (!confirmed) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const url = queryString
        ? `/api/admin/subscribers/export.csv?${queryString}`
        : "/api/admin/subscribers/export.csv";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) {
        setActionMsg("The export failed. No file was downloaded.");
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] ?? "subscribers.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setActionMsg("The export failed. No file was downloaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-page">
      <h1 className="adm-heading">Subscribers</h1>

      <p className="adm-sub-note">{data ? digestRunLine(data.lastRun) : "The weekly digest goes out Thursday mornings."}</p>

      {data && (
        <p className="adm-sub-counts">
          {data.counts.subscribed} subscribed · {data.counts.unsubscribed} unsubscribed · {data.counts.bounced}{" "}
          bounced
        </p>
      )}

      <UpcomingDigestSection />

      <h2 className="adm-subheading">Subscriber list</h2>

      <div className="adm-filter-row">
        <label className="adm-filter">
          Status
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
          </select>
        </label>
        <label className="adm-filter">
          Email
          <input
            type="text"
            value={filters.email}
            onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))}
            placeholder="Contains…"
          />
        </label>
        <label className="adm-filter">
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </label>
        <label className="adm-filter">
          To
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
        <button type="button" onClick={() => void exportCsv()} disabled={busy || rows.length === 0}>
          Export
        </button>
      </div>

      {actionMsg && <p className="adm-action-msg">{actionMsg}</p>}
      {isError && <p className="adm-error-text">Subscribers could not be loaded. Refresh to try again.</p>}
      {isLoading && !isError && <p>Loading…</p>}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="adm-empty">
          {data?.anyExist ? "No subscribers match these filters." : "No subscribers have been imported or signed up yet."}
        </p>
      )}

      {rows.length > 0 && (
        <table className="adm-act-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>First name</th>
              <th>Last name</th>
              <th>Status</th>
              <th>Subscribed</th>
              <th>Unsubscribed</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.email}
                  {r.personName !== null && <span className="adm-sub-person"> — {r.personName}</span>}
                </td>
                <td>{r.firstName ?? "—"}</td>
                <td>{r.lastName ?? "—"}</td>
                <td>{r.status}</td>
                <td>{fmtDay(r.subscribedAt)}</td>
                <td>{fmtDay(r.unsubscribedAt)}</td>
                <td>{r.legacySource === null ? "Signed up" : "Imported"}</td>
                <td>
                  {r.status === "subscribed" && (
                    <button type="button" onClick={() => void unsubscribe(r)} disabled={busy}>
                      Unsubscribe
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
