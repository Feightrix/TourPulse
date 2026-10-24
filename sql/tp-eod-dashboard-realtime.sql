-- TourPulse EOD dashboard realtime refresh events
-- Live dashboard clients subscribe to this lightweight event table.
-- Metrics continue to come from tp_get_eod_dashboard_v1().

create table if not exists public.tp_eod_dashboard_events (
  site_key text not null,
  report_date date not null,
  changed_at timestamptz not null default now(),
  primary key (site_key, report_date)
);

alter table public.tp_eod_dashboard_events enable row level security;
grant select on public.tp_eod_dashboard_events to authenticated;

drop policy if exists "dashboard managers can read live events"
on public.tp_eod_dashboard_events;

create policy "dashboard managers can read live events"
on public.tp_eod_dashboard_events
for select
to authenticated
using (
  site_key in (
    select s.site_key
    from public.tp_get_eod_dashboard_sites_v1() s
  )
);

create or replace function public.tp_touch_eod_dashboard_event_v1()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.tp_eod_dashboard_events(site_key, report_date, changed_at)
  values (new.site_key, new.report_date, now())
  on conflict (site_key, report_date)
  do update set changed_at = excluded.changed_at;

  return new;
end;
$$;

revoke all on function public.tp_touch_eod_dashboard_event_v1() from public;
revoke all on function public.tp_touch_eod_dashboard_event_v1() from anon;
revoke all on function public.tp_touch_eod_dashboard_event_v1() from authenticated;

drop trigger if exists tp_eod_dashboard_event_v1 on public.tp_eod_submissions;

create trigger tp_eod_dashboard_event_v1
after insert or update on public.tp_eod_submissions
for each row
execute function public.tp_touch_eod_dashboard_event_v1();

alter publication supabase_realtime add table public.tp_eod_dashboard_events;
