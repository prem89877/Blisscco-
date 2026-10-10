import { useI18n } from '../i18n';
import { inr, type MegaStats } from '../lib/megaStore';

function Tile({ label, value, hint, tone = 'plain' }: { label: string; value: string | number; hint?: string; tone?: 'plain' | 'cost' }) {
  return (
    <div className={`rounded-2xl p-3 ${tone === 'cost' ? 'bg-blush/30' : 'bg-ink/5'}`}>
      <p className="font-display text-2xl font-semibold leading-tight">{value}</p>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink/70">{hint}</p>}
    </div>
  );
}

/**
 * The five things the Mega Store must never mix up. They come from different tables on the server:
 * registrations (enrolments), verified partner-shop services, rewards issued, rewards redeemed, and the discount cost (redemptions only).
 */
export default function MegaMetrics({ st }: { st: Partial<MegaStats> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Tile label={t('mg.m.registrations')} value={st.enrolled ?? 0} hint={t('mg.m.registrationsHint')} />
        <Tile label={t('mg.m.services')} value={st.verified_services ?? 0} hint={t('mg.m.servicesHint')} />
        <Tile label={t('mg.m.issued')} value={st.issued ?? 0} hint={t('mg.m.issuedHint')} />
        <Tile label={t('mg.m.redeemed')} value={st.redeemed ?? 0} hint={t('mg.m.redeemedHint')} />
      </div>
      <Tile tone="cost" label={t('mg.m.cost')} value={inr(st.discount_cost_inr ?? st.discount_given_inr ?? 0)} hint={t('mg.m.costHint', { bills: inr(st.bills_inr ?? 0) })} />
      <div className="rounded-2xl border border-ink/10 p-3">
        <p className="text-sm font-medium">{t('mg.m.issuedSplit')}</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink/70">{t('mg.stats.active')}</dt><dd className="text-right font-semibold">{st.active ?? 0}</dd>
          <dt className="text-ink/70">{t('mg.stats.redeemed')}</dt><dd className="text-right font-semibold">{st.redeemed ?? 0}</dd>
          <dt className="text-ink/70">{t('mg.stats.expired')}</dt><dd className="text-right font-semibold">{st.expired ?? 0}</dd>
          <dt className="text-ink/70">{t('mg.m.revoked')}</dt><dd className="text-right font-semibold">{st.revoked ?? 0}</dd>
          <dt className="text-ink/70">{t('mg.stats.onHold')}</dt><dd className="text-right font-semibold">{st.on_hold ?? 0}</dd>
        </dl>
        <p className="mt-2 text-xs text-ink/70">{t('mg.m.issuedNote')}</p>
      </div>
    </div>
  );
}
