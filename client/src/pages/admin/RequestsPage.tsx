/**
 * ADMIN-02 — REQUEST APPROVAL QUEUE (docs/specs/ADMIN-02.md).
 *
 * Both request types share one queue (§1); the type filter narrows in place
 * and the status tabs are Pending (default) / Active / Archived / Returned (§4).
 * The detail panel shows the request the way the public will see it — image
 * included — because staff review the actual output, not a field list (§4).
 * Staff may add a themed image before approving (§5). The full Edit flow
 * allows editing every request/contact/deadline/location/copy field and all
 * child items or roles (add/edit/reorder/remove with quantities).
 * Approve confirms with the §8 copy naming the recipients; return-to-draft
 * demands a note and reminds the operator that no email goes out (D45);
 * archive confirms it stops public display; eligible active requests may be
 * unapproved to Pending for correction; reinstate is archived-tab only.
 * Returned drafts can be moved back to pending without re-submission.
 * Every result lands in place, verbatim from §8 where the spec binds it.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productUrlProblem } from "@shared/item-product-url";

type RequestKind = "item" | "volunteer";
type Tab = "pending" | "active" | "archived" | "returned";
type TypeFilter = "all" | "item" | "volunteer";

type QueueRow = {
  type: RequestKind;
  id: string;
  title: string;
  status: string;
  submittedAt: string | null;
  createdAt: string;
  returnedAt?: string | null;
  orgId: string;
  orgName: string;
  orgCity: string | null;
  orgStatus: "pending" | "approved" | "disabled";
  childCount: number;
};

type ItemChild = {
  id: string;
  name: string;
  description: string | null;
  condition: string | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityReceived: number;
  quantityRemaining: number;
};

type RoleChild = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityConfirmed: number;
  quantityRemaining: number;
};

type VolunteerCategoryOption = {
  id: string;
  name: string;
  isActive: boolean;
  selected: boolean;
};

type Detail = {
  type: RequestKind;
  request: {
    id: string;
    title: string;
    description: string | null;
    details?: string | null;
    imageUrl: string | null;
    imageGenerated?: boolean;
    imageGenStatus?: "pending" | "succeeded" | "failed" | null;
    imageGenError?: string | null;
    dropoffLocation?: string | null;
    eventLocation?: string | null;
    peopleHelped: number | null;
    deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
    deadlineDate: string | null;
    expiresOn: string | null;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    archivedReason: string | null;
  };
  organization: { id: string; name: string; city: string | null; status: "pending" | "approved" | "disabled" };
  orgContact: { name: string; email: string } | null;
  creator: { name: string; email: string } | null;
  requestContact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  children: ItemChild[] | RoleChild[];
  categories: VolunteerCategoryOption[];
  latestReturn: { note: string; createdAt: string } | null;
  editability: {
    editable: boolean;
    reason: string | null;
    unapprovable: boolean;
    unapprovalReason: string | null;
  };
};

type PendingConfirm = { kind: "approve" | "archive" | "unapprove" } | null;

// ── Edit-form shape ─────────────────────────────────────────────────────────

type EditItemChild = {
  _key: string; // local identity for React keys / reorder
  id?: string;
  name: string;
  description: string;
  condition: "new" | "gently_used" | "any";
  productUrl: string;
  quantityRequested: number;
};

type EditRoleChild = {
  _key: string;
  id?: string;
  name: string;
  description: string;
  quantityNeeded: number;
};

type EditForm = {
  title: string;
  description: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
  deadlineDate: string;
  peopleHelped: string;
  dropoffLocation: string;
  eventLocation: string;
  // volunteer-only
  details: string;
  categoryIds: string[];
  itemChildren: EditItemChild[];
  roleChildren: EditRoleChild[];
};

/** §8 verbatim. */
const PENDING_EMPTY = "No requests are waiting for approval.";
const FAILURE = "That did not save. Nothing was changed.";
const RETURN_PROMPT =
  "What needs to change? This note is saved to the request history as a record only — it does not trigger any AI processing, send any email, or make any other change to the request. The organization is not emailed; staff must contact the organization directly.";
const NOT_PROVIDED = "Not provided";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";
const DETAIL_ERROR = "Something went wrong loading this request. Please refresh the page and try again.";

