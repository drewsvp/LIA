/**
 * MP-03 — /signup. Organization self-registration (docs/specs/MP-03.md).
 *
 * One continuous page: band heading, two instructional paragraphs,
 * ORGANIZATION INFO, PRIMARY CONTACT INFO, "Submit for Approval". One POST →
 * one transaction server-side. A failed submission retains every entered
 * value (§6); the duplicate-name and generic-failure messages are §8 copy.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type PopulationOption = { id: string; name: string; slug: string };

const SUCCESS_COPY =
  "Thank you for registering! We'll review your submission and set up your dashboard within 1-2 business days. Watch your email for next steps.";
const DUPLICATE_COPY =
  "It looks like your organization may already be registered. Please contact us at info@defendingthecause.org if you need help accessing your account.";
const FAILURE_COPY =
  "Something went wrong and your submission wasn't saved. Please try again, or contact us at info@defendingthecause.org if the problem continues.";
const REQUIRED_MSG = "This field is required";
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

export function SignupPage() {
  const populationsQuery = useQuery<PopulationOption[]>({ queryKey: ["/api/public/populations"] });

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
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const populations = populationsQuery.data ?? [];
  const otherId = useMemo(() => populations.find((p) => p.slug === "other")?.id ?? null, [populations]);
  const otherSelected = otherId !== null && selectedPops.includes(otherId);
  const capReached = selectedPops.length >= 2;

  function togglePopulation(id: string) {
    setSelectedPops((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 2) return prev; // Select 1-2: cap enforced
      return [...prev, id];
    });
  }

  function onLogoChange(file: File | null) {
    if (file === null) {
      setLogoFile(null);
      return;
    }
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
    if (logoFile === null) errs.logo = REQUIRED_MSG;
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
    setServerError(null);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
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

      const res = await fetch("/api/public/organization-signups", { method: "POST", body: fd });
      if (res.status === 201) {
        setSubmitted(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 409) {
        setServerError(body?.message ?? DUPLICATE_COPY);
      } else if (res.status === 400 || res.status === 429) {
        setServerError(body?.message ?? FAILURE_COPY);
      } else {
        setServerError(FAILURE_COPY);
      }
    } catch {
      setServerError(FAILURE_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null;

  return (
    <div className="mp3-page">
      <div className="mp3-band">
        <h1 className="mp3-band-title">ORGANIZATION SIGN UP</h1>
      </div>
      <div className="mp3-body">
        <p className="mp3-intro">
          Welcome to The Alliance's <strong>Love in Action Database!</strong> This platform is an exclusive tool
          for our Members and is designed to streamline the process of promoting your donation and volunteer
          needs to the community.
        </p>
        <p className="mp3-intro">
          Please fill out the form below and we will set up your dashboard in the next 1-2 business days. You
          will receive a series of 2 emails with instructions on creating a username and password then you'll be
          ready to create item and volunteer posts.
        </p>

        {submitted ? (
          <p className="mp3-success" role="status">
            {SUCCESS_COPY}
          </p>
        ) : (
          <form className="mp3-form" onSubmit={onSubmit} noValidate>
            <h2 className="mp3-section">ORGANIZATION INFO</h2>

            <label className="mp3-label" htmlFor="mp3-name">
              Organization Name *
            </label>
            <input
              id="mp3-name"
              className="pub-input mp3-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {fieldError("name")}

            <label className="mp3-label" htmlFor="mp3-website">
              Website *
            </label>
            <input
              id="mp3-website"
              className="pub-input mp3-input"
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            {fieldError("website")}

            <label className="mp3-label" htmlFor="mp3-city">
              City *
            </label>
            <input
              id="mp3-city"
              className="pub-input mp3-input"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            {fieldError("city")}

            <label className="mp3-label" htmlFor="mp3-phone">
              Main Phone *
            </label>
            <input
              id="mp3-phone"
              className="pub-input mp3-input"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {fieldError("phone")}

            <label className="mp3-label" htmlFor="mp3-mission">
              Your Mission Statement *
            </label>
            <textarea
              id="mp3-mission"
              className="pub-input mp3-input mp3-textarea"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
            />
            {fieldError("mission")}

            <fieldset className="mp3-pops">
              <legend className="mp3-label">Primary Population Served - Select 1-2 *</legend>
              {populationsQuery.isLoading ? (
                <p className="mp3-pops-note">Loading populations…</p>
              ) : populationsQuery.isError ? (
                <p className="mp3-field-error">
                  The population options could not be loaded. Please refresh the page and try again.
                </p>
              ) : (
                populations.map((p) => {
                  const checked = selectedPops.includes(p.id);
                  return (
                    <label key={p.id} className="mp3-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && capReached}
                        onChange={() => togglePopulation(p.id)}
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })
              )}
              {otherSelected ? (
                <input
                  className="pub-input mp3-input mp3-other-input"
                  type="text"
                  aria-label="Tell us more about the population you serve"
                  value={otherDetail}
                  onChange={(e) => setOtherDetail(e.target.value)}
                />
              ) : null}
              {fieldError("populations")}
            </fieldset>

            <label className="mp3-label" htmlFor="mp3-logo">
              Logo *
            </label>
            <input
              id="mp3-logo"
              ref={fileInputRef}
              className="mp3-file-hidden"
              type="file"
              accept="image/*"
              onChange={(e) => onLogoChange(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="mp3-logo-box" onClick={() => fileInputRef.current?.click()}>
              {logoFile ? logoFile.name : "Add a Picture +"}
            </button>
            <p className="mp3-helper">Please supply a square size graphic.</p>
            {fieldError("logo")}

            <h2 className="mp3-section mp3-section-contact">PRIMARY CONTACT INFO</h2>

            <label className="mp3-label" htmlFor="mp3-first">
              First Name *
            </label>
            <input
              id="mp3-first"
              className="pub-input mp3-input"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            {fieldError("firstName")}

            <label className="mp3-label" htmlFor="mp3-last">
              Last Name *
            </label>
            <input
              id="mp3-last"
              className="pub-input mp3-input"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            {fieldError("lastName")}

            <label className="mp3-label" htmlFor="mp3-email">
              Email *
            </label>
            <input
              id="mp3-email"
              className="pub-input mp3-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldError("email")}

            <label className="mp3-label" htmlFor="mp3-contact-phone">
              Phone Number *
            </label>
            <input
              id="mp3-contact-phone"
              className="pub-input mp3-input"
              type="text"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
            {fieldError("contactPhone")}

            {serverError ? (
              <p className="mp3-server-error" role="alert">
                {serverError}
              </p>
            ) : null}

            <button type="submit" className="mp3-submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
