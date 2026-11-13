-- Автосдача письменных ответов работы на время — на сервере, не в браузере.
create or replace function public.finalize_exam_works(p_lesson uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.written_works w
     set status = 'submitted', submitted_at = coalesce(w.submitted_at, now()), updated_at = now()
    from public.lesson_items i
   where w.item_id = i.id and i.lesson_id = p_lesson and w.status = 'draft'
     and (length(trim(w.body)) > 0 or cardinality(w.files) > 0)
     and (public.is_teacher() or w.student_id = auth.uid())
     and public.session_over(p_lesson, w.student_id);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.finish_exam(p_lesson uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.exam_sessions set finished_at = coalesce(finished_at, now())
   where lesson_id = p_lesson and student_id = auth.uid();
  if not found then raise exception 'not started'; end if;
  n := public.finalize_exam_works(p_lesson);
  return jsonb_build_object('finished', true, 'submitted_works', n);
end $$;

revoke execute on function public.finalize_exam_works(uuid) from public, anon;
grant execute on function public.finalize_exam_works(uuid) to authenticated;
