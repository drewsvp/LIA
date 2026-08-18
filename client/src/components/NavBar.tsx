/**
 * MP-02 — Global navigation bar, present on every page.
 *
 * Desktop: logo left; right side stacks the button row (DASHBOARD when
 * authenticated with an active membership, GIVE, MEET NEEDS) over the text
 * links (ABOUT US, RESOURCES, OUR NETWORK, REGIONAL CALENDAR).
 * Mobile (§10): logo, hamburger, DASHBOARD button when authenticated; the
 * remaining items collapse behind the hamburger.
 *
 * The main-site items' destinations are captured nowhere in docs/ — they
 * point at the Alliance's primary website, outside this system. Following
 * the PB-00 TEDx precedent they render as unlinked labels rather than
 * pointing somewhere invented (reported in the build log). The logo links
 * home (§8) and DASHBOARD navigates in-portal.
 *
 * Org switcher (§5): only for sessions holding 2+ active memberships; lists
 * org names only, validated server-side against the caller's memberships.
 * On failure the previous selection stands (§6).
 *
 * User menu (§11): shown when authenticated; contains Log out. Reachable on
 * every page so members never need to return to /dashboard to end a session.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../hooks/useSession";
import { apiRequest } from "../lib/queryClient";
import logoBlue from "../assets/alliance-logo-blue.png";

const MAIN_SITE_LINKS = ["ABOUT US", "RESOURCES", "OUR NETWORK", "REGIONAL CALENDAR"] as const;

/**
 * User chip shown in the nav bar when authenticated. Clicking the name opens
 * a menu with a Log out action. Log out POSTs sign-out, clears all cached
 * query data so no authenticated payloads linger, then navigates to /login.
 * Failures are stated inside the menu — never a silent no-op.
 */
function NavUserMenu({ firstName }: { firstName: string }): ReactElement {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/auth/sign-out", {});
      queryClient.clear();
      navigate("/login");
    } catch {
      setError("Log out failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="site-nav-user" ref={rootRef}>
      <button
        type="button"
        className="site-nav-user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg className="site-nav-user-avatar" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="currentColor" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="currentColor" />
        </svg>
        <span>{firstName}</span>
        <svg className="site-nav-user-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open ? (
        <div className="site-nav-user-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="site-nav-user-menu-item"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? "Logging out…" : "Log out"}
          </button>
          {error !== null ? <p className="site-nav-user-menu-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function OrgSwitcher({ className }: { className: string }): ReactElement | null {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);

  if (!session?.authenticated || session.memberships.length < 2) return null;

  async function choose(orgId: string): Promise<void> {
    setPendingOrgId(orgId);
    try {
      await apiRequest("POST", "/api/session/active-org", { orgId });
      await queryClient.invalidateQueries();
    } catch {
      // Previous selection stands (§6): drop the optimistic value.
    } finally {
      setPendingOrgId(null);
    }
  }

  const value = pendingOrgId ?? session.activeOrgId ?? "";
  return (
    <select
      className={className}
      aria-label="Organization"
      value={value}
      onChange={(e) => void choose(e.target.value)}
    >
      {value === "" ? <option value="" disabled /> : null}
      {session.memberships.map((m) => (
        <option key={m.orgId} value={m.orgId}>
          {m.orgName}
        </option>
      ))}
    </select>
  );
}

export function NavBar(): ReactElement {
  const { session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const showDashboard = session?.authenticated === true && session.memberships.length >= 1;
  const firstName = session?.user?.firstName ?? "";

  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <Link href="/" className="site-nav-logo" onClick={() => setMenuOpen(false)}>
          <img
            src={logoBlue}
            alt="The Alliance – Defending the Cause of Kids &amp; Families"
            className="site-nav-logo-img"
          />
        </Link>

        {/* Desktop: buttons row over text links row */}
        <div className="site-nav-right">
          <div className="site-nav-buttons">
            <OrgSwitcher className="site-nav-switcher" />
            {showDashboard ? (
              <Link href="/dashboard" className="site-nav-btn">
                DASHBOARD
              </Link>
            ) : null}
            <span className="site-nav-btn site-nav-dead">GIVE</span>
            <span className="site-nav-btn site-nav-dead">MEET NEEDS</span>
            {showDashboard ? <NavUserMenu firstName={firstName} /> : null}
          </div>
          <nav className="site-nav-links" aria-label="Main navigation">
            {MAIN_SITE_LINKS.map((label) => (
              <span key={label} className="site-nav-link site-nav-dead">
                {label}
              </span>
            ))}
          </nav>
        </div>

        {/* Mobile: DASHBOARD stays outside the hamburger (§10) */}
        <div className="site-nav-mobile-controls">
          {showDashboard ? (
            <Link href="/dashboard" className="site-nav-btn" onClick={() => setMenuOpen(false)}>
              DASHBOARD
            </Link>
          ) : null}
          <button
            type="button"
            className="site-nav-hamburger"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="site-nav-panel">
          {MAIN_SITE_LINKS.map((label) => (
            <span key={label} className="site-nav-panel-item site-nav-dead">
              {label}
            </span>
          ))}
          <span className="site-nav-panel-item site-nav-dead">GIVE</span>
          <span className="site-nav-panel-item site-nav-dead">MEET NEEDS</span>
          <OrgSwitcher className="site-nav-switcher site-nav-switcher-mobile" />
          {showDashboard ? <NavUserMenu firstName={firstName} /> : null}
        </div>
      ) : null}
    </header>
  );
}
