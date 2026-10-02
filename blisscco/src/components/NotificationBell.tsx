import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';

export const NOTIF_CHANGED = 'blisscco:notifications-changed';

function useUnread(uid: string | undefined): number {
  const [n, setN] = useState(0);

  const refresh = useCallback(async () => {
    if (!uid) return;
    const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null);
    if (!error) setN(count ?? 0);
  }, [uid]);

  useEffect(() => {
    if (!uid) { setN(0); return; }
    void refresh();
    // live updates; if realtime is not available the 60-second refresh below still keeps the badge fresh
    const channel = supabase.channel(`notif-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => { void refresh(); })
      .subscribe();
    const timer = window.setInterval(() => { void refresh(); }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onChanged = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTIF_CHANGED, onChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(NOTIF_CHANGED, onChanged);
      void supabase.removeChannel(channel);
    };
  }, [uid, refresh]);

  return n;
}

export default function NotificationBell({ uid }: { uid: string }) {
  const { t } = useI18n();
  const unread = useUnread(uid);
  return (
    <Link to="/notifications" className="btn-secondary relative !px-3" aria-label={t('p10.bellLabel', { n: unread })}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blush px-1 text-[11px] font-semibold text-ink" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
