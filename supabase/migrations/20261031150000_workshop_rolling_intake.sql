-- Rolling intake: one continuous form, three sessions, seats given in payment order.
--
-- An application in an intake has no cohort until it is paid. When payment is verified,
-- workshop_confirm_payment places the payer in the earliest session of that intake that still
-- has a seat and has not passed its booking cutoff. Cohort 01 rows (intake_id null) keep the
-- original single-cohort path unchanged.

create table if not exists public.workshop_intakes (
  id text primary key,
  title text not null,
  fee_gbp bigint not null check (fee_gbp > 0),           -- pence
  fee_ngn bigint not null check (fee_ngn > 0),           -- kobo
  booking_cutoff_hours integer not null default 24 check (booking_cutoff_hours >= 0),
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.workshop_intakes enable row level security;

alter table public.workshop_cohorts
  add column if not exists intake_id text references public.workshop_intakes(id),
  add column if not exists label text;

alter table public.workshop_applications
  add column if not exists intake_id text references public.workshop_intakes(id),
  add column if not exists projected_cohort_id text references public.workshop_cohorts(id),
  add column if not exists placed_at timestamptz;

-- Intake applications have no cohort until payment places them.
alter table public.workshop_applications alter column cohort_id drop not null;
alter table public.workshop_applications drop constraint if exists workshop_applications_cohort_or_intake;
alter table public.workshop_applications add constraint workshop_applications_cohort_or_intake
  check (cohort_id is not null or intake_id is not null);

-- One application per email per intake.
create unique index if not exists workshop_applications_intake_email_key
  on public.workshop_applications (intake_id, email) where intake_id is not null;

-- Paid after every session filled: refunded automatically.
alter table public.workshop_applications drop constraint if exists workshop_applications_status_check;
alter table public.workshop_applications add constraint workshop_applications_status_check
  check (status = any (array['applied','reviewed','foundation','invited','paid','waitlisted','refund-required','refunded']));

insert into public.workshop_intakes (id, title, fee_gbp, fee_ngn, booking_cutoff_hours, is_open)
values ('winter-2026', 'The Build Session, Nov to Dec 2026', 7500, 12500000, 24, true)
on conflict (id) do nothing;

-- UK is on GMT in November and December, so 14:00 UK = 14:00 UTC.
insert into public.workshop_cohorts (id, capacity, confirmed_count, session_at, duration_minutes, intake_id, label) values
  ('cohort-02', 8, 0, '2026-11-21 14:00:00+00', 180, 'winter-2026', 'Cohort 02'),
  ('cohort-03', 8, 0, '2026-12-05 14:00:00+00', 180, 'winter-2026', 'Cohort 03'),
  ('cohort-04', 8, 0, '2026-12-19 14:00:00+00', 180, 'winter-2026', 'Cohort 04')
on conflict (id) do nothing;
update public.workshop_cohorts set label = 'Founding Cohort 01' where id = 'cohort-01' and label is null;

-- Seats per session, and which session a payment made now would land in.
create or replace function public.workshop_intake_availability(p_intake text)
returns table (cohort_id text, label text, session_at timestamptz, capacity integer,
               confirmed_count integer, remaining integer, booking_open boolean, is_next boolean)
language sql stable
set search_path to 'public'
as $function$
  with i as (select * from public.workshop_intakes where id = p_intake),
  c as (
    select c.id, c.label, c.session_at, c.capacity, c.confirmed_count,
           greatest(0, c.capacity - c.confirmed_count) as remaining,
           (c.session_at - make_interval(hours => i.booking_cutoff_hours) > now()) as booking_open
    from public.workshop_cohorts c join i on c.intake_id = i.id
  ),
  nxt as (select id from c where booking_open and remaining > 0 order by session_at, id limit 1)
  select c.id, c.label, c.session_at, c.capacity, c.confirmed_count, c.remaining, c.booking_open,
         coalesce(c.id = (select id from nxt), false)
  from c order by c.session_at, c.id;
$function$;

create or replace function public.workshop_confirm_payment(p_event text, p_session text, p_reference text, p_currency text, p_amount bigint)
 returns text
 language plpgsql
 set search_path to 'public'
as $function$
declare a public.workshop_applications%rowtype; c public.workshop_cohorts%rowtype; i public.workshop_intakes%rowtype;
        expected_currency text; expected_amount bigint; outcome text; target text;
begin
 select * into a from public.workshop_applications where reference=p_reference for update;
 if not found then return 'unknown-applicant'; end if;
 if exists(select 1 from public.workshop_payment_events where stripe_event_id=p_event) then return 'duplicate-event'; end if;

 if a.intake_id is not null then
   -- Rolling intake: place the payer in the earliest open session with a free seat.
   select * into i from public.workshop_intakes where id=a.intake_id;
   -- Lock every session of the intake in a fixed order so concurrent payments queue up
   -- and each one sees the counts the previous one left behind.
   perform 1 from public.workshop_cohorts where intake_id=a.intake_id order by id for update;
   expected_currency:=lower(a.currency);
   expected_amount:=coalesce(a.fee_amount, case when a.currency='NGN' then i.fee_ngn else i.fee_gbp end);
   if lower(p_currency)<>expected_currency or p_amount<>expected_amount or a.stripe_session_id is distinct from p_session then
     outcome:='verification-mismatch';
   elsif a.status='paid' then outcome:='already-paid';
   elsif a.status in ('refund-required','refunded') then outcome:='refund-pending';
   else
     select id into target from public.workshop_cohorts
      where intake_id=a.intake_id and confirmed_count<capacity
        and session_at - make_interval(hours => i.booking_cutoff_hours) > now()
      order by session_at, id limit 1;
     if target is null then
       update public.workshop_applications set status='refund-required' where id=a.id;
       outcome:='full-refund-required';
     else
       update public.workshop_cohorts set confirmed_count=confirmed_count+1 where id=target;
       update public.workshop_applications set status='paid',paid_at=now(),placed_at=now(),cohort_id=target where id=a.id;
       outcome:='confirmed';
     end if;
   end if;
   insert into public.workshop_payment_events(stripe_event_id,stripe_session_id,application_id,outcome) values(p_event,p_session,a.id,outcome);
   return outcome;
 end if;

 -- Founding Cohort 01 path, unchanged.
 select * into c from public.workshop_cohorts where id=a.cohort_id for update;
 expected_currency:=lower(a.currency);
 expected_amount:=coalesce(a.fee_amount, case when a.currency='NGN' then 8500000 else 5000 end);
 if lower(p_currency)<>expected_currency or p_amount<>expected_amount or a.classification<>'Guided Builder' or a.stripe_session_id is distinct from p_session then
   outcome:='verification-mismatch';
 elsif a.status='paid' then outcome:='already-paid';
 elsif c.confirmed_count>=c.capacity then
   outcome:='full-refund-required';
   update public.workshop_applications set status='waitlisted' where id=a.id;
 else
   update public.workshop_applications set status='paid',paid_at=now() where id=a.id;
   update public.workshop_cohorts set confirmed_count=confirmed_count+1 where id=a.cohort_id;
   outcome:='confirmed';
 end if;
 insert into public.workshop_payment_events(stripe_event_id,stripe_session_id,application_id,outcome) values(p_event,p_session,a.id,outcome);
 return outcome;
end $function$;

revoke all on function public.workshop_intake_availability(text) from public, anon, authenticated;
revoke all on function public.workshop_confirm_payment(text,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.workshop_intake_availability(text) to service_role;
grant execute on function public.workshop_confirm_payment(text,text,text,text,bigint) to service_role;
