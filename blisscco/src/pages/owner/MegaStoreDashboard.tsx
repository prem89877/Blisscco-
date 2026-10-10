import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MegaAlerts from '../../components/MegaAlerts';
import MegaBudgetCard from '../../components/MegaBudgetCard';
import MegaCampaignForm from '../../components/MegaCampaignForm';
import MegaMetrics from '../../components/MegaMetrics';
import MegaPartnerShops from '../../components/MegaPartnerShops';
import MegaStoreForm from '../../components/MegaStoreForm';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDate, fmtDateTime, rupees } from '../../lib/format';
import { campaignLink, inr, istDayOf, megaErrKey, rewardLabel, type MegaCampaign, type MegaDashboard } from '../../lib/megaStore';
import { supabase } from '../../lib/supabase';

const QR_COLORS = { dark: '#2D2A2E', light: '#FFFFFF' };
const DEFAULT_MAX_SHOPS = 10;

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 text-sm"><dt className="text-ink/70">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

/** Read-only summary of the campaign rules (always visible; the edit form shows only for a draft). */
function CampaignSummary({ c }: { c: MegaCampaign }) {
  const { t, lang } = useI18n();
  const pauseBlocks = c.config?.pause_blocks_registrations !== false;
  return (
    <dl className="space-y-1.5 rounded-xl bg-ink/5 p-3">
      <Row k={t('mg.f.start')} v={fmtDate(istDayOf(c.starts_at), lang)} />
      <Row k={t('mg.f.end')} v={fmtDate(istDayOf(c.ends_at), lang)} />
      <Row k={t('mg.sum.reward')} v={rewardLabel(c.reward_type, c.reward_value, c.max_discount_inr, t)} />
      <Row k={t('mg.f.minService')} v={c.min_service_price_inr > 0 ? rupees(c.min_service_price_inr) : t('mg.sum.none')} />
      <Row k={t('mg.f.minPurchase')} v={c.min_purchase_inr > 0 ? rupees(c.min_purchase_inr) : t('mg.sum.none')} />
      <Row k={t('mg.f.onePerShop')} v={c.one_reward_per_shop ? t('mg.sum.yes') : t('mg.sum.no')} />
      <Row k={t('mg.f.budget')} v={inr(c.budget_inr)} />
      <Row k={t('mg.sum.pauseRule')} v={pauseBlocks ? t('mg.sum.pauseBoth') : t('mg.sum.pauseIssueOnly')} />
    </dl>
  );
}

