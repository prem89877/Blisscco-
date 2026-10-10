import { useState } from 'react';
import { Msg } from './ui';
import { useI18n } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { megaErrKey, type MegaFlag, type MegaHeld } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

const SEV: Record<MegaFlag['severity'], string> = { low: 'bg-ink/10 text-ink', medium: 'bg-amber-100 text-amber-900', high: 'bg-red-100 text-red-900' };

/**
 * Suspicious transactions and requests needing verification.
 *  - held: the server put these rewards on hold; the Mega Store decides (approve starts the 1-month clock, reject cancels it)
 *  - flags: open / confirmed fraud flags (admin decides these; shown here so the owner is aware)
 * While the campaign is not running, approving is disabled (it would issue a NEW reward); rejecting stays possible.
 */
export default function MegaAlerts({ held, flags, canApprove, onChanged }: { held: MegaHeld[]; flags: MegaFlag[]; canApprove: boolean; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function review(id: string, approve: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('megastore_review_reward', { p_reward_id: id, p_approve: approve, p_note: null });
    setBusy(false);
    if (e) setError(t(megaErrKey(e.message)));
    onChanged();
  }

  const heldCodes = new Set(held.map((h) => h.code));
  const otherFlags = flags.filter((f) => !(f.reward_code && heldCodes.has(f.reward_code) && f.status === 'open'));

  return (
    <div className="space-y-4">
      <Msg error={error} />
      {held.length === 0 && otherFlags.length === 0 && <p className="text-sm text-ink/70">{t('mg.alerts.none')}</p>}

      {held.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">{t('mg.alerts.heldTitle', { n: held.length })}</h3>
          <p className="text-sm text-ink/80">{t('mg.held.hint')}</p>
          {!canApprove && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.alerts.pausedNote')}</p>}
          <ul className="space-y-3">
            {held.map((h) => (
              <li key={h.id} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-sm"><strong>{h.customer_name || '—'}</strong> · {h.business_name}</p>
                <p className="text-xs text-ink/70">{h.risk_flags.map((f) => t(`mg.flag.${f}`)).join(', ')} · {fmtDateTime(h.created_at, lang)}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-solid flex-1" disabled={busy || !canApprove} onClick={() => void review(h.id, true)}>{t('mg.held.approve')}</button>
                  <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => void review(h.id, false)}>{t('mg.held.reject')}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {otherFlags.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">{t('mg.alerts.flagsTitle')}</h3>
          <ul className="space-y-2">
            {otherFlags.map((f) => (
              <li key={f.id} className="space-y-1 rounded-xl border border-ink/10 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEV[f.severity]}`}>{t(`mg.sev.${f.severity}`)}</span>
                  <span className="font-medium">{t(`mg.flag.${f.flag_type}`) === `mg.flag.${f.flag_type}` ? f.flag_type : t(`mg.flag.${f.flag_type}`)}</span>
                  <span className="text-xs text-ink/70">{t(`mg.flagStatus.${f.status}`)}</span>
                </div>
                <p className="text-ink/80">{[f.customer_name, f.business_name].filter(Boolean).join(' · ') || '—'}</p>
                <p className="text-xs text-ink/70">{f.reward_code ? `${f.reward_code} · ` : ''}{fmtDateTime(f.created_at, lang)}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink/70">{t('mg.alerts.adminNote')}</p>
        </div>
      )}
    </div>
  );
}
