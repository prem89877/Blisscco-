import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime, rupees } from '../../lib/format';
import { supabase } from '../../lib/supabase';

interface Tx { id: string; plan_code: string; amount_paise: number; refunded_paise: number; status: string; created_at: string; businesses: { name: string } | null }
interface Ev { event_id: string; event_type: string; result: string | null; received_at: string }

export default function AdminPayments() {
  const { t, lang } = useI18n();
  const [tx, setTx] = useState<Tx[] | null>(null);
  const [ev, setEv] = useState<Ev[]>([]);
  const [errKey, setErrKey] = useState('');

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([
        supabase.from('payment_transactions').select('id,plan_code,amount_paise,refunded_paise,status,created_at,businesses(name)').order('created_at', { ascending: false }).limit(50),
        supabase.from('webhook_events').select('event_id,event_type,result,received_at').order('received_at', { ascending: false }).limit(30),
      ]);
      if (a.error || b.error) { console.error(a.error ?? b.error); setErrKey('err.generic'); return; }
      setTx((a.data ?? []) as unknown as Tx[]); setEv((b.data ?? []) as Ev[]);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p8.adPayments')}</h1>
      <Msg error={errKey ? t(errKey) : ''} />
      <Section title={t('p8.adTx')}>
        {tx === null && !errKey && <div className="h-16 animate-pulse rounded-2xl bg-ink/10" />}
        {tx?.length === 0 && <p className="text-ink/70">{t('admin.noApps')}</p>}
        <ul className="divide-y divide-ink/10 text-sm">
          {tx?.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{x.businesses?.name ?? '—'} · {x.plan_code} · {fmtDateTime(x.created_at, lang)}</span>
              <span>{rupees(x.amount_paise / 100)}{x.refunded_paise > 0 ? ` (−${rupees(x.refunded_paise / 100)})` : ''} · {t(`p8.tx.${x.status}`)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('p8.adEvents')}>
        <ul className="divide-y divide-ink/10 text-xs">
          {ev.map((e) => <li key={e.event_id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{e.event_type}</span><span>{e.result ?? '—'} · {fmtDateTime(e.received_at, lang)}</span></li>)}
        </ul>
      </Section>
    </div>
  );
}
