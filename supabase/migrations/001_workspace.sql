-- Apply once in your Supabase SQL editor. No service-role key is needed by the app.
create table public.experience (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 160), body text not null check(length(body) between 10 and 5000),
  created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text not null check(length(company) between 1 and 160), role text not null check(length(role) between 1 and 160),
  jd text not null check(length(jd) between 20 and 15000), stage text not null check(stage in ('Saved','Applied','Interview','Offer','Closed')),
  notes text not null default '' check(length(notes)<=4000), created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null, status text not null check(status in ('pending','running','completed','failed')),
  output jsonb, error text, evidence_snapshot jsonb not null, jd_snapshot text not null,
  prompt_version text not null, model text not null, duration_ms integer, input_tokens integer, output_tokens integer,
  created_at timestamptz not null default now(), unique(id,user_id),
  foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade
);
create unique index one_active_analysis on public.analysis_runs(application_id) where status in ('pending','running');
create index analysis_user_created on public.analysis_runs(user_id,created_at desc);
-- Separate quota ledger survives application deletion; users cannot erase usage history.
create table public.analysis_usage (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index usage_user_created on public.analysis_usage(user_id,created_at desc);
alter table public.analysis_usage enable row level security;
create policy read_own_usage on public.analysis_usage for select to authenticated using(user_id=auth.uid());
revoke all on public.analysis_usage from anon,authenticated;
grant select on public.analysis_usage to authenticated;
create table public.preparation_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null, ordinal integer not null, title text not null, detail text not null, done boolean not null default false,
  unique(run_id,ordinal), foreign key(run_id,user_id) references public.analysis_runs(id,user_id) on delete cascade
);
alter table public.experience enable row level security;
alter table public.applications enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.preparation_tasks enable row level security;
create policy own_experience on public.experience for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_applications on public.applications for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy read_own_runs on public.analysis_runs for select to authenticated using(user_id=auth.uid());
create policy read_own_tasks on public.preparation_tasks for select to authenticated using(user_id=auth.uid());
create policy update_own_tasks on public.preparation_tasks for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.experience, public.applications, public.analysis_runs, public.preparation_tasks from anon,authenticated;
grant select,insert,update,delete on public.experience, public.applications to authenticated;
grant select on public.analysis_runs, public.preparation_tasks to authenticated;
grant update(done) on public.preparation_tasks to authenticated;

-- Transactional reservation: per-user lock enforces quota even across different jobs.
create function public.start_analysis(p_application_id uuid,p_model text,p_prompt_version text)
returns public.analysis_runs language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result public.analysis_runs; snapshot jsonb; jd text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select a.jd into jd from public.applications a where a.id=p_application_id and a.user_id=uid;
  if jd is null then raise exception 'Application not found'; end if;
  update public.analysis_runs set status='failed',error='Execution expired; retry the analysis.' where user_id=uid and status in ('pending','running') and created_at<now()-interval '2 minutes';
  if (select count(*) from public.analysis_usage where user_id=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'Hourly analysis limit reached'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body)),'[]'::jsonb) into snapshot from public.experience where user_id=uid;
  if jsonb_array_length(snapshot)>50 then raise exception 'Use at most 50 experience entries'; end if;
  insert into public.analysis_runs(user_id,application_id,status,evidence_snapshot,jd_snapshot,model,prompt_version)
  values(uid,p_application_id,'running',snapshot,jd,left(p_model,100),left(p_prompt_version,100)) returning * into result;
  insert into public.analysis_usage(user_id) values(uid);
  return result;
end $$;

create function public.finish_analysis(p_run_id uuid,p_output jsonb,p_error text,p_duration integer,p_input integer,p_output_tokens integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.analysis_runs set status=case when p_error is null then 'completed' else 'failed' end,
  output=case when p_error is null then p_output else null end,error=left(p_error,500),duration_ms=p_duration,input_tokens=p_input,output_tokens=p_output_tokens
  where id=p_run_id and user_id=auth.uid() and status='running';
  if not found then raise exception 'Run is no longer active'; end if;
end $$;

-- Entire approval is one transaction; unique(run_id,ordinal) makes concurrent retries safe.
create function public.approve_analysis(p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select output into payload from public.analysis_runs where id=p_run_id and user_id=auth.uid() and status='completed' for update;
  if payload is null or jsonb_typeof(payload->'tasks')<>'array' or jsonb_array_length(payload->'tasks') not between 1 and 12 then raise exception 'Completed valid analysis required'; end if;
  insert into public.preparation_tasks(user_id,run_id,ordinal,title,detail)
  select auth.uid(),p_run_id,ordinality::integer,left(value->>'title',200),left(value->>'detail',1000)
  from jsonb_array_elements(payload->'tasks') with ordinality
  on conflict(run_id,ordinal) do nothing;
end $$;

revoke all on function public.start_analysis(uuid,text,text), public.finish_analysis(uuid,jsonb,text,integer,integer,integer), public.approve_analysis(uuid) from public,anon;
grant execute on function public.start_analysis(uuid,text,text), public.finish_analysis(uuid,jsonb,text,integer,integer,integer), public.approve_analysis(uuid) to authenticated;
