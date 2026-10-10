import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Msg } from '../components/ui';
import { useI18n } from '../i18n';
import { fmtDate, rupees } from '../lib/format';
import { daysLeft, istDayOf, redeemLink, rewardLabel, type MyMegaReward } from '../lib/megaStore';
import { supabase } from '../lib/supabase';

const QR_COLORS = { dark: '#2D2A2E', light: '#FFFFFF' };

function RewardCard({ r, qr }: { r: MyMegaReward; qr?: string }) {
  const { t, lang } = useI18n();
  const live = r.state === 'active';
  const badge = r.state === 'active' ? 'bg-green-100 text-green-900' : r.state === 'on_hold' ? 'bg-amber-100 text-amber-900' : 'bg-ink/10 text-ink/70';
  const left = daysLeft(r.expires_at);
  return (
    <article className={`card space-y-3 ${live ? '' : 'opacity-80'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{r.store_name}</h3>
          <p className="text-sm text-ink/70">{r.campaign_title}</p>
        </div>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${badge}`}>{t(`mg.state.${r.state}`)}</span>
      </div>
      <p className="font-display text-2xl font-semibold">{rewardLabel(r.reward_type, r.reward_value, r.max_discount_inr, t)}</p>
      <p className="text-sm text-ink/80">{t('mg.my.earnedAt', { shop: r.business_name })}</p>
      {r.min_purchase_inr > 0 && <p className="text-sm text-ink/80">{t('mg.my.minBill', { n: rupees(r.min_purchase_inr) })}</p>}

      {live && (
        <div className="space-y-2 text-center">
          {qr
            ? <img src={qr} alt={t('mg.my.showQr', { store: r.store_name })} width={208} height={208} className="mx-auto h-52 w-52 rounded-xl border border-ink/10" />
            : <div className="mx-auto h-52 w-52 animate-pulse rounded-xl bg-ink/10" />}
          <p className="text-sm">{t('mg.my.showQr', { store: r.store_name })}</p>
          <p className="text-sm">{t('mg.my.code')}: <strong className="font-mono tracking-wider">{r.code}</strong></p>
          {r.expires_at && (
            <p className="text-sm font-medium">
              {t('mg.my.expires', { d: fmtDate(istDayOf(r.expires_at), lang) })}
              {' · '}{t('mg.my.daysLeft', { n: left })}
            </p>
          )}
        </div>
      )}
      {r.state === 'on_hold' && <p className="rounded-xl bg-amber-50 p-3 text-sm">{t('mg.my.pendingNote')}</p>}
      {r.state === 'redeemed' && r.redeemed_at && (
        <p className="text-sm">{t('mg.my.usedOn', { d: fmtDate(istDayOf(r.redeemed_at), lang) })}{r.discount_given_inr ? ` · ${t('mg.my.saved', { n: rupees(r.discount_given_inr) })}` : ''}</p>
      )}
      {r.state === 'expired' && r.expires_at && <p className="text-sm">{t('mg.my.expires', { d: fmtDate(istDayOf(r.expires_at), lang) })}</p>}
    </article>
  );
}

export default function MyRewards() {
  const { t } = useI18n();
  const [rows, setRows] = useState<MyMegaReward[] | null>(null);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error: e } = await supabase.rpc('get_my_mega_rewards');
      if (!alive) return;
      if (e) { console.error(e); setError(t('err.generic')); setRows([]); return; }
      const list = (data ?? []) as MyMegaReward[];
      setRows(list);
      // QR images are generated on this phone from our own link; nothing is sent to any server
      const out: Record<string, string> = {};
      for (const r of list) {
        if (r.state !== 'active') continue;
        try { out[r.id] = await QRCode.toDataURL(redeemLink(r.code), { width: 416, margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS }); } catch { /* skip */ }
      }
      if (alive) setQrs(out);
    })();
    return () => { alive = false; };
  }, [t]);

  const usable = rows?.filter((r) => r.state === 'active') ?? [];
  const pending = rows?.filter((r) => r.state === 'on_hold') ?? [];
  const past = rows?.filter((r) => ['redeemed', 'expired', 'rejected'].includes(r.state)) ?? [];

  return (
    <section className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link to="/profile" className="text-sm btn-text">{t('mg.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('mg.my.title')}</h1>
      <Msg error={error} />
      {rows === null && !error && <div className="h-32 animate-pulse rounded-2xl bg-ink/10" />}
      {rows?.length === 0 && !error && <p className="text-ink/70">{t('mg.my.none')}</p>}
      {usable.length > 0 && <h2 className="font-semibold">{t('mg.my.usable')}</h2>}
      {usable.map((r) => <RewardCard key={r.id} r={r} qr={qrs[r.id]} />)}
      {pending.length > 0 && <h2 className="font-semibold">{t('mg.my.pending')}</h2>}
      {pending.map((r) => <RewardCard key={r.id} r={r} />)}
      {past.length > 0 && <h2 className="font-semibold">{t('mg.my.past')}</h2>}
      {past.map((r) => <RewardCard key={r.id} r={r} />)}
    </section>
  );
}
