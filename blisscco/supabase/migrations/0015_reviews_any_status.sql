-- 0015: reviews allowed for ANY of the customer's own bookings (completed or not).
-- Same function as in 0010 minus the 'not_completed' check. Everything else is unchanged:
-- still needs login, must be the booking's own customer, not suspended, rating 1-5, one review per booking.
create or replace function public.submit_review(p_booking_id uuid, p_rating int, p_comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_name text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or bk.customer_id is distinct from auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_found'; end if;
  select nullif(left(split_part(trim(coalesce(full_name, '')), ' ', 1), 30), '') into v_name from public.profiles where id = auth.uid();
  begin
    insert into public.reviews (booking_id, business_id, business_name, customer_id, reviewer_name, rating, comment)
    values (bk.id, bk.business_id, bk.business_name, auth.uid(), v_name, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
    returning id into v_id;
  exception when unique_violation then raise exception 'already_reviewed';
  end;
  return v_id;
end $$;
-- create or replace keeps the existing grants (authenticated only), nothing to re-grant.
