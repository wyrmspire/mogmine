# Planned schema (not applied)

These files are the M1 sketch for trader-owned rows: trades, notes, and annotations.

They are **not** in `supabase/migrations/` and must not be applied in this workstream.

The journal stays on the device (`localStorage` + IndexedDB) until Chris accepts a cutover (`AC-08`). Applying this SQL early would create empty tables with RLS, which is fine in a dev project, but the app does not read or write them yet.

Every table here is sketched with `user_id` and `auth.uid()` RLS, following `OD-2`.
