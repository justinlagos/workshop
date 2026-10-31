-- Which ad or link brought each booking (utm_* and fbclid from the landing address), and whether
-- the person allowed ad measurement (needed before sending their purchase to Meta).
alter table public.workshop_applications
  add column if not exists utm jsonb,
  add column if not exists ad_consent boolean not null default false;
