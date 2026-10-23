-- TourPulse native EOD dashboard API
-- Manager/admin only. The web dashboard reads this RPC directly; Excel is not involved.

create or replace function public.tp_get_eod_dashboard_sites_v1()
returns table(site_key text, site_name text)
language plpgsql
stable
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_uid uuid := auth.uid();
  v_emp text := split_part(coalesce(auth.jwt() ->> 'email',''),'@',1);
  v_is_admin boolean := false;
  v_is_manager boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_is_admin :=
    v_emp = '078195'
    or exists(select 1 from public.tp_admins a where a.emp = v_emp);

  v_is_manager := exists(
    select 1
    from public.tp_user_roles r
    where r.user_id = v_uid
      and r.is_manager = true
      and coalesce(r.is_active,true) = true
  );

  if not (v_is_admin or v_is_manager) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;

  return query
  select distinct
    m.site_key::text,
    case m.site_key
      when 'myrtle-beach-oceanfront' then 'Myrtle Beach Oceanfront'
      when 'south-beach' then 'South Beach Resort'
      else initcap(replace(m.site_key,'-',' '))
    end::text as site_name
  from public.tp_eod_marketer_map m
  where m.active = true
    and (
      v_is_admin
      or m.user_id = v_uid
      or exists(
        select 1
        from public.tp_user_roles r
        where r.user_id = m.user_id
          and r.manager_user_id = v_uid
          and coalesce(r.is_active,true) = true
      )
    )
  order by 2;
end;
$$;

revoke all on function public.tp_get_eod_dashboard_sites_v1() from public;
revoke all on function public.tp_get_eod_dashboard_sites_v1() from anon;
grant execute on function public.tp_get_eod_dashboard_sites_v1() to authenticated;


