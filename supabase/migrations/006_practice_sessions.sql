-- Practice attempts belong to one immutable plan version. Target deletion
-- cascades through plans, but replacing a plan preserves its attempts.
create table public.practice_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  plan_id uuid not null,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  foreign key(plan_id,user_id) references public.preparation_plans(id,user_id) on delete cascade
);
create index practice_sessions_owner_plan on public.practice_sessions(user_id,plan_id,created_at desc);
alter table public.practice_sessions enable row level security;
create policy read_own_practice_sessions on public.practice_sessions for select to authenticated using(user_id=auth.uid());
revoke all on public.practice_sessions from public,anon,authenticated;
grant select on public.practice_sessions to authenticated;
create function public.save_practice_session(p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid:=(p_payload->>'id')::uuid; pid uuid:=(p_payload->>'planId')::uuid; old jsonb; p jsonb; t jsonb; rev integer:=(p_payload->>'revision')::integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||'practice',0));
  select payload into p from public.preparation_plans where id=pid and user_id=uid;
  if p is null then raise exception 'Plan not found'; end if;
  select payload into t from public.preparation_targets where id=(p->>'targetId')::uuid and user_id=uid for update;
  if t->>'activeVersionId' is distinct from pid::text then raise exception 'Previous version is read-only'; end if;
  if jsonb_typeof(p_payload->'turns') is distinct from 'array' or jsonb_array_length(p_payload->'turns')>9 or pg_catalog.octet_length(p_payload::text)>400000 or rev is null or rev<0 or rev>20 then raise exception 'Invalid session'; end if;
  select payload into old from public.practice_sessions where id=sid and user_id=uid for update;
  if old is not null then
    if old=p_payload then return; end if;
    if old->>'planId' is distinct from pid::text or (old->>'revision')::integer+1<>rev or old->>'status'='completed' or old->'questionIds' is distinct from p_payload->'questionIds' or old->>'mode' is distinct from p_payload->>'mode' or old->>'activityId' is distinct from p_payload->>'activityId' then raise exception 'Session changed'; end if;
    if jsonb_array_length(p_payload->'turns')<jsonb_array_length(old->'turns') then raise exception 'History cannot be removed'; end if;
    for i in 0..jsonb_array_length(old->'turns')-1 loop
      if old->'turns'->i is distinct from p_payload->'turns'->i then raise exception 'History cannot change'; end if;
    end loop;
    update public.practice_sessions set payload=p_payload where id=sid and user_id=uid;
  else
    if rev<>0 or jsonb_array_length(p_payload->'turns')<>0 then raise exception 'Invalid initial session'; end if;
    if (select count(*) from public.practice_sessions where user_id=uid and plan_id=pid)>=100 then raise exception 'Session capacity reached'; end if;
    insert into public.practice_sessions(id,user_id,plan_id,payload) values(sid,uid,pid,p_payload);
  end if;
end $$;
revoke all on function public.save_practice_session(jsonb) from public,anon;
grant execute on function public.save_practice_session(jsonb) to authenticated;

alter table public.inference_usage drop constraint inference_usage_kind_check;
alter table public.inference_usage add constraint inference_usage_kind_check check(kind in ('resume_extraction','job_extraction','preparation_generation','practice_turn','practice_audio'));
create or replace function public.reserve_inference(p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); hourly integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  hourly:=case p_kind when 'resume_extraction' then 10 when 'job_extraction' then 20 when 'preparation_generation' then 10 when 'practice_turn' then 60 when 'practice_audio' then 30 end;
  if hourly is null then raise exception 'Unknown inference kind'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||p_kind,0));
  if (select count(*) from public.inference_usage where user_id=uid and kind=p_kind and created_at>now()-interval '1 hour')>=hourly then raise exception 'Hourly inference limit reached'; end if;
  insert into public.inference_usage(user_id,kind) values(uid,p_kind);
end $$;
