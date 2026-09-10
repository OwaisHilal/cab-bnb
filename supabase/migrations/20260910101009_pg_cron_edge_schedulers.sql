-- =====================================================================
-- Migration 0020: pg_cron + pg_net Edge Function schedulers
-- Hobby Vercel Cron is once-per-day only. Interactive jobs drain on
-- demand (drainDueJobs). This migration:
--   1. Invokes job-queue-worker on due job_queue inserts (pg_net)
--   2. Schedules retries / delayed jobs every minute (pg_cron)
--   3. Schedules lifecycle / quote-expiry / vendor-SLA sweeps
--   4. Enqueues token_99 vendor notify as due-now so FIFO drain can send
--      ack then notify in the same request (the old +3s delay assumed a
--      1-minute Vercel cron)
-- Auth token lives in Vault (not this file). After migrate:
--   select private.set_edge_cron_secrets(
--     '<project origin>',
--     '<SUPABASE_SERVICE_ROLE_KEY JWT>'
--   );
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;
do $$
begin
  grant usage on schema private to supabase_admin;
exception when undefined_object then
  null;
end $$;

alter table public.job_queue enable row level security;

create or replace function private.invoke_edge_function(p_function_name text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  if p_function_name not in (
    'job-queue-worker',
    'dispatch-lifecycle-events',
    'expire-stale-quotes',
    'vendor-reply-timeouts'
  ) then
    raise warning 'invoke_edge_function: refused function name %', p_function_name;
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'edge_cron_project_url'
  limit 1;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'edge_cron_service_role_key'
  limit 1;

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    raise warning 'invoke_edge_function: vault secrets edge_cron_project_url/edge_cron_service_role_key are not set';
    return null;
  end if;

  v_url := rtrim(v_url, '/') || '/functions/v1/' || p_function_name;

  v_request_id := net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    timeout_milliseconds := 50000
  );

  return v_request_id;
end;
$$;

revoke all on function private.invoke_edge_function(text) from public, anon, authenticated;
grant execute on function private.invoke_edge_function(text) to postgres;

create or replace function private.set_edge_cron_secrets(p_project_url text, p_service_role_key text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
declare
  v_id uuid;
  v_url text := trim(p_project_url);
  v_key text := trim(p_service_role_key);
begin
  if v_url is null or v_url = '' then
    raise exception 'project_url is required';
  end if;
  if v_key is null or v_key = '' then
    raise exception 'service_role_key is required';
  end if;

  select id into v_id from vault.secrets where name = 'edge_cron_project_url' limit 1;
  if v_id is null then
    perform vault.create_secret(
      v_url,
      'edge_cron_project_url',
      'Supabase project origin for pg_cron Edge Function calls'
    );
  else
    perform vault.update_secret(
      v_id,
      v_url,
      'edge_cron_project_url',
      'Supabase project origin for pg_cron Edge Function calls'
    );
  end if;

  v_id := null;
  select id into v_id from vault.secrets where name = 'edge_cron_service_role_key' limit 1;
  if v_id is null then
    perform vault.create_secret(
      v_key,
      'edge_cron_service_role_key',
      'Service-role JWT for pg_cron Edge Function Authorization (SUPABASE_SERVICE_ROLE_KEY)'
    );
  else
    perform vault.update_secret(
      v_id,
      v_key,
      'edge_cron_service_role_key',
      'Service-role JWT for pg_cron Edge Function Authorization (SUPABASE_SERVICE_ROLE_KEY)'
    );
  end if;
end;
$$;

revoke all on function private.set_edge_cron_secrets(text, text) from public, anon, authenticated;
grant execute on function private.set_edge_cron_secrets(text, text) to postgres;

create or replace function private.kick_job_queue_worker()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from new_jobs
    where status = 'queued' and run_after <= now()
  ) then
    perform private.invoke_edge_function('job-queue-worker');
  end if;
  return null;
end;
$$;

revoke all on function private.kick_job_queue_worker() from public, anon, authenticated;
grant execute on function private.kick_job_queue_worker() to postgres;

drop trigger if exists trg_job_queue_kick_worker on public.job_queue;
create trigger trg_job_queue_kick_worker
  after insert on public.job_queue
  referencing new table as new_jobs
  for each statement
  execute function private.kick_job_queue_worker();

do $$
declare
  r record;
