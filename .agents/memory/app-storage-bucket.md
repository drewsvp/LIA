---
name: App Storage default bucket
description: Bucket provisioning is manual; how to detect whether one exists
---
- App Storage buckets cannot be created programmatically from the workspace — the user must click Create bucket in the App Storage tool. Plan for an AskQuestion round-trip in any storage task on a fresh project.
- To detect whether a default bucket exists, `curl http://127.0.0.1:1106/object-storage/default-bucket`: empty `bucketId` means none, and `@replit/object-storage` `new Client()` will fail loudly. Propagation after creation isn't instant — poll briefly after the user confirms.
- **How to apply:** check first, ask early (don't leave the bucket for last), and never hunt for a creation API.
