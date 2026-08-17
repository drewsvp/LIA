/**
 * MP-05 — /dashboard/organization. Settings + team management
 * (docs/specs/MP-05.md).
 *
 * Fields mirror MP-03 §5, pre-filled, population checklist WITHOUT the 1-2
 * cap (§5). One Submit below the contact fields per capture. Removal is a
 * status change through the owning DAL function — people and users rows are
 * never touched (§3). A member cannot remove themselves (D6), and the last
 * active member can never be removed (§12).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type PopulationOption = { id: string; name: string; slug: string };
type Settings = {
  org: {
    name: string;
    websiteUrl: string | null;
    city: string | null;
    phone: string | null;
    mission: string | null;
    populationsOther: string | null;
    logoUrl: string | null;
  };
  populationIds: string[];
  populationOptions: PopulationOption[];
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  members: { membershipId: string; firstName: string; lastName: string; email: string; isSelf: boolean }[];
};

const REQUIRED_MSG = "This field is required";
const SAVE_SUCCESS = "Your organization has been updated.";
const SAVE_FAILURE = "That didn't save. Please check the form and try again.";
const REMOVE_CONFIRM = "Remove this user from your organization?";
const REMOVE_SUCCESS = "User removed.";
const LOAD_FAILURE = "Something went wrong loading your organization. Please refresh the page and try again.";
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidWebsite(raw: string): boolean {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export function OrganizationSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery<Settings>({ queryKey: ["/api/dashboard/organization"] });
  const settings = settingsQuery.data;

  const [seeded, setSeeded] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [mission, setMission] = useState("");
  const [selectedPops, setSelectedPops] = useState<string[]>([]);
  const [otherDetail, setOtherDetail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [orgMessage, setOrgMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [selectedMember, setSelectedMember] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [teamMessage, setTeamMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Seed the form exactly once from the loaded values (§14: pre-filled).
  useEffect(() => {
    if (settings && !seeded) {
      setName(settings.org.name);
      setWebsite(settings.org.websiteUrl ?? "");
      setCity(settings.org.city ?? "");
      setPhone(settings.org.phone ?? "");
      setMission(settings.org.mission ?? "");
      setSelectedPops(settings.populationIds);
      setOtherDetail(settings.org.populationsOther ?? "");
      setFirstName(settings.contact?.firstName ?? "");
      setLastName(settings.contact?.lastName ?? "");
      setEmail(settings.contact?.email ?? "");
      setContactPhone(settings.contact?.phone ?? "");
      setSeeded(true);
    }
  }, [settings, seeded]);

  const options = settings?.populationOptions ?? [];
  const otherId = options.find((p) => p.slug === "other")?.id ?? null;
  const otherSelected = otherId !== null && selectedPops.includes(otherId);
  const members = settings?.members ?? [];
  const selectedMemberRow = members.find((m) => m.membershipId === selectedMember) ?? null;
  const removeDisabled =
    selectedMemberRow === null || selectedMemberRow.isSelf || members.length <= 1 || removing;

  function togglePopulation(id: string) {
    setSelectedPops((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function onLogoChange(file: File | null) {
    if (file === null) return;
    if (!file.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, logo: "Please choose an image file." }));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setErrors((e) => ({ ...e, logo: "Please choose an image under 5 MB." }));
      return;
    }
    setErrors((e) => {
      const { logo: _drop, ...rest } = e;
      return rest;
    });
    setLogoFile(file);
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim() === "") errs.name = REQUIRED_MSG;
    if (website.trim() === "") errs.website = REQUIRED_MSG;
    else if (!isValidWebsite(website.trim())) errs.website = "Please enter a valid website URL.";
    if (city.trim() === "") errs.city = REQUIRED_MSG;
    if (phone.trim() === "") errs.phone = REQUIRED_MSG;
    if (mission.trim() === "") errs.mission = REQUIRED_MSG;
    if (selectedPops.length < 1) errs.populations = REQUIRED_MSG;
    if (firstName.trim() === "") errs.firstName = REQUIRED_MSG;
    if (lastName.trim() === "") errs.lastName = REQUIRED_MSG;
    if (email.trim() === "") errs.email = REQUIRED_MSG;
    else if (!EMAIL_RE.test(email.trim())) errs.email = "Please enter a valid email.";
    if (contactPhone.trim() === "") errs.contactPhone = REQUIRED_MSG;
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setOrgMessage(null);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("websiteUrl", website.trim());
      fd.append("city", city.trim());
      fd.append("phone", phone.trim());
      fd.append("mission", mission.trim());
      for (const id of selectedPops) fd.append("populationIds", id);
      if (otherSelected && otherDetail.trim() !== "") fd.append("populationsOther", otherDetail.trim());
      if (logoFile) fd.append("logo", logoFile);
      fd.append("firstName", firstName.trim());
      fd.append("lastName", lastName.trim());
      fd.append("email", email.trim());
      fd.append("contactPhone", contactPhone.trim());

      const res = await fetch("/api/dashboard/organization", { method: "PUT", body: fd });
      if (res.ok) {
        setOrgMessage({ kind: "success", text: SAVE_SUCCESS });
        setLogoFile(null);
        // Refresh server values (logo preview, member list); the form keeps
        // its (identical) values — seeded stays true.
        await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/organization"] });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setOrgMessage({ kind: "error", text: body?.message ?? SAVE_FAILURE });
      }
    } catch {
      setOrgMessage({ kind: "error", text: SAVE_FAILURE });
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (selectedMemberRow === null) return;
    setRemoving(true);
    setTeamMessage(null);
    try {
      const res = await fetch("/api/dashboard/organization/remove-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: selectedMemberRow.membershipId }),
      });
      if (res.ok) {
        setTeamMessage({ kind: "success", text: REMOVE_SUCCESS });
        setSelectedMember("");
        await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/organization"] });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setTeamMessage({ kind: "error", text: body?.message ?? SAVE_FAILURE });
      }
    } catch {
      setTeamMessage({ kind: "error", text: SAVE_FAILURE });
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  if (settingsQuery.isError) {
    return (
      <div className="mp5-page">
        <div className="mp5-band">
          <h1 className="mp5-band-title">EDIT MY ORGANIZATION</h1>
        </div>
        <div className="mp5-body">
          <p className="mp5-load-error" role="alert">
            {LOAD_FAILURE}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mp5-page">
      <div className="mp5-band">
        <h1 className="mp5-band-title">EDIT MY ORGANIZATION</h1>
      </div>
      <div className="mp5-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>

        <form className="mp5-form" onSubmit={onSubmit} noValidate>
          <h2 className="mp5-section">ORGANIZATION INFO</h2>

          <label className="mp5-label" htmlFor="mp5-name">
            Organization Name
          </label>
          <input
            id="mp5-name"
            className="pub-input mp5-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldError("name")}

          <label className="mp5-label" htmlFor="mp5-website">
            Website
          </label>
          <input
            id="mp5-website"
            className="pub-input mp5-input"
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          {fieldError("website")}

          <label className="mp5-label" htmlFor="mp5-city">
            Address
          </label>
          <input
            id="mp5-city"
            className="pub-input mp5-input"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          {fieldError("city")}

          <label className="mp5-label" htmlFor="mp5-phone">
            Main Phone
          </label>
          <input
            id="mp5-phone"
            className="pub-input mp5-input"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {fieldError("phone")}

          <label className="mp5-label" htmlFor="mp5-mission">
            Mission Statement
          </label>
          <textarea
            id="mp5-mission"
            className="pub-input mp5-input mp5-textarea"
            value={mission}
            onChange={(e) => setMission(e.target.value)}
          />
          {fieldError("mission")}

          <fieldset className="mp5-pops">
            <legend className="mp5-label">Primary Population Served</legend>
            {settingsQuery.isLoading ? (
              <p className="mp5-note">Loading populations…</p>
            ) : (
              options.map((p) => (
                <label key={p.id} className="mp5-check">
                  <input
                    type="checkbox"
                    checked={selectedPops.includes(p.id)}
                    onChange={() => togglePopulation(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))
            )}
            {otherSelected ? (
              <input
                className="pub-input mp5-input mp5-other-input"
                type="text"
                aria-label="Tell us more about the population you serve"
                value={otherDetail}
                onChange={(e) => setOtherDetail(e.target.value)}
              />
            ) : null}
            {fieldError("populations")}
          </fieldset>

          {settings?.org.logoUrl ? (
            <img className="mp5-logo-preview" src={settings.org.logoUrl} alt="Current organization logo" />
          ) : null}

          <label className="mp5-label" htmlFor="mp5-logo">
            Logo
          </label>
          <input
            id="mp5-logo"
            ref={fileInputRef}
            className="mp3-file-hidden"
            type="file"
            accept="image/*"
            onChange={(e) => onLogoChange(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="mp5-logo-box" onClick={() => fileInputRef.current?.click()}>
            {logoFile ? logoFile.name : "Add a Picture +"}
          </button>
          <p className="mp5-helper">Recommended Size is 113 x 113 px. Image will update on submit</p>
          {fieldError("logo")}

          <h2 className="mp5-section mp5-section-contact">PRIMARY CONTACT INFO</h2>

          <label className="mp5-label">Name</label>
          <div className="mp5-name-row">
            <input
              className="pub-input mp5-input"
              type="text"
              aria-label="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              className="pub-input mp5-input"
              type="text"
              aria-label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          {fieldError("firstName")}
          {fieldError("lastName")}

          <label className="mp5-label" htmlFor="mp5-email">
            Email
          </label>
          <input
            id="mp5-email"
            className="pub-input mp5-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldError("email")}

          <label className="mp5-label" htmlFor="mp5-contact-phone">
            Phone Number
          </label>
          <input
            id="mp5-contact-phone"
            className="pub-input mp5-input"
            type="text"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {fieldError("contactPhone")}

          {orgMessage ? (
            <p
              className={orgMessage.kind === "success" ? "mp5-success" : "mp5-failure"}
              role={orgMessage.kind === "error" ? "alert" : "status"}
            >
              {orgMessage.text}
            </p>
          ) : null}

          <button type="submit" className="mp5-submit" disabled={saving || !seeded}>
            {saving ? "Submitting…" : "Submit"}
          </button>
        </form>

        <section className="mp5-team">
          <h2 className="mp5-team-heading">TEAM MEMBERS</h2>
          <select
            className="mp5-team-select"
            value={selectedMember}
            onChange={(e) => {
              setSelectedMember(e.target.value);
              setConfirming(false);
              setTeamMessage(null);
            }}
          >
            <option value="">Click to see your team members.</option>
            {members.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.firstName} {m.lastName} ({m.email})
              </option>
            ))}
          </select>
          {confirming && selectedMemberRow !== null ? (
            <div className="mp5-confirm" role="alertdialog" aria-label="Confirm removal">
              <p className="mp5-confirm-text">{REMOVE_CONFIRM}</p>
              <div className="mp5-confirm-actions">
                <button
                  type="button"
                  className="mp5-remove-btn"
                  disabled={removing}
                  onClick={() => void removeSelected()}
                >
                  {removing ? "Removing…" : "Remove User"}
                </button>
                <button
                  type="button"
                  className="mp5-cancel-btn"
                  disabled={removing}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mp5-remove-btn"
              disabled={removeDisabled}
              onClick={() => setConfirming(true)}
            >
              Remove User
            </button>
          )}
          {teamMessage ? (
            <p
              className={teamMessage.kind === "success" ? "mp5-success" : "mp5-failure"}
              role={teamMessage.kind === "error" ? "alert" : "status"}
            >
              {teamMessage.text}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
