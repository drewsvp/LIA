/**
 * ADMIN-07 — Audit trail (/admin/activity). Read-only: every status
 * transition, newest first, with actor, readable transition label, and the
 * note when one was recorded. Null actors render as "Automated" (§7) and
 * events whose entity no longer resolves still render with a marker — an
 * audit trail that hides events about deleted things is not an audit trail.
 */
import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { ENTITY_TYPE_NAMES, entityTypeName, transitionLabel } from "@shared/transitions";

type ActRow = {
  id: string;
  createdAt: string;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  entity: { name: string; path: string | null } | null;
};

type ListResponse = {
  rows: ActRow[];
  actors: Array<{ userId: string; name: string }>;
  hasAutomated: boolean;
  anyExist: boolean;
};

function laDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Filters = { type: string; actor: string; from: string; to: string; entityType: string; entityId: string };

/**
 * Default view: last thirty days (§5). An entity deep link
 * (?entityType=&entityId=) instead shows that entity's FULL history, so the
 * date default is dropped in that mode.
 */
function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const entityType = params.get("entityType") ?? "";
  const entityId = params.get("entityId") ?? "";
  const entityMode = entityType !== "" && entityId !== "";
  return {
    type: params.get("type") ?? "",
    actor: params.get("actor") ?? "",
    from: entityMode ? "" : (params.get("from") ?? laDate(30)),
    to: params.get("to") ?? "",
    entityType: entityMode ? entityType : "",
    entityId: entityMode ? entityId : "",
  };
}

export function ActivityPage(): ReactElement {
  const [filters, setFilters] = useState(initialFilters);
  const entityMode = filters.entityType !== "" && filters.entityId !== "";

  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    if (entityMode) {
      params.set("entityType", filters.entityType);
      params.set("entityId", filters.entityId);
    }
    if (filters.type) params.set("type", filters.type);
    if (filters.actor) params.set("actor", filters.actor);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const qs = params.toString();
    return qs ? `/api/admin/activity?${qs}` : "/api/admin/activity";
  }, [filters, entityMode]);

  const { data, isLoading, isError } = useQuery<ListResponse>({ queryKey: [listKey] });
  const rows = data?.rows ?? [];

  function showAll(): void {
    setFilters({ type: "", actor: "", from: laDate(30), to: "", entityType: "", entityId: "" });
  }

  return (
    <div className="adm-page">
      <h1 className="adm-heading">Activity</h1>

      {entityMode && (
        <div className="adm-act-entitymode">
          <span>Showing the full history of one {entityTypeName(filters.entityType).toLowerCase()}.</span>
          <button type="button" onClick={showAll}>
            Show all activity
          </button>
        </div>
      )}

      <div className="adm-filter-row">
        <label className="adm-filter">
          Type
          <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">All types</option>
            {Object.entries(ENTITY_TYPE_NAMES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-filter">
          Actor
          <select value={filters.actor} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}>
            <option value="">All actors</option>
            <option value="automated">Automated</option>
            {(data?.actors ?? []).map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </select>
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
      </div>

      {isError && <p className="adm-error-text">Activity could not be loaded. Refresh to try again.</p>}
      {isLoading && !isError && <p>Loading…</p>}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="adm-empty">{data?.anyExist ? "No activity matches your filters." : "No activity recorded yet."}</p>
      )}

      {rows.length > 0 && (
        <table className="adm-act-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Entity</th>
              <th>Transition</th>
              <th>Actor</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtTimestamp(r.createdAt)}</td>
                <td>{entityTypeName(r.entityType)}</td>
                <td>
                  {r.entity ? (
                    r.entity.path ? (
                      <a href={r.entity.path}>{r.entity.name}</a>
                    ) : (
                      r.entity.name
                    )
                  ) : (
                    <span className="adm-act-gone">
                      {entityTypeName(r.entityType)} {r.entityId.slice(0, 8)}… — No longer present
                    </span>
                  )}
                </td>
                <td>{transitionLabel(r.entityType, r.fromStatus, r.toStatus, r.note)}</td>
                <td>{r.actorUserId === null ? "Automated" : (r.actorName ?? "Unknown user")}</td>
                <td className="adm-act-note">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