export default function MegaStoreDashboard() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [d, setD] = useState<MegaDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('get_my_megastore');
    if (e) { console.error(e); setError(t(megaErrKey(e.message))); setD({ store: null, campaign: null, shops: [], stats: {}, held: [], recent: [] }); return; }
    setD(data as MegaDashboard);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const store = d?.store ?? null;
  const approved = store?.status === 'approved';
  const link = store ? campaignLink(store.code) : '';
  useEffect(() => {
    if (!link || !approved) return;
    let alive = true;
    QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS })
      .then((s) => { if (alive) setSvg(s); })      // generated locally from our own URL; nothing is sent to any server
      .catch((err) => console.error(err));
    return () => { alive = false; };
  }, [link, approved]);

  async function setStatus(status: 'active' | 'paused' | 'ended') {
    if (busy) return;
    if (status === 'ended' && !window.confirm(t('mg.camp.confirmEnd'))) return;
    if (status === 'paused' && !window.confirm(t('mg.camp.confirmPause'))) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('megastore_set_campaign_status', { p_status: status });
    setBusy(false);
    if (e) setError(t(megaErrKey(e.message)));
    await load();
  }

  async function downloadPng() {
    try {
      const url = await QRCode.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS });
      const a = document.createElement('a');
      a.href = url; a.download = 'blisscco-mega-store-campaign-qr.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { console.error(err); setError(t('err.generic')); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError(t('err.generic')); }
  }
  function openRedeem(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) nav(`/mega/redeem/${encodeURIComponent(c)}`);
  }

  if (d === null) return <div className="mx-auto mt-6 h-40 max-w-2xl animate-pulse rounded-2xl bg-ink/10" />;

  const c = d.campaign;
  const open = !!c && c.status !== 'ended';
  const canManage = d.can_manage === true;
  const maxShops = d.limits?.max_partner_shops ?? DEFAULT_MAX_SHOPS;
  const attention = (d.held?.length ?? 0) + (d.flags ?? []).filter((f) => f.status === 'open').length;

  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="inline-flex min-h-[44px] items-center text-sm btn-text">{t('mg.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('mg.title')}</h1>
      <p className="rounded-xl bg-ink/5 p-3 text-sm">{t('mg.fundNote')}</p>
      <Msg error={error} />

      {/* 1. Registration: business type "Mega Store" -> admin approval. Nothing below this block is reachable before approval. */}
      {!store && (
        <Section title={t('mg.create.title')}>
          <p className="text-sm text-ink/80">{t('mg.create.sub')}</p>
          <MegaStoreForm store={null} onDone={() => void load()} />
        </Section>
      )}

      {store && !approved && (
        <>
          <div className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div><h2 className="font-semibold">{store.name}</h2>{store.city && <p className="text-sm text-ink/70">{store.city}</p>}</div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${store.status === 'pending_review' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900'}`}>{t(`mg.status.${store.status}`)}</span>
            </div>
            {store.status === 'pending_review' && <p className="text-sm">{t('mg.pendingNote')}</p>}
            {store.status === 'rejected' && <p className="rounded-xl bg-red-50 p-3 text-sm">{t('mg.rejectedNote')}{store.rejection_reason ? ` ${store.rejection_reason}` : ''}</p>}
            {store.status === 'suspended' && <p className="rounded-xl bg-red-50 p-3 text-sm">{t('mg.suspendedNote')}{store.rejection_reason ? ` ${store.rejection_reason}` : ''}</p>}
            <p className="text-xs text-ink/70">{t('mg.locked')}</p>
          </div>
          {store.status !== 'suspended' && d.can_manage && (
            <Section title={t('mg.create.title')}>
              <MegaStoreForm store={store} onDone={() => void load()} />
            </Section>
          )}
        </>
      )}

      {store && approved && (
        <>
          {/* 2. Store + campaign control: the first thing visible on a phone */}
          <div className="card space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div><h2 className="font-semibold">{store.name}</h2>{store.city && <p className="text-sm text-ink/70">{store.city}</p>}</div>
              <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-900">{t('mg.status.approved')}</span>
            </div>
            {d.my_role === 'manager' && <p className="rounded-xl bg-ink/5 p-3 text-xs">{t('mg.managerNote')}</p>}
            {open && c && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{c.title}</p>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${c.status === 'active' ? 'bg-green-100 text-green-900' : c.status === 'paused' ? 'bg-amber-100 text-amber-900' : 'bg-ink/10'}`}>{t(`mg.camp.status.${c.status}`)}</span>
                </div>
                {c.status === 'paused' && (
                  <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t(c.config?.pause_blocks_registrations === false ? 'mg.pausedNoteIssue' : 'mg.pausedNote')}</p>
                )}
                {canManage && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {c.status === 'active' && <button type="button" className="btn-secondary min-h-[52px]" disabled={busy} onClick={() => void setStatus('paused')}>{t('mg.camp.pause')}</button>}
                    {c.status === 'paused' && <button type="button" className="btn-solid min-h-[52px]" disabled={busy} onClick={() => void setStatus('active')}>{t('mg.camp.resume')}</button>}
                    {c.status === 'draft' && <button type="button" className="btn-solid min-h-[52px]" disabled={busy || d.shops.length === 0 || c.budget_inr === null} onClick={() => void setStatus('active')}>{t('mg.camp.start')}</button>}
                    <button type="button" className="btn-secondary min-h-[52px]" disabled={busy} onClick={() => void setStatus('ended')}>{t('mg.camp.end')}</button>
                  </div>
                )}
                {c.status === 'draft' && d.shops.length === 0 && <p className="text-sm text-amber-800">{t('mg.camp.noShopsToStart')}</p>}
                {c.status === 'draft' && c.budget_inr === null && <p className="text-sm text-amber-800">{t('mg.camp.noBudgetToStart')}</p>}
              </>
            )}
            {!open && <p className="text-sm text-ink/80">{c ? t('mg.camp.endedNote') : t('mg.camp.none')}</p>}
          </div>

          {/* 3. Checkout: redeem a customer's reward */}
          <Section title={t('mg.redeem.title')}>
            <p className="text-sm text-ink/80">{t('mg.redeem.hint')}</p>
            <form onSubmit={openRedeem} className="flex gap-2">
              <input aria-label={t('mg.redeem.code')} placeholder="MS-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                className="input min-w-0 flex-1 font-mono uppercase" value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} />
              <button type="submit" className="btn-solid shrink-0" disabled={!code.trim()}>{t('mg.redeem.open')}</button>
            </form>
          </Section>

          {/* 4. Needs attention */}
          {c && attention > 0 && (
            <a href="#mg-alerts" className="block rounded-2xl bg-amber-100 p-3 text-center text-sm font-semibold text-amber-900">{t('mg.attention', { n: attention })}</a>
          )}

          {/* 5. Performance */}
          {c && (
            <Section title={t('mg.stats.title')}>
              <MegaMetrics st={d.stats} />
            </Section>
          )}

          {/* 6. Budget */}
          {c && (
            <Section title={t('mg.budget.title')}>
              <MegaBudgetCard budget={d.budget} limits={d.limits} canIncrease={canManage && open} onChanged={() => void load()} />
            </Section>
          )}

          {/* 7. Campaign configuration */}
          <Section title={t('mg.camp.title')}>
            {open && c && <CampaignSummary c={c} />}
            {open && c && c.status !== 'draft' && <p className="text-xs text-ink/70">{t('mg.camp.lockedNote')}</p>}
            {canManage && (!open || c?.status === 'draft') && (
              <div className="space-y-3">
                <h3 className="font-semibold">{open ? t('mg.camp.edit') : t('mg.camp.new')}</h3>
                <MegaCampaignForm key={c?.id ?? 'new'} draft={open ? c : null} limits={d.limits} onSaved={() => void load()} />
              </div>
            )}
            {!open && c && <CampaignSummary c={c} />}
          </Section>

          {/* 8. Partner shops */}
          {open && (
            <Section title={t('mg.shops.title')}>
              <MegaPartnerShops shops={d.shops} max={maxShops} canEdit={canManage} onChanged={() => void load()} />
            </Section>
          )}

          {/* 9. Suspicious transactions + requests that need verification */}
          {c && (
            <div id="mg-alerts" className="scroll-mt-20">
              <Section title={t('mg.alerts.title')}>
                <MegaAlerts held={d.held} flags={d.flags ?? []} canApprove={d.issuance_open === true} onChanged={() => void load()} />
              </Section>
            </div>
          )}

          {/* 10. Campaign-entry QR */}
          {open && (
            <Section title={t('mg.qr.title')}>
              <div className="space-y-3 text-center">
                <p className="font-display text-xl font-semibold">{store.name}</p>
                {svg
                  ? <div role="img" aria-label={t('mg.qr.title')} className="mx-auto w-64 max-w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
                  : <div className="mx-auto h-64 w-64 animate-pulse rounded-xl bg-ink/10" />}
                <p className="text-sm">{t('mg.qr.hint')}</p>
              </div>
              <p className="break-all rounded-xl bg-ink/5 p-3 text-xs">{link}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-solid" disabled={!svg} onClick={() => void downloadPng()}>{t('mg.qr.download')}</button>
                <button type="button" className="btn-secondary" onClick={() => void copyLink()}>{copied ? t('mg.qr.copied') : t('mg.qr.copy')}</button>
              </div>
            </Section>
          )}

          {/* 11. Redemption history */}
          {c && (
            <Section title={t('mg.recent.title')}>
              {d.recent.length === 0 && <p className="text-sm text-ink/70">{t('mg.recent.none')}</p>}
              <ul className="space-y-2">
                {d.recent.map((r) => (
                  <li key={r.code + r.redeemed_at} className="rounded-xl border border-ink/10 p-3 text-sm">
                    <p><strong>{r.customer_name || '—'}</strong> · {r.business_name}</p>
                    <p className="text-ink/70">{t('mg.recent.row', { bill: rupees(r.bill_inr), disc: rupees(r.discount_inr) })} · {fmtDateTime(r.redeemed_at, lang)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {canManage && (
            <Section title={t('mg.f.name')}>
              <MegaStoreForm store={store} onDone={() => void load()} />
            </Section>
          )}
        </>
      )}
    </section>
  );
}
