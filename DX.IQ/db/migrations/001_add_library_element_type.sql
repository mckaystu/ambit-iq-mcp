-- Run once on existing databases created before Library element type support.
alter table wcm_elements drop constraint if exists wcm_elements_type_check;
alter table wcm_elements
  add constraint wcm_elements_type_check
  check (type in ('Component', 'AT', 'PT', 'SiteArea', 'Content', 'Library'));
