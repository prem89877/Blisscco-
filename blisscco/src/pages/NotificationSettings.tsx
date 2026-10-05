import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Msg, Section } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useInstall } from '../lib/installPrompt';
import { disablePush, enablePush, isPushOnHere, pushSupport } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { NotificationPrefs } from '../lib/types';

const CATS = ['booking', 'approval', 'review', 'payment', 'reminder'] as const;
const DEFAULTS: NotificationPrefs = { push_enabled: true, email_enabled: true, muted_categories: [] };

export default function NotificationSettings() {
  const { t } = useI18n();
  const { session } = useAuth();
  const uid = session?.user.id;
  const install = useInstall();
  const support = pushSupport();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [perm, setPerm] = useState<NotificationPermission | 'none'>(() => ('Notification' in window ? Notification.permission : 'none'));

  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase.from('notification_preferences').select('push_enabled, email_enabled, muted_categories').eq('user_id', uid).maybeSingle();
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    setPrefs((data as NotificationPrefs | null) ?? DEFAULTS);
    setHere(await isPushOnHere());
  }, [uid, t]);
  useEffect(() => { void load(); }, [load]);

  async function toggleDevice() {
    setBusy(true); setMsg({ error: '', ok: '' });
    try {
      if (here) { await disablePush(); setHere(false); }
      else {
        const r = await enablePush();
        setPerm('Notification' in window ? Notification.permission : 'none');
        if (r === 'ok') setHere(true);
        else setMsg({ error: t(r === 'denied' ? 'p10.s.denied' : 'p10.s.pushFailed'), ok: '' });
      }
    } finally { setBusy(false); }
  }

  async function save() {
    if (!prefs) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await supabase.rpc('save_notification_preferences', {
      p_push: prefs.push_enabled, p_email: prefs.email_enabled, p_muted: prefs.muted_categories,
    });
    setBusy(false);
    if (error) { console.error(error); setMsg({ error: t('err.generic'), ok: '' }); return; }
    setMsg({ error: '', ok: t('p10.s.saved') });
  }

  const toggleCat = (c: string, on: boolean) =>
    setPrefs((p) => (p ? { ...p, muted_categories: on ? p.muted_categories.filter((x) => x !== c) : [...p.muted_categories.filter((x) => x !== c), c] } : p));

  const deviceNote =
    support === 'needs_install' ? t('p10.s.needsInstall')
      : support === 'unsupported' ? t('p10.s.unsupported')
        : support === 'no_key' ? t('p10.s.noKey')
          : perm === 'denied' ? t('p10.s.denied') : '';

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/notifications" className="text-sm underline">{t('p10.s.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p10.s.title')}</h1>
      <Msg error={msg.error} ok={msg.ok} />

      <Section title={t('p10.s.device')}>
        <p className="text-sm">{here ? t('p10.s.pushOn') : t('p10.s.pushOff')}</p>
        {deviceNote && <p className="text-sm text-ink/70">{deviceNote}</p>}
        {support === 'ok' && perm !== 'denied' && (
          <button className="btn-primary" disabled={busy} onClick={() => void toggleDevice()}>{here ? t('p10.s.disable') : t('p10.s.enable')}</button>
        )}
        {install.canPrompt && <button className="btn-secondary" onClick={() => void install.install()}>{t('p10.i.button')}</button>}
      </Section>

      {prefs && (
        <Section title={t('p10.s.prefs')}>
          <Check id="np-push" label={t('p10.s.pushAll')} checked={prefs.push_enabled} onChange={(v) => setPrefs({ ...prefs, push_enabled: v })} />
          <Check id="np-email" label={t('p10.s.emailAll')} checked={prefs.email_enabled} onChange={(v) => setPrefs({ ...prefs, email_enabled: v })} />
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('p10.s.cats')}</legend>
            {CATS.map((c) => (
              <Check key={c} id={`np-${c}`} label={t(`p10.cat.${c}`)} checked={!prefs.muted_categories.includes(c)} onChange={(v) => toggleCat(c, v)} />
            ))}
          </fieldset>
          <p className="text-xs text-ink/60">{t('p10.s.catHint')}</p>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>{t('p10.s.save')}</button>
        </Section>
      )}
    </div>
  );
}
