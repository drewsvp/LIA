---
name: Polymorphic PL/pgSQL trigger rows
description: How to safely reference table-specific NEW and OLD fields from one trigger function used by multiple tables.
---

A trigger function shared by tables with different row shapes must put every table-specific `NEW` or `OLD` field reference inside a separate `IF`/`ELSIF` branch for that table. Do not combine a table-name check and a field reference in one boolean expression.

**Why:** PL/pgSQL resolves the entire expression against the trigger row type before boolean short-circuiting. A guard such as `tg_table_name = 'items' AND NEW.item_only_column ...` can still fail when the same function runs for another table that lacks that field.

**How to apply:** In polymorphic trigger functions, test `TG_TABLE_NAME` first, then reference only that table's fields inside the selected nested branch. Keep fresh-database migration history and the schema snapshot aligned.