let _keyCounter = 0;
function nextKey(): string {
  return `k${++_keyCounter}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function deadlineLabel(detail: Detail["request"]): string {
  if (detail.deadlineType === "date_specific") return formatDate(detail.deadlineDate);
  return detail.deadlineType === "until_fulfilled" ? "Until fulfilled" : "Ongoing";
}

async function postJson(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: { message?: string } = {};
  try {
    payload = (await res.json()) as { message?: string };
  } catch {
    /* non-JSON body — fall through to the generic failure line */
  }
  return { ok: res.ok, message: payload.message ?? FAILURE };
}

function buildEditForm(detail: Detail): EditForm {
  const r = detail.request;
  const rc = detail.requestContact;
  const itemChildren: EditItemChild[] = detail.type === "item"
    ? (detail.children as ItemChild[]).map((c) => ({
        _key: nextKey(),
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        condition: (c.condition as "new" | "gently_used" | "any") ?? "any",
        productUrl: c.productUrl ?? "",
        quantityRequested: c.quantityRequested,
      }))
    : [];
  const roleChildren: EditRoleChild[] = detail.type === "volunteer"
    ? (detail.children as RoleChild[]).map((c) => ({
        _key: nextKey(),
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        quantityNeeded: c.quantityNeeded,
      }))
    : [];
  return {
    title: r.title,
    description: r.description ?? "",
    contactFirstName: rc?.firstName ?? "",
    contactLastName: rc?.lastName ?? "",
    contactEmail: rc?.email ?? "",
    contactPhone: rc?.phone ?? "",
    deadlineType: r.deadlineType,
    deadlineDate: r.deadlineDate ?? "",
    peopleHelped: r.peopleHelped !== null ? String(r.peopleHelped) : "",
    dropoffLocation: r.dropoffLocation ?? "",
    eventLocation: r.eventLocation ?? "",
    details: r.details ?? "",
    categoryIds: detail.categories.filter((category) => category.selected).map((category) => category.id),
    itemChildren,
    roleChildren,
  };
}

function validateEditForm(form: EditForm, kind: RequestKind): string | null {
  if (!form.title.trim()) return "Title is required.";
  if (!form.description.trim()) return "Description is required.";
  if (!form.contactFirstName.trim()) return "Contact first name is required.";
  if (!form.contactLastName.trim()) return "Contact last name is required.";
  if (!form.contactEmail.trim()) return "Contact email is required.";
  if (!form.contactPhone.trim()) return "Contact phone is required.";
  if (form.deadlineType === "date_specific" && !form.deadlineDate.trim())
    return "Deadline date is required when deadline type is date-specific.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim()))
    return "Contact email does not look valid.";
  if (
    form.peopleHelped.trim() !== "" &&
    (!Number.isInteger(Number(form.peopleHelped)) || Number(form.peopleHelped) < 0)
  )
    return "People helped must be a non-negative whole number.";
  if (kind === "item") {
    for (const child of form.itemChildren) {
      if (!child.name.trim()) return "Each item must have a name.";
      if (!child.description.trim()) return "Each item must have a description.";
      if (!Number.isInteger(child.quantityRequested) || child.quantityRequested < 1)
        return "Each item quantity requested must be a whole number of at least 1.";
      const urlProblem = productUrlProblem(child.productUrl);
      if (urlProblem) return urlProblem;
    }
  } else {
    if (!form.details.trim()) return "Volunteer details are required.";
    if (!form.eventLocation.trim()) return "Event location is required.";
    for (const child of form.roleChildren) {
      if (!child.name.trim()) return "Each role must have a name.";
      if (!child.description.trim()) return "Each role must have a description.";
      if (!Number.isInteger(child.quantityNeeded) || child.quantityNeeded < 1)
        return "Each role quantity needed must be a whole number of at least 1.";
    }
  }
  return null;
}

function buildEditPayload(form: EditForm, kind: RequestKind): Record<string, unknown> {
  const base: Record<string, unknown> = {
    title: form.title.trim(),
    description: form.description.trim(),
    contactFirstName: form.contactFirstName.trim(),
    contactLastName: form.contactLastName.trim(),
    contactEmail: form.contactEmail.trim(),
    contactPhone: form.contactPhone.trim(),
    deadlineType: form.deadlineType,
    deadlineDate: form.deadlineType === "date_specific" ? form.deadlineDate.trim() || null : null,
    peopleHelped: form.peopleHelped.trim() !== "" ? Number(form.peopleHelped) : null,
  };
  if (kind === "item") {
    base.dropoffLocation = form.dropoffLocation.trim() || null;
    base.children = form.itemChildren.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name.trim(),
      description: c.description.trim(),
      condition: c.condition,
      productUrl: c.productUrl.trim() || null,
      quantityRequested: c.quantityRequested,
    }));
  } else {
    base.details = form.details.trim();
    base.eventLocation = form.eventLocation.trim();
    base.categoryIds = form.categoryIds;
    base.children = form.roleChildren.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name.trim(),
      description: c.description.trim(),
      quantityNeeded: c.quantityNeeded,
    }));
  }
  return base;
}

// ── Edit form sub-components ─────────────────────────────────────────────────

function ItemChildEditor({
  child,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  child: EditItemChild;
  index: number;
  total: number;
  onChange: (updated: EditItemChild) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="adm-child-card">
      <div className="adm-child-header">
        <strong>Item {index + 1}</strong>
        <div className="adm-child-actions">
          <button type="button" className="adm-btn adm-btn-sm" disabled={index === 0} onClick={onMoveUp} aria-label="Move up">↑</button>
          <button type="button" className="adm-btn adm-btn-sm" disabled={index === total - 1} onClick={onMoveDown} aria-label="Move down">↓</button>
          <button type="button" className="adm-btn adm-btn-sm adm-btn-danger" onClick={onRemove} aria-label="Remove item">Remove</button>
        </div>
      </div>
      <div className="adm-form-row">
        <label>
          Name *
          <input
            value={child.name}
            onChange={(e) => onChange({ ...child, name: e.target.value })}
            placeholder="Item name"
          />
        </label>
        <label>
          Quantity Requested *
          <input
            type="number"
            min={1}
            value={child.quantityRequested}
            onChange={(e) => onChange({ ...child, quantityRequested: Math.max(1, Number(e.target.value)) })}
            style={{ minWidth: 100 }}
          />
        </label>
        <label>
          Condition
          <select
            className="adm-select"
            value={child.condition}
            onChange={(e) => onChange({ ...child, condition: e.target.value as "new" | "gently_used" | "any" })}
          >
            <option value="new">New</option>
            <option value="gently_used">Gently used</option>
            <option value="any">Any</option>
          </select>
        </label>
      </div>
      <div className="adm-form-row">
        <label style={{ flex: 1 }}>
          Description *
          <input
            value={child.description}
            onChange={(e) => onChange({ ...child, description: e.target.value })}
            placeholder="Optional description"
            style={{ minWidth: 300 }}
          />
        </label>
        <label style={{ flex: 1 }}>
          Product URL
          <input
            value={child.productUrl}
            onChange={(e) => onChange({ ...child, productUrl: e.target.value })}
            placeholder="https://…"
            style={{ minWidth: 200 }}
          />
        </label>
      </div>
    </div>
  );
}

function RoleChildEditor({
  child,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  child: EditRoleChild;
  index: number;
  total: number;
  onChange: (updated: EditRoleChild) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="adm-child-card">
      <div className="adm-child-header">
        <strong>Role {index + 1}</strong>
        <div className="adm-child-actions">
          <button type="button" className="adm-btn adm-btn-sm" disabled={index === 0} onClick={onMoveUp} aria-label="Move up">↑</button>
          <button type="button" className="adm-btn adm-btn-sm" disabled={index === total - 1} onClick={onMoveDown} aria-label="Move down">↓</button>
          <button type="button" className="adm-btn adm-btn-sm adm-btn-danger" onClick={onRemove} aria-label="Remove role">Remove</button>
        </div>
      </div>
      <div className="adm-form-row">
        <label>
          Name *
          <input
            value={child.name}
            onChange={(e) => onChange({ ...child, name: e.target.value })}
            placeholder="Role name"
          />
        </label>
        <label>
          Quantity Needed *
          <input
            type="number"
            min={1}
            value={child.quantityNeeded}
            onChange={(e) => onChange({ ...child, quantityNeeded: Math.max(1, Number(e.target.value)) })}
            style={{ minWidth: 100 }}
          />
        </label>
      </div>
      <div className="adm-form-row">
        <label style={{ flex: 1 }}>
          Description *
          <input
            value={child.description}
            onChange={(e) => onChange({ ...child, description: e.target.value })}
            placeholder="Optional description"
            style={{ minWidth: 300 }}
          />
        </label>
      </div>
    </div>
  );
}

// ── Main page component ──────────────────────────────────────────────────────

export function RequestsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selected, setSelected] = useState<{ type: RequestKind; id: string } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Edit-mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const listQueryKey = tab === "returned"
    ? "/api/admin/requests?status=returned"
    : `/api/admin/requests?status=${tab}`;

  const listQuery = useQuery<{ requests: QueueRow[] }>({
    queryKey: [listQueryKey],
  });
  const detailQuery = useQuery<Detail>({
    queryKey: [`/api/admin/requests/${selected?.type}/${selected?.id}`],
    enabled: selected !== null,
  });

  function switchTab(next: Tab) {
    setTab(next);
    resetPanel();
  }

  function resetPanel() {
    setSelected(null);
    setConfirm(null);
    setReturning(false);
    setNote("");
    setResult(null);
    setEditing(false);
    setEditForm(null);
    setEditError(null);
  }

  async function refreshAfterAction() {
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/nav-counts"] });
    for (const status of ["pending", "active", "archived", "returned"]) {
      const key = status === "returned"
        ? "/api/admin/requests?status=returned"
        : `/api/admin/requests?status=${status}`;
      await queryClient.invalidateQueries({ queryKey: [key] });
    }
    if (selected) {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/requests/${selected.type}/${selected.id}`] });
    }
  }

  async function act(path: string, body?: unknown, onSuccess?: () => void) {
    setBusy(true);
    setResult(null);
    try {
      const { ok, message } = await postJson(path, body);
      setResult({ kind: ok ? "ok" : "error", text: message });
      if (ok) {
        setConfirm(null);
        setReturning(false);
        setNote("");
        onSuccess?.();
      }
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await refreshAfterAction();
    }
  }

  async function uploadImage(file: File) {
    if (!selected) return;
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`/api/admin/requests/${selected.type}/${selected.id}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      let payload: { message?: string } = {};
      try {
        payload = (await res.json()) as { message?: string };
      } catch {
        /* fall through */
      }
      setResult({ kind: res.ok ? "ok" : "error", text: payload.message ?? FAILURE });
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      await refreshAfterAction();
    }
  }

  function startEdit() {
    if (!detail) return;
    setEditForm(buildEditForm(detail));
    setEditError(null);
    setEditing(true);
    setConfirm(null);
    setReturning(false);
    setResult(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditForm(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editForm || !detail || !selected) return;
    const err = validateEditForm(editForm, detail.type);
    if (err) {
      setEditError(err);
      return;
    }
    setEditError(null);
    setBusy(true);
    setResult(null);
    try {
      const payload = buildEditPayload(editForm, detail.type);
      const { ok, message } = await postJson(
        `/api/admin/requests/${detail.type}/${selected.id}/edit`,
        payload,
      );
      setResult({ kind: ok ? "ok" : "error", text: message });
      if (ok) {
        setEditing(false);
        setEditForm(null);
      }
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await refreshAfterAction();
    }
  }

  // ── item children helpers ────────────────────────────────────────────────
  function updateItemChild(index: number, updated: EditItemChild) {
    if (!editForm) return;
    const next = [...editForm.itemChildren];
    next[index] = updated;
    setEditForm({ ...editForm, itemChildren: next });
  }
  function removeItemChild(index: number) {
    if (!editForm) return;
    const next = editForm.itemChildren.filter((_, i) => i !== index);
    setEditForm({ ...editForm, itemChildren: next });
  }
  function moveItemChild(from: number, to: number) {
    if (!editForm) return;
    const next = [...editForm.itemChildren];
    const spliced = next.splice(from, 1);
    const item = spliced[0];
    if (!item) return;
    next.splice(to, 0, item);
    setEditForm({ ...editForm, itemChildren: next });
  }
  function addItemChild() {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      itemChildren: [
        ...editForm.itemChildren,
        { _key: nextKey(), name: "", description: "", condition: "any", productUrl: "", quantityRequested: 1 },
      ],
    });
  }

  // ── role children helpers ────────────────────────────────────────────────
  function updateRoleChild(index: number, updated: EditRoleChild) {
    if (!editForm) return;
    const next = [...editForm.roleChildren];
    next[index] = updated;
    setEditForm({ ...editForm, roleChildren: next });
  }
  function removeRoleChild(index: number) {
    if (!editForm) return;
    const next = editForm.roleChildren.filter((_, i) => i !== index);
    setEditForm({ ...editForm, roleChildren: next });
  }
  function moveRoleChild(from: number, to: number) {
    if (!editForm) return;
    const next = [...editForm.roleChildren];
    const spliced = next.splice(from, 1);
    const item = spliced[0];
    if (!item) return;
    next.splice(to, 0, item);
    setEditForm({ ...editForm, roleChildren: next });
  }
  function addRoleChild() {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      roleChildren: [
        ...editForm.roleChildren,
        { _key: nextKey(), name: "", description: "", quantityNeeded: 1 },
      ],
    });
  }

  function toggleVolunteerCategory(categoryId: string) {
    if (!editForm) return;
    const selected = editForm.categoryIds.includes(categoryId);
    setEditForm({
      ...editForm,
      categoryIds: selected
        ? editForm.categoryIds.filter((id) => id !== categoryId)
        : [...editForm.categoryIds, categoryId],
    });
  }

  const rows = listQuery.data?.requests ?? [];
  const visible = rows.filter((r) => typeFilter === "all" || r.type === typeFilter);
  const detail = detailQuery.data ?? null;
  const request = detail?.request ?? null;

  // §6/§7: recipients preview for the approve confirmation, resolved the way
  // the server resolves them — contact then creator, deduped by address.
  const recipientEmails: string[] = [];
  if (detail) {
    for (const email of [detail.orgContact?.email, detail.creator?.email]) {
      if (email && !recipientEmails.some((e) => e.toLowerCase() === email.toLowerCase())) {
        recipientEmails.push(email);
      }
    }
  }
  const recipientsText =
    recipientEmails.length === 2
      ? `${recipientEmails[0]} and ${recipientEmails[1]}`
      : recipientEmails.length === 1
        ? recipientEmails[0]
        : "no one — no contact is on file";

  const orgNotApproved = detail !== null && detail.organization.status !== "approved";
  const noChildren = detail !== null && detail.children.length === 0;
  const hasActiveVolunteerCategory =
    detail?.type !== "volunteer" || detail.categories.some((category) => category.selected && category.isActive);
  const approveBlockedReason = detail
    ? orgNotApproved
      ? `${detail.organization.name} is not approved yet, so this request cannot be published.`
      : noChildren
        ? detail.type === "item"
          ? "This request has no items and cannot be approved."
          : "This request has no roles and cannot be approved."
        : !hasActiveVolunteerCategory
          ? "Assign at least one active volunteer category before approving this request."
        : null
    : null;

  const emptyLine =
    tab === "pending"
      ? PENDING_EMPTY
      : tab === "active"
        ? "No active requests."
        : tab === "archived"
          ? "No archived requests."
          : "No returned drafts.";

  const isEditable = detail?.editability?.editable ?? false;

  return (
    <div>
      <h1 className="adm-heading">Requests</h1>

      <div className="adm-tabs" role="tablist">
        {(["pending", "active", "archived", "returned"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "adm-tab adm-tab-on" : "adm-tab"}
            onClick={() => switchTab(t)}
          >
            {t === "pending"
              ? "Pending"
              : t === "active"
                ? "Active"
                : t === "archived"
                  ? "Archived"
                  : "Returned for changes"}
          </button>
        ))}
      </div>

      <div className="adm-filter" role="group" aria-label="Type filter">
        {(["all", "item", "volunteer"] as TypeFilter[]).map((f) => (
          <button
            key={f}
            className={typeFilter === f ? "adm-filterbtn adm-filterbtn-on" : "adm-filterbtn"}
            onClick={() => setTypeFilter(f)}
          >
            {f === "all" ? "All" : f === "item" ? "Items" : "Volunteer"}
          </button>
        ))}
      </div>

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="adm-muted">{emptyLine}</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Organization</th>
              <th>{tab === "returned" ? "Returned" : "Submitted"}</th>
              <th>{typeFilter === "volunteer" ? "Roles" : typeFilter === "item" ? "Items" : "Items / roles"}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.type}-${row.id}`}
                className={selected?.id === row.id ? "adm-row adm-row-on" : "adm-row"}
                onClick={() => {
                  setSelected({ type: row.type, id: row.id });
                  setConfirm(null);
                  setReturning(false);
                  setNote("");
                  setResult(null);
                  setEditing(false);
                  setEditForm(null);
                  setEditError(null);
                }}
              >
                <td>{row.type === "item" ? "Item" : "Volunteer"}</td>
                <td>{row.title}</td>
                <td>
                  {row.orgName}
                  {row.orgCity ? ` — ${row.orgCity}` : ""}
                </td>
                <td>{formatDate(tab === "returned" ? (row.returnedAt ?? null) : row.submittedAt)}</td>
                <td>{row.childCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected !== null && (
        <div className="adm-detail">
          {detailQuery.isError ? (
            <p className="adm-alert">{DETAIL_ERROR}</p>
          ) : detailQuery.isLoading || !detail || !request ? (
            <p className="adm-muted">Loading…</p>
          ) : editing && editForm ? (
            /* ──────────── EDIT MODE ──────────── */
            <div className="adm-edit-form">
              <h2 className="adm-subheading">Edit Request</h2>

              <div className="adm-form-section">
                <h3 className="adm-form-section-title">Request Details</h3>
                <div className="adm-form-row">
                  <label style={{ flex: 1 }}>
                    Title *
                    <input
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      style={{ minWidth: 300 }}
                    />
                  </label>
                </div>
                <div className="adm-form-row">
                  <label style={{ flex: 1 }}>
                    Description *
                    <textarea
                      className="adm-note"
                      value={editForm.description}
                      rows={4}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                  </label>
                </div>
                {detail.type === "volunteer" && (
                  <div className="adm-form-row">
                    <label style={{ flex: 1 }}>
                      Details *
                      <textarea
                        className="adm-note"
                        value={editForm.details}
                        rows={4}
                        onChange={(e) => setEditForm({ ...editForm, details: e.target.value })}
                      />
                    </label>
                  </div>
                )}
                <div className="adm-form-row">
                  <label>
                    People Helped
                    <input
                      type="number"
                      min={0}
                      value={editForm.peopleHelped}
                      onChange={(e) => setEditForm({ ...editForm, peopleHelped: e.target.value })}
                      placeholder="Optional"
                      style={{ minWidth: 120 }}
                    />
                  </label>
                </div>
              </div>

              {detail.type === "volunteer" && (
                <div className="adm-form-section">
                  <h3 className="adm-form-section-title">Volunteer Categories</h3>
                  <p className="adm-muted">Choose the categories that describe this opportunity.</p>
                  <fieldset>
                    <legend className="sr-only">Volunteer categories</legend>
                    {detail.categories.map((category) => {
                      const checked = editForm.categoryIds.includes(category.id);
                      return (
                        <label key={category.id} style={{ display: "block", marginBottom: 6 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!category.isActive && !checked}
                            onChange={() => toggleVolunteerCategory(category.id)}
                          />{" "}
                          {category.name}
                          {!category.isActive ? " (inactive — remove only)" : ""}
                        </label>
                      );
                    })}
                  </fieldset>
                  {detail.categories.length === 0 && (
                    <p className="adm-alert">No active volunteer categories are available. Staff must add one before this request can be approved.</p>
                  )}
                </div>
              )}

              <div className="adm-form-section">
                <h3 className="adm-form-section-title">Deadline</h3>
                <div className="adm-form-row">
                  <label>
                    Deadline Type
                    <select
                      className="adm-select"
                      value={editForm.deadlineType}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          deadlineType: e.target.value as "date_specific" | "until_fulfilled" | "ongoing",
                        })
                      }
                    >
                      <option value="date_specific">Date specific</option>
                      <option value="until_fulfilled">Until fulfilled</option>
                      <option value="ongoing">Ongoing</option>
                    </select>
                  </label>
                  {editForm.deadlineType === "date_specific" && (
                    <label>
                      Deadline Date *
                      <input
                        type="date"
                        value={editForm.deadlineDate}
                        onChange={(e) => setEditForm({ ...editForm, deadlineDate: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="adm-form-section">
                <h3 className="adm-form-section-title">Location</h3>
                {detail.type === "item" ? (
                  <div className="adm-form-row">
                    <label style={{ flex: 1 }}>
                      Drop-off Location
                      <input
                        value={editForm.dropoffLocation}
                        onChange={(e) => setEditForm({ ...editForm, dropoffLocation: e.target.value })}
                        placeholder="Optional"
                        style={{ minWidth: 300 }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="adm-form-row">
                    <label style={{ flex: 1 }}>
                      Event Location *
                      <input
                        value={editForm.eventLocation}
                        onChange={(e) => setEditForm({ ...editForm, eventLocation: e.target.value })}
                        placeholder="Optional"
                        style={{ minWidth: 300 }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="adm-form-section">
                <h3 className="adm-form-section-title">Request Contact</h3>
                <div className="adm-form-row">
                  <label>
                    First Name *
                    <input
                      value={editForm.contactFirstName}
                      onChange={(e) => setEditForm({ ...editForm, contactFirstName: e.target.value })}
                    />
                  </label>
                  <label>
                    Last Name *
                    <input
                      value={editForm.contactLastName}
                      onChange={(e) => setEditForm({ ...editForm, contactLastName: e.target.value })}
                    />
                  </label>
                </div>
                <div className="adm-form-row">
                  <label>
                    Email *
                    <input
                      type="email"
                      value={editForm.contactEmail}
                      onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                    />
                  </label>
                  <label>
                    Phone *
                    <input
                      value={editForm.contactPhone}
                      onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })}
                    />
                  </label>
                </div>
              </div>

              <div className="adm-form-section">
                <h3 className="adm-form-section-title">
                  {detail.type === "item" ? "Items" : "Roles"}
                </h3>
                {detail.type === "item" ? (
                  <>
                    {editForm.itemChildren.map((child, i) => (
                      <ItemChildEditor
                        key={child._key}
                        child={child}
                        index={i}
                        total={editForm.itemChildren.length}
                        onChange={(u) => updateItemChild(i, u)}
                        onRemove={() => removeItemChild(i)}
                        onMoveUp={() => moveItemChild(i, i - 1)}
                        onMoveDown={() => moveItemChild(i, i + 1)}
                      />
                    ))}
                    <button type="button" className="adm-btn" onClick={addItemChild}>
                      + Add Item
                    </button>
                  </>
                ) : (
                  <>
                    {editForm.roleChildren.map((child, i) => (
                      <RoleChildEditor
                        key={child._key}
                        child={child}
                        index={i}
                        total={editForm.roleChildren.length}
                        onChange={(u) => updateRoleChild(i, u)}
                        onRemove={() => removeRoleChild(i)}
                        onMoveUp={() => moveRoleChild(i, i - 1)}
                        onMoveDown={() => moveRoleChild(i, i + 1)}
                      />
                    ))}
                    <button type="button" className="adm-btn" onClick={addRoleChild}>
                      + Add Role
                    </button>
                  </>
                )}
              </div>

              {/* Image upload stays accessible while editing */}
              {isEditable && (
                <div className="adm-form-section">
                  <h3 className="adm-form-section-title">Image</h3>
                  {request.imageUrl && (
                    <>
                      <img className="adm-img" src={request.imageUrl} alt={request.title} />
                      {request.imageGenerated && (
                        <p className="adm-ai-label">AI-generated — review before approving.</p>
                      )}
                    </>
                  )}
                  <p className="adm-upload">
                    <label htmlFor="adm-request-image-edit">Add or replace the image (saved immediately):</label>{" "}
                    <input
                      id="adm-request-image-edit"
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadImage(file);
                      }}
                    />
                  </p>
                </div>
              )}

              {editError && <p className="adm-alert">{editError}</p>}
              {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

              <div className="adm-actions">
                <button className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void saveEdit()}>
                  Save Changes
                </button>
                <button className="adm-btn" disabled={busy} onClick={cancelEdit}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ──────────── VIEW MODE ──────────── */
            <>
              {/* Latest return note (returned drafts) */}
              {detail.latestReturn && (
                <div className="adm-return-note">
                  <strong>Last return note</strong>{" "}
                  <span className="adm-muted">({formatDate(detail.latestReturn.createdAt)})</span>
                  <p className="adm-return-note-body">{detail.latestReturn.note}</p>
                  <p className="adm-muted adm-return-note-disclaimer">
                    This note is history only. It does not trigger any AI processing, send any email, or make
                    any change to the request. Staff must contact the organization directly.
                  </p>
                </div>
              )}

              {/* §4: the request as the public will see it, image included. */}
              <h2 className="adm-subheading">{request.title}</h2>
              <p className="adm-muted">
                {detail.type === "item" ? "Item request" : "Volunteer request"} · {detail.organization.name}
                {detail.organization.city ? ` — ${detail.organization.city}` : ""}
              </p>
              {request.imageUrl ? (
                <>
                  <img className="adm-img" src={request.imageUrl} alt={request.title} />
                  {request.imageGenerated && <p className="adm-ai-label">AI-generated — review before approving.</p>}
                </>
              ) : (
                <p className="adm-muted">Image: {NOT_PROVIDED}</p>
              )}
              {request.imageGenStatus === "failed" && (
                <p className="adm-alert">
                  Automatic image sourcing failed{request.imageGenError ? `: ${request.imageGenError}` : "."}
                </p>
              )}
              {request.imageGenStatus === "pending" && !request.imageUrl && (
                <p className="adm-muted">An image is being sourced automatically…</p>
              )}
              {request.description ? <p>{request.description}</p> : <p className="adm-muted">Description: {NOT_PROVIDED}</p>}
              {detail.type === "volunteer" &&
                (request.details ? <p>{request.details}</p> : <p className="adm-muted">Details: {NOT_PROVIDED}</p>)}

              <dl className="adm-kv">
                <dt>Deadline</dt>
                <dd>{deadlineLabel(request)}</dd>
                {detail.type === "item" ? (
                  <>
                    <dt>Drop-off location</dt>
                    <dd>{request.dropoffLocation ?? NOT_PROVIDED}</dd>
                  </>
                ) : (
                  <>
                    <dt>Event location</dt>
                    <dd>{request.eventLocation ?? NOT_PROVIDED}</dd>
                  </>
                )}
                <dt>People helped</dt>
                <dd>{request.peopleHelped ?? NOT_PROVIDED}</dd>
                {detail.type === "volunteer" && (
                  <>
                    <dt>Volunteer categories</dt>
                    <dd>
                      {detail.categories.filter((category) => category.selected).length > 0
                        ? detail.categories
                            .filter((category) => category.selected)
                            .map((category) => `${category.name}${category.isActive ? "" : " (inactive)"}`)
                            .join(", ")
                        : "No categories assigned — assign an active category before approval."}
                    </dd>
                  </>
                )}
                <dt>Request contact</dt>
                <dd>
                  {detail.requestContact
                    ? `${detail.requestContact.firstName} ${detail.requestContact.lastName} · ${detail.requestContact.email}${detail.requestContact.phone ? ` · ${detail.requestContact.phone}` : ""}`
                    : NOT_PROVIDED}
                </dd>
                <dt>Submitted</dt>
                <dd>{formatDate(request.submittedAt)}</dd>
                <dt>Created by</dt>
                <dd>{detail.creator ? `${detail.creator.name} · ${detail.creator.email}` : NOT_PROVIDED}</dd>
                {request.approvedAt && (
                  <>
                    <dt>Approved</dt>
                    <dd>{formatDate(request.approvedAt)}</dd>
                  </>
                )}
              </dl>

              {detail.type === "item" ? (
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Condition</th>
                      <th>Requested</th>
                      <th>Claimed</th>
                      <th>Received</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.children as ItemChild[]).map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.name}
                          {item.productUrl ? (
                            <>
                              {" "}
                              <a href={item.productUrl} target="_blank" rel="noreferrer">
                                link
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td>{item.condition ?? "—"}</td>
                        <td>{item.quantityRequested}</td>
                        <td>{item.quantityClaimed}</td>
                        <td>{item.quantityReceived}</td>
                        <td>{item.quantityRemaining}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Needed</th>
                      <th>Interested</th>
                      <th>Confirmed</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.children as RoleChild[]).map((role) => (
                      <tr key={role.id}>
                        <td>{role.name}</td>
                        <td>{role.quantityNeeded}</td>
                        <td>{role.quantityInterested}</td>
                        <td>{role.quantityConfirmed}</td>
                        <td>{role.quantityRemaining}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Image upload — only when editable */}
              {isEditable && (
                <p className="adm-upload">
                  <label htmlFor="adm-request-image">Add or replace the image (saved immediately):</label>{" "}
                  <input
                    id="adm-request-image"
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadImage(file);
                    }}
                  />
                </p>
              )}

              {/* Auto-sourced image controls — both kinds, never over an uploaded photo. */}
              {isEditable && (request.imageUrl === null || request.imageGenerated) && (
                <p className="adm-upload">
                  <button
                    className="adm-btn"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/generate-image`)}
                  >
                    {request.imageUrl ? "Regenerate auto image" : "Find an image automatically"}
                  </button>{" "}
                  {request.imageUrl !== null && request.imageGenerated && (
                    <button
                      className="adm-btn"
                      disabled={busy}
                      onClick={() =>
                        void act(`/api/admin/requests/${detail.type}/${request.id}/remove-generated-image`)
                      }
                    >
                      Remove auto image
                    </button>
                  )}
                </p>
              )}

              {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

              <div className="adm-actions">
                {/* Edit button — available from pending and returned when editable */}
                {isEditable && (
                  <button className="adm-btn" disabled={busy} onClick={startEdit}>
                    Edit Request
                  </button>
                )}

                {request.status === "pending" && (
                  <>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || approveBlockedReason !== null}
                      onClick={() => setConfirm({ kind: "approve" })}
                    >
                      Approve
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setReturning(true)}>
                      Return to draft
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: "archive" })}>
                      Archive
                    </button>
                  </>
                )}
                {request.status === "active" && (
                  <>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || !detail.editability.unapprovable}
                      onClick={() => setConfirm({ kind: "unapprove" })}
                    >
                      Unapprove
                    </button>
                    <button className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: "archive" })}>
                      Archive
                    </button>
                  </>
                )}
                {request.status === "archived" && (
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/reinstate`)}
                  >
                    Reinstate
                  </button>
                )}
                {request.status === "draft" && (
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/move-to-pending`)}
                  >
                    Move to Pending
                  </button>
                )}
              </div>

              {/* §7: blocked reasons stated, not just a dead button. */}
              {request.status === "pending" && approveBlockedReason && (
                <p className="adm-alert">{approveBlockedReason}</p>
              )}
              {request.status === "active" &&
                !detail.editability.unapprovable &&
                detail.editability.unapprovalReason && (
                  <p className="adm-alert">{detail.editability.unapprovalReason}</p>
                )}

              {/* Not editable reason */}
              {!isEditable && detail.editability.reason && (
                <p className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {detail.editability.reason}
                </p>
              )}

              {confirm?.kind === "approve" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>
                    Approve {request.title}? This publishes the request and sends any approval email not already
                    delivered to {recipientsText}.
                  </p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/approve`)}
                  >
                    Approve
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {confirm?.kind === "unapprove" && (
                <div className="adm-confirm">
                  <p>
                    Unapprove {request.title}? It will leave public view immediately, return to Pending, and become
                    editable. No email is sent.
                  </p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/api/admin/requests/${detail.type}/${request.id}/unapprove`,
                        undefined,
                        () => setTab("pending"),
                      )
                    }
                  >
                    Unapprove
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {confirm?.kind === "archive" && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>Archive {request.title}? It will stop appearing publicly. No email is sent.</p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/api/admin/requests/${detail.type}/${request.id}/archive`)}
                  >
                    Archive
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {returning && (
                <div className="adm-confirm">
                  {/* §8 verbatim — the D45 reminder that Christina owns outreach. */}
                  <p>{RETURN_PROMPT}</p>
                  <textarea
                    className="adm-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    aria-label="Return-to-draft note"
                  />
                  <div>
                    <button
                      className="adm-btn adm-btn-primary"
                      disabled={busy || note.trim() === ""}
                      onClick={() =>
                        void act(`/api/admin/requests/${detail.type}/${request.id}/return-to-draft`, {
                          note: note.trim(),
                        })
                      }
                    >
                      Return to draft
                    </button>
                    <button
                      className="adm-btn"
                      disabled={busy}
                      onClick={() => {
                        setReturning(false);
                        setNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
