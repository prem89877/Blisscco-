-- 0029: admin custom notification (push only, no e-mail).
-- Run after 0028, BEFORE deploying the new frontend. Safe to re-run. No table / column change.
--
-- The admin writes a title + message and picks who gets it:
--   'owners'    every active owner          'customers'  every active customer
--   'owner'     ONE owner (p_user_id)       'customer'   ONE customer (p_user_id)
-- It is saved as an in-app notification (type 'admin_message', category 'system') and queued ONLY on the 'push' channel,
-- so it reaches phones like every other app notification. Nothing is queued on 'email'.
-- Users who turned push off in their settings, or have no push-enabled device, still see it in the in-app Notifications list.
-- Suspended users are skipped. Every send is written to admin_audit_logs.

create or replace function public.admin_send_notification(
  p_target text, p_user_id uuid, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body  text := trim(coalesce(p_body, ''));
  v_role  public.user_role;
  v_single boolean;
  v_data  jsonb;
  v_total int := 0;
  v_push  int := 0;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_title) < 2 or char_length(v_title) > 60 then raise exception 'title_length'; end if;
  if char_length(v_body) < 2 or char_length(v_body) > 300 then raise exception 'body_length'; end if;

  if p_target in ('owners', 'owner') then v_role := 'owner';
  elsif p_target in ('customers', 'customer') then v_role := 'customer';
  else raise exception 'invalid_target'; end if;
  v_single := p_target in ('owner', 'customer');

  if v_single then
    if p_user_id is null then raise exception 'user_required'; end if;
    if not exists (select 1 from public.profiles where id = p_user_id and role = v_role and not is_suspended) then
      raise exception 'user_not_found';
    end if;
  end if;

  v_data := jsonb_build_object('title', v_title, 'body', v_body);

  -- 1) in-app notification for every target user
  with targets as (
    select p.id from public.profiles p
     where p.role = v_role and not p.is_suspended
       and (not v_single or p.id = p_user_id)
  ), ins as (
    insert into public.notifications (user_id, type, category, data, link)
    select t.id, 'admin_message', 'system', v_data, '/notifications' from targets t
    returning id, user_id
  ), q as (
    -- 2) push delivery ONLY for users who allow push and have at least one subscribed device
    insert into public.notification_deliveries (notification_id, channel)
    select i.id, 'push' from ins i
     where exists (select 1 from public.push_subscriptions s where s.user_id = i.user_id)
       and coalesce((select np.push_enabled from public.notification_preferences np where np.user_id = i.user_id), true)
    returning 1
  )
  select (select count(*) from ins), (select count(*) from q) into v_total, v_push;

  if v_push > 0 then perform public._kick_dispatcher(); end if;

  perform public.write_audit_log('notification.send', 'notification', case when v_single then p_user_id else null end,
    jsonb_build_object('target', p_target, 'title', v_title, 'body', v_body, 'recipients', v_total, 'push_queued', v_push));

  return jsonb_build_object('recipients', v_total, 'push_queued', v_push);
end $$;

revoke execute on function public.admin_send_notification(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_send_notification(text, uuid, text, text) to authenticated;
