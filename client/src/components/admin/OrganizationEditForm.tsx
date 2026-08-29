import { useRef, useState } from "react";

export type OrganizationEditDetail = {
  organization: {
    id: string;
    name: string;
    websiteUrl: string | null;
    mission: string | null;
    phone: string | null;
    logoUrl: string | null;
    populationsOther: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  populations: { id: string; name: string }[];
  populationOptions?: { id: string; name: string; slug: string }[];
};

type FormState = {
  name: string;
  websiteUrl: string;
  mission: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  populationIds: string[];
  populationsOther: string;
  firstName: string;
  lastName: string;
  email: string;
  contactPhone: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const SAVE_FAILURE = "That did not save. Nothing was changed.";

function initialState(detail: OrganizationEditDetail): FormState {
  const { organization: org, contact } = detail;
  return {
    name: org.name,
    websiteUrl: org.websiteUrl ?? "",
    mission: org.mission ?? "",
    phone: org.phone ?? "",
    addressLine1: org.addressLine1 ?? "",
    addressLine2: org.addressLine2 ?? "",
    city: org.city ?? "",
    state: org.state ?? "",
    postalCode: org.postalCode ?? "",
    populationIds: detail.populations.map((population) => population.id),
    populationsOther: org.populationsOther ?? "",
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    contactPhone: contact?.phone ?? "",
  };
}

function isValidWebsite(raw: string): boolean {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function responseMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : SAVE_FAILURE;
}

export function OrganizationEditForm({
  detail,
  onCancel,
  onSaved,
}: {
  detail: OrganizationEditDetail;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(detail));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmEmailChange, setConfirmEmailChange] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const options = detail.populationOptions ?? [];
  const otherId = options.find((option) => option.slug === "other")?.id ?? null;
  const otherSelected = otherId !== null && form.populationIds.includes(otherId);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
    if (key === "email") setConfirmEmailChange(false);
  }

  function togglePopulation(id: string) {
    setField(
      "populationIds",
      form.populationIds.includes(id)
        ? form.populationIds.filter((populationId) => populationId !== id)
        : [...form.populationIds, id],
    );
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [key, label] of [
      ["name", "Organization name"],
      ["websiteUrl", "Website"],
      ["mission", "Mission statement"],
      ["phone", "Main phone"],
      ["city", "City"],
      ["firstName", "Contact first name"],
      ["lastName", "Contact last name"],
      ["email", "Contact email"],
      ["contactPhone", "Contact phone"],
    ] as const) {
      if (form[key].trim() === "") next[key] = `${label} is required.`;
    }
    if (form.websiteUrl.trim() !== "" && !isValidWebsite(form.websiteUrl.trim())) {
      next.websiteUrl = "Please enter a valid website URL.";
    }
    if (form.email.trim() !== "" && !EMAIL_RE.test(form.email.trim())) {
      next.email = "Please enter a valid email.";
    }
    if (form.populationIds.length < 1) next.populationIds = "Select at least one population.";
    return next;
  }

  function onLogoChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((current) => ({ ...current, logo: "Please choose an image file." }));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setErrors((current) => ({ ...current, logo: "Please choose an image under 5 MB." }));
      return;
    }
    setErrors((current) => {
      const { logo: _logo, ...rest } = current;
      return rest;
    });
    setLogoFile(file);
  }

  async function save(forceEmailChange = false) {
    const nextErrors = validate();
    setErrors(nextErrors);
    setMessage(null);
    if (Object.keys(nextErrors).length > 0) return;
    const originalEmail = detail.contact?.email.trim().toLowerCase() ?? "";
    if (!forceEmailChange && form.email.trim().toLowerCase() !== originalEmail) {
      setConfirmEmailChange(true);
      return;
    }

    setSaving(true);
    setConfirmEmailChange(false);
    try {
      const body = new FormData();
      body.append("name", form.name.trim());
      body.append("websiteUrl", form.websiteUrl.trim());
      body.append("mission", form.mission.trim());
      body.append("phone", form.phone.trim());
      body.append("addressLine1", form.addressLine1.trim());
      body.append("addressLine2", form.addressLine2.trim());
      body.append("city", form.city.trim());
      body.append("state", form.state.trim());
      body.append("postalCode", form.postalCode.trim());
      for (const id of form.populationIds) body.append("populationIds", id);
      if (otherSelected && form.populationsOther.trim()) body.append("populationsOther", form.populationsOther.trim());
      body.append("firstName", form.firstName.trim());
      body.append("lastName", form.lastName.trim());
      body.append("email", form.email.trim());
      body.append("contactPhone", form.contactPhone.trim());
      if (logoFile) body.append("logo", logoFile);

      const response = await fetch(`/api/admin/organizations/${detail.organization.id}`, { method: "PUT", body });
      const responseBody = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(responseBody?.message ?? SAVE_FAILURE);
      await onSaved(responseBody?.message ?? "Organization updated.");
    } catch (error) {
      setMessage(responseMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? <p className="adm-edit-error" role="alert">{errors[key]}</p> : null;

  return (
    <form
      className="adm-org-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <h3 className="adm-edit-section">Organization information</h3>
      <div className="adm-edit-grid">
        <label>
          <span>Organization name</span>
          <input value={form.name} onChange={(event) => setField("name", event.target.value)} />
          {fieldError("name")}
        </label>
        <label>
          <span>Website</span>
          <input value={form.websiteUrl} onChange={(event) => setField("websiteUrl", event.target.value)} />
          {fieldError("websiteUrl")}
        </label>
        <label className="adm-edit-wide">
          <span>Mission statement</span>
          <textarea value={form.mission} onChange={(event) => setField("mission", event.target.value)} />
          {fieldError("mission")}
        </label>
        <label>
          <span>Main phone</span>
          <input value={form.phone} onChange={(event) => setField("phone", event.target.value)} />
          {fieldError("phone")}
        </label>
        <label>
          <span>Address line 1</span>
          <input value={form.addressLine1} onChange={(event) => setField("addressLine1", event.target.value)} />
        </label>
        <label>
          <span>Address line 2</span>
          <input value={form.addressLine2} onChange={(event) => setField("addressLine2", event.target.value)} />
        </label>
        <label>
          <span>City</span>
          <input value={form.city} onChange={(event) => setField("city", event.target.value)} />
          {fieldError("city")}
        </label>
        <label>
          <span>State</span>
          <input value={form.state} onChange={(event) => setField("state", event.target.value)} />
        </label>
        <label>
          <span>Postal code</span>
          <input value={form.postalCode} onChange={(event) => setField("postalCode", event.target.value)} />
        </label>
      </div>

      <fieldset className="adm-edit-populations">
        <legend>Populations served</legend>
        {options.map((option) => (
          <label key={option.id}>
            <input
              type="checkbox"
              checked={form.populationIds.includes(option.id)}
              onChange={() => togglePopulation(option.id)}
            />
            <span>{option.name}</span>
          </label>
        ))}
        {otherSelected && (
          <label className="adm-edit-wide">
            <span>Other population details</span>
            <input
              value={form.populationsOther}
              onChange={(event) => setField("populationsOther", event.target.value)}
            />
          </label>
        )}
        {fieldError("populationIds")}
      </fieldset>

      <div className="adm-edit-logo">
        <span>Logo</span>
        {detail.organization.logoUrl && (
          <img src={detail.organization.logoUrl} alt="Current organization logo" className="adm-logo" />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => onLogoChange(event.target.files?.[0] ?? null)}
        />
        <button type="button" className="adm-btn adm-btn-outline" onClick={() => fileRef.current?.click()}>
          {logoFile ? logoFile.name : "Replace logo"}
        </button>
        <small>Image must be under 5 MB.</small>
        {fieldError("logo")}
      </div>

      <h3 className="adm-edit-section">Primary contact</h3>
      <div className="adm-edit-grid">
        <label>
          <span>First name</span>
          <input value={form.firstName} onChange={(event) => setField("firstName", event.target.value)} />
          {fieldError("firstName")}
        </label>
        <label>
          <span>Last name</span>
          <input value={form.lastName} onChange={(event) => setField("lastName", event.target.value)} />
          {fieldError("lastName")}
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} />
          {fieldError("email")}
        </label>
        <label>
          <span>Phone</span>
          <input value={form.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
          {fieldError("contactPhone")}
        </label>
      </div>

      {confirmEmailChange && (
        <div className="adm-confirm" role="alertdialog" aria-label="Confirm contact email change">
          <p className="adm-confirm-text">
            Change the primary contact email? If this contact has a login account, the change will be blocked so their
            sign-in identity is never moved silently.
          </p>
          <div className="adm-btn-row">
            <button type="button" className="adm-btn" onClick={() => void save(true)}>
              Confirm email change
            </button>
            <button type="button" className="adm-btn adm-btn-outline" onClick={() => setConfirmEmailChange(false)}>
              Keep editing
            </button>
          </div>
        </div>
      )}
      {message && <p className="adm-danger" role="alert">{message}</p>}
      <div className="adm-btn-row">
        <button type="submit" className="adm-btn" disabled={saving || confirmEmailChange}>
          {saving ? "Saving…" : "Save organization"}
        </button>
        <button type="button" className="adm-btn adm-btn-outline" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}