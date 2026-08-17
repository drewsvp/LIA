-- 0003_merge_people_function.sql
-- merge_people(p_duplicate, p_survivor) — the ADMIN-04 merge (spec §6, D16).
--
-- The spec says this function was folded into 0001_initial_schema.sql; it
-- was not (only the approval_events 'person' entity_type made it in), and
-- applied migrations are immutable under the sha256 bookkeeping in
-- apply-migrations.ts. So it lands here, as a new file, per the captain's
-- approval of Aug 17 2026.
--
-- FK audit (pg_constraint, Aug 17 2026): eight columns reference people(id),
-- all ON DELETE NO ACTION. Every one is reassigned to the survivor:
--   item_pledges.person_id                      — pledge history follows the human
--   volunteer_signups.person_id                 — signup history follows the human
--   users.person_id                             — login account follows (unique; see guard)
--   digest_subscribers.person_id                — subscription follows (unique on email,
--                                                 not person_id, so two rows may point at
--                                                 the survivor if both were subscribed)
--   organizations.primary_contact_person_id     — org contact follows (§7: stated
--                                                 prominently in the UI before merging)
--   email_log.to_person_id                      — send history follows; to_email keeps
--                                                 the literal address it was sent to
--   item_requests.contact_person_id             — request contact follows
--   volunteer_requests.contact_person_id        — request contact follows
-- Deliberately not touched:
--   approval_events — no FK to people. actor_user_id references users(id),
--     and merge never deletes users rows, so audit actors survive. entity_id
--     is polymorphic (no FK); the app writes the merge event against the
--     survivor with the deleted id preserved in the note (D31).
--   org_memberships — hang off users(id), so they follow the login account
--     implicitly when users.person_id is reassigned.
--   items / counters — reassignment changes who pledged, never what (§3).
--     No quantity column is read or written here.
-- Because every FK is NO ACTION, a future ninth reference that this
-- function does not know about makes the DELETE below fail loudly and roll
-- back — nothing can be orphaned silently.
--
-- The DELETE here is the system's only row delete (spec §6): the merge is
-- the one action whose entire point is that the duplicate row stops
-- existing. Everything else in the system archives or removes by status.

create function merge_people(p_duplicate uuid, p_survivor uuid)
returns jsonb
language plpgsql
as $$
declare
  n_pledges int;
  n_signups int;
  n_users int;
  n_digest int;
  n_org_contacts int;
  n_email int;
  n_item_req_contacts int;
  n_vol_req_contacts int;
begin
  if p_duplicate is null or p_survivor is null then
    raise exception 'merge_people: both ids are required';
  end if;
  if p_duplicate = p_survivor then
    raise exception 'merge_people: duplicate and survivor are the same row';
  end if;

  -- Lock both rows in id order, so two concurrent merges touching the same
  -- pair cannot deadlock regardless of call direction.
  perform 1 from people where id = least(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', least(p_duplicate, p_survivor);
  end if;
  perform 1 from people where id = greatest(p_duplicate, p_survivor) for update;
  if not found then
    raise exception 'merge_people: person % not found', greatest(p_duplicate, p_survivor);
  end if;

  -- Defense in depth behind the app-side pre-check (§12): users.person_id
  -- is unique — two login accounts cannot collapse into one person row.
  -- The app renders the readable reason; this guard makes the invariant
  -- hold even for a caller that skipped the pre-check.
  if exists (select 1 from users where person_id = p_duplicate)
     and exists (select 1 from users where person_id = p_survivor) then
    raise exception 'merge_people: both records have login accounts';
  end if;

  update item_pledges set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_pledges = row_count;

  update volunteer_signups set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_signups = row_count;

  update users set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_users = row_count;

  update digest_subscribers set person_id = p_survivor where person_id = p_duplicate;
  get diagnostics n_digest = row_count;

  update organizations set primary_contact_person_id = p_survivor
   where primary_contact_person_id = p_duplicate;
  get diagnostics n_org_contacts = row_count;

  update email_log set to_person_id = p_survivor where to_person_id = p_duplicate;
  get diagnostics n_email = row_count;

  update item_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_item_req_contacts = row_count;

  update volunteer_requests set contact_person_id = p_survivor where contact_person_id = p_duplicate;
  get diagnostics n_vol_req_contacts = row_count;

  delete from people where id = p_duplicate;

  return jsonb_build_object(
    'pledges', n_pledges,
    'signups', n_signups,
    'users', n_users,
    'digestSubscribers', n_digest,
    'orgPrimaryContacts', n_org_contacts,
    'emailLogEntries', n_email,
    'itemRequestContacts', n_item_req_contacts,
    'volunteerRequestContacts', n_vol_req_contacts);
end
$$;
