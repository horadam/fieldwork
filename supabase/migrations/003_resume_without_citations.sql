-- Resume citations are no longer required. Existing provenance remains valid.
create or replace function public.import_resume_experience(p_batch_id uuid,p_entries jsonb) returns setof public.experience language plpgsql security definer set search_path='' as $$
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
      or (entry->'provenance' ? 'passages' and jsonb_typeof(entry->'provenance'->'passages')<>'array')
      then raise exception 'Invalid import entry'; end if;
    perform (entry->>'itemId')::uuid;
    if entry->'provenance' ? 'passages' and jsonb_array_length(entry->'provenance'->'passages') not between 0 and 5 then raise exception 'Invalid source excerpts'; end if;
    if exists(select 1 from jsonb_array_elements(entry->'provenance'->'passages') p where p->>'quote' is null or length(p->>'quote') not between 1 and 700) then raise exception 'Invalid source excerpts'; end if;
  end loop;
  insert into public.experience(user_id,title,body,provenance,import_batch_id,import_item_id)
  select uid,btrim(value->>'title'),btrim(value->>'body'),value->'provenance',p_batch_id,(value->>'itemId')::uuid from jsonb_array_elements(p_entries)
  on conflict(user_id,import_batch_id,import_item_id) do nothing;
  return query select * from public.experience where user_id=uid and import_batch_id=p_batch_id;
end $$;
