-- Dedicated demo project setup. Inspect existing permissive policies first.
begin;
insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do nothing;

do $$ begin
  if exists (select 1 from storage.buckets where id = 'assets' and public) then
    raise exception 'The existing assets bucket is public. Review its access before continuing.';
  end if;
end $$;

drop policy if exists "menu_assets_select_own" on storage.objects;
create policy "menu_assets_select_own" on storage.objects for select to authenticated
using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "menu_assets_insert_own" on storage.objects;
create policy "menu_assets_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "menu_assets_update_own" on storage.objects;
create policy "menu_assets_update_own" on storage.objects for update to authenticated
using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "menu_assets_delete_own" on storage.objects;
create policy "menu_assets_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
