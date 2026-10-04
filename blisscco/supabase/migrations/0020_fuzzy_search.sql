-- 0020: Typo-tolerant search (like Google / YouTube): wrong or similar spellings still find the service.
-- Run after 0018 (and 0019 is independent). Safe to re-run.
--
-- How it matches (every word the customer typed must match something):
--   * exact / partial text            "facial"   -> Facial, Facial Cleanup           (best rank)
--   * small spelling mistakes         "fasial", "facal", "pedicur", "hair spaa"
--   * words that SOUND alike          "pedikyur", "menicure", "bridle makeup"
--   * missing / extra space           "hairspa", "bridalmakeup"
--   * Hindi / Marathi names keep working (matching is character based)
-- Exact matches are listed first; "similar" matches come after them. The new column is_exact lets the app say
-- "Showing closest matches" when nothing matched exactly.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ============ SCALABILITY INDEXES (search behaviour is NOT changed, only the speed of fetching rows) ============
-- Already present and still used by search_services (nothing to add): businesses_location_gix (partial GiST, approved only, 5 km filter),
-- services_business_idx, business_hours unique (business_id, day_of_week), subs_business_idx. See supabase/manual/benchmark_search.sql.
-- 1) Candidate rows per shop: lets Postgres read price / name / category straight from the index (no table fetch) for the fuzzy score.
create index if not exists services_search_cover_idx on public.services (business_id)
  include (price_inr, name, service_category) where is_active;
-- 2) Cover photo lookup (ORDER BY sort_order, created_at LIMIT 1) is done once per result row.
create index if not exists business_images_cover_lookup_idx on public.business_images (business_id, sort_order, created_at);

-- Score: -1 = a typed word matched nothing; otherwise sum over typed words (2 = contained in the text, 1 = similar).
create or replace function public._fuzzy_score(p_tokens text[], p_text text) returns int
language plpgsql stable set search_path = '' as $$
declare t text; w text; words text[]; hit int; total int := 0; k int; mt text;
begin
  words := array(select left(x, 40) from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[\s,.;:/&()|+-]+')) x where x <> '');
  foreach t in array p_tokens loop
    hit := 0;
    k := case when char_length(t) <= 3 then 0 when char_length(t) <= 5 then 1 else 2 end;       -- allowed spelling mistakes
    mt := case when char_length(t) >= 4 then extensions.dmetaphone(t) else '' end;               -- "sound" code
    foreach w in array words loop
      if position(t in w) > 0 then hit := 2; exit; end if;
      if hit < 1 then
        if k > 0 and abs(char_length(w) - char_length(t)) <= k and extensions.levenshtein(w, t) <= k then
          hit := 1;
        elsif char_length(t) >= 4 and char_length(w) >= 4
              and (extensions.similarity(w, t) >= 0.5 or (mt <> '' and mt = extensions.dmetaphone(w))) then
          hit := 1;
        end if;
      end if;
    end loop;
    if hit = 0 then return -1; end if;
    total := total + hit;
  end loop;
  return total;
end $$;
revoke execute on function public._fuzzy_score(text[], text) from public, anon, authenticated;

drop function if exists public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int);

create or replace function public.search_services(
  p_lat double precision, p_lng double precision, p_query text,
  p_category uuid default null, p_max_price numeric default null,
  p_open_now boolean default false, p_sort text default 'distance',
  p_limit int default 20, p_offset int default 0)
returns table (service_id uuid, service_label text, price_inr numeric, business_id uuid, business_name text,
               category_id uuid, category_name_en text, category_name_hi text, category_name_mr text,
               city text, distance_m double precision, cover_path text, is_open_now boolean,
               is_verified boolean, is_exact boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_point extensions.geography; v_q text; v_tokens text[]; v_n int;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid location' using errcode = '22023';
  end if;
  if trim(coalesce(p_query, '')) = '' then raise exception 'query required' using errcode = '22023'; end if;
  -- wildcard characters are not search text; lower-case; single spaces
  v_q := regexp_replace(lower(regexp_replace(left(trim(p_query), 60), '[%_\\]', '', 'g')), '\s+', ' ', 'g');
  v_q := trim(v_q);
  v_tokens := array(select x from unnest(string_to_array(v_q, ' ')) x where x <> '' limit 5);
  v_n := coalesce(array_length(v_tokens, 1), 0);
  if v_n = 0 then return; end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  select x.service_id, x.service_label, x.price_inr, x.business_id, x.business_name, x.category_id,
         x.name_en, x.name_hi, x.name_mr, x.city, x.distance_m, x.cover_path, x.is_open_now, x.is_verified,
         (x.score >= 2 * v_n) as is_exact
    from (
      select s.id as service_id, coalesce(s.name, s.service_category) as service_label, s.price_inr,
             b.id as business_id, b.name as business_name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now,
             public.has_entitlement(b.id, 'blue_badge') as is_verified,
             public._fuzzy_score(v_tokens, concat_ws(' ', s.service_category, s.name, b.name, c.name_en, c.name_hi, c.name_mr)) as score,
             extensions.word_similarity(v_q, lower(concat_ws(' ', s.service_category, s.name, b.name, c.name_en))) as wsim
        from public.services s
        join public.businesses b on b.id = s.business_id
        join public.business_categories c on c.id = b.category_id
       where s.is_active and b.status = 'approved' and b.location is not null
         and extensions.st_dwithin(b.location, v_point, 5000)
         and (p_category is null or b.category_id = p_category)
    ) x
   where (x.score >= 0 or (char_length(v_q) >= 5 and x.wsim >= 0.55))          -- word match, or "hairspa"-style whole-text match
     and (p_max_price is null or x.price_inr <= p_max_price)
     and (not coalesce(p_open_now, false) or x.is_open_now)
   order by (x.score >= 2 * v_n) desc,                                          -- exact matches first
            x.score desc,                                                       -- then the closest spelling
            case when p_sort = 'distance' then x.distance_m end asc nulls last,
            x.price_inr asc, x.distance_m asc, x.service_id
   limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  from public, anon, authenticated;
grant execute on function public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  to anon, authenticated;
