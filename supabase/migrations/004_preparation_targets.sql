-- Additive. Existing application/analysis/task data and browser practice remain valid.
create table public.preparation_targets (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  unique(id,user_id), check((payload->>'id')::uuid=id)
);
create table public.preparation_plans (
  id uuid primary key, user_id uuid not null, target_id uuid not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  unique(id,user_id), foreign key(target_id,user_id) references public.preparation_targets(id,user_id) on delete cascade,
  check((payload->>'id')::uuid=id), check((payload->>'targetId')::uuid=target_id)
);
create table public.preparation_progress (
  plan_id uuid primary key, user_id uuid not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  foreign key(plan_id,user_id) references public.preparation_plans(id,user_id) on delete cascade,
  check((payload->>'planId')::uuid=plan_id)
);
alter table public.preparation_targets enable row level security;
alter table public.preparation_plans enable row level security;
alter table public.preparation_progress enable row level security;
create policy read_own_preparation_targets on public.preparation_targets for select to authenticated using(user_id=auth.uid());
create policy read_own_preparation_plans on public.preparation_plans for select to authenticated using(user_id=auth.uid());
create policy read_own_preparation_progress on public.preparation_progress for select to authenticated using(user_id=auth.uid());
revoke all on public.preparation_targets,public.preparation_plans,public.preparation_progress from public,anon,authenticated;
grant select on public.preparation_targets,public.preparation_plans,public.preparation_progress to authenticated;

create function public.mutate_preparation(p_action text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); tid uuid; pid uuid; existing jsonb; selected_target jsonb;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if p_action='target' then
    tid:=(p_payload->>'id')::uuid;
    if jsonb_typeof(p_payload->'jobIds') is distinct from 'array' or jsonb_array_length(p_payload->'jobIds') not between 1 and 3
      or length(p_payload->>'name') not between 1 and 160 then raise exception 'Invalid target'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(p_payload->'jobIds'))<>jsonb_array_length(p_payload->'jobIds')
      or exists(select 1 from jsonb_array_elements_text(p_payload->'jobIds') j where not exists(select 1 from public.applications a where a.id::text=j.value and a.user_id=uid)) then raise exception 'Invalid target applications'; end if;
    select payload into existing from public.preparation_targets where id=tid and user_id=uid for update;
    if found then
      update public.preparation_targets set payload=jsonb_set(p_payload,'{activeVersionId}',coalesce(existing->'activeVersionId','null'::jsonb)) where id=tid and user_id=uid;
    else
      insert into public.preparation_targets(id,user_id,payload) values(tid,uid,jsonb_set(p_payload,'{activeVersionId}','null'::jsonb));
    end if;
  elsif p_action='delete' then
    delete from public.preparation_targets where id=(p_payload->>'id')::uuid and user_id=uid;
    if not found then raise exception 'Target not found'; end if;
  elsif p_action='activate' then
    tid:=(p_payload->>'targetId')::uuid; pid:=(p_payload->>'id')::uuid;
    select payload into selected_target from public.preparation_targets where id=tid and user_id=uid for update;
    if not found then raise exception 'Target not found'; end if;
    if exists(select 1 from public.preparation_plans where id=pid and target_id=tid and user_id=uid) then return; end if;
    if jsonb_typeof(p_payload->'sources') is distinct from 'array' or jsonb_array_length(p_payload->'sources')<>jsonb_array_length(selected_target->'jobIds')
      or exists(select 1 from jsonb_array_elements(p_payload->'sources') s where not (selected_target->'jobIds' ? (s->>'jobId'))) then raise exception 'Target sources changed'; end if;
    insert into public.preparation_plans(id,user_id,target_id,payload) values(pid,uid,tid,p_payload);
    insert into public.preparation_progress(plan_id,user_id,payload) values(pid,uid,jsonb_build_object('planId',pid,'answers','{}'::jsonb,'scores','{}'::jsonb,'done','{}'::jsonb));
    update public.preparation_targets set payload=jsonb_set(jsonb_set(payload,'{activeVersionId}',to_jsonb(pid::text)),'{settings}',p_payload->'settings') where id=tid and user_id=uid;
  elsif p_action='progress' then
    pid:=(p_payload->>'planId')::uuid;
    select target_id into tid from public.preparation_plans where id=pid and user_id=uid;
    if not found then raise exception 'Plan not found'; end if;
    select payload into selected_target from public.preparation_targets where id=tid and user_id=uid for update;
    if selected_target->>'activeVersionId' is distinct from pid::text then raise exception 'Previous versions are read-only'; end if;
    update public.preparation_progress set payload=p_payload where plan_id=pid and user_id=uid;
  else raise exception 'Invalid preparation action'; end if;
end $$;
revoke all on function public.mutate_preparation(text,jsonb) from public,anon;
grant execute on function public.mutate_preparation(text,jsonb) to authenticated;
