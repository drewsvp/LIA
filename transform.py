#!/usr/bin/env python3
"""
transform.py — Love in Action legacy migration, offline transform.

Reads the six Wix CMS collection exports. Writes thirteen CSVs, one per target
table, that load with plain `\\copy` and nothing else. No application code, no
ORM, no live database.

    python3 transform.py --source data/legacy-export --out data/load
    psql "$DATABASE_URL" -f load.sql

Rules live in docs/migration/field-map.md. The measurements those rules are
based on live in docs/migration/data-audit.md. This file implements them; where
it and field-map.md disagree, field-map.md is the contract and this is the bug.

WHY OFFLINE
  The output is a spreadsheet a human can read before anything touches the
  database. It also never fires the BEFORE UPDATE triggers, since COPY only
  inserts, so preserved source timestamps survive.

WHY DETERMINISTIC IDs
  Every uuid is uuid5(namespace, legacy_id). Re-running produces byte-identical
  files, and a parent's id is known before its children are written without
  round-tripping through Postgres.

NOT PRODUCED HERE
  users, org_memberships, digest_subscribers — all three live in the contacts
  export, which has not been received. Without it nobody can log in.
  image_url / logo_url — filled by the media pass after upload to object storage.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants. Confirmed from the 2026-08-14 export. See data-audit.md.
# ---------------------------------------------------------------------------

NS = uuid.UUID("6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f")  # arbitrary, fixed forever

FILES = {
    "organizations":       "Area_Needs_-_Organizations.csv",
    "item_requests":       "Area_Needs_-_Item_Requests.csv",
    "items":               "Area_Needs_-_Items.csv",
    "volunteer_requests":  "Area_Needs_-_Volunteer_Requests.csv",
    "volunteer_roles":     "Area_Needs_-_Volunteer_Roles.csv",
    "donors":              "Area_Needs_-_Donors.csv",
}

EXPECTED_SOURCE_ROWS = {
    "organizations": 49, "item_requests": 120, "items": 403,
    "volunteer_requests": 24, "volunteer_roles": 58, "donors": 127,
}

PLATFORM_OWNER_NAME = "The Alliance"
PLATFORM_OWNER_SLUG = "the-alliance"

# NOTE THE SOURCE MISSPELLING. 78 rows. A correctly spelled key defaults them all.
DEADLINE_TYPE = {
    "until fufilled": "until_fulfilled",
    "until fulfilled": "until_fulfilled",
    "ongoing": "ongoing",
    "date specific": "date_specific",
}

# Twelve source variants, three schema values. Full mapping in data-audit.md section 4.
ITEM_CONDITION = {
    "new": "new",
    "new or like new": "new",
    "new or like-new": "new",
    "gently used": "gently_used",
    "used - functional": "gently_used",
    "used - like new": "gently_used",
    "new/gently used": "any",
}

# D61: seed exactly these eleven rows — ten MP-03 checkboxes plus Other.
CANONICAL_POPULATIONS = [
    "At-Risk Kids/Teens",
    "Youth in Foster Care",
    "Transitional Age Youth/Young Adults",
    "Unhoused Teens/Families",
    "Foster/Adoptive Families",
    "Refugee Families",
    "Single Parents",
    "Women Facing Unplanned Pregnancies",
    "Families/Young Adults in Crisis",
    "Youth with Disabilities/Health Issues",
    "Other",
]

POPULATION_MERGE = {
    "foster youth": "Youth in Foster Care",
    "transitional age youth/aged-out youth": "Transitional Age Youth/Young Adults",
    "single moms": "Single Parents",
}

# Historical values with no home in the ten; preserved in populations_other
# (see D61 / field-map.md section 7). resolve_population sends any non-canonical
# source tag to populations_other rather than dropping it.

NEED_STATUS = {"active": "active", "pending": "pending", "archived": "archived"}
ORG_STATUS = {"approved": "approved", "pending": "pending"}

NAME_PARTICLES = {"van", "von", "de", "del", "della", "der", "di", "du", "la", "le", "da", "st"}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "md", "phd", "esq"}
MULTI_PERSON = (" and ", " & ", " + ")
PLACEHOLDER = "Unknown"

FORMATTED_TAIL = re.compile(r"([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?")

# ---------------------------------------------------------------------------
# Scalars
# ---------------------------------------------------------------------------


def txt(v):
    """Empty, whitespace, 'null', and 'nan' all become None."""
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("null", "nan", "none"):
        return None
    return s


def key(v) -> str:
    """Coded-value lookup key: trimmed, whitespace-collapsed, lowercased."""
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def as_int(v):
    s = txt(v)
    if s is None:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def ts(v):
    """ISO 8601 with Z -> a string Postgres reads as timestamptz. UTC preserved."""
    s = txt(v)
    if s is None:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def date_only(v):
    s = txt(v)
    if s is None:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def jload(v):
    s = txt(v)
    if s is None:
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


def new_id(kind: str, legacy: str) -> str:
    return str(uuid.uuid5(NS, f"{kind}:{legacy}"))


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"-+", "-", s) or "organization"


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


class Report:
    def __init__(self):
        self.exceptions = []
        self.counts = Counter()
        self.notes = []

    def add(self, entity, legacy_id, identifier, kind, field, source_value, imported_value, reason):
        self.exceptions.append({
            "entity": entity, "legacy_id": legacy_id, "identifier": identifier,
            "kind": kind, "field": field, "source_value": source_value,
            "imported_value": imported_value, "reason": reason,
        })
        self.counts[f"exception:{kind}"] += 1

    def note(self, text):
        self.notes.append(text)

    def n(self, label, by=1):
        self.counts[label] += by


# ---------------------------------------------------------------------------
# Names. Handbook.md section 8: migration never guesses a confident split.
# ---------------------------------------------------------------------------


def split_name(raw):
    """
    Returns (first, last, needs_review, review_note, source_note).

    Confirmed patterns in this data: particles ('Efren Del Rio'), middle names
    and initials ('Rachel Diane Scalise'), two humans in one field
    ('David & Lisa Eichinger'), single tokens ('Breanna'), all caps, one null.
    """
    original = "" if raw is None else str(raw)
    cleaned = re.sub(r"\s+", " ", original).strip()

    def flag(first, last, why):
        return first, last, True, why, original

    if cleaned == "":
        return flag(PLACEHOLDER, PLACEHOLDER,
                    "The source record had no name. Both name fields are placeholders.")

    if any(m in f" {cleaned.lower()} " for m in MULTI_PERSON):
        # 'Don & Patty Anderson' is two humans sharing one surname at the end.
        # Keep the first given name and the surname; the connector is noise.
        parts = re.split(r"\s+(?:and|&|\+)\s+", cleaned, flags=re.IGNORECASE)
        first = parts[0].split()[0]
        tail = parts[-1].split()
        last = tail[-1] if len(tail) > 1 else (tail[0] if tail else PLACEHOLDER)
        return flag(first, last,
                    "The source name appears to contain more than one person. The first given "
                    "name and the shared last name were kept. Confirm who this record belongs to.")

    if "," in cleaned:
        t = re.sub(r"\s+", " ", cleaned.replace(",", " ")).strip().split(" ")
        return flag(t[0], " ".join(t[1:]) or PLACEHOLDER,
                    "The source name contained a comma and may be reversed. "
                    "Confirm the first and last name.")

    t = cleaned.split(" ")

    if len(t) == 1:
        return flag(t[0], PLACEHOLDER,
                    "The source recorded only one name. No last name was present.")

    if len(t) == 2:
        if t[1].lower().replace(".", "") in NAME_SUFFIXES:
            return flag(t[0], t[1],
                        "The source name ends in a suffix and has no separate last name.")
        # The only path that does not flag.
        return t[0], t[1], False, None, None

    # Three or more tokens. Three different shapes, three treatments. Every one
    # still flags: these are defensible readings, not confident splits.
    #
    #   particle  -> belongs to the surname     Efren Del Rio    -> Efren    | Del Rio
    #   initial   -> noise, dropped             Julie M Stark    -> Julie    | Stark
    #   middle    -> part of the given name     Teresa Ann Cx    -> Teresa Ann | Cx
    #
    # A trailing suffix is peeled off first and reattached to the surname.
    if t[-1].lower().replace(".", "") in NAME_SUFFIXES:
        core, suffix = t[:-1], t[-1]
    else:
        core, suffix = t, None

    if len(core) < 2:
        return flag(core[0] if core else PLACEHOLDER, suffix or PLACEHOLDER,
                    "The source name is a single token followed by a suffix.")

    def with_suffix(last):
        return f"{last} {suffix}" if suffix else last

    # Particle first: 'Del Rio' and 'von Housen' are two-word surnames, and
    # taking only the final token would produce 'Rio' and 'Housen'.
    for i in range(1, len(core)):
        if core[i].lower().replace(".", "") in NAME_PARTICLES:
            return flag(" ".join(core[:i]), with_suffix(" ".join(core[i:])),
                        "The source name contains a surname particle. The particle and "
                        "everything after it were kept together as the last name.")

    # An initial is a single letter, with or without a period.
    middles = core[1:-1]
    if middles and all(re.fullmatch(r"[A-Za-z]\.?", m) for m in middles):
        return flag(core[0], with_suffix(core[-1]),
                    "The source name contained a middle initial, which was dropped. Confirm "
                    "the first and last name.")

    # A middle word is part of what the person goes by, so it stays with the
    # first name rather than being guessed into the surname.
    return flag(" ".join(core[:-1]), with_suffix(core[-1]),
                "The source name has more than two parts. The final token was taken as the "
                "last name and everything before it as the first name. Confirm the split.")


# ---------------------------------------------------------------------------
# Addresses. Five key shapes, every key optional.
# ---------------------------------------------------------------------------


def parse_address(raw):
    """Returns a dict of address columns plus how city was obtained."""
    out = {
        "address_line1": None, "address_line2": None, "city": None, "state": None,
        "postal_code": None, "address_formatted": None, "_city_parsed": False, "_note": None,
    }
    a = jload(raw)
    if not a:
        out["_note"] = "No address object on the source record."
        return out

    formatted = txt(a.get("formatted"))
    out["address_formatted"] = formatted

    street = a.get("streetAddress") or {}
    out["address_line1"] = (
        txt(street.get("formattedAddressLine"))
        or txt(" ".join(x for x in [street.get("number"), street.get("name")] if x))
    )
    out["address_line2"] = txt(street.get("apt"))

    # ADMINISTRATIVE_AREA_LEVEL_1 is the state. The array also holds county and
    # city entries, so never take subdivisions[0] positionally.
    level1 = next(
        (s for s in (a.get("subdivisions") or [])
         if s.get("type") == "ADMINISTRATIVE_AREA_LEVEL_1"), None
    )
    out["state"] = txt(level1.get("code")) if level1 else (
        re.sub(r"^US-", "", txt(a.get("subdivision")) or "") or None
    )

    out["city"] = txt(a.get("city"))
    out["postal_code"] = txt(a.get("postalCode"))

    if out["city"] is None and formatted:
        m = FORMATTED_TAIL.search(formatted)
        if m:
            out["city"] = m.group(1).strip()
            out["postal_code"] = out["postal_code"] or m.group(3)
            out["_city_parsed"] = True
            out["_note"] = f'City parsed from the formatted address: "{formatted}"'
        elif not any(c.isdigit() for c in formatted) and "," not in formatted:
            # Bare place names: "Roseville ", "Grass Valley". Three organizations.
            out["city"] = formatted.strip()
            out["_city_parsed"] = True
            out["_note"] = f'The formatted address contained only a place name: "{formatted}"'
        else:
            out["_note"] = f'City could not be parsed from the formatted address: "{formatted}"'

    return out


# ---------------------------------------------------------------------------
# People registry. One human is one row, keyed on lower(email).
# ---------------------------------------------------------------------------


class People:
    """
    The collapse. 127 donor rows across 81 distinct emails, plus contacts from
    three other collections. A naive row-per-record import creates duplicates;
    this does not.

    SOURCE ORDER MATTERS. Organizations load before requests, requests before
    donors, so the cleanest source wins a conflict and a later best-effort split
    never overwrites an earlier one.
    """

    def __init__(self, report: Report):
        self.rows = {}          # lower(email) -> dict
        self.hits = Counter()   # lower(email) -> times seen
        self.report = report

    def resolve(self, raw_name, raw_email, raw_phone, source, legacy_id):
        email = txt(raw_email)
        email = email.lower() if email else None

        if email is None:
            # TE8 confirms zero in the CMS export. If the contacts export ever produces
            # one, exclude rather than synthesize — ADMIN-04 closed-with-default.
            self.report.add(
                "people", legacy_id, str(raw_name or ""), "excluded", "email", "", "",
                "The source record had no email address. The person is excluded from the "
                "load rather than importing a synthesized address. Resolve at ADMIN-04 "
                "once a correct email is available from the source.",
            )
            self.report.n("people excluded missing email")
            return None

        self.hits[email] += 1

        if email in self.rows:
            self._reconcile(email, raw_name, raw_phone, source, legacy_id)
            return self.rows[email]["id"]

        first, last, needs_review, review_note, source_note = split_name(raw_name)

        if source_note is not None:
            source_note = f'Source name as exported: "{source_note}" ({source} {legacy_id})'

        self.rows[email] = {
            "id": new_id("person", email),
            "first_name": first,
            "last_name": last,
            "email": email,
            "phone": txt(raw_phone),
            "needs_review": needs_review,
            "review_note": review_note,
            "source_note": source_note,
            "legacy_wix_contact_id": None,
            "created_at": None,
            "updated_at": None,
        }

        self.report.n("people created")
        if needs_review:
            self.report.n("people flagged needs_review")
        if needs_review:
            self.report.add(
                "people", legacy_id, email, "inferred", "first_name/last_name",
                str(raw_name or ""), f"{first} | {last}", review_note,
            )
        return self.rows[email]["id"]

    def _reconcile(self, email, raw_name, raw_phone, source, legacy_id):
        """
        A second source with the same email. NOT a second person.

        Names are not overwritten during migration. The live rule in Handbook
        section 8 (a matching email updates the name in place) is about a human
        resubmitting their own name; here it would let a dirtier source silently
        overwrite a cleaner one. A difference is recorded as a conflict instead.
        """
        self.report.n("people matched to an existing row")
        row = self.rows[email]

        first, last, needs_review, _, _ = split_name(raw_name)
        if not needs_review and (first != row["first_name"] or last != row["last_name"]):
            self.report.add(
                "people", legacy_id, email, "conflict", "first_name/last_name",
                f"{first} | {last} ({source})", f'{row["first_name"]} | {row["last_name"]}',
                "The same email arrived from more than one source with different names. The "
                "earlier-loaded value was kept and no second person was created.",
            )

        phone = txt(raw_phone)
        if row["phone"] is None and phone is not None:
            row["phone"] = phone

    @property
    def duplicates_collapsed(self):
        return sum(n - 1 for n in self.hits.values() if n > 1)


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------


def read_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_sources(source_dir: Path, allow_drift: bool):
    src = {}
    for name, filename in FILES.items():
        p = source_dir / filename
        if not p.exists():
            sys.exit(f"Missing source file: {p}\nExpected: {', '.join(FILES.values())}")
        src[name] = read_csv(p)

    drift = [
        f"  {k}: expected {v}, got {len(src[k])}"
        for k, v in EXPECTED_SOURCE_ROWS.items() if len(src[k]) != v
    ]
    if drift:
        msg = ("Source row counts differ from docs/migration/data-audit.md:\n"
               + "\n".join(drift)
               + "\n\nThe live system changes daily. Re-run the audit against this export "
                 "and update EXPECTED_SOURCE_ROWS, or pass --allow-drift to proceed knowingly.")
        if allow_drift:
            print(f"[WARN] {msg}\n", file=sys.stderr)
        else:
            sys.exit(msg)
    return src


def load_exclusions(path: Path):
    """
    Records that do not import, with a reason. Rows with a blank legacy id are
    flagged for a human decision nobody has made yet; they still import.
    """
    if not path.exists():
        print(f"[WARN] No exclusions file at {path}. Nothing will be excluded.", file=sys.stderr)
        return {"item_request": set(), "item": set(), "volunteer_role": set()}, []

    rows = read_csv(path)
    by_kind = defaultdict(set)
    undecided = []
    for r in rows:
        legacy = (r.get("legacy_wix_id") or "").strip()
        if legacy:
            by_kind[r["kind"]].add(legacy)
        elif (r.get("needs_human_decision") or "").upper() == "YES":
            undecided.append(r)
    return by_kind, undecided


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------


def build_populations(report: Report):
    """
    Seeded per D61: exactly eleven rows (ten MP-03 checkboxes plus Other).
    Not from the 24 distinct historical export values.
    """
    rows, taken = [], set()
    for i, name in enumerate(CANONICAL_POPULATIONS):
        base = slugify(name)
        slug, n = base, 2
        while slug in taken:
            slug, n = f"{base}-{n}", n + 1
        taken.add(slug)
        rows.append({"id": new_id("population", name), "name": name, "slug": slug,
                     "sort_order": i, "is_active": True})
        report.n("populations seeded")

    by_name = {r["name"]: r["id"] for r in rows}
    by_key = {key(r["name"]): r["id"] for r in rows}
    report.note(
        f"Seeded {len(rows)} populations per D61 (ten MP-03 values plus Other). "
        "Near-duplicate merges and populations_other preservation happen in build_organizations."
    )
    return rows, by_name, by_key


def resolve_population(raw, pop_ids_by_key):
    """
    Returns (population_id or None, other_text or None).
    Every source value links to a canonical row or is preserved in populations_other.
    """
    v = txt(raw)
    if v is None:
        return None, None

    merged = POPULATION_MERGE.get(key(v), v)
    pid = pop_ids_by_key.get(key(merged))
    if pid is not None:
        return pid, None

    # Canonical Other matches above; anything else unlinked goes to populations_other.
    return None, v


def build_organizations(orgs, pop_ids_by_key, people: People, report: Report):
    org_rows, link_rows, email_rows = [], [], []
    by_legacy = {}
    taken = {PLATFORM_OWNER_SLUG}
    approved_at_inferred = 0

    # The platform owner is not in any export. Staff memberships are NOT created:
    # the roster is an open capture (B4) and inventing one would grant admin
    # access to a guess.
    org_rows.append({
        "id": new_id("organization", "__platform_owner__"),
        "legacy_wix_id": None, "kind": "platform_owner",
        "name": PLATFORM_OWNER_NAME, "slug": PLATFORM_OWNER_SLUG,
        "website_url": None, "mission": None, "phone": None, "logo_url": None,
        "populations_other": None,
        "address_line1": None, "address_line2": None, "city": None, "state": None,
        "postal_code": None, "address_formatted": None,
        "primary_contact_person_id": None, "status": "approved",
        "approved_at": None, "approved_by": None,
        "created_at": None, "updated_at": None,
    })
    report.n("platform owner created")

    for o in orgs:
        legacy = txt(o.get("ID"))
        name = txt(o.get("Organization Name"))
        if not legacy or not name:
            report.add("organizations", legacy or "", name or "(no name)", "excluded",
                       "ID/Organization Name", "", "",
                       "The source row had no id or no name and could not be imported.")
            continue

        contact_id = people.resolve(
            o.get("Primary Contact Name"), o.get("Primary Contact Email"),
            o.get("Primary Contact Phone Number"), "organizations", legacy,
        )

        status = ORG_STATUS.get(key(o.get("Approved")))
        if status is None:
            status = "pending"
            report.add("organizations", legacy, name, "defaulted", "status",
                       txt(o.get("Approved")) or "", status,
                       "The source Approved value was absent or unrecognized. "
                       "Defaulted to pending, never approved.")

        addr = parse_address(o.get("Org Address"))
        if addr["city"] is None:
            report.add("organizations", legacy, name, "unresolved", "city",
                       txt(o.get("Org Address")) or "", "",
                       "No city could be resolved. Every approved organization must have one; "
                       "it renders as the location on both public browse surfaces. Fill by hand.")
            report.n("organizations with no city")
        elif addr["_city_parsed"]:
            report.add("organizations", legacy, name, "inferred", "city",
                       addr["address_formatted"] or "", addr["city"], addr["_note"])

        base = slugify(name)
        slug, n = base, 2
        while slug in taken:
            slug, n = f"{base}-{n}", n + 1
        taken.add(slug)

        updated = ts(o.get("Updated Date"))
        approved_at = updated if status == "approved" else None
        if approved_at:
            approved_at_inferred += 1

        org_id = new_id("organization", legacy)
        by_legacy[legacy] = org_id

        values = jload(o.get("Primary Population Served")) or []
        if not values:
            report.add("organization_populations", legacy, name, "unresolved",
                       "Primary Population Served", "", "",
                       "The organization has no populations assigned. It will not appear "
                       "under any public filter.")
        linked = set()
        other_parts = []
        for raw in values:
            pid, other_text = resolve_population(raw, pop_ids_by_key)
            if pid is not None and pid not in linked:
                linked.add(pid)
                link_rows.append({"org_id": org_id, "population_id": pid})
                report.n("organization_populations linked")
            elif other_text is not None:
                other_parts.append(other_text)
                report.n("populations_other preserved")

        org_rows.append({
            "id": org_id, "legacy_wix_id": legacy, "kind": "member_org",
            "name": name, "slug": slug,
            "website_url": txt(o.get("Website URL")),
            "mission": txt(o.get("Mission Statement")),
            "phone": txt(o.get("Org Phone Number")),
            "logo_url": None,          # media pass. Never a source-hosted URL (D38)
            "populations_other": ", ".join(other_parts) if other_parts else None,
            "address_line1": addr["address_line1"], "address_line2": addr["address_line2"],
            "city": addr["city"], "state": addr["state"],
            "postal_code": addr["postal_code"], "address_formatted": addr["address_formatted"],
            "primary_contact_person_id": contact_id, "status": status,
            "approved_at": approved_at, "approved_by": None,
            "created_at": ts(o.get("Created Date")), "updated_at": updated,
        })
        report.n("organizations imported")

        # D37. Replaces the source Approved Email Sent boolean. Without this the
        # dedup index has no record and staff can re-welcome a two-year member.
        if key(o.get("Approved Email Sent")) == "true":
            to_email = txt(o.get("Primary Contact Email"))
            if to_email:
                email_rows.append({
                    "id": new_id("email_log", legacy),
                    "template_key": "org_approved",
                    "to_email": to_email.lower(),
                    "to_person_id": contact_id,
                    "entity_type": "organization", "entity_id": org_id,
                    "payload": "{}", "status": "sent",
                    "provider_message_id": None, "error": None,
                    "sent_at": updated, "created_at": updated,
                })
                report.n("email_log rows seeded")
            else:
                report.add("email_log", legacy, name, "unresolved", "to_email", "", "",
                           "Approved Email Sent was true but there is no primary contact email, "
                           "so no dedup row could be seeded. This organization can be "
                           "re-welcomed by mistake.")

    if approved_at_inferred:
        report.note(
            f"approved_at was set to the source Updated Date on {approved_at_inferred} approved "
            "organizations; approved_by is null. This applies to organizations only. Item and "
            "volunteer requests leave approved_at and submitted_at null (D43, D48)."
        )

    return org_rows, link_rows, email_rows, by_legacy


def build_item_requests(rows, org_ids, excluded, people: People, report: Report):
    out, by_legacy, redirects = [], {}, []
    archived_inferred = 0

    for r in rows:
        legacy = txt(r.get("ID"))
        if not legacy:
            continue
        # `Title` is null on all 120 rows. `Request Title` is the real field.
        title = txt(r.get("Request Title"))

        if legacy in excluded:
            report.add("item_requests", legacy, title or "(no title)", "excluded", "org_id",
                       txt(r.get("Organization")) or "", "",
                       "Listed in docs/migration/exclusions.csv. See that file for the reason.")
            report.n("item requests excluded")
            continue

        org_legacy = txt(r.get("Organization"))
        org_id = org_ids.get(org_legacy) if org_legacy else None
        if org_id is None:
            report.add("item_requests", legacy, title or "(no title)", "excluded", "org_id",
                       org_legacy or "", "",
                       "The organization reference does not resolve and this row is NOT in "
                       "exclusions.csv. The source has changed since the audit. Re-run the audit.")
            report.n("item requests excluded, unlisted")
            continue

        if not title:
            report.add("item_requests", legacy, "(no title)", "excluded", "title", "", "",
                       "The source row has no Request Title. title is not null in the schema.")
            continue

        status = NEED_STATUS.get(key(r.get("Need Status")))
        if status is None:
            status = "archived"
            report.add("item_requests", legacy, title, "defaulted", "status",
                       txt(r.get("Need Status")) or "", status,
                       "Unmapped Need Status. Defaulted to archived so nothing unexpected "
                       "becomes public.")

        dtype = DEADLINE_TYPE.get(key(r.get("Deadline Type")))
        if dtype is None:
            dtype = "until_fulfilled"
            report.add("item_requests", legacy, title, "defaulted", "deadline_type",
                       txt(r.get("Deadline Type")) or "", dtype, "Unmapped Deadline Type.")

        ddate = date_only(r.get("Deadline Date"))
        if dtype == "date_specific" and ddate is None:
            # The schema has a CHECK constraint on this pair.
            report.add("item_requests", legacy, title, "inferred", "deadline_type",
                       "date_specific with no date", "until_fulfilled",
                       "The source said Date Specific but carried no deadline date, which the "
                       "schema forbids. Coerced to until_fulfilled.")
            dtype = "until_fulfilled"

        contact_id = people.resolve(
            r.get("Primary Contact Name"), r.get("Primary Contact Email"),
            r.get("Primary Contact Phone Number"), "item_requests", legacy,
        )

        updated = ts(r.get("Updated Date"))
        archived_at = updated if status == "archived" else None
        if archived_at:
            archived_inferred += 1

        rid = new_id("item_request", legacy)
        by_legacy[legacy] = rid

        out.append({
            "id": rid, "legacy_wix_id": legacy, "org_id": org_id,
            "title": title, "description": txt(r.get("Description")),
            "image_url": None,          # media pass
            "dropoff_location": None,   # no source field exists
            "people_helped": as_int(r.get("Quantity Helped")),
            "deadline_type": dtype, "deadline_date": ddate,
            "expires_on": date_only(r.get("Archive On")),
            "contact_person_id": contact_id, "status": status,
            "submitted_at": None,       # D43/D48: null on the historical batch
            "approved_at": None, "approved_by": None,
            "archived_at": archived_at, "archived_reason": None,
            "created_by": None,
            "created_at": ts(r.get("Created Date")), "updated_at": updated,
        })
        report.n("item requests imported")
        redirects.append({"legacy_path": f"/area-needs-request/{legacy}",
                          "new_path": f"/items/{rid}"})

    if archived_inferred:
        report.note(
            f"archived_at was set to the source Updated Date on {archived_inferred} archived item "
            "requests. archived_reason is null: the source does not distinguish manual from "
            "expired from fulfilled. approved_at and submitted_at are null on every migrated row."
        )
    return out, by_legacy, redirects


def build_items(rows, request_ids, excluded, report: Report):
    out, by_legacy = [], {}
    order = Counter()

    for it in rows:
        legacy = txt(it.get("ID"))
        name = txt(it.get("Item Name"))
        if not legacy or not name:
            continue

        if legacy in excluded:
            report.add("items", legacy, name, "excluded", "item_request_id",
                       txt(it.get("Item Request")) or "", "",
                       "Listed in docs/migration/exclusions.csv.")
            report.n("items excluded")
            continue

        parent = txt(it.get("Item Request"))
        request_id = request_ids.get(parent) if parent else None
        if request_id is None:
            # Includes items whose parent request was itself excluded.
            report.add("items", legacy, name, "excluded", "item_request_id", parent or "", "",
                       "The parent item request was not imported, so this item has nowhere "
                       "to attach.")
            report.n("items excluded, parent not imported")
            continue

        qty = as_int(it.get("Quantity"))
        if qty is None or qty <= 0:
            report.add("items", legacy, name, "defaulted", "quantity_requested",
                       txt(it.get("Quantity")) or "", "1",
                       "The source quantity was null or zero. The schema requires greater than "
                       "zero, so it was defaulted to 1. Confirm the real quantity with the "
                       "organization.")
            qty = 1

        condition = ITEM_CONDITION.get(key(it.get("Item Condition")))
        if condition is None:
            condition = "any"
            report.add("items", legacy, name, "defaulted", "condition",
                       txt(it.get("Item Condition")) or "", condition,
                       "Unmapped Item Condition.")

        item_id = new_id("item", legacy)
        by_legacy[legacy] = item_id

        out.append({
            "id": item_id, "legacy_wix_id": legacy, "item_request_id": request_id,
            "name": name, "description": txt(it.get("Item Description")),
            "condition": condition, "product_url": txt(it.get("Product Link")),
            "quantity_requested": qty,
            "quantity_claimed": 0,      # recomputed below, never imported
            "quantity_received": as_int(it.get("Received Quantity")) or 0,
            "sort_order": order[request_id],
            "created_at": ts(it.get("Created Date")), "updated_at": ts(it.get("Updated Date")),
        })
        order[request_id] += 1
        report.n("items imported")

    return out, by_legacy


def build_volunteer_requests(rows, org_ids, people: People, report: Report):
    out, by_legacy, redirects = [], {}, []

    for r in rows:
        legacy = txt(r.get("ID"))
        title = txt(r.get("Title"))  # populated on this side, unlike item requests
        if not legacy or not title:
            continue

        org_legacy = txt(r.get("Organization"))
        org_id = org_ids.get(org_legacy) if org_legacy else None
        if org_id is None:
            report.add("volunteer_requests", legacy, title, "excluded", "org_id",
                       org_legacy or "", "", "The organization reference does not resolve.")
            continue

        status = NEED_STATUS.get(key(r.get("Need Status")), "archived")
        dtype = DEADLINE_TYPE.get(key(r.get("Deadline Type")), "ongoing")

        # deadline_date is null on every migrated row: the source has no such
        # field, and the control is new per deviation one. date_specific without
        # a date violates the CHECK constraint, so coerce.
        if dtype == "date_specific":
            report.add("volunteer_requests", legacy, title, "inferred", "deadline_type",
                       "Date Specific", "ongoing",
                       "The source marked this Date Specific, but the volunteer collection has "
                       "no deadline date field to carry. The schema requires a date for "
                       "date_specific, so the type was coerced. An organization can set a real "
                       "date after cutover.")
            dtype = "ongoing"

        contact_id = people.resolve(
            r.get("Primary Contact Name"), r.get("Primary Contact Email"),
            r.get("Primary Contact Phone Number"), "volunteer_requests", legacy,
        )

        updated = ts(r.get("Updated Date"))
        rid = new_id("volunteer_request", legacy)
        by_legacy[legacy] = rid

        out.append({
            "id": rid, "legacy_wix_id": legacy, "org_id": org_id,
            "title": title, "description": txt(r.get("Description")),
            "details": txt(r.get("Details")), "event_location": txt(r.get("Event Location")),
            "image_url": None,
            "people_helped": as_int(r.get("Quantity Helped")),
            "deadline_type": dtype, "deadline_date": None,
            "expires_on": date_only(r.get("Archive On")),
            "contact_person_id": contact_id, "status": status,
            "submitted_at": None, "approved_at": None, "approved_by": None,
            "archived_at": updated if status == "archived" else None,
            "archived_reason": None, "created_by": None,
            "created_at": ts(r.get("Created Date")), "updated_at": updated,
        })
        report.n("volunteer requests imported")
        redirects.append({"legacy_path": f"/area-needs-volunteer-request/{legacy}",
                          "new_path": f"/volunteer/{rid}"})

    return out, by_legacy, redirects


def build_volunteer_roles(rows, request_ids, excluded, report: Report):
    """
    Source Claimed Quantity and Remaining Quantity are null on all 58 rows,
    corpus-wide. Received Quantity is zero on 41 and null on 17, never positive.
    Interest-not-commitment is a fact about this data, not a preference.

    There is no Manual Sort column. sort_order comes from source row order.
    """
    out, by_legacy = [], {}
    order = Counter()

    for r in rows:
        legacy = txt(r.get("ID"))
        name = txt(r.get("Role Name"))
        if not legacy or not name:
            continue

        if legacy in excluded:
            report.add("volunteer_roles", legacy, name, "excluded", "volunteer_request_id",
                       txt(r.get("Volunteer Request")) or "", "",
                       "Listed in docs/migration/exclusions.csv.")
            report.n("volunteer roles excluded")
            continue

        parent = txt(r.get("Volunteer Request"))
        request_id = request_ids.get(parent) if parent else None
        if request_id is None:
            report.add("volunteer_roles", legacy, name, "excluded", "volunteer_request_id",
                       parent or "", "", "The parent volunteer request was not imported.")
            continue

        qty = as_int(r.get("Quantity"))
        if qty is None or qty <= 0:
            report.add("volunteer_roles", legacy, name, "defaulted", "quantity_needed",
                       txt(r.get("Quantity")) or "", "1",
                       "The source quantity was null or zero. Defaulted to 1.")
            qty = 1

        role_id = new_id("volunteer_role", legacy)
        by_legacy[legacy] = role_id

        out.append({
            "id": role_id, "legacy_wix_id": legacy, "volunteer_request_id": request_id,
            "name": name, "description": txt(r.get("Role Description")),
            "quantity_needed": qty,
            "quantity_interested": 0,   # recomputed below
            "quantity_confirmed": as_int(r.get("Received Quantity")) or 0,
            "sort_order": order[request_id],
            "created_at": ts(r.get("Created Date")), "updated_at": ts(r.get("Updated Date")),
        })
        order[request_id] += 1
        report.n("volunteer roles imported")

    return out, by_legacy


def build_supporters(donors, ir_ids, item_ids, vr_ids, role_ids, people: People, report: Report):
    """
    The Donors collection splits into two branches. Confirmed: 83 item pledges,
    38 volunteer signups, 0 carrying both references, 6 carrying neither.

    Counters are computed here from the lines, never read from the source, which
    drifts on 61 of 403 items and 11 of 58 roles.
    """
    pledges, lines, signups, signup_roles = [], [], [], []

    for d in donors:
        legacy = txt(d.get("ID"))
        if not legacy:
            continue

        identifier = txt(d.get("Email")) or txt(d.get("Name")) or legacy
        ir_ref = txt(d.get("Item Request"))
        vr_ref = txt(d.get("Volunteer Request"))

        # The person is created regardless of which branch this lands in, or
        # whether it lands in either. Someone who tried to claim is a supporter.
        person_id = people.resolve(
            d.get("Name"), d.get("Email"), d.get("Phone Number"), "donors", legacy
        )
        if person_id is None:
            report.add("donors", legacy, identifier, "excluded", "email",
                       txt(d.get("Email")) or "", "",
                       "The source row had no email address. The person is excluded and "
                       "no pledge or signup was created.")
            report.n("donor rows excluded missing email")
            continue

        if ir_ref and vr_ref:
            # Zero rows here. Kept because a future export may not be so clean.
            report.add("donors", legacy, identifier, "unresolved",
                       "Item Request / Volunteer Request", f"{ir_ref} + {vr_ref}", "",
                       "The source row references both an item request and a volunteer request, "
                       "which the prior system's prose rule forbade but could not enforce. "
                       "Neither branch was created. The person was. Resolve by hand.")
            report.n("donor rows with both references")
            continue

        if not ir_ref and not vr_ref:
            report.add("donors", legacy, identifier, "excluded",
                       "Item Request / Volunteer Request", "", "",
                       "The source row references neither an item request nor a volunteer "
                       "request. No pledge or signup was created. The person was created "
                       "and is unaffected.")
            report.n("donor rows with neither reference")
            continue

        created, updated = ts(d.get("Created Date")), ts(d.get("Updated Date"))

        if ir_ref:
            request_id = ir_ids.get(ir_ref)
            if request_id is None:
                report.add("item_pledges", legacy, identifier, "excluded", "item_request_id",
                           ir_ref, "", "The referenced item request was not imported. "
                                       "The person was created.")
                continue

            pledge_id = new_id("item_pledge", legacy)
            pledges.append({
                "id": pledge_id, "legacy_wix_id": legacy, "person_id": person_id,
                "item_request_id": request_id, "notes": txt(d.get("Notes")),
                "created_at": created, "updated_at": updated,
            })
            report.n("item pledges imported")

            array = jload(d.get("Item to Quantity Array")) or []

            if not array:
                # Zero rows here (TE5). Kept because it was the single largest
                # predicted source of wrong public numbers.
                for ref in (jload(d.get("Items")) or []):
                    item_id = item_ids.get(ref)
                    if item_id is None:
                        continue
                    lines.append({"id": new_id("line", f"{legacy}:{ref}"),
                                  "item_pledge_id": pledge_id, "item_id": item_id, "quantity": 1})
                    report.add("item_pledge_lines", legacy, identifier, "defaulted", "quantity",
                               "(no quantity array)", "1",
                               "The source recorded which items were claimed but not how many. "
                               "Defaulted to 1, which understates the claimed quantity if the "
                               "donor took more.")
                    report.n("pledge lines defaulted to quantity 1")
                report.n("donor rows with an empty quantity array")
                continue

            # Two source rows list the same itemId twice in one array, which the
            # unique(item_pledge_id, item_id) constraint rejects. Sum them.
            merged = Counter()
            for entry in array:
                q = as_int(entry.get("donatedQuantity")) or 0
                if q > 0:
                    merged[entry.get("itemId")] += q

            if len(merged) < len(array):
                report.add("item_pledge_lines", legacy, identifier, "inferred", "quantity",
                           f"{len(array)} array entries", f"{len(merged)} lines",
                           "The source quantity array listed the same item more than once in "
                           "one pledge. The quantities were summed into a single line.")

            for ref, q in merged.items():
                item_id = item_ids.get(ref)
                if item_id is None:
                    report.add("item_pledge_lines", legacy, identifier, "excluded", "item_id",
                               str(ref), "",
                               "The pledge references an item that was not imported. The line was "
                               "skipped and the pledge still imported, so the recomputed claimed "
                               "quantity will be lower than the source.")
                    continue
                lines.append({"id": new_id("line", f"{legacy}:{ref}"),
                              "item_pledge_id": pledge_id, "item_id": item_id, "quantity": q})
                report.n("item pledge lines imported")
        else:
            request_id = vr_ids.get(vr_ref)
            if request_id is None:
                report.add("volunteer_signups", legacy, identifier, "excluded",
                           "volunteer_request_id", vr_ref, "",
                           "The referenced volunteer request was not imported. "
                           "The person was created.")
                continue

            signup_id = new_id("volunteer_signup", legacy)
            signups.append({
                "id": signup_id, "legacy_wix_id": legacy, "person_id": person_id,
                "volunteer_request_id": request_id, "notes": txt(d.get("Notes")),
                "created_at": created, "updated_at": updated,
            })
            report.n("volunteer signups imported")

            # Interest is one spot per role per signup. No quantity.
            seen = set()
            for ref in (jload(d.get("Volunteer Roles")) or []):
                role_id = role_ids.get(ref)
                if role_id is None:
                    report.add("volunteer_signup_roles", legacy, identifier, "excluded",
                               "volunteer_role_id", str(ref), "",
                               "The signup references a role that was not imported. "
                               "The signup still imported.")
                    continue
                if role_id in seen:
                    continue
                seen.add(role_id)
                signup_roles.append({"id": new_id("signup_role", f"{legacy}:{ref}"),
                                     "volunteer_signup_id": signup_id, "volunteer_role_id": role_id})
                report.n("volunteer signup roles imported")

    return pledges, lines, signups, signup_roles


def recompute_counters(items, lines, roles, signup_roles, source_items, donors, report: Report):
    """
    Never carry counter values from the source. quantity_remaining is a
    generated column and is not written at all.

    The stored-versus-recomputed comparison is recorded as evidence that the
    fault is being fixed, NOT as a failure signal. A large gap here is a source
    defect and is expected.
    """
    claimed = Counter()
    for l in lines:
        claimed[l["item_id"]] += l["quantity"]
    for it in items:
        it["quantity_claimed"] = claimed.get(it["id"], 0)

    interested = Counter()
    for sr in signup_roles:
        interested[sr["volunteer_role_id"]] += 1
    for r in roles:
        r["quantity_interested"] = interested.get(r["id"], 0)

    # Compare against the source, per legacy id.
    actual = Counter()
    for d in donors:
        for e in (jload(d.get("Item to Quantity Array")) or []):
            actual[e.get("itemId")] += as_int(e.get("donatedQuantity")) or 0

    for it in source_items:
        legacy = txt(it.get("ID"))
        stored = as_int(it.get("Claimed Quantity")) or 0
        recomputed = actual.get(legacy, 0)
        if stored == recomputed:
            continue
        report.add("items", legacy, txt(it.get("Item Name")) or "", "drift", "quantity_claimed",
                   str(stored), str(recomputed),
                   "The source stored claimed quantity disagreed with the sum of its donor "
                   "pledge lines. The recomputed value is authoritative and was used. This is "
                   "the counter-drift fault in the prior system, recorded as evidence.")
        report.n("items with source counter drift")

    # Nothing may exceed what was requested: quantity_remaining is generated as
    # greatest(requested - claimed, 0) and the schema forbids a negative gap.
    #
    # The pledges are real; the requested number went stale while donors kept
    # claiming. Raising requested to match claimed is the honest reconciliation:
    # remaining lands at zero, which is true, and no pledge is discarded.
    for it in items:
        if it["quantity_claimed"] <= it["quantity_requested"]:
            continue
        report.add("items", it["legacy_wix_id"], it["name"], "inferred", "quantity_requested",
                   str(it["quantity_requested"]), str(it["quantity_claimed"]),
                   "More was claimed than the organization requested, which the prior system "
                   "allowed and this schema forbids. quantity_requested was raised to match the "
                   "real claimed total so no pledge is lost. Remaining becomes zero. Confirm the "
                   "true requested quantity with the organization.")
        report.n("items where claimed exceeded requested")
        it["quantity_requested"] = it["quantity_claimed"]

    report.note(
        "Counters were computed from pledge lines and signup roles. Source values were not "
        "carried. quantity_remaining is a generated column and is not present in any output file."
    )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def write(out_dir: Path, filename: str, rows, columns):
    """
    NULL is written as the unquoted token \\N, which is what COPY expects.
    Anything else and an empty string lands as '' in a not-null column.
    """
    path = out_dir / filename
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(columns)
        for r in rows:
            w.writerow([r"\N" if r.get(c) is None else r.get(c) for c in columns])
    print(f"  {filename:38s} {len(rows):>5d} rows")
    return len(rows)


COLUMNS = {
    "people": ["id", "first_name", "last_name", "email", "phone", "needs_review",
               "review_note", "source_note", "legacy_wix_contact_id"],
    "populations": ["id", "name", "slug", "sort_order", "is_active"],
    "organizations": ["id", "legacy_wix_id", "kind", "name", "slug", "website_url", "mission",
                      "phone", "logo_url", "populations_other", "address_line1", "address_line2",
                      "city", "state", "postal_code", "address_formatted",
                      "primary_contact_person_id", "status", "approved_at", "approved_by",
                      "created_at", "updated_at"],
    "organization_populations": ["org_id", "population_id"],
    "item_requests": ["id", "legacy_wix_id", "org_id", "title", "description", "image_url",
                      "dropoff_location", "people_helped", "deadline_type", "deadline_date",
                      "expires_on", "contact_person_id", "status", "submitted_at", "approved_at",
                      "approved_by", "archived_at", "archived_reason", "created_by",
                      "created_at", "updated_at"],
    "items": ["id", "legacy_wix_id", "item_request_id", "name", "description", "condition",
              "product_url", "quantity_requested", "quantity_claimed", "quantity_received",
              "sort_order", "created_at", "updated_at"],
    "volunteer_requests": ["id", "legacy_wix_id", "org_id", "title", "description", "details",
                           "event_location", "image_url", "people_helped", "deadline_type",
                           "deadline_date", "expires_on", "contact_person_id", "status",
                           "submitted_at", "approved_at", "approved_by", "archived_at",
                           "archived_reason", "created_by", "created_at", "updated_at"],
    "volunteer_roles": ["id", "legacy_wix_id", "volunteer_request_id", "name", "description",
                        "quantity_needed", "quantity_interested", "quantity_confirmed",
                        "sort_order", "created_at", "updated_at"],
    "item_pledges": ["id", "legacy_wix_id", "person_id", "item_request_id", "notes",
                     "created_at", "updated_at"],
    "item_pledge_lines": ["id", "item_pledge_id", "item_id", "quantity"],
    "volunteer_signups": ["id", "legacy_wix_id", "person_id", "volunteer_request_id", "notes",
                          "created_at", "updated_at"],
    "volunteer_signup_roles": ["id", "volunteer_signup_id", "volunteer_role_id"],
    "email_log": ["id", "template_key", "to_email", "to_person_id", "entity_type", "entity_id",
                  "payload", "status", "provider_message_id", "error", "sent_at", "created_at"],
}

ORDER = [
    ("01_people.csv", "people"),
    ("02_populations.csv", "populations"),
    ("03_organizations.csv", "organizations"),
    ("04_organization_populations.csv", "organization_populations"),
    ("05_item_requests.csv", "item_requests"),
    ("06_items.csv", "items"),
    ("07_volunteer_requests.csv", "volunteer_requests"),
    ("08_volunteer_roles.csv", "volunteer_roles"),
    ("09_item_pledges.csv", "item_pledges"),
    ("10_item_pledge_lines.csv", "item_pledge_lines"),
    ("11_volunteer_signups.csv", "volunteer_signups"),
    ("12_volunteer_signup_roles.csv", "volunteer_signup_roles"),
    ("13_email_log.csv", "email_log"),
]


def write_load_sql(out_dir: Path, counts):
    """One \\copy per file, in foreign-key order. This is the entire load step."""
    lines = [
        "-- load.sql — generated by transform.py. Do not hand-edit.",
        "--",
        "-- Loads the thirteen CSVs in data/load/ into a database that already has",
        "-- migrations/0001_initial_schema.sql applied. Run from the repository root:",
        "--",
        '--     psql "$DATABASE_URL" -f load.sql',
        "--",
        "-- One transaction. Any failure rolls the whole thing back and nothing is written.",
        "-- Idempotent only in the sense that it refuses to run twice: the unique indexes on",
        "-- legacy_wix_id and lower(email) will reject a second load. To re-load, truncate first.",
        "--",
        "-- COPY does not fire the BEFORE UPDATE triggers, so the preserved source timestamps",
        "-- in created_at and updated_at survive exactly as exported.",
        "--",
        "-- NOT loaded here: users, org_memberships, digest_subscribers. All three come from the",
        "-- contacts export, which has not been received. Nobody can log in until it arrives.",
        "-- Also not loaded: image_url and logo_url, filled by the media pass after upload.",
        "",
        "\\set ON_ERROR_STOP on",
        "begin;",
        "",
    ]
    for filename, table in ORDER:
        cols = ", ".join(COLUMNS[table])
        lines += [
            f"-- {table}: {counts.get(table, 0)} rows",
            f"\\copy {table} ({cols}) from 'data/load/{filename}' with (format csv, header true, null '\\N')",
            "",
        ]
    lines += [
        "commit;",
        "",
        "-- Then prove it worked:",
        "--     psql \"$DATABASE_URL\" -f docs/migration/validation.sql",
        "",
    ]
    (out_dir.parent.parent / "load.sql").write_text("\n".join(lines), encoding="utf-8")


def write_report(out_dir: Path, report: Report, people: People, counts):
    rows = "\n".join(f"| {k} | {v} |" for k, v in sorted(report.counts.items())
                     if not k.startswith("exception:"))
    kinds = "\n".join(f"| {k.split(':', 1)[1]} | {v} |" for k, v in sorted(report.counts.items())
                      if k.startswith("exception:"))
    notes = "\n".join(f"- {n}" for n in report.notes) or "None."
    tables = "\n".join(f"| `{t}` | {counts.get(t, 0)} |" for _, t in ORDER)

    (out_dir / "transform-report.md").write_text(f"""# Transform report

