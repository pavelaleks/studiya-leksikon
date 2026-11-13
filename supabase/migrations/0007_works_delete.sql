-- Удаление файлов работ: свои — ученику, любые — преподавателю.
create policy works_delete on storage.objects for delete to authenticated
  using (bucket_id = 'works' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));
