-- Applied to Supabase project "Workshop" (imbhdffupsfehifcbdfb) on 24 Oct 2026.
-- Per-applicant fee override (smallest currency unit: kobo or pence). Null = standard fee.
alter table public.workshop_applications
  add column if not exists fee_amount bigint check (fee_amount is null or fee_amount > 0);

-- Payment verification now expects the applicant's own fee when one is set.
create or replace function public.workshop_confirm_payment(p_event text, p_session text, p_reference text, p_currency text, p_amount bigint)
 returns text
 language plpgsql
 set search_path to 'public'
as $function$
declare a public.workshop_applications%rowtype; c public.workshop_cohorts%rowtype; expected_currency text; expected_amount bigint; outcome text;
begin
 select * into a from public.workshop_applications where reference=p_reference for update;
 if not found then return 'unknown-applicant'; end if;
 select * into c from public.workshop_cohorts where id=a.cohort_id for update;
 if exists(select 1 from public.workshop_payment_events where stripe_event_id=p_event) then return 'duplicate-event'; end if;
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
