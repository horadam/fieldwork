-- Hourly quota for hosted model calls other than fit analysis (which keeps
-- analysis_usage). Like that ledger, rows survive deletes and users cannot write them.
create table public.inference_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('resume_extraction','job_extraction','preparation_generation')),
  created_at timestamptz not null default now()
);
create index inference_usage_user_kind_created on public.inference_usage(user_id,kind,created_at desc);
alter table public.inference_usage enable row level security;
create policy read_own_inference_usage on public.inference_usage for select to authenticated using(user_id=auth.uid());
revoke all on public.inference_usage from public,anon,authenticated;
grant select on public.inference_usage to authenticated;

-- Reserves one call before the model runs; failed calls still count, as with analysis.
create function public.reserve_inference(p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); hourly integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  hourly:=case p_kind when 'resume_extraction' then 10 when 'job_extraction' then 20 when 'preparation_generation' then 10 end;
  if hourly is null then raise exception 'Unknown inference kind'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||p_kind,0));
  if (select count(*) from public.inference_usage where user_id=uid and kind=p_kind and created_at>now()-interval '1 hour')>=hourly
    then raise exception 'Hourly inference limit reached'; end if;
  insert into public.inference_usage(user_id,kind) values(uid,p_kind);
end $$;
revoke all on function public.reserve_inference(text) from public,anon;
grant execute on function public.reserve_inference(text) to authenticated;
