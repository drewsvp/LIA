import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

type Status = "active" | "disabled";

type SupporterRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: Status;
  lastLoginAt: string | null;
  createdAt: string;
  alertsEnabled: boolean;
  pledgeCount: number;
  signupCount: number;
  viewCount: number;
};

type DirectoryResponse = {
  supporters: SupporterRow[];
  total: number;
  page: number;
  pageSize: number;
};

type ProfileResponse = {
  supporter: SupporterRow & { personId: string; updatedAt: string; alertInterests: string[] };
  preferences: {
    matchingVolunteerAlertsEnabled: boolean;
    volunteerInterests: string[];
  };
  pledges: Array<{
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    lines: Array<{ itemId: string; itemName: string; quantity: number }>;
  }>;
  signups: Array<{
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    roles: Array<{ roleId: string; roleName: string }>;
  }>;
  recentlyViewed: Array<{
    requestKind: "item" | "volunteer";
    requestId: string;
    title: string;
    orgName: string;
    lastViewedAt: string;
    available: boolean;
  }>;
};

type Result = { kind: "ok" | "error"; text: string } | null;
type Confirm = "disable" | "reactivate" | "impersonate" | null;

function fmtDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-US", { dateStyle: "medium" });
}

async function jsonRequest(
  path: string,
  method: "PUT" | "POST",
  body?: unknown,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, payload };
}

