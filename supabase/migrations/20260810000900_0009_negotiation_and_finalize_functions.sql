-- =====================================================================
-- Migration 0009: Negotiation + Booking Finalize Functions
-- Plan §10 fallback routes (POST /api/quotes/:id/negotiate,
-- POST /api/bookings/finalize) and Checklist 3.3/3.4 both require a
-- `select ... for update` row lock against double-tap races. Plain
-- supabase-js/PostgREST calls cannot issue that clause directly, so
-- this logic lives in Postgres functions invoked via .rpc() from the
-- service-role client only (see 0008_rls_policies.sql for the same
-- service-role-only access model).
-- =====================================================================

-- ================= compute_negotiation =================
-- Checklist 3.3 / Plan §3.4: randomized bounded decrement, locked
-- against concurrent double-taps on the same quote_snapshot row.
create or replace function public.compute_negotiation(p_quote_snapshot_id uuid)
returns table (next_quote numeric, is_final boolean, negotiation_round int)
language plpgsql
as $$
declare
  v_snapshot record;
  v_band record;
  v_step numeric;
  v_next numeric;
  v_is_final boolean;
  v_previous_quote numeric;
begin
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

  select * into v_band
  from public.vendor_rate_bands
  where id = v_snapshot.vendor_rate_band_id;

  v_previous_quote := v_snapshot.current_quote;

  if v_snapshot.negotiation_round >= v_band.max_negotiation_rounds then
    v_next := v_snapshot.min_quote_floor;
    v_is_final := true;
  else
    v_step := v_band.negotiation_step_min
      + random() * (v_band.negotiation_step_max - v_band.negotiation_step_min);
    v_next := greatest(v_snapshot.current_quote - v_step, v_snapshot.min_quote_floor);
    -- round to nearest 10 (Plan §3.4)
    v_next := round(v_next / 10) * 10;
    v_is_final := v_next <= v_snapshot.min_quote_floor;
  end if;

  update public.quote_snapshots
  set
    current_quote = v_next,
    negotiation_round = negotiation_round + 1,
    negotiation_history = negotiation_history || jsonb_build_object(
      'round', v_snapshot.negotiation_round + 1,
      'previous_quote', v_previous_quote,
      'next_quote', v_next,
      'step', v_step,
      'at', now()
    ),
    status = 'negotiating'
  where id = p_quote_snapshot_id;

  -- Plan §8 state machine: quotes_sent -> negotiating. Never regress a
  -- trip_request that's already moved further along (e.g. booked).
  update public.trip_requests
  set status = 'negotiating'
  where id = v_snapshot.trip_request_id
    and status = 'quotes_sent';

  return query select v_next, v_is_final, v_snapshot.negotiation_round + 1;
end;
$$;

revoke execute on function public.compute_negotiation(uuid) from public, anon, authenticated;
grant execute on function public.compute_negotiation(uuid) to service_role;

-- ================= finalize_quote_booking =================
-- Checklist 3.4: commit booking, mark sibling snapshots lost, enqueue
-- vendor notification job. Locked the same way as compute_negotiation
-- so a finalize and a concurrent negotiate on the same row can't race.
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

  -- Plan §3.5: no payment gateway exists in this app; the two lock
  -- options map directly onto the two non-terminal payment_status
  -- values already reserved for them.
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

  insert into public.job_queue (job_type, payload)
  values ('notify_vendor_booking', jsonb_build_object('booking_id', v_booking_id));

  return query select v_booking_id, v_booking_ref;
end;
$$;

revoke execute on function public.finalize_quote_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_quote_booking(uuid, text) to service_role;
