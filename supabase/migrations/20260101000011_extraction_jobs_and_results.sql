create table public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status public.extraction_job_status not null default 'queued',
  attempt integer not null default 1 check (attempt >= 1),
  provider_name text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency: a redelivered/duplicated trigger for the same document+attempt is a no-op.
  unique (document_id, attempt)
);

create index extraction_jobs_owner_status_idx on public.extraction_jobs (owner_user_id, status);
create index extraction_jobs_document_idx on public.extraction_jobs (document_id);

create trigger set_extraction_jobs_updated_at
  before update on public.extraction_jobs
  for each row execute function public.set_updated_at();

alter table public.extraction_jobs enable row level security;

create policy "extraction_jobs_select_own"
  on public.extraction_jobs for select
  using (owner_user_id = auth.uid());

-- No client insert/update policy: jobs are created and progressed only by the server-side
-- processing pipeline (service-role), never by the mobile/admin client directly.

create table public.extraction_results (
  id uuid primary key default gen_random_uuid(),
  extraction_job_id uuid not null unique references public.extraction_jobs(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  raw_provider_output jsonb not null default '{}',
  overall_confidence numeric(4, 3) check (overall_confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create index extraction_results_owner_idx on public.extraction_results (owner_user_id);

alter table public.extraction_results enable row level security;

create policy "extraction_results_select_own"
  on public.extraction_results for select
  using (owner_user_id = auth.uid());

comment on column public.extraction_results.raw_provider_output is
  'Raw vendor output kept for diagnostics only — searchable/typed fields live on bills/payments,
   per the brief''s "do not place all extracted fields into an unstructured JSON object only" rule.';
