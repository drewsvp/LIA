/**
 * MP-06 — /dashboard/members/new. Invite a teammate (docs/specs/MP-06.md).
 *
 * Organization Name is display only, populated from the session organization
 * and never trusted on submit (§5) — the server reads no organization field
 * from this form. On success the form resets and the member stays put so
 * they can invite several people in a row (§2).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import heroImg from "../../assets/dashboard/hero.png";

const REQUIRED_MSG = "This field is required";
const SUCCESS_MSG = "Success! Your new user has been submitted for approval.";
const FAILURE_MSG = "That didn't save. Please check the form and try again.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Overview = { org: { name: string } };

export function MembersNewPage() {
  const overviewQuery = useQuery<Overview>({ queryKey: ["/api/dashboard/overview"] });
  const orgName = overviewQuery.data?.org.name ?? "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (firstName.trim() === "") errs.firstName = REQUIRED_MSG;
    if (lastName.trim() === "") errs.lastName = REQUIRED_MSG;
    if (email.trim() === "") errs.email = REQUIRED_MSG;
    else if (!EMAIL_RE.test(email.trim())) errs.email = "Please enter a valid email.";
    if (phone.trim() === "") errs.phone = REQUIRED_MSG;
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setMessage(null);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        }),
      });
      if (res.ok) {
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setErrors({});
        setMessage({ kind: "success", text: SUCCESS_MSG });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMessage({ kind: "error", text: body?.message ?? FAILURE_MSG });
      }
    } catch {
      setMessage({ kind: "error", text: FAILURE_MSG });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  return (
    <div className="mp6-page">
      <img className="mp6-hero" src={heroImg} alt="The Love in Action Database" />
      <div className="mp6-band">
        <h1 className="mp6-band-title">ADD A NEW USER</h1>
      </div>
      <div className="mp6-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>
        <p className="mp6-copy">
          Please fill out the form below to add a new user to your organization&apos;s dashboard. They will be
          approved in 1-2 business days and receive an email with a link to log in. Once this is complete, they will
          be able to submit donation needs and volunteer requests.
        </p>
        <p className="mp6-copy">
          If you have any questions, please email Love in Action Program Director, <strong>Christina Moe</strong>, at{" "}
          <a className="mp6-mailto" href="mailto:christina@defendingthecause.org">
            christina@defendingthecause.org
          </a>
          .
        </p>

        <h2 className="mp6-section">NEW CONTACT INFO</h2>

        <form className="mp6-form" onSubmit={onSubmit} noValidate>
          <label className="mp5-label" htmlFor="mp6-org">
            Organization Name
          </label>
          <input id="mp6-org" className="pub-input mp5-input mp6-readonly" type="text" value={orgName} disabled />

          <label className="mp5-label" htmlFor="mp6-first">
            First Name *
          </label>
          <input
            id="mp6-first"
            className="pub-input mp5-input"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          {fieldError("firstName")}

          <label className="mp5-label" htmlFor="mp6-last">
            Last Name *
          </label>
          <input
            id="mp6-last"
            className="pub-input mp5-input"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          {fieldError("lastName")}

          <label className="mp5-label" htmlFor="mp6-email">
            Email *
          </label>
          <input
            id="mp6-email"
            className="pub-input mp5-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldError("email")}

          <label className="mp5-label" htmlFor="mp6-phone">
            Phone Number *
          </label>
          <input
            id="mp6-phone"
            className="pub-input mp5-input"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {fieldError("phone")}

          {message ? (
            <p
              className={message.kind === "success" ? "mp5-success" : "mp5-failure"}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          ) : null}

          <button type="submit" className="mp5-submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for Approval"}
          </button>
        </form>
      </div>
    </div>
  );
}
