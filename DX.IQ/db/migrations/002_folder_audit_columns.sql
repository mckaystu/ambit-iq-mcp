-- Folder hierarchy + audit metadata for context-aware scanner.
alter table wcm_elements drop constraint if exists wcm_elements_type_check;
alter table wcm_elements
  add constraint wcm_elements_type_check
  check (type in ('Component', 'AT', 'PT', 'SiteArea', 'Content', 'Library', 'Folder'));

alter table wcm_elements add column if not exists breadcrumb_path text;
alter table wcm_elements add column if not exists audit_findings jsonb not null default '[]'::jsonb;
alter table wcm_elements add column if not exists stale_candidate boolean not null default false;
