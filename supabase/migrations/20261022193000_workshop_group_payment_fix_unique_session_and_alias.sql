-- Applied to Supabase project "Workshop" (imbhdffupsfehifcbdfb) on 22 Oct 2026.
--
-- Fixes two bugs that made every group checkout webhook fail (HTTP 500 to Stripe, endless retries):
-- 1. The applicant update set stripe_session_id = <group session> on all 3 rows, which violates
--    workshop_applications_stripe_session_id_key (UNIQUE). The whole transaction rolled back.
--    Applicant rows now keep their own session id; the group session is recorded on
--    workshop_group_checkouts and workshop_payment_events.
-- 2. The payment-event insert used "a" as both the PL/pgSQL loop variable and the table alias
--    (error 42702, ambiguous column). Loop variable renamed to r, table alias to app.
--
-- Verified with a rolled-back test: new group payment -> confirmed, duplicate delivery ->
-- already-paid, single payment -> confirmed.

create or replace function public.workshop_confirm_group_payment(p_event text, p_session text, p_group_reference text, p_currency text, p_amount bigint)
returns text
language plpgsql
set search_path to 'public'
as $function$
declare
 g public.workshop_group_checkouts%rowtype;
 c public.workshop_cohorts%rowtype;
 r public.workshop_applications%rowtype;
 n integer:=0;
begin
 select * into g from public.workshop_group_checkouts where session_id=p_session and group_reference=p_group_reference for update;
 if not found then return 'unknown-group'; end if;
 if g.status='paid' then return 'already-paid'; end if;
 if g.status='refund-required' then return 'full-refund-required'; end if;
 if lower(g.currency)<>lower(p_currency) or g.amount<>p_amount or lower(p_currency)<>'ngn' or p_amount<>25500000 then return 'verification-mismatch'; end if;
 select * into c from public.workshop_cohorts where id='cohort-01' for update;
 if c.capacity-c.confirmed_count < 3 then
  update public.workshop_group_checkouts set status='refund-required' where session_id=p_session;
  return 'full-refund-required';
 end if;
 for r in
  select * from public.workshop_applications where reference=any(g.applicant_references) order by id for update
 loop
  n:=n+1;
  if r.cohort_id<>'cohort-01' or r.classification<>'Guided Builder' or r.currency<>'NGN' or r.status='paid' then
   return 'verification-mismatch';
  end if;
 end loop;
 if n<>3 then return 'verification-mismatch'; end if;
 update public.workshop_applications
 set status='paid',paid_at=now()
 where reference=any(g.applicant_references);
 update public.workshop_cohorts set confirmed_count=confirmed_count+3 where id='cohort-01';
 update public.workshop_group_checkouts set status='paid',paid_at=now() where session_id=p_session;
 insert into public.workshop_payment_events(stripe_event_id,stripe_session_id,application_id,outcome)
 select p_event||':'||app.reference,p_session,app.id,'confirmed-group' from public.workshop_applications app
 where app.reference=any(g.applicant_references)
 on conflict (stripe_event_id) do nothing;
 return 'confirmed';
end $function$;
