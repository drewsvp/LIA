import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

/** A button inside the heading keeps native table semantics and keyboard activation. */
export function SortableHeader<T extends string>({
  label, column, sort, direction, onSort,
}: {
  label: string;
  column: T;
  sort: T | null;
  direction: SortDirection;
  onSort: (column: T, direction: SortDirection) => void;
}) {
  const active = sort === column;
  return (
    <th scope="col" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="adm-sort-header" onClick={() => onSort(column, active && direction === "asc" ? "desc" : "asc")}>
        {label}<span aria-hidden="true">{active ? (direction === "asc" ? " ▲" : " ▼") : " ↕"}</span>
      </button>
    </th>
  );
}

export function ListSearch({ value, onChange, label = "Search", onClear, children }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  onClear?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="adm-list-controls">
      <label className="adm-filter">{label}<input type="search" value={value} onChange={e => onChange(e.target.value)} /></label>
      {children}
      <button type="button" className="adm-btn adm-btn-outline" onClick={onClear ?? (() => onChange(""))}>Clear filters</button>
    </div>
  );
}

export function ListCount({ count, noun = "results" }: { count: number; noun?: string }) {
  return <p className="adm-muted" role="status">{count} {noun}</p>;
}

export function ListPagination({ page, pageSize, total, onPage }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return <nav className="adm-list-pages" aria-label="List pages">
    <button type="button" className="adm-btn adm-btn-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
    <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))} ({total} results)</span>
    <button type="button" className="adm-btn adm-btn-outline" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Next</button>
  </nav>;
}

/** Complete in-memory reference lists only; server-paged lists must sort in SQL. */
export function filterAndSort<T>(
  rows: readonly T[],
  search: string,
  fields: (row: T) => unknown[],
  key: (row: T) => string,
  sortValue: (row: T) => string | number | boolean | null | undefined,
  direction: SortDirection,
): T[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter(row => !needle || fields(row).some(value =>
    String(value ?? "").toLocaleLowerCase().includes(needle),
  )).sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    if (left == null || left === "") return right == null || right === "" ? key(a).localeCompare(key(b)) : 1;
    if (right == null || right === "") return -1;
    const compared = typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return (direction === "asc" ? compared : -compared) || key(a).localeCompare(key(b));
  });
}