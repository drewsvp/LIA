import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { filterAndSort, SortableHeader, ListPagination } from "../client/src/components/admin/ListControls";
import { invalidateAdminList } from "../client/src/components/admin/invalidateAdminList";

const rows = [
  { id: "b", name: "Beta", amount: 12, date: "2025-02-01" },
  { id: "a", name: "Alpha", amount: 2, date: "2025-01-01" },
  { id: "c", name: "Gamma", amount: null, date: null },
  { id: "d", name: "Beta", amount: 12, date: "2025-02-01" },
];
const ordered = (search: string, field: keyof typeof rows[number], direction: "asc" | "desc") =>
  filterAndSort(rows, search, r => [r.name, r.amount, r.date], r => r.id, r => r[field], direction).map(r => r.id);

assert.deepEqual(ordered("beT", "amount", "asc"), ["b", "d"]);
assert.deepEqual(ordered("", "amount", "asc"), ["a", "b", "d", "c"]);
assert.deepEqual(ordered("", "amount", "desc"), ["b", "d", "a", "c"]);
assert.deepEqual(ordered("", "date", "asc"), ["a", "b", "d", "c"]);
assert.deepEqual(ordered("12", "name", "asc"), ["b", "d"]);
const markup = renderToStaticMarkup(<table><thead><tr>
  <SortableHeader label="Amount" column="amount" sort="amount" direction="desc" onSort={() => {}} />
  <SortableHeader label="Name" column="name" sort="amount" direction="desc" onSort={() => {}} />
</tr></thead></table>);
assert.match(markup, /aria-sort="descending"/);
assert.match(markup, /aria-sort="none"/);
assert.match(markup, /<button type="button"/);
assert.match(renderToStaticMarkup(<ListPagination page={2} pageSize={2} total={7} onPage={() => {}} />), /Page 2 of 4 \(7 results\)/);
async function checkMutationRefresh(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const path of ["/api/admin/members", "/api/admin/organizations"]) {
    const key = `${path}?status=active&search=fixture&orgId=org-1&sort=name&direction=desc&page=2&pageSize=25`;
    let version = 0;
    const observer = new QueryObserver(client, {
      queryKey: [key],
      queryFn: async () => ({ rows: [`revision-${++version}`], total: version }),
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data?.total, 1);
    // This is the same invalidation called after approve/reject/edit actions:
    // the mounted, filtered/sorted page refetches both its rows and total.
    await invalidateAdminList(client, path);
    assert.equal(observer.getCurrentResult().data?.total, 2, `${path} refetches the filtered page after mutation`);
    assert.deepEqual(observer.getCurrentResult().data?.rows, ["revision-2"]);
    unsubscribe();
  }
  client.clear();
  console.log("Admin list control and mutation-refresh assertions passed.");
}
checkMutationRefresh().catch(error => { console.error(error); process.exitCode = 1; });