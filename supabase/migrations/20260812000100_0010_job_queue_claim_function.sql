-- =====================================================================
-- Migration 0010: Atomic Job Queue Claiming
-- Checklist 3.10 / Plan §12: the job-queue-worker Edge Function is
-- invoked by a 1-min cron (Checklist 2.8) and must be safe to run
-- concurrently/overlapping without double-processing a row. Plain
-- PostgREST/supabase-js calls can't issue `for update skip locked`, so
-- this follows the same "logic lives in a Postgres function invoked via
-- .rpc() from the service-role client only" pattern established in
-- 0009_negotiation_and_finalize_functions.sql.
--
-- `p_job_types` lets the worker only claim job_types it currently has a
-- handler for, leaving job_types without a handler yet (e.g.
-- notify_vendor_booking, parse_driver_details) untouched and queued for
-- their future phases rather than mis-marking them as failed.
-- =====================================================================

create or replace function public.claim_due_jobs(p_job_types text[], p_limit int)
returns setof public.job_queue
language plpgsql
as $$
begin
  return query
  update public.job_queue
  set status = 'processing', attempts = attempts + 1, updated_at = now()
  where id in (
    select id from public.job_queue
    where status = 'queued'
      and run_after <= now()
      and job_type = any(p_job_types)
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

revoke execute on function public.claim_due_jobs(text[], int) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(text[], int) to service_role;
