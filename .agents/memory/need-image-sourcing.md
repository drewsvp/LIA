---
name: Need auto-image sourcing
description: Decisions and provider quirks for auto-sourced item-request images (Pexels-first, OpenAI fallback)
---

# Need auto-image sourcing

Rule: item requests without an uploaded photo get an auto-sourced image — Pexels stock search first, OpenAI image generation only as fallback (user decision, Aug 2026). Uploaded photos always win; the guard lives in SQL (`recordGeneratedImage` only writes where image_url is null or image_generated), not in route code.

**Why:** user preferred real stock photos over per-image AI cost; uploaded-wins in SQL closes the async race between background sourcing and a staff upload.

**How to apply:** any new write path that sets an uploaded image must also clear `image_generated`/`image_gen_status` so automation never touches it again. Volunteer requests are deliberately excluded (people-focused; decide with user).

Provider quirks:
- OpenAI `/v1/images/generations` now REJECTS the old `response_format` parameter (`Unknown parameter`). Use `gpt-image-1`; it returns `b64_json` by default. Valid sizes include 1536x1024.
- The user's OpenAI account hit "Billing hard limit has been reached" (Aug 2026) — AI fallback fails visibly until they add credit; this is account-side, not code.
- Failures must land on the row (`image_gen_status='failed'` + message) so staff see them on the admin request panel; retry = staff Regenerate button.
