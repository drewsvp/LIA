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
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../hooks/useSession";
import { apiRequest } from "../lib/queryClient";
import logoBlue from "../assets/alliance-logo-blue.png";

const MAIN_SITE_LINKS = ["ABOUT US", "RESOURCES", "OUR NETWORK", "REGIONAL CALENDAR"] as const;

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
        </div>
      ) : null}
    </header>
  );
}
