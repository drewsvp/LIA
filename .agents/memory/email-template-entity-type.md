---
name: Email template entity defaults
description: Shared email templates carry a per-template default entity_type; cross-entity callers must override it explicitly.
---

# Shared email templates default their entity_type

The queue-email helpers for templates that serve multiple entity kinds (e.g. an "org request received" template used by both item and volunteer submissions) take an optional `entityType` that defaults to the template's original entity.

**Why:** A volunteer-side call that omitted the override logged its email rows as `entity_type='item_request'` — silently, since sends still succeeded and dedup keys still matched. Found only by row inspection during E2E.

**How to apply:** Whenever a template helper is called for a different entity kind than the one it was first written for, pass `entityType` (and `entityId`) explicitly at the call site, and verify with a `select entity_type from email_log` probe after the first E2E submission. Failed-status rows are excluded from the dedup unique index, so wrong-label residue from before a fix stays inert.
