import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { composeNotification } from '../../api/_lib/notificationText';
import { NOTIF_CHANGED } from '../components/NotificationBell';
import { Msg } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { DeliveryRow, NotificationRow } from '../lib/types';

// What we show for a delivery. Only what the database recorded: "sent" appears ONLY after the provider accepted it.
function chip(d: DeliveryRow, t: (k: string, v?: Record<string, string | number>) => string): { text: string; cls: string } | null {
  const ch = t(d.channel === 'push' ? 'p10.d.push' : 'p10.d.email');
  if (d.status === 'sent') return { text: t('p10.d.sent', { ch }), cls: 'bg-green-100 text-green-900' };
  if (d.status === 'failed') return { text: t('p10.d.failed', { ch }), cls: 'bg-red-100 text-red-900' };
  if (d.status === 'sending') return { text: t('p10.d.sending', { ch }), cls: 'bg-ink/10 text-ink' };
  if (d.status === 'pending') return d.attempts > 0 ? { text: t('p10.d.retrying', { ch }), cls: 'bg-amber-100 text-amber-900' } : { text: t('p10.d.queued', { ch }), cls: 'bg-ink/10 text-ink' };
  return null;                                                // skipped: nothing was supposed to be sent, so nothing is shown
}

export default function Notifications() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const nav = useNavigate();
  const uid = session?.user.id;
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error: e } = await supabase.from('notifications')
      .select('id, type, category, data, link, read_at, created_at, notification_deliveries(channel, status, attempts, last_error, sent_at)')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(50);
    if (e) { console.error(e); setError(t('err.generic')); return; }
    setError('');
    setRows((data ?? []) as unknown as NotificationRow[]);
  }, [uid, t]);

  useEffect(() => { void load(); }, [load]);

  // refresh while the page is open (new notifications and delivery results arrive in the background)
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markRead(ids: string[] | null) {
    const { error: e } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
    if (e) { console.error(e); setError(t('err.generic')); return; }
    window.dispatchEvent(new Event(NOTIF_CHANGED));
    void load();
  }

  async function open(n: NotificationRow) {
    if (!n.read_at) await markRead([n.id]);
    if (n.link) nav(n.link);
  }

  const unread = (rows ?? []).filter((r) => !r.read_at).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{t('p10.title')}</h1>
        <div className="flex gap-2">
          {unread > 0 && <button className="btn-secondary" onClick={() => void markRead(null)}>{t('p10.markAll')}</button>}
          <Link to="/notifications/settings" className="btn-secondary">{t('p10.settings')}</Link>
        </div>
      </div>
      <Msg error={error} />
      {rows === null && !error && <p className="text-sm text-ink/70" role="status">{t('p10.loading')}</p>}
      {rows !== null && rows.length === 0 && <div className="card text-sm text-ink/70">{t('p10.empty')}</div>}
      <ul className="space-y-3">
        {(rows ?? []).map((n) => {
          const { title, body } = composeNotification(n.type, n.data, lang);
          const chips = n.notification_deliveries.map((d) => ({ d, c: chip(d, t) })).filter((x) => x.c !== null);
          return (
            <li key={n.id} className={`card !p-4 ${n.read_at ? '' : 'ring-2 ring-blush/60'}`}>
              <button type="button" onClick={() => void open(n)} className="block w-full text-left">
                <span className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-blush" aria-label={t('p10.unread')} />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{title}</span>
                    {body && <span className="mt-0.5 block text-sm text-ink/80">{body}</span>}
                    <span className="mt-1 block text-xs text-ink/60">{fmtDateTime(n.created_at, lang)}</span>
                  </span>
                </span>
              </button>
              {chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {chips.map(({ d, c }) => (
                    <span key={d.channel} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c?.cls ?? ''}`}>{c?.text}</span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows !== null && rows.some((r) => r.notification_deliveries.length > 0) && <p className="text-xs text-ink/60">{t('p10.d.hint')}</p>}
    </div>
  );
}
