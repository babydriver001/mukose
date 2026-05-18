
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transcribe-uploads',
  'transcribe-uploads',
  true,
  524288000,
  null
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy "Public read transcribe-uploads"
on storage.objects for select
to public
using (bucket_id = 'transcribe-uploads');

create policy "Public insert transcribe-uploads"
on storage.objects for insert
to public
with check (bucket_id = 'transcribe-uploads');
