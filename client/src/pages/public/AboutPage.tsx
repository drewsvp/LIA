import type { ReactElement } from "react";
import { Link } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";

/**
 * PB-06 — About (docs/specs/PB-06.md).
 *
 * Navigation only: reads nothing, writes nothing.
 *
 * Page order:
 *   1. Navy band — "Join us in Making a Difference" (moved from PB-00)
 *   2. Meet Real Needs in Real Time
 *   3. A Powerful Tool for Local Organizations
 *   4. One Part of a Larger Program + the two CTA buttons
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
        <h2 className="pb0-navy-heading">Join us in Making a Difference</h2>
        <p className="pb0-navy-para">
          Each of us have resources and experience that can make a difference for at-risk kids &amp; families right
          here in our community.
        </p>
      </div>

      {/* ── 2. Origin story ── */}
      <section className="pb6-section pb6-section-pair">
        <h2>Meet Real Needs in Real Time</h2>
        <p>
          The Love in Action Program began ten years ago with a simple idea:{" "}
          <strong>make it easy for caring people to connect with kids and families who need support right now.</strong>{" "}
          Whether it's purchasing a new car seat,
          donating diapers, or volunteering time, every act of generosity can help meet an immediate need and
          create greater stability for a child or family. This platform connects you directly to real-time
          opportunities, making it simple to choose how you'll put your love into action.
        </p>
      </section>

      {/* ── 3. Free for member organizations ── */}
      <section className="pb6-section">
        <h2>A Powerful Tool for Local Organizations</h2>
        <p>
          The Love in Action Database is a resource for our <strong>Alliance Members</strong>—including nonprofits,
          agencies and
          ministries serving local kids and families. Instead of spending hours searching for donations or
          coordinating resources, Members can post needs, allowing our community to respond. By sharing
          technology, resources and relationships, we reduce costs and administrative burdens, giving staff more
          time to focus on what matters most: caring for each child and family. Because every need is vetted by
          our Members, this platform creates a trusted, collaborative way to mobilize essential items and support
          throughout our community.
        </p>
      </section>

      {/* ── 4. Impact list + calls to action ── */}
      <section className="pb6-section">
        <h2>One Part of a Larger Program</h2>
        <p>
          The Love in Action Program makes it simple for our community to meet real needs in three powerful ways:
        </p>
        <ul>
          <li>
            <strong>Annual Donation Drives</strong> that collect thousands of essential items.
          </li>
          <li>
            Our <strong>Emergency Supply Closet</strong> which allows us to distribute critical resources when
            urgent needs arise.
          </li>
          <li>
            This fully custom <strong>Love in Action Database</strong> where unique needs are posted by our
            Alliance Member network throughout the year.
          </li>
        </ul>
        <p>
          This program gives individuals, community groups, churches, and businesses easy ways to turn generosity
          into <strong>real support for kids and families</strong>.
        </p>
        <p>
          And it works! In 2025, Love in Action provided <strong>33,394 donated items</strong> to meet the needs of{" "}
          <strong>10,553 children and families</strong> through{" "}
          <strong>72 Alliance Member agencies and nonprofits</strong>.
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
        <h2 className="pb0-navy-heading">Let's Change Our Community Together</h2>
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
