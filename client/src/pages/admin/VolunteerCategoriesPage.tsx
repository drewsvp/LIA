/**
 * ADMIN-11 — staff-admin configuration for the shared volunteer-interest
 * vocabulary. Categories stay alphabetized automatically and are deactivated,
 * never deleted, so existing supporter preferences remain identifiable.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type CategoryRow = {
  id: string;
  name: string;
  isActive: boolean;
  interestCount: number;
};

type ReportCategory = { id: string; name: string; isActive: boolean };
type ReportRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  categories: ReportCategory[];
  accountState: "invited" | "active" | "disabled";
  matchingAlertsEnabled: boolean;
};
type ReportResponse = { rows: ReportRow[]; total: number; page: number; pageSize: number };
type ReportOptions = {
  categories: ReportCategory[];
  accountStates: string[];
  matchingAlertStates: string[];
  categoryStates: string[];
};
type ReportFilters = {
  search: string;
  categoryIds: string[];
  categoryState: "all" | "active" | "inactive";
  accountState: "all" | "invited" | "active" | "disabled";
  matchingAlerts: "all" | "on" | "off";
  page: number;
};

const FAILURE = "That did not save. Nothing was changed.";
const DEFAULT_REPORT_FILTERS: ReportFilters = {
  search: "",
  categoryIds: [],
  categoryState: "all",
  accountState: "active",
  matchingAlerts: "all",
  page: 1,
};

function displayName(row: ReportRow): string {
  return `${row.firstName} ${row.lastName}`.trim() || "Unnamed supporter";
}

function accountStateLabel(state: ReportRow["accountState"]): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: { message?: string } = {};
  try {
    payload = (await response.json()) as { message?: string };
  } catch {
    // The generic failure below remains actionable if the response is not JSON.
  }
  return { ok: response.ok, message: payload.message ?? (response.ok ? "" : FAILURE) };
}

export function VolunteerCategoriesPage() {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<"categories" | "report">("categories");
  const [reportFilters, setReportFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const listQuery = useQuery<{ categories: CategoryRow[] }>({
    queryKey: ["/api/admin/volunteer-categories"],
  });

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setResult(null);
    try {
      const response = await postJson(path, body);
      setResult({ kind: response.ok ? "ok" : "error", text: response.message || FAILURE });
      if (response.ok) {
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/volunteer-categories"] });
      }
      return response.ok;
    } catch {
      setResult({ kind: "error", text: FAILURE });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const categories = listQuery.data?.categories ?? [];
  const reportOptionsQuery = useQuery<ReportOptions>({
    queryKey: ["/api/admin/volunteer-interest-report/options"],
    enabled: tab === "report",
  });
  const reportKey = useMemo(() => {
    const params = new URLSearchParams();
    if (reportFilters.search.trim()) params.set("search", reportFilters.search.trim());
    for (const categoryId of reportFilters.categoryIds) params.append("categoryId", categoryId);
    params.set("categoryState", reportFilters.categoryState);
    params.set("accountState", reportFilters.accountState);
    params.set("matchingAlerts", reportFilters.matchingAlerts);
    params.set("page", String(reportFilters.page));
    params.set("pageSize", "25");
    return `/api/admin/volunteer-interest-report?${params.toString()}`;
  }, [reportFilters]);
  const reportQuery = useQuery<ReportResponse>({
    queryKey: [reportKey],
    enabled: tab === "report",
  });
  const reportOptions = reportOptionsQuery.data?.categories ?? [];
  const reportTotalPages = reportQuery.data ? Math.max(1, Math.ceil(reportQuery.data.total / reportQuery.data.pageSize)) : 1;

  function updateReportFilters(changes: Partial<ReportFilters>): void {
    setReportFilters((current) => ({ ...current, ...changes, page: changes.page ?? 1 }));
  }

  return (
    <div>
      <h1 className="adm-heading">Volunteer categories</h1>
      <p className="adm-muted">
        These choices appear on supporter profiles. Deactivating a category hides it from new selections without
        removing it from people who already chose it.
      </p>

      <nav className="adm-tabs" aria-label="Volunteer category views">
        <button
          className={tab === "categories" ? "adm-tab adm-tab-current" : "adm-tab"}
          aria-pressed={tab === "categories"}
          onClick={() => setTab("categories")}
        >
          Categories
        </button>
        <button
          className={tab === "report" ? "adm-tab adm-tab-current" : "adm-tab"}
          aria-pressed={tab === "report"}
          onClick={() => setTab("report")}
        >
          Interested supporters
        </button>
      </nav>

      {tab === "categories" && result && (
        <p role={result.kind === "error" ? "alert" : "status"} className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>
          {result.text}
        </p>
      )}

      {tab === "report" ? (
        <section aria-labelledby="interested-supporters-heading">
          <h2 id="interested-supporters-heading" className="adm-subheading">
            Interested supporters
          </h2>
          <p className="adm-note">
            Active supporter accounts are shown by default, including accounts with no selected interests.
            Matching alerts are separate from weekly digest subscriptions.
          </p>
          <div className="adm-report-filters">
            <label className="adm-filter">
              Search supporters
              <input
                aria-label="Search supporters"
                value={reportFilters.search}
                placeholder="Name, email, or phone"
                onChange={(event) => updateReportFilters({ search: event.target.value })}
              />
            </label>
            <label className="adm-filter">
              Account state
              <select
                aria-label="Account state"
                value={reportFilters.accountState}
                onChange={(event) =>
                  updateReportFilters({
                    accountState: event.target.value as ReportFilters["accountState"],
                  })
                }
              >
                <option value="active">Active</option>
                <option value="all">All account states</option>
                <option value="invited">Invited</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="adm-filter">
              Matching alerts
              <select
                aria-label="Matching alerts"
                value={reportFilters.matchingAlerts}
                onChange={(event) =>
                  updateReportFilters({
                    matchingAlerts: event.target.value as ReportFilters["matchingAlerts"],
                  })
                }
              >
                <option value="all">All preferences</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="adm-filter">
              Interest category state
              <select
                aria-label="Interest category state"
                value={reportFilters.categoryState}
                onChange={(event) =>
                  updateReportFilters({
                    categoryState: event.target.value as ReportFilters["categoryState"],
                  })
                }
              >
                <option value="all">All category states</option>
                <option value="active">Has an active interest</option>
                <option value="inactive">Has an inactive interest</option>
              </select>
            </label>
          </div>
          <label className="adm-filter adm-report-category-filter">
            Volunteer categories
            <select
              aria-label="Volunteer categories"
              multiple
              size={Math.min(6, Math.max(3, reportOptions.length))}
              value={reportFilters.categoryIds}
              onChange={(event) =>
                updateReportFilters({
                  categoryIds: Array.from(event.target.selectedOptions, (option) => option.value),
                })
              }
            >
              {reportOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}{category.isActive ? "" : " (Inactive)"}
                </option>
              ))}
            </select>
            <small>Hold Ctrl (Windows) or Command (Mac) to select more than one.</small>
          </label>
          <div className="adm-report-actions">
            <button className="adm-btn" onClick={() => setReportFilters(DEFAULT_REPORT_FILTERS)}>
              Clear filters
            </button>
            {!reportQuery.isLoading && !reportQuery.isError && reportQuery.data && (
              <span className="adm-note">
                {reportQuery.data.total.toLocaleString()} supporter{reportQuery.data.total === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {reportOptionsQuery.isError || reportQuery.isError ? (
            <p role="alert" className="adm-alert">
              Something went wrong loading the supporter report. Please refresh the page and try again.
            </p>
          ) : reportOptionsQuery.isLoading || reportQuery.isLoading ? (
            <div className="adm-loading-list" aria-busy="true" aria-label="Loading interested supporters">
              <span />
              <span />
              <span />
            </div>
          ) : reportQuery.data?.rows.length === 0 ? (
            <p className="adm-empty adm-report-empty">No supporters match these filters.</p>
          ) : (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-report-table">
                  <thead>
                    <tr>
                      <th>Supporter</th>
                      <th>Contact</th>
                      <th>Selected interests</th>
                      <th>Account state</th>
                      <th>Matching alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportQuery.data?.rows.map((row) => (
                      <tr key={row.userId}>
                        <td>{displayName(row)}</td>
                        <td>
                          <a href={`mailto:${row.email}`}>{row.email}</a>
                          {row.phone && <span className="adm-report-secondary">{row.phone}</span>}
                        </td>
                        <td>
                          {row.categories.length === 0 ? (
                            <span className="adm-report-secondary">No volunteer interests</span>
                          ) : (
                            <ul className="adm-report-interests">
                              {row.categories.map((category) => (
                                <li key={category.id}>
                                  {category.name}
                                  {!category.isActive && <span className="adm-inactive-label">Inactive</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>{accountStateLabel(row.accountState)}</td>
                        <td>{row.matchingAlertsEnabled ? "On" : "Off"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="adm-report-pagination" aria-label="Report pagination">
                <button
                  className="adm-btn"
                  disabled={reportFilters.page <= 1}
                  onClick={() => setReportFilters((current) => ({ ...current, page: current.page - 1 }))}
                >
                  Previous
                </button>
                <span>
                  Page {reportFilters.page} of {reportTotalPages}
                </span>
                <button
                  className="adm-btn"
                  disabled={reportFilters.page >= reportTotalPages}
                  onClick={() => setReportFilters((current) => ({ ...current, page: current.page + 1 }))}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      ) : listQuery.isError ? (
        <p role="alert" className="adm-alert">
          Something went wrong loading this list. Please refresh the page and try again.
        </p>
      ) : listQuery.isLoading ? (
        <div className="adm-loading-list" aria-label="Loading volunteer categories">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Saved by</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="adm-empty-cell">
                    No volunteer categories yet. Add the first category below.
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} className="adm-row">
                    <td>
                      {renameId === category.id ? (
                        <span className="adm-btn-row">
                          <input
                            aria-label={`New name for ${category.name}`}
                            value={renameName}
                            maxLength={120}
                            disabled={busy}
                            onChange={(event) => setRenameName(event.target.value)}
                          />
                          <button
                            className="adm-btn adm-btn-primary"
                            disabled={busy || renameName.trim() === "" || renameName.trim() === category.name}
                            onClick={() => {
                              void (async () => {
                                if (
                                  await act(`/api/admin/volunteer-categories/${category.id}/rename`, {
                                    name: renameName.trim(),
                                  })
                                ) {
                                  setRenameId(null);
                                }
                              })();
                            }}
                          >
                            Save
                          </button>
                          <button className="adm-btn" disabled={busy} onClick={() => setRenameId(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        category.name
                      )}
                    </td>
                    <td>
                      {category.interestCount} supporter{category.interestCount === 1 ? "" : "s"}
                    </td>
                    <td>{category.isActive ? "Active" : <strong>Inactive</strong>}</td>
                    <td>
                      {renameId !== category.id && (
                        <div className="adm-btn-row">
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() => {
                              setRenameId(category.id);
                              setRenameName(category.name);
                              setResult(null);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                `/api/admin/volunteer-categories/${category.id}/${
                                  category.isActive ? "deactivate" : "reactivate"
                                }`,
                              )
                            }
                          >
                            {category.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && (
        <section className="adm-category-add" aria-labelledby="add-category-heading">
          <h2 id="add-category-heading" className="adm-subheading">
            Add volunteer category
          </h2>
          <div className="adm-form-row">
            <label>
              Name
              <input
                value={addName}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setAddName(event.target.value)}
              />
            </label>
            <button
              className="adm-btn adm-btn-primary"
              disabled={busy || addName.trim() === ""}
              onClick={() => {
                void (async () => {
                  if (await act("/api/admin/volunteer-categories", { name: addName.trim() })) setAddName("");
                })();
              }}
            >
              Add
            </button>
          </div>
        </section>
      )}
    </div>
  );
}