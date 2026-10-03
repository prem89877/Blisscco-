import { useState } from 'react';
import TimePicker12 from '../TimePicker12';
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
  const [gOpen, setGOpen] = useState(() => rows.find((r) => !r.closed)?.opens ?? '10:00');
  const [gClose, setGClose] = useState(() => rows.find((r) => !r.closed)?.closes ?? '20:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // One time pair is applied to every open day
  function setGlobal(o: string, c: string) {
    setGOpen(o); setGClose(c);
    setRows((rs) => rs.map((r) => (r.closed ? r : { ...r, opens: o, closes: c })));
  }
  const toggleDay = (day: number) =>
    setRows((rs) => rs.map((r) => (r.day !== day ? r : r.closed ? { ...r, closed: false, opens: gOpen, closes: gClose } : { ...r, closed: true })));
  const setDay = (day: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.day === day ? { ...r, ...p } : r)));

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
      <p className="text-sm font-medium">{t('ed.tapDays')}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('ed.tapDays')}>
        {rows.map((r) => (
          <button key={r.day} type="button" aria-pressed={!r.closed} disabled={d} onClick={() => toggleDay(r.day)}
            className={`min-h-[44px] min-w-[56px] rounded-full border px-3 text-sm font-medium ${r.closed ? 'border-ink/20 bg-white text-ink/60' : 'border-blush bg-blush text-ink'}`}>
            {t(`day.${r.day}`)}
          </button>
        ))}
      </div>

      <p className="text-sm font-medium">{t('ed.sameTime')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{t('ed.opens')}</span>
          <TimePicker12 label={t('ed.opens')} value={gOpen} disabled={d} onChange={(v) => setGlobal(v, gClose)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{t('ed.closes')}</span>
          <TimePicker12 label={t('ed.closes')} value={gClose} disabled={d} onChange={(v) => setGlobal(gOpen, v)} />
        </div>
      </div>

      <details className="box p-3">
        <summary className="cursor-pointer text-sm font-medium">{t('ed.customizeDays')}</summary>
        <div className="mt-3 space-y-2">
          {rows.filter((r) => !r.closed).map((r) => (
            <div key={r.day} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-sm font-medium">{t(`day.${r.day}`)}</span>
              <TimePicker12 label={`${t(`day.${r.day}`)} ${t('ed.opens')}`} value={r.opens} disabled={d} onChange={(v) => setDay(r.day, { opens: v })} />
              <span aria-hidden="true">–</span>
              <TimePicker12 label={`${t(`day.${r.day}`)} ${t('ed.closes')}`} value={r.closes} disabled={d} onChange={(v) => setDay(r.day, { closes: v })} />
            </div>
          ))}
        </div>
      </details>

      <Msg error={error} ok={ok} />
      {editable && <button className="btn-primary w-full" disabled={busy} onClick={() => void save()}>{busy ? t('common.loading') : t('common.save')}</button>}
    </Section>
  );
}
