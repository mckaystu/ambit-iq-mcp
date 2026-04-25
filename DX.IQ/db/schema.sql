create table if not exists libraries (
  id bigserial primary key,
  name text not null,
  base_url text not null,
  username text not null,
  password_secret_ref text not null,
  created_at timestamptz not null default now()
);

create table if not exists scan_jobs (
  id bigserial primary key,
  library_id bigint not null references libraries(id) on delete cascade,
  state text not null default 'queued',
  cursor jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

create table if not exists wcm_elements (
  id bigserial primary key,
  library_id bigint not null references libraries(id) on delete cascade,
  wcm_id text not null,
  name text not null,
  type text not null check (type in ('Component', 'AT', 'PT', 'SiteArea', 'Content', 'Library', 'Folder')),
  last_modified timestamptz,
  raw_markup text,
  breadcrumb_path text,
  audit_findings jsonb not null default '[]'::jsonb,
  stale_candidate boolean not null default false,
  unique (library_id, wcm_id)
);

create table if not exists wcm_links (
  id bigserial primary key,
  parent_id bigint not null references wcm_elements(id) on delete cascade,
  child_id bigint references wcm_elements(id) on delete set null,
  link_type text not null
);

create index if not exists idx_wcm_elements_library_type on wcm_elements (library_id, type);
create index if not exists idx_wcm_links_parent on wcm_links (parent_id);
create index if not exists idx_wcm_links_child on wcm_links (child_id);
