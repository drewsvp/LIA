/**
 * MP-02 — Global navigation bar, present on every page.
 *
 * Desktop: logo left; the right side is a two-row stack inside one navigation
 * landmark, mirroring the main Alliance site's header. The lower row holds
 * ABOUT, ALLIANCE HOMEPAGE (external, new tab), MEMBER LOGIN (unauthenticated
 * only), PROVIDE AN ITEM, and VOLUNTEER as plain text links, followed by the
 * org switcher when the session carries one. The floating top row only renders
 * when authenticated: it holds the in-portal controls (DASHBOARD, ADMIN, user
 * menu). Unauthenticated visitors see no top row — both public destinations
 * appear in the lower row alongside the other plain links.
 * Mobile (§10): logo, hamburger, DASHBOARD/ADMIN buttons when authenticated;
 * the remaining items collapse behind the hamburger.
 *
 * The former main-site labels (ABOUT US, RESOURCES, OUR NETWORK, REGIONAL
 * CALENDAR, GIVE, MEET NEEDS) pointed at the Alliance's primary website,
 * outside this system, and are gone rather than rendered dead.
 *
 * Org switcher (§5): only for sessions holding 2+ active memberships; lists
 * org names only, validated server-side against the caller's memberships.
 * On failure the previous selection stands (§6).
 *
 * User menu (§11): shown when authenticated; contains Log out, and a MY PROFILE
 * link for supporter sessions (donor/volunteer accounts without an org portal).
 * Reachable on every page so members never need to return to /dashboard to end
 * a session.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../hooks/useSession";
import { apiRequest } from "../lib/queryClient";
import logoBlue from "../assets/alliance-logo-blue.png";


/**
 * User chip shown in the nav bar when authenticated. Clicking the name opens
 * a menu with a Log out action. Log out POSTs sign-out, clears all cached
 * query data so no authenticated payloads linger, then navigates to /login.
 * Failures are stated inside the menu — never a silent no-op.
 */
function NavUserMenu({ firstName, isSupporter }: { firstName: string; isSupporter: boolean }): ReactElement {
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
      // Timeout so a dead/restarting server yields a stated error instead of
      // an infinite "Logging out…" spinner.
      await apiRequest("POST", "/api/auth/sign-out", {}, AbortSignal.timeout(10_000));
      // Full page load, not SPA navigation: it guarantees every trace of the
      // old session (query cache, component state) is gone. clear() while
      // queries are mounted proved unreliable — components kept rendering
      // the removed session data.
      window.location.assign("/login");
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
          {isSupporter ? (
            <Link
              href="/profile"
              role="menuitem"
              className="site-nav-user-menu-item"
              onClick={() => setOpen(false)}
            >
              MY PROFILE
            </Link>
          ) : null}
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
  const { session, isLoading } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const showDashboard = !isLoading && session?.authenticated === true && session.memberships.length >= 1;
  // The user menu (identity + log out) must be reachable for EVERY
  // authenticated session, membership or not — otherwise a member-less
  // login has no way to see who they are or sign out.
  const showUserMenu = !isLoading && session?.authenticated === true;
  // Member login is offered only to visitors without a session; an
  // authenticated visitor already has the user menu.
  const showMemberLogin = !isLoading && session?.authenticated !== true;
  const firstName = session?.user?.firstName ?? "";
  const isSupporter = !isLoading && session?.isSupporter === true;
  // Admin link: visible to any staff session (approver or admin); both roles
  // can reach /admin/organizations (the first non-staff-admin-only surface).
  const showAdmin = !isLoading && session?.staffRole != null;

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

        {/* Desktop: two stacked right-aligned rows */}
        {/* One navigation landmark wraps BOTH rows — splitting it would drop
            the top-row destinations out of screen-reader landmark navigation. */}
        <nav className="site-nav-stack" aria-label="Main navigation">
          {/* The floating top row only renders for authenticated sessions so it
              never creates a blank gap in the flex stack for logged-out visitors. */}
          {showMemberLogin ? null : (
            <div className="site-nav-top">
              {showDashboard ? (
                <Link href="/dashboard" className="site-nav-btn">
                  DASHBOARD
                </Link>
              ) : null}
              {showAdmin ? (
                <Link href="/admin/organizations" className="site-nav-btn">
                  ADMIN
                </Link>
              ) : null}
              {showUserMenu ? <NavUserMenu firstName={firstName} isSupporter={isSupporter} /> : null}
            </div>
          )}

          <div className="site-nav-right">
            <Link href="/about" className="site-nav-link">
              ABOUT
            </Link>
            <a
              href="https://www.defendingthecause.org"
              className="site-nav-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              ALLIANCE HOMEPAGE
            </a>
            {showMemberLogin ? (
              <Link href="/login" className="site-nav-link">
                MEMBER LOGIN
              </Link>
            ) : null}
            {/* The two public destinations are shown to all visitors — logged-out
                and logged-in alike. Logged-out users no longer see them as
                teal CTA buttons in the top row; they appear here as plain links
                matching the rest of the lower nav row. */}
            <Link href="/items" className="site-nav-link">
              PROVIDE AN ITEM
            </Link>
            <Link href="/volunteer" className="site-nav-link">
              VOLUNTEER
            </Link>
            <OrgSwitcher className="site-nav-switcher" />
          </div>
        </nav>

        {/* Mobile: DASHBOARD and ADMIN stay outside the hamburger (§10) */}
        <div className="site-nav-mobile-controls">
          {showDashboard ? (
            <Link href="/dashboard" className="site-nav-btn" onClick={() => setMenuOpen(false)}>
              DASHBOARD
            </Link>
          ) : null}
          {showAdmin ? (
            <Link href="/admin/organizations" className="site-nav-btn" onClick={() => setMenuOpen(false)}>
              ADMIN
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
        <nav className="site-nav-panel" aria-label="Main navigation">
          <Link href="/about" className="site-nav-panel-item" onClick={() => setMenuOpen(false)}>
            ABOUT
          </Link>
          <a
            href="https://www.defendingthecause.org"
            className="site-nav-panel-item"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
          >
            ALLIANCE HOMEPAGE
          </a>
          {showMemberLogin ? (
            <Link href="/login" className="site-nav-panel-item" onClick={() => setMenuOpen(false)}>
              MEMBER LOGIN
            </Link>
          ) : null}
          <Link href="/items" className="site-nav-panel-item" onClick={() => setMenuOpen(false)}>
            PROVIDE AN ITEM
          </Link>
          <Link href="/volunteer" className="site-nav-panel-item" onClick={() => setMenuOpen(false)}>
            VOLUNTEER
          </Link>
          <OrgSwitcher className="site-nav-switcher site-nav-switcher-mobile" />
          {showUserMenu && isSupporter ? (
            <Link href="/profile" className="site-nav-panel-item" onClick={() => setMenuOpen(false)}>
              MY PROFILE
            </Link>
          ) : null}
          {showUserMenu ? <NavUserMenu firstName={firstName} isSupporter={isSupporter} /> : null}
        </nav>
      ) : null}
    </header>
  );
}