Generated {datetime.now(timezone.utc).isoformat()} by `transform.py`.

Rules in `docs/migration/field-map.md`. Measurements in `docs/migration/data-audit.md`.

**This report records what the transform produced. It does not prove the load is
correct.** Run `docs/migration/validation.sql` after loading and commit its output.

## Rows written

| Table | Rows |
|---|---|
{tables}

## The collapse

| | |
|---|---|
| Distinct people | {len(people.rows)} |
| Duplicate records collapsed | {people.duplicates_collapsed} |
| Flagged `needs_review` | {report.counts.get("people flagged needs_review", 0)} |

## Work counts

| Item | Count |
|---|---|
{rows}

## Exceptions by kind

{"| Kind | Count |" + chr(10) + "|---|---|" + chr(10) + kinds if kinds else "None."}

Full detail in `migration-exceptions.csv`.

## Missing-email exclusions

{"**ATTENTION:** " + str(report.counts.get("people excluded missing email", 0)) + " source record(s) had no email and were excluded from `people`. TE8 confirms zero in the CMS export; any occurrence here deserves a second look, not a silent pass-through. Detail in `migration-exceptions.csv`." if report.counts.get("people excluded missing email", 0) else "None. TE8 confirms zero no-email rows in the CMS export."}

## Inferences made once, for a class of rows

