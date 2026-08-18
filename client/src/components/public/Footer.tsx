import type { ReactElement } from "react";
import { Link } from "wouter";

/**
 * Public site footer, rendered by PublicLayout on every public page (never
 * inside the member or admin shells).
 *
 * Full-bleed navy matching the .pb2-banner treatment already used elsewhere.
 * Left: organization identity and copyright. Right: quiet links to the
 * About page, digest signup and member login, then the Alliance's social
 * accounts.
 *
 * LinkedIn is deliberately absent: only the org's display name is confirmed
 * for that account, not a URL, and inventing one is worse than omitting it.
 * Provide an Item / Volunteer are not repeated here — they are the loudest
 * controls in the nav above — and Give is out of scope for LIA.
 */

const SOCIAL_LINKS = [
  {
    label: "Facebook",
    href: "https://facebook.com/TheAllianceDTC",
    path: "M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H16.7V3.6A21 21 0 0 0 14.3 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V13h2.7v8Z",
  },
  {
    label: "Instagram",
    href: "https://instagram.com/thealliance_dtc",
    path: "M12 2.2c-2.7 0-3 .01-4.05.06-1.05.05-1.77.22-2.4.46a4.8 4.8 0 0 0-1.75 1.14A4.8 4.8 0 0 0 2.66 5.6c-.24.63-.4 1.35-.46 2.4C2.16 9.05 2.14 9.38 2.14 12s.02 2.95.06 4c.06 1.05.22 1.77.46 2.4a4.8 4.8 0 0 0 1.14 1.75 4.8 4.8 0 0 0 1.75 1.14c.63.24 1.35.4 2.4.46 1.05.05 1.38.06 4.05.06s3-.01 4.05-.06c1.05-.06 1.77-.22 2.4-.46a5 5 0 0 0 2.89-2.89c.24-.63.4-1.35.46-2.4.05-1.05.06-1.38.06-4s-.01-2.95-.06-4c-.06-1.05-.22-1.77-.46-2.4a4.8 4.8 0 0 0-1.14-1.75 4.8 4.8 0 0 0-1.75-1.14c-.63-.24-1.35-.41-2.4-.46C15 2.21 14.67 2.2 12 2.2Zm0 1.8c2.62 0 2.93.01 3.97.06.96.04 1.48.2 1.82.34.46.18.79.39 1.13.73.34.34.55.67.73 1.13.13.34.3.86.34 1.82.05 1.04.06 1.35.06 3.97s-.01 2.93-.06 3.97c-.04.96-.21 1.48-.34 1.82-.18.46-.39.79-.73 1.13-.34.34-.67.55-1.13.73-.34.13-.86.3-1.82.34-1.04.05-1.35.06-3.97.06s-2.93-.01-3.97-.06c-.96-.04-1.48-.21-1.82-.34-.46-.18-.79-.39-1.13-.73a3 3 0 0 1-.73-1.13c-.13-.34-.3-.86-.34-1.82C4.01 14.93 4 14.62 4 12s.01-2.93.06-3.97c.04-.96.21-1.48.34-1.82.18-.46.39-.79.73-1.13.34-.34.67-.55 1.13-.73.34-.13.86-.3 1.82-.34C9.07 4.01 9.38 4 12 4Zm0 3.03a4.97 4.97 0 1 0 0 9.94 4.97 4.97 0 0 0 0-9.94Zm0 8.2a3.23 3.23 0 1 1 0-6.46 3.23 3.23 0 0 1 0 6.46Zm6.33-8.4a1.16 1.16 0 1 1-2.32 0 1.16 1.16 0 0 1 2.32 0Z",
  },
  {
    label: "X",
    href: "https://x.com/TheAlliance_DTC",
    path: "M17.53 3h2.98l-6.5 7.43L21.66 21h-5.99l-4.69-6.13L5.6 21H2.62l6.95-7.95L2.34 3h6.14l4.24 5.6Zm-1.05 16.2h1.65L7.6 4.72H5.83Z",
  },
] as const;

export function Footer(): ReactElement {
  return (
    <footer className="pb-footer">
      <div className="pb-footer-inner">
        <div className="pb-footer-identity">
          <p className="pb-footer-org">The Alliance</p>
          <p className="pb-footer-copyright">
            &copy; 2026 Defending the Cause of Kids &amp; Families
          </p>
        </div>

        <div className="pb-footer-right">
          <nav className="pb-footer-links" aria-label="Footer">
            <Link href="/about" className="pb-footer-link">
              About
            </Link>
            <Link href="/subscribe" className="pb-footer-link">
              Weekly email signup
            </Link>
            <Link href="/login" className="pb-footer-link">
              Member login
            </Link>
          </nav>
          <ul className="pb-footer-social">
            {SOCIAL_LINKS.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  className="pb-footer-social-link"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={social.label}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d={social.path} fill="currentColor" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
