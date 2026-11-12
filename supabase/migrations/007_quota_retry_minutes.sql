-- Hourly limits now say when the next slot opens: the oldest call in the
-- window leaves it one hour after it was made. Bodies are otherwise those of
-- 006 (reserve_inference) and 002 (start_analysis).
create or replace function public.quota_retry_minutes(oldest timestamptz) returns integer
language sql stable set search_path='' as $$
  select greatest(1, pg_catalog.ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60)::integer)
$$;
revoke all on function public.quota_retry_minutes(timestamptz) from public,anon,authenticated;

create or replace function public.reserve_inference(p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); hourly integer; used integer; oldest timestamptz;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  hourly:=case p_kind when 'resume_extraction' then 10 when 'job_extraction' then 20 when 'preparation_generation' then 10 when 'practice_turn' then 60 when 'practice_audio' then 30 end;
  if hourly is null then raise exception 'Unknown inference kind'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||p_kind,0));
  select count(*), min(created_at) into used, oldest from public.inference_usage where user_id=uid and kind=p_kind and created_at>now()-interval '1 hour';
  if used>=hourly then raise exception 'Hourly inference limit reached; retry in % minutes', public.quota_retry_minutes(oldest); end if;
  insert into public.inference_usage(user_id,kind) values(uid,p_kind);
end $$;
revoke all on function public.reserve_inference(text) from public,anon;
grant execute on function public.reserve_inference(text) to authenticated;

create or replace function public.start_analysis(p_application_id uuid,p_model text,p_prompt_version text,p_provider text default 'openai')
returns public.analysis_runs language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result public.analysis_runs; snapshot jsonb; jd text; used integer; oldest timestamptz;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select a.jd into jd from public.applications a where a.id=p_application_id and a.user_id=uid;
  if jd is null then raise exception 'Application not found'; end if;
  update public.analysis_runs set status='failed',error='Execution expired; retry the analysis.' where user_id=uid and status in ('pending','running') and created_at<now()-interval '5 minutes';
  select count(*), min(created_at) into used, oldest from public.analysis_usage where user_id=uid and created_at>now()-interval '1 hour';
  if used>=10 then raise exception 'Hourly analysis limit reached; retry in % minutes', public.quota_retry_minutes(oldest); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'provenance',provenance)),'[]'::jsonb) into snapshot from public.experience where user_id=uid;
  if jsonb_array_length(snapshot)>50 then raise exception 'Use at most 50 experience entries'; end if;
  insert into public.analysis_runs(user_id,application_id,status,evidence_snapshot,jd_snapshot,model,prompt_version,provider)
  values(uid,p_application_id,'running',snapshot,jd,left(p_model,100),left(p_prompt_version,100),p_provider) returning * into result;
  insert into public.analysis_usage(user_id) values(uid);
  return result;
end $$;
revoke all on function public.start_analysis(uuid,text,text,text) from public,anon;
grant execute on function public.start_analysis(uuid,text,text,text) to authenticated;
