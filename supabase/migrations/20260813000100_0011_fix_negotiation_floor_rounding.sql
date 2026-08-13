-- =====================================================================
-- Migration 0011: Fix compute_negotiation floor rounding (audit A2)
-- Plan §3.4 requires the negotiated quote to round to the nearest 10
-- but never drop below vendor_rate_bands.min_quote_floor. The 0009
-- definition clamped to the floor *before* rounding, so a floor that
-- isn't a multiple of 10 (e.g. 1005) could round down to a value below
-- the floor (e.g. 1000). This recreates the same function with the
-- clamp re-applied after rounding.
-- =====================================================================
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
    -- round to nearest 10 (Plan §3.4), then re-clamp: rounding a
    -- non-multiple-of-10 floor down must never cross below it.
    v_next := greatest(round(v_next / 10) * 10, v_snapshot.min_quote_floor);
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
