import { useState } from "react";

export type CsvColumn<T> = {
  label: string;
  value: (row: T) => unknown;
};

export type CsvPage<T> = {
  rows: T[];
  total: number;
};

const EXPORT_PAGE_SIZE = 100;

/**
 * Fetch every row matching the current list filters through its existing,
 * access-controlled admin endpoint. The page number and size are supplied
 * here so callers can reuse the same filters and ordering without exporting
 * only the currently visible page.
 */
export async function fetchAllAdminPages<T>(
  endpoint: string,
  filters: URLSearchParams,
  readPage: (payload: unknown) => CsvPage<T>,
): Promise<T[]> {
  const params = new URLSearchParams(filters);
  params.delete("page");
  params.delete("pageSize");

  const rows: T[] = [];
  let expectedTotal: number | null = null;

  for (let page = 1; page <= 10_000; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("page", String(page));
    pageParams.set("pageSize", String(EXPORT_PAGE_SIZE));

    const url = new URL(endpoint, window.location.origin);
    url.search = pageParams.toString();
    const response = await fetch(url.pathname + url.search, { credentials: "include" });
    if (!response.ok) throw new Error("The filtered list could not be exported.");

    const payload: unknown = await response.json();
    const result = readPage(payload);
    if (!Array.isArray(result.rows) || !Number.isInteger(result.total) || result.total < 0) {
      throw new Error("The filtered list returned an invalid export response.");
    }

    if (expectedTotal === null) expectedTotal = result.total;
    const remaining = expectedTotal - rows.length;
    if (remaining <= 0) return rows;

    rows.push(...result.rows.slice(0, remaining));
    if (rows.length >= expectedTotal) return rows;
    if (result.rows.length === 0) {
      throw new Error("The filtered list changed during export. Please try again.");
    }
  }

  throw new Error("The filtered list is too large to export in one file.");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.map((item) => (item === null || item === undefined ? "" : String(item))).join("; ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function downloadCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string): void {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(",")),
  ];
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

type AdminCsvExportButtonProps<T> = {
  filename: string;
  columns: CsvColumn<T>[];
  getRows: () => Promise<T[]>;
  disabled?: boolean;
};

export function AdminCsvExportButton<T>({
  filename,
  columns,
  getRows,
  disabled = false,
}: AdminCsvExportButtonProps<T>) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportRows(): Promise<void> {
    if (exporting || disabled) return;
    setExporting(true);
    setError(null);
    try {
      const rows = await getRows();
      downloadCsv(rows, columns, filename);
    } catch {
      setError("The export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <span className="adm-csv-export">
      <button
        type="button"
        className="adm-btn adm-btn-outline"
        disabled={disabled || exporting}
        onClick={() => void exportRows()}
      >
        {exporting ? "Preparing CSV…" : "Export CSV"}
      </button>
      {error && <span className="adm-alert" role="alert">{error}</span>}
    </span>
  );
}