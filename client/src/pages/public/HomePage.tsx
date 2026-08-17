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
        {/* Member login link, right-aligned below the hero (§4) */}
        <p className="pb0-login-row">
          <Link href="/login" className="pb0-login-link">
            Alliance Member Login &gt;
          </Link>
        </p>

        <p className="pb0-intro">
          Welcome to our <strong>Love in Action Database</strong>! Here, you'll find opportunities to meet the
          needs of our community's most vulnerable kids and families, in addition to the needs of the local
          nonprofits, agencies and support groups that serve them.
        </p>
        <p className="pb0-intro">
          Browse real-time needs using the image buttons below, then sign up to make a difference for local foster
          children, youth aging out of the system, newly arrived refugees, single moms, struggling families, social
          workers and more.
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

        {/* Digest callout */}
        <p className="pb0-callout">
          Want to hear when new needs or volunteers are posted? We've got you covered. Click the button below to
          sign up for our weekly Love in Action email digest!
        </p>
        <p style={{ textAlign: "center", margin: "0 0 48px" }}>
          <Link href="/subscribe" className="btn-navy">
            Weekly Email Sign Up
          </Link>
        </p>
      </div>

      {/* Join Us section — full-bleed navy (§4) */}
      <div className="pb0-navy">
        <h2 className="pb0-navy-heading">Join Us in Changing the World</h2>
        <p className="pb0-navy-para">
          Each of us have talents, resources and experience that can be used to make a difference for kids &amp;
          families in our community.
        </p>
        <p className="pb0-navy-para">
          If you're looking for some ideas or encouragement, check out this <strong>TEDx talk</strong> by The
          Alliance's very own, <strong>Heidi White</strong>.
        </p>
      </div>
    </PublicLayout>
  );
}