begin
  for r in
    select jobid from cron.job
    where jobname in (
      'invoke-job-queue-worker',
      'invoke-dispatch-lifecycle-events',
      'invoke-expire-stale-quotes',
      'invoke-vendor-reply-timeouts'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'invoke-job-queue-worker',
  '* * * * *',
  $$select private.invoke_edge_function('job-queue-worker')$$
);

select cron.schedule(
  'invoke-dispatch-lifecycle-events',
  '*/15 * * * *',
  $$select private.invoke_edge_function('dispatch-lifecycle-events')$$
);

select cron.schedule(
  'invoke-expire-stale-quotes',
  '0 * * * *',
  $$select private.invoke_edge_function('expire-stale-quotes')$$
);

select cron.schedule(
  'invoke-vendor-reply-timeouts',
  '*/10 * * * *',
  $$select private.invoke_edge_function('vendor-reply-timeouts')$$
);

-- Token lock: enqueue vendor notify as due-now. claim_due_jobs orders by
-- run_after, created_at so the ack row (inserted first) still goes first.
-- The previous +3s delay assumed a 1-minute Vercel cron and would stall
-- vendor WhatsApp until pg_cron/vault or the daily Hobby safety net.
create or replace function public.finalize_quote_booking(
  p_quote_snapshot_id uuid,
  p_lock_type text
)
returns table (booking_id uuid, booking_ref text)
language plpgsql
as $$
declare
  v_snapshot record;
  v_trip_request record;
  v_payment_status public.payment_status;
  v_booking_ref text;
  v_booking_id uuid;
  v_attempt int := 0;
begin
  if p_lock_type not in ('full_payment', 'token_99') then
    raise exception 'invalid_lock_type';
  end if;

  select * into v_snapshot
  from public.quote_snapshots
  where id = p_quote_snapshot_id
  for update;

  if not found then
    raise exception 'quote_snapshot_not_found';
  end if;

  if v_snapshot.status in ('finalized', 'lost', 'expired') then
    raise exception 'quote_snapshot_not_negotiable';
  end if;

  select * into v_trip_request
  from public.trip_requests
  where id = v_snapshot.trip_request_id;

  if v_trip_request.tourist_id is null then
    raise exception 'tourist_not_verified';
  end if;

  v_payment_status := case p_lock_type
    when 'token_99' then 'token_paid'
    else 'fully_paid'
  end;

  loop
    v_attempt := v_attempt + 1;
    v_booking_ref := public.generate_booking_ref();
    begin
      insert into public.bookings (
        booking_ref, tourist_id, trip_request_id, winning_quote_snapshot_id,
        vendor_id, vehicle_type_id, status, payment_status, lock_type,
        final_quote, pickup_at, trip_days, pax_count
      ) values (
        v_booking_ref, v_trip_request.tourist_id, v_trip_request.id, v_snapshot.id,
        v_snapshot.vendor_id, v_snapshot.vehicle_type_id, 'vendor_confirming', v_payment_status, p_lock_type,
        v_snapshot.current_quote, v_trip_request.trip_start_date::timestamptz, v_trip_request.trip_days, v_trip_request.pax_count
      )
      returning id into v_booking_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'booking_ref_generation_failed';
      end if;
    end;
  end loop;

  update public.quote_snapshots
  set status = 'finalized'
  where id = p_quote_snapshot_id;

  update public.quote_snapshots
  set status = 'lost'
  where trip_request_id = v_snapshot.trip_request_id
    and id <> p_quote_snapshot_id
    and status not in ('finalized', 'lost');

  update public.trip_requests
  set status = 'booked'
  where id = v_trip_request.id;

  if p_lock_type = 'token_99' then
    insert into public.job_queue (job_type, payload, run_after)
    values (
      'send_token_received_ack',
      jsonb_build_object('booking_id', v_booking_id),
      now()
    );
    insert into public.job_queue (job_type, payload, run_after)
    values (
      'notify_vendor_booking',
      jsonb_build_object('booking_id', v_booking_id),
      now()
    );
  else
    insert into public.job_queue (job_type, payload)
    values ('notify_vendor_booking', jsonb_build_object('booking_id', v_booking_id));
  end if;

  return query select v_booking_id, v_booking_ref;
end;
$$;

revoke execute on function public.finalize_quote_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_quote_booking(uuid, text) to service_role;
