-- HOME OS PART 27 OF 34
update public.tasks set status = 'todo' where status = 'open';

update public.tasks set status = 'completed' where status = 'done';

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index task_steps_task_idx on public.task_steps (task_id, position);

-- Attachments/proof photos: storage PATHS only until the documents stage
-- wires binary upload to Supabase Storage.
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  path text not null,
  kind text not null default 'attachment' check (kind in ('attachment','proof')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index task_events_task_idx on public.task_events (task_id, created_at);

alter table public.task_steps enable row level security;

alter table public.task_attachments enable row level security;

alter table public.task_comments enable row level security;

alter table public.task_events enable row level security;

-- Owner or active supervisor: approves completions and rates tasks.
create or replace function public.can_approve_tasks(p_family_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.family_id = p_family_id
      and p.status = 'active' and p.role in ('owner','supervisor')
  );
$$;
