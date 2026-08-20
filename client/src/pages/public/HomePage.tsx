import type { ReactElement } from "react";
import { Link } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import liaHeader from "../../assets/headers/LIA-Main-Page-Header.png";
import provideHeader from "../../assets/headers/Provide-an-Item-Header.png";
import volunteerHeader from "../../assets/headers/Volunteer-your-Time-Header.png";

/**
 * PB-00 — Public hub / landing (docs/specs/PB-00.md).
 * Navigation only: reads nothing, writes nothing. The captured hero and the
 * two tiles are photo art with script lettering; those assets are not in the
 * repo, so this renders the same typographic treatment PB-01 established
 * (logged decision). The TEDx talk URL is captured nowhere in docs/, so the
 * phrase renders bold-but-unlinked rather than pointing somewhere invented —
 * reported in the build log.
 */
export function HomePage(): ReactElement {
  return (
    <PublicLayout>
      {/* Hero — site branding */}
      <img
        src={liaHeader}
        alt=""
        className="pb0-hero-img"
      />

      <div className="pb0-content">
        <p className="pb0-intro">
          Welcome to our <strong>Love in Action Database</strong>! Browse real-time item and volunteer needs, then
          choose an opportunity that speaks to you. Together, we can show love in action to local kids in foster
          care, refugees, single moms, struggling families, social workers and so many more.
        </p>

        {/* Image tiles (§6) */}
        <div className="pb0-tiles">
          <Link href="/items" className="pb0-tile" aria-label="Provide an Item">
            <div
              className="pb0-tile-bg"
              style={{ backgroundImage: `url(${provideHeader})` }}
            />
          </Link>
          <Link href="/volunteer" className="pb0-tile" aria-label="Volunteer Your Time">
            <div
              className="pb0-tile-bg"
              style={{ backgroundImage: `url(${volunteerHeader})` }}
            />
          </Link>
        </div>

        {/* Digest callout — the question carries the emphasis, the answer below
            it reads as ordinary body copy. */}
        <p className="pb0-callout">Want to hear when new needs or volunteers are posted?</p>
        <p className="pb0-callout pb0-callout-regular">
          We've got you covered. Click the button below to sign up for our weekly Love in Action email digest!
        </p>
        <p style={{ textAlign: "center", margin: "0 0 48px" }}>
          <Link href="/subscribe" className="btn-navy">
            Weekly Email Sign Up
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
}