export function SupportersPage(): ReactElement {
  const queryClient = useQueryClient();
  const detailRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<Status>("active");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ firstName: "", lastName: "", email: "", phone: "" });

  const listKey = useMemo(() => {
    const params = new URLSearchParams({ status, page: String(page), pageSize: "25" });
    if (search !== "") params.set("search", search);
    return `/api/admin/supporters?${params.toString()}`;
  }, [status, search, page]);
  const listQuery = useQuery<DirectoryResponse>({ queryKey: [listKey] });
  const detailKey = selectedId ? `/api/admin/supporters/${selectedId}` : "";
  const detailQuery = useQuery<ProfileResponse>({ queryKey: [detailKey], enabled: selectedId !== null });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail) return;
    setDraft({
      firstName: detail.supporter.firstName,
      lastName: detail.supporter.lastName,
      email: detail.supporter.email,
      phone: detail.supporter.phone ?? "",
    });
  }, [detail]);

  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  function changeStatus(next: Status): void {
    setStatus(next);
    setPage(1);
    setSelectedId(null);
    setConfirm(null);
    setResult(null);
  }

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [listKey] });
    if (detailKey) await queryClient.invalidateQueries({ queryKey: [detailKey] });
  }

  async function saveContact(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedId || busy) return;
    setBusy(true);
    setResult(null);
    setFieldErrors({});
    try {
      const response = await jsonRequest(`/api/admin/supporters/${selectedId}/contact`, "PUT", draft);
      if (!response.ok) {
        const errors = response.payload.fieldErrors;
        if (errors && typeof errors === "object") setFieldErrors(errors as Record<string, string>);
        setResult({
          kind: "error",
          text: typeof response.payload.message === "string" ? response.payload.message : "That did not save. Nothing was changed.",
        });
        return;
      }
      setResult({
        kind: "ok",
        text: typeof response.payload.message === "string" ? response.payload.message : "Supporter contact details saved.",
      });
      await refresh();
    } catch {
      setResult({ kind: "error", text: "That did not save. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  async function runAction(): Promise<void> {
    if (!selectedId || !confirm || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const path =
        confirm === "impersonate"
          ? `/api/admin/supporters/${selectedId}/impersonate`
          : `/api/admin/supporters/${selectedId}/${confirm}`;
      const response = await jsonRequest(path, "POST");
      if (!response.ok) {
        setResult({
          kind: "error",
          text: typeof response.payload.message === "string" ? response.payload.message : "That did not save. Nothing was changed.",
        });
        return;
      }
      if (confirm === "impersonate") {
        window.location.assign(typeof response.payload.redirectTo === "string" ? response.payload.redirectTo : "/profile");
        return;
      }
      setResult({
        kind: "ok",
        text: typeof response.payload.message === "string" ? response.payload.message : "Supporter account updated.",
      });
      setConfirm(null);
      await refresh();
    } catch {
      setResult({ kind: "error", text: "That did not save. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const rows = listQuery.data?.supporters ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="adm-page">
      <h1 className="adm-heading">Supporters</h1>
      <p className="adm-muted">Supporter-only accounts with no organization membership.</p>

      <div className="adm-tabs" role="tablist" aria-label="Supporter account state">
        {(["active", "disabled"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={status === value ? "adm-tab adm-tab-current" : "adm-tab"}
            onClick={() => changeStatus(value)}
          >
            {value === "active" ? "Active" : "Disabled"}
          </button>
        ))}
      </div>

      <form
        className="adm-supporter-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchDraft.trim());
          setPage(1);
          setSelectedId(null);
        }}
      >
        <label className="adm-filter">
          Search by name or email
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} />
        </label>
        <button type="submit" className="adm-btn">Search</button>
        {search !== "" ? (
          <button
            type="button"
            className="adm-btn adm-btn-outline"
            onClick={() => {
              setSearch("");
              setSearchDraft("");
              setPage(1);
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {listQuery.isLoading ? <p className="adm-muted">Loading supporters…</p> : null}
      {listQuery.isError ? <p className="adm-alert" role="alert">Supporters could not be loaded. Refresh to try again.</p> : null}
      {!listQuery.isLoading && !listQuery.isError && rows.length === 0 ? (
        <p className="adm-muted">{search ? "No supporters match that search." : `No ${status} supporter accounts.`}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Last login</th><th>Donations</th><th>Volunteer</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={selectedId === row.id ? "adm-row adm-row-selected" : "adm-row"}
                  onClick={() => {
                    setSelectedId(row.id);
                    setConfirm(null);
                    setResult(null);
                  }}
                >
                  <td>{row.firstName} {row.lastName}</td>
                  <td>{row.email}</td>
                  <td>{fmtDate(row.lastLoginAt)}</td>
                  <td>{row.pledgeCount}</td>
                  <td>{row.signupCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > pageSize ? (
        <div className="adm-supporter-pagination" aria-label="Supporter pages">
          <button className="adm-btn adm-btn-outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page} of {pageCount}</span>
          <button className="adm-btn adm-btn-outline" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      ) : null}

      {selectedId ? (
        <section className="adm-detail adm-supporter-detail" ref={detailRef} aria-label="Supporter profile">
          {detailQuery.isLoading ? <p className="adm-muted">Loading supporter profile…</p> : null}
          {detailQuery.isError ? <p className="adm-alert" role="alert">This supporter profile could not be loaded.</p> : null}
          {detail ? (
            <>
              <h2 className="adm-subheading">{detail.supporter.firstName} {detail.supporter.lastName}</h2>
              <dl className="adm-fields">
                <dt>Account state</dt><dd>{detail.supporter.status === "active" ? "Active" : "Disabled"}</dd>
                <dt>Created</dt><dd>{fmtDate(detail.supporter.createdAt)}</dd>
                <dt>Last login</dt><dd>{fmtDate(detail.supporter.lastLoginAt)}</dd>
                <dt>Matching alerts</dt><dd>{detail.preferences.matchingVolunteerAlertsEnabled ? "Enabled" : "Disabled"}</dd>
                <dt>Volunteer interests</dt><dd>{detail.preferences.volunteerInterests.join(", ") || "None selected"}</dd>
              </dl>

              <form className="adm-supporter-contact" onSubmit={(event) => void saveContact(event)} noValidate>
                <h3 className="adm-subheading">Contact information</h3>
                <div className="adm-supporter-contact-grid">
                  {(["firstName", "lastName", "email", "phone"] as const).map((field) => (
                    <label className="adm-filter" key={field}>
                      {field === "firstName" ? "First name" : field === "lastName" ? "Last name" : field === "email" ? "Email" : "Phone"}
                      <input
                        type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                        value={draft[field]}
                        aria-invalid={fieldErrors[field] ? "true" : undefined}
                        onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                        disabled={busy}
                      />
                      {fieldErrors[field] ? <small className="adm-error-text">{fieldErrors[field]}</small> : null}
                    </label>
                  ))}
                </div>
                <p className="adm-muted">A new email address is not applied until the supporter confirms it from that mailbox.</p>
                <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save contact"}</button>
              </form>

              {result ? <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"} role={result.kind === "error" ? "alert" : "status"}>{result.text}</p> : null}

              <div className="adm-actions">
                {detail.supporter.status === "active" ? (
                  <>
                    <button className="adm-btn adm-btn-primary" disabled={busy} onClick={() => setConfirm("impersonate")}>Log in as supporter</button>
                    <button className="adm-btn adm-btn-outline" disabled={busy} onClick={() => setConfirm("disable")}>Disable account</button>
                  </>
                ) : (
                  <button className="adm-btn adm-btn-primary" disabled={busy} onClick={() => setConfirm("reactivate")}>Reactivate account</button>
                )}
              </div>

              {confirm ? (
                <div className="adm-confirm">
                  <p>
                    {confirm === "impersonate"
                      ? `Open the application as ${detail.supporter.firstName} ${detail.supporter.lastName}? Staff permissions will be paused in a separate one-hour supporter view.`
                      : confirm === "disable"
                        ? "Disable this supporter account? They will be signed out and unable to request new sign-in links."
                        : "Reactivate this supporter account? They will be able to sign in again."}
                  </p>
                  <button className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void runAction()}>
                    {busy ? "Saving…" : "Confirm"}
                  </button>
                  <button className="adm-btn adm-btn-outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              ) : null}

              <h3 className="adm-subheading">Donation history ({detail.pledges.length})</h3>
              {detail.pledges.length === 0 ? <p className="adm-muted">No item donations.</p> : (
                <ul className="adm-supporter-history">
                  {detail.pledges.map((pledge) => (
                    <li key={pledge.id}>
                      <Link href={`/items/${pledge.requestId}`}>{pledge.requestTitle}</Link> for {pledge.orgName}
                      <span>{fmtDate(pledge.createdAt)} · {pledge.lines.map((line) => `${line.itemName} × ${line.quantity}`).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="adm-subheading">Volunteer history ({detail.signups.length})</h3>
              {detail.signups.length === 0 ? <p className="adm-muted">No volunteer signups.</p> : (
                <ul className="adm-supporter-history">
                  {detail.signups.map((signup) => (
                    <li key={signup.id}>
                      <Link href={`/volunteer/${signup.requestId}`}>{signup.requestTitle}</Link> for {signup.orgName}
                      <span>{fmtDate(signup.createdAt)} · {signup.roles.map((role) => role.roleName).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="adm-subheading">Recently viewed ({detail.recentlyViewed.length})</h3>
              {detail.recentlyViewed.length === 0 ? <p className="adm-muted">No recent request views.</p> : (
                <ul className="adm-supporter-history">
                  {detail.recentlyViewed.map((view) => (
                    <li key={`${view.requestKind}-${view.requestId}`}>
                      {view.available ? <Link href={`/${view.requestKind === "item" ? "items" : "volunteer"}/${view.requestId}`}>{view.title}</Link> : view.title}
                      {" "}for {view.orgName}<span>{fmtDate(view.lastViewedAt)}{view.available ? "" : " · No longer available"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}