-- Additive resume metadata; no stored original files or full resume text.
alter table public.experience add column provenance jsonb, add column import_batch_id uuid, add column import_item_id uuid;
create unique index experience_import_retry on public.experience(user_id,import_batch_id,import_item_id);
alter table public.experience add constraint import_identifiers_together check ((import_batch_id is null) = (import_item_id is null));
alter table public.experience add constraint provenance_size check (provenance is null or (jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=12000));
alter table public.analysis_runs add column provider text not null default 'openai' check(provider in ('ollama','openai'));

-- All experience writes, including manual entries, share the same per-user lock/cap.
create function public.limit_experience_bank() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
  -- A retry of an existing item must be able to reach ON CONFLICT at capacity.
  if new.import_batch_id is not null and exists(select 1 from public.experience where user_id=new.user_id and import_batch_id=new.import_batch_id and import_item_id=new.import_item_id) then return new; end if;
  if (select count(*) from public.experience where user_id=new.user_id)>=50 then raise exception 'Experience bank is limited to 50 entries'; end if;
  return new;
end $$;
create trigger experience_capacity before insert on public.experience for each row execute function public.limit_experience_bank();
revoke all on function public.limit_experience_bank() from public,anon,authenticated;

create function public.import_resume_experience(p_batch_id uuid,p_entries jsonb) returns setof public.experience language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); entry jsonb;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_batch_id is null or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 30 then raise exception 'Invalid import batch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  if (select count(distinct value->>'itemId') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate import items'; end if;
  -- Validate the entire batch before insertion. Every failure rolls back the function.
  for entry in select value from jsonb_array_elements(p_entries) loop
    if entry->>'itemId' is null or entry->>'title' is null or entry->>'body' is null
      or length(btrim(entry->>'title')) not between 1 and 160 or length(btrim(entry->>'body')) not between 10 and 5000
      or entry->'provenance' is null or jsonb_typeof(entry->'provenance')<>'object'
      or (entry->'provenance'->>'kind') is null or (entry->'provenance'->>'kind') not in ('role','project')
      or (entry->'provenance'->>'provider') is null or (entry->'provenance'->>'provider') not in ('ollama','openai')
      or coalesce(jsonb_typeof(entry->'provenance'->'passages'),'null')<>'array'
      then raise exception 'Invalid import entry'; end if;
    perform (entry->>'itemId')::uuid;
    if jsonb_array_length(entry->'provenance'->'passages') not between 1 and 5 then raise exception 'Invalid source excerpts'; end if;
    if exists(select 1 from jsonb_array_elements(entry->'provenance'->'passages') p where p->>'quote' is null or length(p->>'quote') not between 1 and 700) then raise exception 'Invalid source excerpts'; end if;
  end loop;
  insert into public.experience(user_id,title,body,provenance,import_batch_id,import_item_id)
  select uid,btrim(value->>'title'),btrim(value->>'body'),value->'provenance',p_batch_id,(value->>'itemId')::uuid from jsonb_array_elements(p_entries)
  on conflict(user_id,import_batch_id,import_item_id) do nothing;
  return query select * from public.experience where user_id=uid and import_batch_id=p_batch_id;
end $$;
revoke all on function public.import_resume_experience(uuid,jsonb) from public,anon;
grant execute on function public.import_resume_experience(uuid,jsonb) to authenticated;

-- Three-argument calls remain compatible through the default provider argument.
drop function public.start_analysis(uuid,text,text);
create function public.start_analysis(p_application_id uuid,p_model text,p_prompt_version text,p_provider text default 'openai')
returns public.analysis_runs language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result public.analysis_runs; snapshot jsonb; jd text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select a.jd into jd from public.applications a where a.id=p_application_id and a.user_id=uid;
  if jd is null then raise exception 'Application not found'; end if;
  update public.analysis_runs set status='failed',error='Execution expired; retry the analysis.' where user_id=uid and status in ('pending','running') and created_at<now()-interval '5 minutes';
  if (select count(*) from public.analysis_usage where user_id=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'Hourly analysis limit reached'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'provenance',provenance)),'[]'::jsonb) into snapshot from public.experience where user_id=uid;
  if jsonb_array_length(snapshot)>50 then raise exception 'Use at most 50 experience entries'; end if;
  insert into public.analysis_runs(user_id,application_id,status,evidence_snapshot,jd_snapshot,model,prompt_version,provider)
  values(uid,p_application_id,'running',snapshot,jd,left(p_model,100),left(p_prompt_version,100),p_provider) returning * into result;
  insert into public.analysis_usage(user_id) values(uid);
  return result;
end $$;

revoke all on function public.start_analysis(uuid,text,text,text) from public,anon;
grant execute on function public.start_analysis(uuid,text,text,text) to authenticated;
