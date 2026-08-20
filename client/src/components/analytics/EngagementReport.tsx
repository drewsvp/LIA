/**
 * EngagementReport — reusable date/type-filtered aggregate analytics report.
 * Renders CSS bar charts for daily engagement and a sortable performance table.
 * Accepts apiUrl and optional orgId filtering prop.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────

export type DailyRow = {
  date: string;
  engagementEvents: number;
  detailViews: number;
  conversions: number;
};

export type PerformanceRow = {
  requestKind: string;
  requestId: string;
  title: string;
  orgId: string;
  orgName: string;
  status: string;
  cardClicks: number;
  detailViews: number;
  productLinkClicks: number;
  formStarts: number;
  selections: number;
  conversions: number;
  conversionRate: number;
};

export type OrgOption = { id: string; name: string };

export type AnalyticsReport = {
  filters: { from: string; to: string; kind: string; orgId: string };
  daily: DailyRow[];
  performance: PerformanceRow[];
  organizations?: OrgOption[];
};

export type EngagementReportProps = {
  apiUrl: string;
  orgId?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function laDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

type SortKey = keyof PerformanceRow;
type SortDir = "asc" | "desc";

const PERF_COLS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "title", label: "Title" },
  { key: "orgName", label: "Organization" },
  { key: "requestKind", label: "Type" },
  { key: "status", label: "Status" },
  { key: "cardClicks", label: "Card Clicks", numeric: true },
  { key: "detailViews", label: "Detail Views", numeric: true },
  { key: "productLinkClicks", label: "Product Clicks", numeric: true },
  { key: "formStarts", label: "Form Starts", numeric: true },
  { key: "selections", label: "Selections", numeric: true },
  { key: "conversions", label: "Conversions", numeric: true },
  { key: "conversionRate", label: "Conv. Rate", numeric: true },
];

// ── Bar Chart ──────────────────────────────────────────────────────────────

function BarChart({ daily }: { daily: DailyRow[] }): ReactElement {
  if (daily.length === 0) {
    return <p className="adm-empty">No daily data in this range.</p>;
  }

  const maxVal = Math.max(
    1,
    ...daily.map((d) => Math.max(d.engagementEvents, d.detailViews, d.conversions)),
  );

  const series: Array<{ key: keyof DailyRow; label: string; color: string }> = [
    { key: "engagementEvents", label: "Engagement Events", color: "var(--color-navy)" },
    { key: "detailViews", label: "Detail Views", color: "var(--color-teal)" },
    { key: "conversions", label: "Conversions", color: "#1a7a3c" },
  ];

  return (
    <div className="anl-chart-wrap" aria-label="Daily engagement bar chart">
      <div className="anl-chart-legend" role="list">
        {series.map((s) => (
          <span key={s.key} className="anl-chart-legend-item" role="listitem">
            <span className="anl-legend-swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
      <div className="anl-chart-scroll">
        <div className="anl-chart" role="img" aria-label={`Bar chart with ${daily.length} days of engagement data`}>
          {daily.map((d) => (
            <div key={d.date} className="anl-chart-col">
              <div className="anl-bars">
                {series.map((s) => {
                  const val = d[s.key] as number;
                  const pct = (val / maxVal) * 100;
                  return (
                    <div
                      key={s.key}
                      className="anl-bar"
                      style={{ height: `${pct}%`, background: s.color }}
                      title={`${s.label}: ${val}`}
                      aria-label={`${fmtDate(d.date)} ${s.label}: ${val}`}
                    />
                  );
                })}
              </div>
              <div className="anl-chart-label">{fmtDate(d.date)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Performance Table ──────────────────────────────────────────────────────

function PerformanceTable({ rows }: { rows: PerformanceRow[] }): ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>("conversions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return <p className="adm-empty">No request performance data in this range.</p>;
  }

  return (
    <div className="adm-table-wrap">
      <table className="adm-table anl-perf-table" aria-label="Request performance">
        <thead>
          <tr>
            {PERF_COLS.map((col) => (
              <th key={col.key} aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  className="anl-sort-btn"
                  onClick={() => handleSort(col.key)}
                  aria-label={`Sort by ${col.label}${sortKey === col.key ? (sortDir === "asc" ? ", currently ascending" : ", currently descending") : ""}`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="anl-sort-arrow" aria-hidden="true">
                      {sortDir === "asc" ? " ▲" : " ▼"}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.requestKind}-${r.requestId}`}>
              <td>{r.title}</td>
              <td>{r.orgName}</td>
              <td className="anl-kind-cell">{r.requestKind === "item" ? "Item" : "Volunteer"}</td>
              <td>{r.status}</td>
              <td className="anl-num">{r.cardClicks}</td>
              <td className="anl-num">{r.detailViews}</td>
              <td className="anl-num">{r.productLinkClicks}</td>
              <td className="anl-num">{r.formStarts}</td>
              <td className="anl-num">{r.selections}</td>
              <td className="anl-num">{r.conversions}</td>
              <td className="anl-num">{fmtPct(r.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function EngagementReport({ apiUrl, orgId }: EngagementReportProps): ReactElement {
  const [from, setFrom] = useState(() => laDate(29));
  const [to, setTo] = useState(() => laDate(0));
  const [kind, setKind] = useState("");
  const [selectedOrg, setSelectedOrg] = useState(orgId ?? "");

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (kind) params.set("kind", kind);
    if (selectedOrg) params.set("orgId", selectedOrg);
    const qs = params.toString();
    return qs ? `${apiUrl}?${qs}` : apiUrl;
  }, [apiUrl, from, to, kind, selectedOrg]);

  const { data, isLoading, isError } = useQuery<AnalyticsReport>({ queryKey: [queryUrl] });

  const daily = data?.daily ?? [];
  const performance = data?.performance ?? [];
  const orgs = data?.organizations ?? [];

  // Totals for summary line
  const totals = useMemo(
    () =>
      daily.reduce(
        (acc, d) => ({
          engagementEvents: acc.engagementEvents + d.engagementEvents,
          detailViews: acc.detailViews + d.detailViews,
          conversions: acc.conversions + d.conversions,
        }),
        { engagementEvents: 0, detailViews: 0, conversions: 0 },
      ),
    [daily],
  );

  return (
    <section aria-label="Engagement report">
      {/* ── Filters ── */}
      <div className="adm-filter-row">
        <label className="adm-filter">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="adm-filter">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="adm-filter">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            <option value="item">Item</option>
            <option value="volunteer">Volunteer</option>
          </select>
        </label>
        {orgs.length > 0 && !orgId && (
          <label className="adm-filter">
            Organization
            <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}>
              <option value="">All organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* ── States ── */}
      {isError && (
        <p className="adm-error-text" role="alert">
          Analytics could not be loaded. Refresh to try again.
        </p>
      )}
      {isLoading && !isError && (
        <div className="adm-loading-list" aria-busy="true" aria-label="Loading analytics">
          <span /><span /><span />
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* ── Summary counts ── */}
          <div className="anl-summary-row" aria-label="Summary counts for selected period">
            <div className="anl-summary-card">
              <span className="anl-summary-val">{totals.engagementEvents.toLocaleString()}</span>
              <span className="anl-summary-label">Total Engagement Events</span>
            </div>
            <div className="anl-summary-card">
              <span className="anl-summary-val">{totals.detailViews.toLocaleString()}</span>
              <span className="anl-summary-label">Total Detail Views</span>
            </div>
            <div className="anl-summary-card">
              <span className="anl-summary-val">{totals.conversions.toLocaleString()}</span>
              <span className="anl-summary-label">Total Conversions</span>
            </div>
          </div>

          {/* ── Daily chart ── */}
          <h2 className="adm-subheading">Daily Engagement (event counts)</h2>
          <BarChart daily={daily} />

          {/* ── Performance table ── */}
          <h2 className="adm-subheading">Request Performance</h2>
          <p className="adm-note">
            Click a column header to sort. Counts reflect the filtered date range.
          </p>
          <PerformanceTable rows={performance} />
        </>
      )}
    </section>
  );
}
