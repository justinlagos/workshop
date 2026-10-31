-- One kit, segmented by cohort. Same sign-in (booking reference + emailed code) for every cohort;
-- the kit reads the signed-in person's cohort row for their label, dates, group and extras.

alter table public.workshop_cohorts
  add column if not exists support_ends_at timestamptz,   -- Ask box and group support close (exclusive)
  add column if not exists kit_closes_at timestamptz,     -- kit sign-in closes (exclusive)
  add column if not exists whatsapp_url text,
  add column if not exists group_calls text,              -- shown in Support when set
  add column if not exists has_deck boolean not null default false;

-- Cohort 01: as before.
update public.workshop_cohorts set
  support_ends_at = '2026-11-15T00:00:00Z', kit_closes_at = '2027-01-01T00:00:00Z',
  whatsapp_url = 'https://chat.whatsapp.com/Dji5FzXLAvKEIhUWNKCT6r',
  group_calls = 'Saturday 31 October and Saturday 14 November. Times confirmed in the group.',
  has_deck = true
where id = 'cohort-01';

-- Cohorts 02 to 04: 21 days of support and 10 weeks of kit after the session. One shared WhatsApp group.
update public.workshop_cohorts c set
  support_ends_at = v.support, kit_closes_at = v.kit,
  whatsapp_url = 'https://chat.whatsapp.com/Dji5FzXLAvKEIhUWNKCT6r'
from (values
  ('cohort-02', '2026-12-13T00:00:00Z'::timestamptz, '2027-01-31T00:00:00Z'::timestamptz),
  ('cohort-03', '2026-12-27T00:00:00Z'::timestamptz, '2027-02-14T00:00:00Z'::timestamptz),
  ('cohort-04', '2027-01-10T00:00:00Z'::timestamptz, '2027-02-28T00:00:00Z'::timestamptz)
) as v(id, support, kit)
where c.id = v.id;

-- Kit updates can target cohorts. Null means everyone. The two existing updates were for Cohort 01.
alter table public.workshop_kit_updates add column if not exists cohort_ids text[];
update public.workshop_kit_updates set cohort_ids = array['cohort-01'] where cohort_ids is null;

-- Sign-in: paid bookings in any cohort, plus listed members (the host), with their cohort.
-- A new function beside workshop_kit_member (Cohort 01 only), which stays for anything still using it.
create or replace function public.workshop_kit_person(p_reference text)
returns table(reference text, full_name text, email text, role text, cohort_id text)
language sql stable security definer
set search_path to 'public'
as $function$
  select x.reference, x.full_name, x.email, x.role, x.cohort_id from (
    select a.reference, a.full_name, a.email, 'attendee'::text as role, a.cohort_id, 1 as pri
      from public.workshop_applications a
     where upper(a.reference) = upper(btrim(p_reference))
       and a.status = 'paid' and a.cohort_id is not null
    union all
    select m.reference, m.full_name, m.email, m.role, null::text, 2 as pri
      from public.workshop_kit_members m
     where upper(m.reference) = upper(btrim(p_reference))
  ) x order by x.pri limit 1;
$function$;
revoke all on function public.workshop_kit_person(text) from public, anon, authenticated;
grant execute on function public.workshop_kit_person(text) to service_role;

-- The kit assistant now sees each asker's cohort and dates.
create or replace function public.workshop_kit_claim_pending()
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare ids uuid[]; out jsonb; any_open boolean;
begin
  select exists(select 1 from workshop_cohorts where session_at <= now() and support_ends_at > now()) into any_open;
  select array_agg(id) into ids from (
    select id from workshop_kit_questions
     where status = 'pending' and (claimed_at is null or claimed_at < now() - interval '20 minutes')
     order by created_at limit 20) s;
  if ids is null then
    return jsonb_build_object('count', 0, 'ask_open', any_open, 'questions', '[]'::jsonb);
  end if;
  update workshop_kit_questions set claimed_at = now() where id = any(ids);
  select jsonb_agg(jsonb_build_object(
      'id', q.id, 'asked_at', q.created_at, 'question', q.question, 'build_link', q.build_link,
      'first_name', case q.reference when 'TBS-E12072A8-E' then 'Daniel' else split_part(coalesce(m.full_name, 'there'), ' ', 1) end,
      'role', m.role, 'country', a.country, 'their_build', a.project_goal,
      'cohort', c.label,
      'session_date', to_char(c.session_at at time zone 'Europe/London', 'FMDay FMDD FMMonth YYYY'),
      'support_until', to_char((c.support_ends_at - interval '1 second') at time zone 'Europe/London', 'FMDay FMDD FMMonth YYYY'),
      'kit_open_until', to_char((c.kit_closes_at - interval '1 second') at time zone 'Europe/London', 'FMDay FMDD FMMonth YYYY'),
      'earlier_questions_from_them', coalesce((
        select jsonb_agg(jsonb_build_object('question', p.question, 'answer', p.answer) order by p.created_at desc)
          from (select question, answer, created_at from workshop_kit_questions p2
                 where p2.reference = q.reference and p2.status <> 'pending' and p2.id <> q.id
                 order by created_at desc limit 3) p), '[]'::jsonb)
    ) order by q.created_at) into out
    from workshop_kit_questions q
    left join lateral (select * from workshop_kit_person(q.reference)) m on true
    left join workshop_applications a on a.reference = q.reference
    left join workshop_cohorts c on c.id = m.cohort_id
   where q.id = any(ids);
  return jsonb_build_object('count', jsonb_array_length(out), 'ask_open', any_open, 'questions', out);
end $function$;
