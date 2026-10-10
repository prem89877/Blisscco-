import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Field from '../../components/Field';
import MegaCampaignForm from '../../components/MegaCampaignForm';
import MegaPartnerShops from '../../components/MegaPartnerShops';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDate, fmtDateTime, rupees } from '../../lib/format';
import { campaignLink, istDayOf, megaErrKey, rewardLabel, type MegaDashboard, type MegaStore } from '../../lib/megaStore';
import { supabase } from '../../lib/supabase';

const QR_COLORS = { dark: '#2D2A2E', light: '#FFFFFF' };

function StoreForm({ store, onDone }: { store: MegaStore | null; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(store?.name ?? '');
  const [description, setDescription] = useState(store?.description ?? '');
  const [phone, setPhone] = useState(store?.phone ?? '');
  const [city, setCity] = useState(store?.city ?? '');
  const [address, setAddress] = useState(store?.address_line ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(''); setOk('');
    if (name.trim().length < 2) return setError(t('mg.err.invalid_name'));
    setBusy(true);
    const args = { p_name: name.trim(), p_description: description.trim() || null, p_phone: phone.trim() || null, p_city: city.trim() || null, p_address: address.trim() || null };
    const { error: err } = await supabase.rpc(store ? 'megastore_update' : 'megastore_create', args);
    setBusy(false);
    if (err) { setError(t(megaErrKey(err.message))); return; }
    setOk(t('mg.saved'));
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="ms-name" label={t('mg.f.name')} value={name} onChange={setName} disabled={busy || store?.status === 'approved'} />
      <div className="space-y-1.5">
        <label htmlFor="ms-desc" className="text-sm font-medium">{t('mg.f.desc')}</label>
        <textarea id="ms-desc" rows={3} maxLength={500} className="input" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Field id="ms-phone" label={t('mg.f.phone')} value={phone} onChange={setPhone} disabled={busy} autoComplete="tel" />
      <Field id="ms-city" label={t('mg.f.city')} value={city} onChange={setCity} disabled={busy} />
      <Field id="ms-address" label={t('mg.f.address')} value={address} onChange={setAddress} disabled={busy} />
      <Msg error={error} ok={ok} />
      <button type="submit" className="btn-confirm" disabled={busy}>{busy ? t('common.loading') : store ? t('mg.save') : t('mg.create.btn')}</button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-ink/5 p-3 text-center">
      <p className="font-display text-xl font-semibold">{value}</p>
      <p className="text-xs text-ink/70">{label}</p>
    </div>
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
  const link = store ? campaignLink(store.code) : '';
  useEffect(() => {
    if (!link || store?.status !== 'approved') return;
    let alive = true;
    QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: QR_COLORS })
      .then((s) => { if (alive) setSvg(s); })      // generated locally from our own URL; nothing is sent to any server
      .catch((err) => console.error(err));
    return () => { alive = false; };
  }, [link, store?.status]);

  async function setStatus(status: 'active' | 'paused' | 'ended') {
    if (busy) return;
    if (status === 'ended' && !window.confirm(t('mg.camp.confirmEnd'))) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('megastore_set_campaign_status', { p_status: status });
    setBusy(false);
    if (e) setError(t(megaErrKey(e.message)));
    await load();
  }

  async function review(id: string, approve: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.rpc('megastore_review_reward', { p_reward_id: id, p_approve: approve, p_note: null });
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

  if (d === null) return <div className="mx-auto h-40 max-w-2xl animate-pulse rounded-2xl bg-ink/10 mt-6" />;

  const c = d.campaign;
  const open = !!c && c.status !== 'ended';
  const approved = store?.status === 'approved';
  const st = d.stats;
  const dates = c ? t('mg.camp.dates', { a: fmtDate(istDayOf(c.starts_at), lang), b: fmtDate(istDayOf(c.ends_at), lang) }) : '';

  return (
    <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">{t('mg.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('mg.title')}</h1>
      <p className="rounded-xl bg-ink/5 p-3 text-sm">{t('mg.fundNote')}</p>
      <Msg error={error} />

      {!store && (
        <Section title={t('mg.create.title')}>
          <p className="text-sm text-ink/80">{t('mg.create.sub')}</p>
          <StoreForm store={null} onDone={() => void load()} />
        </Section>
      )}

      {store && (
        <>
          <div className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div><h2 className="font-semibold">{store.name}</h2>{store.city && <p className="text-sm text-ink/70">{store.city}</p>}</div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${approved ? 'bg-green-100 text-green-900' : store.status === 'pending_review' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900'}`}>{t(`mg.status.${store.status}`)}</span>
            </div>
            {store.status === 'pending_review' && <p className="text-sm">{t('mg.pendingNote')}</p>}
            {store.status === 'rejected' && <p className="rounded-xl bg-red-50 p-3 text-sm">{t('mg.rejectedNote')}{store.rejection_reason ? ` ${store.rejection_reason}` : ''}</p>}
            {store.status === 'suspended' && <p className="rounded-xl bg-red-50 p-3 text-sm">{t('mg.suspendedNote')}{store.rejection_reason ? ` ${store.rejection_reason}` : ''}</p>}
          </div>

          {approved && (
            <Section title={t('mg.redeem.title')}>
              <p className="text-sm text-ink/80">{t('mg.redeem.hint')}</p>
              <form onSubmit={openRedeem} className="flex gap-2">
                <input aria-label={t('mg.redeem.code')} placeholder="MS-XXXXXXXX" className="input flex-1 font-mono uppercase" value={code} maxLength={16} onChange={(e) => setCode(e.target.value)} />
                <button type="submit" className="btn-solid" disabled={!code.trim()}>{t('mg.redeem.open')}</button>
              </form>
            </Section>
          )}

          {approved && (
            <Section title={t('mg.camp.title')}>
              {open && c && (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="font-semibold">{c.title}</h3><p className="text-sm text-ink/70">{dates}</p></div>
                    <span className="inline-block rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`mg.camp.status.${c.status}`)}</span>
                  </div>
                  <p className="font-display text-xl font-semibold">{rewardLabel(c.reward_type, c.reward_value, c.max_discount_inr, t)}</p>
                  <div className="flex flex-wrap gap-2">
                    {c.status === 'draft' && <button type="button" className="btn-solid" disabled={busy || d.shops.length === 0} onClick={() => void setStatus('active')}>{t('mg.camp.start')}</button>}
                    {c.status === 'paused' && <button type="button" className="btn-solid" disabled={busy} onClick={() => void setStatus('active')}>{t('mg.camp.resume')}</button>}
                    {c.status === 'active' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setStatus('paused')}>{t('mg.camp.pause')}</button>}
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setStatus('ended')}>{t('mg.camp.end')}</button>
                  </div>
                  {c.status === 'draft' && d.shops.length === 0 && <p className="text-sm text-amber-800">{t('mg.camp.noShopsToStart')}</p>}
                  {c.status !== 'draft' && <p className="text-xs text-ink/70">{t('mg.camp.lockedNote')}</p>}
                </div>
              )}
              {(!open || c?.status === 'draft') && (
                <div className="space-y-3">
                  <h3 className="font-semibold">{open ? t('mg.camp.edit') : t('mg.camp.new')}</h3>
                  <MegaCampaignForm key={c?.id ?? 'new'} draft={open ? c : null} onSaved={() => void load()} />
                </div>
              )}
            </Section>
          )}

          {approved && open && (
            <Section title={t('mg.shops.title')}>
              <MegaPartnerShops shops={d.shops} onChanged={() => void load()} />
            </Section>
          )}

          {approved && open && (
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

          {approved && c && (
            <Section title={t('mg.stats.title')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label={t('mg.stats.enrolled')} value={st.enrolled ?? 0} />
                <Stat label={t('mg.stats.issued')} value={st.issued ?? 0} />
                <Stat label={t('mg.stats.active')} value={st.active ?? 0} />
                <Stat label={t('mg.stats.redeemed')} value={st.redeemed ?? 0} />
                <Stat label={t('mg.stats.expired')} value={st.expired ?? 0} />
                <Stat label={t('mg.stats.onHold')} value={st.on_hold ?? 0} />
                <Stat label={t('mg.stats.discount')} value={rupees(st.discount_given_inr ?? 0)} />
                <Stat label={t('mg.stats.bills')} value={rupees(st.bills_inr ?? 0)} />
              </div>
            </Section>
          )}

          {approved && d.held.length > 0 && (
            <Section title={t('mg.held.title')}>
              <p className="text-sm text-ink/80">{t('mg.held.hint')}</p>
              <ul className="space-y-3">
                {d.held.map((h) => (
                  <li key={h.id} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-sm"><strong>{h.customer_name || '—'}</strong> · {h.business_name}</p>
                    <p className="text-xs text-ink/70">{h.risk_flags.map((f) => t(`mg.flag.${f}`)).join(', ')}</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn-solid" disabled={busy} onClick={() => void review(h.id, true)}>{t('mg.held.approve')}</button>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void review(h.id, false)}>{t('mg.held.reject')}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {approved && c && (
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

          {!approved && store.status !== 'suspended' && (
            <Section title={t('mg.create.title')}>
              <StoreForm store={store} onDone={() => void load()} />
            </Section>
          )}
          {approved && (
            <Section title={t('mg.f.name')}>
              <StoreForm store={store} onDone={() => void load()} />
            </Section>
          )}
        </>
      )}
    </section>
  );
}
