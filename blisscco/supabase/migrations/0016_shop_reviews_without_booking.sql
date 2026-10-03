-- 0016: any logged-in user can review a public shop directly (no booking needed), except the shop's own owner.
-- One direct review per user per shop. Booking-based reviews (submit_review) are unchanged.
alter table public.reviews alter column booking_id drop not null;

create unique index if not exists reviews_one_direct_per_shop
  on public.reviews (customer_id, business_id) where booking_id is null;

create or replace function public.submit_shop_review(p_business_id uuid, p_rating int, p_comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text; v_biz text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select name into v_biz from public.businesses where id = p_business_id and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.businesses where id = p_business_id and owner_id = auth.uid()) then raise exception 'own_business'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.reviews where customer_id = auth.uid() and business_id = p_business_id) then raise exception 'already_reviewed_shop'; end if;
  select nullif(left(split_part(trim(coalesce(full_name, '')), ' ', 1), 30), '') into v_name from public.profiles where id = auth.uid();
  begin
    insert into public.reviews (booking_id, business_id, business_name, customer_id, reviewer_name, rating, comment)
    values (null, p_business_id, v_biz, auth.uid(), v_name, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
    returning id into v_id;
  exception when unique_violation then raise exception 'already_reviewed_shop';
  end;
  return v_id;
end $$;

revoke execute on function public.submit_shop_review(uuid, int, text) from public, anon, authenticated;
grant execute on function public.submit_shop_review(uuid, int, text) to authenticated;
