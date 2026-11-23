-- HOME OS PART 23 OF 34
-- decided_by/decided_at track the LATEST decision; full history in request_events.

alter table public.requests alter column status set default 'new';

update public.requests set status = 'new' where status = 'pending';

-- Every action on a request, with actor, timestamp, reason.
create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index request_events_request_idx on public.request_events (request_id, created_at);

-- Discussion thread per request.
create table public.request_comments (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index request_comments_request_idx on public.request_comments (request_id, created_at);

alter table public.request_events enable row level security;

alter table public.request_comments enable row level security;

-- ---------------------------------------------------------------------------
-- can_decide_requests: active family member holding requests.decide
-- ---------------------------------------------------------------------------
create or replace function public.can_decide_requests(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_family_member(p_family_id) and public.has_permission('requests.decide');
$$;
