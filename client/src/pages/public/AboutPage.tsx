import type { ReactElement } from "react";
import { Link } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";

/**
 * PB-06 — About (docs/specs/PB-06.md).
 *
 * Navigation only: reads nothing, writes nothing.
 *
 * Page order:
 *   1. Navy band — "Join Us in Changing the World" (moved from PB-00, unchanged)
 *   2. When a Kid Needs a Bed, It Can't Wait
 *   3. Free for Every Member Organization
 *   4. What This Has Actually Done + the two CTA buttons
 *   5. Navy band — TEDx talk + responsive 16:9 video embed
 *
 * Copy is supplied verbatim by Tiffany and Christina; nothing here is written
 * by the build. The TEDx phrase stays bold-but-unlinked as specified — the
 * embedded video below it is the link.
 */
export function AboutPage(): ReactElement {
  return (
    <PublicLayout>
      {/* ── 1. Top navy band — the page headline, left exactly as moved from PB-00 ── */}
      <div className="pb0-navy">
        <h2 className="pb0-navy-heading">Join Us in Changing the World</h2>
        <p className="pb0-navy-para">
          Each of us have talents, resources and experience that can be used to make a difference for kids &amp;
          families in our community.
        </p>
      </div>

      {/* ── 2. Origin story ── */}
      <section className="pb6-section">
        <h2>When a Kid Needs a Bed, It Can't Wait</h2>
        <p>
          Love in Action started ten years ago as a simple idea: connect what our community already has to give
          with what a kid or family actually needs right now. A bed. A car seat. Diapers. The basics that let a
          placement happen, or let a family stay stable through a hard week.
        </p>
        <p>
          When a child is waiting on a bed so a placement can go through, or a caregiver needs a car seat and
          there isn't one, the wait isn't just inconvenient. It's traumatic. That's the problem Love in Action
          was built to shorten.
        </p>
      </section>

      {/* ── 3. Free for member organizations ── */}
      <section className="pb6-section">
        <h2>Free for Every Member Organization</h2>
        <p>
          Love in Action isn't one program run by one nonprofit. It's shared infrastructure for the Alliance's
          network of more than 100 nonprofit organizations, and every one of them gets an account for free.
          Nobody pays to post a need or claim a dashboard. A weekly digest carries those needs to donors and
          volunteers across the region, and churches, companies, and community groups run their own drives and
          wishlists through it too, turning individual generosity into a coordinated response instead of a
          scattered one.
        </p>
      </section>

      {/* ── 4. Impact list + calls to action ── */}
      <section className="pb6-section">
        <h2>What This Has Actually Done</h2>
        <ul>
          <li>
            Over 10,000 people served across the life of the program, with hundreds more met in the months since
            our most recent relaunch alone.
          </li>
          <li>1,000+ items moved through household essentials drives, supporting 350+ kids and families.</li>
          <li>46 safe spaces furnished, from a single bed to a full apartment.</li>
          <li>
            An annual backpack drive that's nearly doubled, from around 900 to as many as 1,800, with partners
            like Sutter Health and local churches driving the growth.
          </li>
          <li>
            Through the Ashley Furniture Hope to Dream partnership, roughly 200 beds delivered in a single
            season, plus 30 more full bed sets since.
          </li>
        </ul>
        <p>
          None of that happens without someone deciding to give an item or an hour instead of scrolling past.
          Real needs, posted by real organizations, met by real people nearby.
        </p>
        <p style={{ textAlign: "center" }}>
          <Link href="/items" className="btn-teal">
            Provide an Item
          </Link>{" "}
          <Link href="/volunteer" className="btn-teal">
            Volunteer Your Time
          </Link>
        </p>
      </section>

      {/* ── 5. Bottom navy band — TEDx + video ── */}
      <div className="pb0-navy">
        <p className="pb0-navy-para">
          If you're looking for some ideas or encouragement, check out this <strong>TEDx talk</strong> by The
          Alliance's very own, <strong>Heidi White</strong>.
        </p>
        <div className="pb6-video-wrap">
          <iframe
            src="https://www.youtube.com/embed/qre11s_hH-U"
            title="TEDx talk by Heidi White"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </PublicLayout>
  );
}