{notes}

## Next

1. Open `01_people.csv` and `03_organizations.csv` and look at them.
2. `psql "$DATABASE_URL" -f load.sql`
3. `psql "$DATABASE_URL" -f docs/migration/validation.sql`
4. Run the media pass to attach images.
5. Review flagged people at ADMIN-04.
""", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Transform the Wix CMS export into load-ready CSVs.")
    ap.add_argument("--source", default="data/legacy-export", type=Path)
    ap.add_argument("--out", default="data/load", type=Path)
    ap.add_argument("--exclusions", default="docs/migration/exclusions.csv", type=Path)
    ap.add_argument("--allow-drift", action="store_true",
                    help="Proceed even if source row counts differ from the audit.")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    src = load_sources(args.source, args.allow_drift)
    excluded, undecided = load_exclusions(args.exclusions)

    if undecided:
        print(f"\n[WARN] {len(undecided)} rows in exclusions.csv are flagged "
              f"needs_human_decision=YES with no legacy id. They WILL be imported:",
              file=sys.stderr)
        for r in undecided:
            print(f"        - {r['kind']}: {r['identifier']}", file=sys.stderr)
        print("", file=sys.stderr)

    report = Report()
    people = People(report)

    print("\nTransforming\n")

    populations, pop_ids, pop_ids_by_key = build_populations(report)
    orgs, org_pops, email_log, org_ids = build_organizations(
        src["organizations"], pop_ids_by_key, people, report
    )
    item_requests, ir_ids, redirects_a = build_item_requests(
        src["item_requests"], org_ids, excluded["item_request"], people, report
    )
    items, item_ids = build_items(src["items"], ir_ids, excluded["item"], report)
    volunteer_requests, vr_ids, redirects_b = build_volunteer_requests(
        src["volunteer_requests"], org_ids, people, report
    )
    roles, role_ids = build_volunteer_roles(
        src["volunteer_roles"], vr_ids, excluded["volunteer_role"], report
    )
    pledges, lines, signups, signup_roles = build_supporters(
        src["donors"], ir_ids, item_ids, vr_ids, role_ids, people, report
    )
    recompute_counters(items, lines, roles, signup_roles, src["items"], src["donors"], report)

    data = {
        "people": list(people.rows.values()),
        "populations": populations,
        "organizations": orgs,
        "organization_populations": org_pops,
        "item_requests": item_requests,
        "items": items,
        "volunteer_requests": volunteer_requests,
        "volunteer_roles": roles,
        "item_pledges": pledges,
        "item_pledge_lines": lines,
        "volunteer_signups": signups,
        "volunteer_signup_roles": signup_roles,
        "email_log": email_log,
    }

    counts = {}
    for filename, table in ORDER:
        counts[table] = write(args.out, filename, data[table], COLUMNS[table])

    write(args.out, "migration-exceptions.csv", report.exceptions,
          ["entity", "legacy_id", "identifier", "kind", "field",
           "source_value", "imported_value", "reason"])
    write(args.out, "redirects.csv", redirects_a + redirects_b, ["legacy_path", "new_path"])

    write_load_sql(args.out, counts)
    write_report(args.out, report, people, counts)

    print(f"\n  distinct people            {len(people.rows)}")
    print(f"  duplicates collapsed       {people.duplicates_collapsed}")
    print(f"  flagged needs_review       {report.counts.get('people flagged needs_review', 0)}")
    print(f"  organizations with no city {report.counts.get('organizations with no city', 0)}")
    print(f"  exceptions                 {len(report.exceptions)}")

    empty_arrays = report.counts.get("donor rows with an empty quantity array", 0)
    if empty_arrays:
        print(f"\n  ATTENTION: {empty_arrays} donor rows carry an empty quantity array. "
              f"{report.counts.get('pledge lines defaulted to quantity 1', 0)} pledge lines "
              f"defaulted to quantity 1,\n             which understates claimed quantities on "
              f"those items. See migration-exceptions.csv.")
    raised = report.counts.get("items where claimed exceeded requested", 0)
    if raised:
        print(f"  {raised} items had quantity_requested raised to match a larger claimed total.")

    missing_email = report.counts.get("people excluded missing email", 0)
    if missing_email:
        print(f"\n  *** ATTENTION: {missing_email} source record(s) had no email address. ***")
        print("              TE8 says the CMS export has zero of these; any occurrence")
        print("              deserves a second look. See migration-exceptions.csv.")

    print("\n  Next: psql \"$DATABASE_URL\" -f load.sql\n")


if __name__ == "__main__":
    main()