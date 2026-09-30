import { useState } from 'react';
import { Msg, Section } from '../ui';
import { useI18n } from '../../i18n';
import { hhmm } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Loaded } from '../../lib/types';

interface Row { day: number; closed: boolean; opens: string; closes: string }

export default function HoursSection({ data, editable, reload }: { data: Loaded; editable: boolean; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: 7 }, (_, day) => {
      const h = data.hours.find((x) => x.day_of_week === day);
      return h ? { day, closed: h.is_closed, opens: hhmm(h.opens_at) || '10:00', closes: hhmm(h.closes_at) || '20:00' }
               : { day, closed: false, opens: '10:00', closes: '20:00' };
    }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const upd = (day: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.day === day ? { ...r, ...p } : r)));

  async function save() {
    if (busy) return;
    setError(''); setOk('');
    if (rows.some((r) => !r.closed && r.closes <= r.opens)) return setError(t('ed.hoursInvalid'));
    setBusy(true);
    const { error: err } = await supabase.from('business_hours').upsert(
      rows.map((r) => ({ business_id: data.business.id, day_of_week: r.day, is_closed: r.closed, opens_at: r.closed ? null : r.opens, closes_at: r.closed ? null : r.closes })),
      { onConflict: 'business_id,day_of_week' });
    setBusy(false);
    if (err) { console.error(err); setError(t('err.generic')); return; }
    setOk(t('common.saved'));
    await reload();
  }

  const d = !editable || busy;
  return (
    <Section title={t('ed.hours')}>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.day} className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-sm font-medium">{t(`day.${r.day}`)}</span>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-blush" checked={r.closed} disabled={d} onChange={(e) => upd(r.day, { closed: e.target.checked })} />
              {t('ed.closed')}
            </label>
            {!r.closed && (
              <>
                <input aria-label={t('ed.opens')} type="time" className="input w-auto" value={r.opens} disabled={d} onChange={(e) => upd(r.day, { opens: e.target.value })} />
                <input aria-label={t('ed.closes')} type="time" className="input w-auto" value={r.closes} disabled={d} onChange={(e) => upd(r.day, { closes: e.target.value })} />
              </>
            )}
          </div>
        ))}
      </div>
      <Msg error={error} ok={ok} />
      {editable && <button className="btn-primary w-full" disabled={busy} onClick={() => void save()}>{busy ? t('common.loading') : t('common.save')}</button>}
    </Section>
  );
}
