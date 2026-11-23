-- HOME OS PART 21 OF 34
create unique index chat_threads_family_room_uq on public.chat_threads (family_id) where kind = 'family';

create unique index chat_threads_direct_uq on public.chat_threads (family_id, direct_key) where kind = 'direct';

create table public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- Thread access: family room -> any active family member; direct -> the pair only.
create or replace function public.can_read_thread(p_thread_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.chat_threads ct
    where ct.id = p_thread_id and (
      (ct.kind = 'family' and public.is_family_member(ct.family_id))
      or (ct.kind = 'direct'
          and public.is_family_member(ct.family_id)
          and (':' || ct.direct_key || ':') like '%:' || auth.uid()::text || ':%')
    )
  );
$$;

-- Open (or get) the private thread between the caller and another member.
create or replace function public.open_direct_thread(p_other_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_other public.profiles%rowtype;
  v_me public.profiles%rowtype;
  v_key text;
  v_thread uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'active';
  select * into v_other from public.profiles where id = p_other_profile_id and status = 'active';
  if v_me.id is null or v_other.id is null or v_me.family_id is distinct from v_other.family_id then
    raise exception 'not allowed';
  end if;
  if v_me.id = v_other.id then
    raise exception 'cannot open a thread with yourself';
  end if;
  v_key := least(v_me.id::text, v_other.id::text) || ':' || greatest(v_me.id::text, v_other.id::text);
  insert into public.chat_threads (family_id, kind, direct_key)
  values (v_me.family_id, 'direct', v_key)
  on conflict (family_id, direct_key) where kind = 'direct' do nothing;
  select id into v_thread from public.chat_threads
  where family_id = v_me.family_id and kind = 'direct' and direct_key = v_key;
  return v_thread;
end;
$$;
