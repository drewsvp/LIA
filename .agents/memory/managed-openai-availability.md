---
name: Out-of-band need photos
description: The standing rule for putting a photo on a need without the app's own provider call.
---

# Out-of-band need photos

A photo may only reach a need through the pipeline's own three steps: the service's prompt
builder, the storage adapter, and the DAL's generated-image write. When the provider cannot
be called from the app and images are produced elsewhere, they still go through those steps —
never a direct column write.

**Why:** a photo written any other way looks identical on the page while breaking rules that
have no visible symptom — a provider or local path stored in an image column, an uploaded
photo silently replaced, or a row parked mid-claim that the sweep then retries forever.

**How to apply:** choose candidates by a null image URL, never by image-generation status —
a row with an uploaded photo carries no status, so a status query returns precisely the
photos that must never be touched.