create or replace function public.tp_get_eod_dashboard_v1(
  p_site_key text,
  p_report_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'auth'
as $$
declare
  v_uid uuid := auth.uid();
  v_emp text := split_part(coalesce(auth.jwt() ->> 'email',''),'@',1);
  v_is_admin boolean := false;
  v_is_manager boolean := false;
  v_has_site boolean := false;
  v_date date := coalesce(p_report_date, current_date);
  v_month_start date := date_trunc('month', coalesce(p_report_date, current_date))::date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if coalesce(trim(p_site_key),'') = '' then
    raise exception 'Site is required' using errcode = '22023';
  end if;

  v_is_admin :=
    v_emp = '078195'
    or exists(select 1 from public.tp_admins a where a.emp = v_emp);

  v_is_manager := exists(
    select 1
    from public.tp_user_roles r
    where r.user_id = v_uid
      and r.is_manager = true
      and coalesce(r.is_active,true) = true
  );

  if not (v_is_admin or v_is_manager) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;

  v_has_site := exists(
    select 1
    from public.tp_eod_marketer_map m
    where m.active = true
      and m.site_key = p_site_key
      and (
        v_is_admin
        or m.user_id = v_uid
        or exists(
          select 1
          from public.tp_user_roles r
          where r.user_id = m.user_id
            and r.manager_user_id = v_uid
            and coalesce(r.is_active,true) = true
        )
      )
  );

  if not v_has_site then
    raise exception 'You do not have access to this site' using errcode = '42501';
  end if;

  with mapped as (
    select
      m.user_id,
      m.emp,
      m.excel_name,
      coalesce(r.is_manager,false) as is_manager
    from public.tp_eod_marketer_map m
    left join public.tp_user_roles r on r.user_id = m.user_id
    where m.active = true
      and m.site_key = p_site_key
      and (
        v_is_admin
        or m.user_id = v_uid
        or exists(
          select 1
          from public.tp_user_roles rr
          where rr.user_id = m.user_id
            and rr.manager_user_id = v_uid
            and coalesce(rr.is_active,true) = true
        )
      )
  ),
  day_sub as (
    select s.*
    from public.tp_eod_submissions s
    join mapped m on m.user_id = s.user_id
    where s.site_key = p_site_key
      and s.report_date = v_date
  ),
  month_sub as (
    select s.*
    from public.tp_eod_submissions s
    join mapped m on m.user_id = s.user_id
    where s.site_key = p_site_key
      and s.report_date between v_month_start and v_date
  ),
  day_totals as (
    select
      coalesce(sum(vip_seen + ga_seen + goo_seen + rci_seen + renter_seen),0)::int as arrivals_seen,
      coalesce(sum(vip_booked + ga_booked + goo_booked + rci_booked + renter_booked),0)::int as tours_booked,
      coalesce(sum(bounce_back_booked),0)::int as bounce_backs,
      count(*)::int as submitted_count,
      max(updated_at) as last_updated
    from day_sub
  ),
  mtd_totals as (
    select
      coalesce(sum(vip_seen + ga_seen + goo_seen + rci_seen + renter_seen),0)::int as arrivals_seen,
      coalesce(sum(vip_booked + ga_booked + goo_booked + rci_booked + renter_booked),0)::int as tours_booked,
      coalesce(sum(bounce_back_booked),0)::int as bounce_backs
    from month_sub
  ),
  marketer_rows as (
    select
      m.user_id,
      m.emp,
      m.excel_name,
      m.is_manager,
      (s.id is not null) as submitted,
      coalesce(s.vip_seen + s.ga_seen + s.goo_seen + s.rci_seen + s.renter_seen,0)::int as arrivals_seen,
      coalesce(s.vip_booked + s.ga_booked + s.goo_booked + s.rci_booked + s.renter_booked,0)::int as tours_booked,
      coalesce(s.bounce_back_booked,0)::int as bounce_backs,
      case
        when coalesce(s.vip_seen + s.ga_seen + s.goo_seen + s.rci_seen + s.renter_seen,0) > 0
        then round(
          100.0 * coalesce(s.vip_booked + s.ga_booked + s.goo_booked + s.rci_booked + s.renter_booked,0)
          / nullif((s.vip_seen + s.ga_seen + s.goo_seen + s.rci_seen + s.renter_seen),0),
          1
        )
        else 0
      end as conversion
    from mapped m
    left join day_sub s on s.user_id = m.user_id
  ),
  trend_dates as (
    select generate_series(v_date - 6, v_date, interval '1 day')::date as d
  ),
  trend_agg as (
    select
      s.report_date,
      coalesce(sum(s.vip_seen + s.ga_seen + s.goo_seen + s.rci_seen + s.renter_seen),0)::int as arrivals_seen,
      coalesce(sum(s.vip_booked + s.ga_booked + s.goo_booked + s.rci_booked + s.renter_booked),0)::int as tours_booked
    from public.tp_eod_submissions s
    join mapped m on m.user_id = s.user_id
    where s.site_key = p_site_key
      and s.report_date between v_date - 6 and v_date
    group by s.report_date
  ),
  campaign as (
    select 'vip'::text as key, 'VIP'::text as label,
      coalesce(sum(vip_seen),0)::int as seen,
      coalesce(sum(vip_booked),0)::int as booked from day_sub
    union all
    select 'ga','GA',coalesce(sum(ga_seen),0)::int,coalesce(sum(ga_booked),0)::int from day_sub
    union all
    select 'goo','GOO',coalesce(sum(goo_seen),0)::int,coalesce(sum(goo_booked),0)::int from day_sub
    union all
    select 'rci','RCI',coalesce(sum(rci_seen),0)::int,coalesce(sum(rci_booked),0)::int from day_sub
    union all
    select 'renter','Renter',coalesce(sum(renter_seen),0)::int,coalesce(sum(renter_booked),0)::int from day_sub
  )
  select jsonb_build_object(
    'site_key', p_site_key,
    'site_name', case p_site_key
      when 'myrtle-beach-oceanfront' then 'Myrtle Beach Oceanfront'
      when 'south-beach' then 'South Beach Resort'
      else initcap(replace(p_site_key,'-',' '))
    end,
    'report_date', v_date,
    'kpis', jsonb_build_object(
      'arrivals_seen', d.arrivals_seen,
      'tours_booked', d.tours_booked,
      'conversion', case when d.arrivals_seen > 0 then round(100.0*d.tours_booked/d.arrivals_seen,1) else 0 end,
      'bounce_backs', d.bounce_backs,
      'submitted_count', d.submitted_count,
      'mapped_count', (select count(*) from mapped),
      'last_updated', d.last_updated
    ),
    'mtd', jsonb_build_object(
      'arrivals_seen', mtd.arrivals_seen,
      'tours_booked', mtd.tours_booked,
      'conversion', case when mtd.arrivals_seen > 0 then round(100.0*mtd.tours_booked/mtd.arrivals_seen,1) else 0 end,
      'bounce_backs', mtd.bounce_backs
    ),
    'marketers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', mr.user_id,
          'emp', mr.emp,
          'name', mr.excel_name,
          'is_manager', mr.is_manager,
          'submitted', mr.submitted,
          'arrivals_seen', mr.arrivals_seen,
          'tours_booked', mr.tours_booked,
          'conversion', mr.conversion,
          'bounce_backs', mr.bounce_backs
        )
        order by mr.is_manager desc, lower(mr.excel_name), mr.emp
      )
      from marketer_rows mr
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', c.key,
          'label', c.label,
          'seen', c.seen,
          'booked', c.booked,
          'conversion', case when c.seen > 0 then round(100.0*c.booked/c.seen,1) else 0 end
        )
        order by case c.key when 'vip' then 1 when 'ga' then 2 when 'goo' then 3 when 'rci' then 4 else 5 end
      )
      from campaign c
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', td.d,
          'arrivals_seen', coalesce(ta.arrivals_seen,0),
          'tours_booked', coalesce(ta.tours_booked,0),
          'conversion', case when coalesce(ta.arrivals_seen,0) > 0
            then round(100.0*coalesce(ta.tours_booked,0)/ta.arrivals_seen,1)
            else 0 end
        )
        order by td.d
      )
      from trend_dates td
      left join trend_agg ta on ta.report_date = td.d
    ), '[]'::jsonb)
  )
  into v_result
  from day_totals d
  cross join mtd_totals mtd;

  return v_result;
end;
$$;

revoke all on function public.tp_get_eod_dashboard_v1(text,date) from public;
revoke all on function public.tp_get_eod_dashboard_v1(text,date) from anon;
grant execute on function public.tp_get_eod_dashboard_v1(text,date) to authenticated;
