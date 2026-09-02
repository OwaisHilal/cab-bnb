# Action required: apply WhatsApp templates migration

The app is wired to load WhatsApp message copy from Supabase table **`whatsapp_message_templates`**, but that table is **not on the remote project yet**.

Migration file (ready in repo):

`supabase/migrations/20260814000100_0012_whatsapp_message_templates.sql`

Until it runs, the app uses **inline fallbacks** (same copy, not editable in DB).

---

## Copy-paste message (for team / Supabase admin)

> **WhatsApp templates — migration needed on Supabase**
>
> We added a migration that creates `public.whatsapp_message_templates` and seeds 12 rows (OTP, quotes, vendor notify, balance, driver contact, etc.).
>
> **Remote project:** `cabkashmir` (`cngyqwrueoskacohqclp`)
>
> **Please apply one of:**
>
> 1. **Supabase Dashboard (easiest, no DB password)**  
>    SQL Editor → paste `supabase/migrations/20260814000100_0012_whatsapp_message_templates.sql` → Run
>
> 2. **Supabase CLI** (needs Supabase account login)  
>    ```bash
>    npx supabase login
>    npx supabase db push
>    ```
>
> 3. **CLI with database password only** (no Supabase login, if you have DB password)  
>    Dashboard → Settings → Database → Reset/view database password, then:  
>    ```bash
>    npx supabase db push --linked --password YOUR_DB_PASSWORD
>    ```
>    Or locally: `npm run db:templates` after adding `SUPABASE_DB_PASSWORD` to `.env`
>
> **What I need:** someone with access to the Supabase project (dashboard login or database password) to run the migration once.
>
> **Verify after apply:** Table Editor → `whatsapp_message_templates` should show **12 rows**.

---

## What access is needed

| Method | Access required |
|--------|-----------------|
| Dashboard SQL editor | Supabase **account login** with access to project `cabkashmir` |
| `supabase login` + `db push` | Same — Supabase **account login** linked to the org/project |
| `db push --password` / `npm run db:templates` | **Database password** only (Settings → Database → Reset password) |

**Note:** `SUPABASE_SECRET_KEY` in `.env` is **not** the database password. It cannot run DDL (CREATE TABLE).

---

## After migration

- Runtime copy loads from `whatsapp_message_templates` via `lib/whatsapp/messageTemplateStore.ts`
- Full flow + template bodies: `docs/whatsapp-booking-flow.md`
