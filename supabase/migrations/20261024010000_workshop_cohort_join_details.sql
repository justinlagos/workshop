-- Join details for each cohort, used by the confirmation (prep) email sent on payment.
alter table public.workshop_cohorts
  add column if not exists join_url text,
  add column if not exists join_meeting_id text,
  add column if not exists join_passcode text,
  add column if not exists duration_minutes integer not null default 180;

update public.workshop_cohorts
   set join_url = 'https://us06web.zoom.us/j/81936012055?pwd=tOsfP7Z9GzJNfkPLFCGR1pCPpMb40q.1',
       join_meeting_id = '819 3601 2055',
       join_passcode = '471207',
       duration_minutes = 180
 where id = 'cohort-01';
