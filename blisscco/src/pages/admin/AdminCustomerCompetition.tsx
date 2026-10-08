import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import RankBadge from '../../components/RankBadge';
import { Msg, Section, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime, rupees } from '../../lib/format';
import type { CcRule, CcStatus, PromoBalance } from '../../lib/customerCompetition';
import { addDaysLocal, isoToLocalInput, localInputToIso } from '../../lib/shopReferral';
import { supabase } from '../../lib/supabase';

interface Comp {
  id: string; title: string; description: string | null; status: CcStatus; starts_at: string; ends_at: string; reward_amount_inr: number;
  sponsor_business_id: string | null; sponsor_business_name: string | null; reward_valid_days: number; eligibility_rule: CcRule; min_booking_value_inr: number;
  winner_name: string | null; winner_referral_count: number | null; reward_issued_at: string | null;
}
interface Standing { rank: number; full_name: string; referrals: number }
interface WinnerCheck {
  status: string; reward_amount_inr: number; already_issued: boolean; frozen_at: string | null; validated_at: string | null;
  frozen_ranking: { pos: number; name: string; referrals: number }[];
  has_winner: boolean; winner_id: string | null; winner_name: string | null; winner_referrals: number | null; winner_changed_since_freeze: boolean;
  winner_referral_list: { id: string; referred_name: string; business_name: string | null; price: number | null; qualified_at: string; risk_status: string }[];
  top: { rank: number; name: string; referrals: number }[]; unresolved_review: number; rejected_count: number; fraud_count: number; can_issue: boolean;
}
interface AuditRow { id: string; entity_type: string; action: string; from_state: string | null; to_state: string | null; note: string | null; actor_name: string | null; created_at: string }
interface Shop { id: string; name: string; city: string | null }
interface AdminBalance extends Omit<PromoBalance, 'id' | 'created_at'> { id: string; customer_name: string }
interface Form { id: string | null; title: string; desc: string; start: string; end: string; prize: string; sponsor: string; rule: CcRule; min: string; days: string }

const KNOWN_ERRORS = ['another_live', 'invalid_dates', 'ends_in_past', 'invalid_reward', 'already_ended', 'invalid_state', 'reason_required', 'invalid_sponsor', 'invalid_rule',
  'competition_closed', 'already_awarded', 'unresolved_review', 'no_winner', 'not_frozen', 'winner_required', 'competition_locked', 'winner_exists', 'winner_changed', 'winner_not_eligible'];

function blankForm(): Form {
  const start = isoToLocalInput(new Date().toISOString());
  return { id: null, title: '', desc: '', start, end: addDaysLocal(start, 30), prize: '1000', sponsor: '', rule: 'completed_booking', min: '0', days: '90' };
}

export default function AdminCustomerCompetition() {
  const { t, lang } = useI18n();
  const [comps, setComps] = useState<Comp[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [form, setForm] = useState<Form>(blankForm);
  const [focus, setFocus] = useState<string | null>(null);     // competition whose standings / referrals are shown
  const [board, setBoard] = useState<Standing[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [note, setNote] = useState('');
  const [check, setCheck] = useState<WinnerCheck | null>(null);
  const [balances, setBalances] = useState<AdminBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async () => {
    const [c, s, b] = await Promise.all([
      supabase.rpc('admin_list_customer_competitions'),
      supabase.from('businesses').select('id,name,city').eq('status', 'approved').order('name').limit(300),
      supabase.rpc('admin_promo_balances'),
    ]);
    const list = (c.data ?? []) as Comp[];
    setComps(list);
    setShops((s.data ?? []) as Shop[]);
    setBalances((b.data ?? []) as AdminBalance[]);
    const pick = list.find((x) => x.status === 'active' || x.status === 'paused' || x.status === 'pending_verification') ?? list[0];
    setFocus((cur) => (cur && list.some((x) => x.id === cur) ? cur : pick?.id ?? null));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadFocus = useCallback(async () => {
    if (!focus) { setBoard([]); setAudit([]); setCheck(null); return; }
    const comp = comps.find((x) => x.id === focus);
    // when the competition waits for its winner, the eligibility / fraud validation runs first (server side), then the check is read
    if (comp?.status === 'pending_verification') await supabase.rpc('admin_refresh_customer_winner', { p_id: focus });
    const [lb, au] = await Promise.all([
      supabase.rpc('admin_customer_standings', { p_competition_id: focus }),
      supabase.rpc('admin_customer_comp_audit', { p_competition_id: focus, p_limit: 30 }),
    ]);
    setBoard((lb.data ?? []) as Standing[]);
    setAudit((au.data ?? []) as AuditRow[]);
    if (comp && (comp.status === 'pending_verification' || comp.status === 'ended')) {
      const ck = await supabase.rpc('admin_customer_winner_check', { p_id: focus });
      setCheck((ck.data ?? null) as WinnerCheck | null);
    } else setCheck(null);
  }, [focus, comps]);
  useEffect(() => { void loadFocus(); }, [loadFocus]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) {
      console.error(error);
      const k = KNOWN_ERRORS.find((e) => error.message.includes(e));
      setMsg({ error: t(k ? `cc.err.${k}` : 'err.generic'), ok: '' });
    } else { setMsg({ error: '', ok: t('admin.done') }); after?.(); }
    await load();
    await loadFocus();
  }

  function save() {
    const prize = Number(form.prize); const min = Number(form.min || 0); const days = Number(form.days);
    if (form.title.trim().length < 3 || form.title.trim().length > 100) { setMsg({ error: t('sa.err.title'), ok: '' }); return; }
    if (!form.start || !form.end || new Date(localInputToIso(form.end)) <= new Date(localInputToIso(form.start))) { setMsg({ error: t('cc.err.invalid_dates'), ok: '' }); return; }
    if (!(prize > 0)) { setMsg({ error: t('cc.err.invalid_reward'), ok: '' }); return; }
    if (!(days >= 1 && days <= 730) || !(min >= 0)) { setMsg({ error: t('err.generic'), ok: '' }); return; }
    void run(() => supabase.rpc('admin_save_customer_competition', {
      p_id: form.id, p_title: form.title, p_description: form.desc, p_starts_at: localInputToIso(form.start), p_ends_at: localInputToIso(form.end),
      p_reward_inr: prize, p_sponsor_business_id: form.sponsor || null, p_rule: form.rule, p_min_booking_inr: min, p_valid_days: Math.round(days),
    }), () => setForm(blankForm()));
  }

  function act(c: Comp, action: 'start' | 'pause' | 'resume' | 'end' | 'delete') {
    if (action === 'end' && !window.confirm(t('cc.confirmEnd'))) return;
    if (action === 'delete' && !window.confirm(t('sa.confirmDelete'))) return;
    void run(() => supabase.rpc('admin_set_customer_competition_status', { p_id: c.id, p_action: action }));
  }

  function edit(c: Comp) {
    setForm({
      id: c.id, title: c.title, desc: c.description ?? '', start: isoToLocalInput(c.starts_at), end: isoToLocalInput(c.ends_at), prize: String(c.reward_amount_inr),
      sponsor: c.sponsor_business_id ?? '', rule: c.eligibility_rule, min: String(c.min_booking_value_inr), days: String(c.reward_valid_days),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function confirmWinner(c: Comp) {
    if (!check?.winner_id || busy) return;
    if (!window.confirm(t('cc.confirmAward', { amt: rupees(check.reward_amount_inr), name: check.winner_name ?? '—' }))) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    // the server recomputes the winner and the amount; the browser only says WHICH winner the admin saw
    const { data, error } = await supabase.rpc('admin_confirm_customer_winner', { p_id: c.id, p_winner_id: check.winner_id, p_note: note || null });
    setBusy(false);
    if (error) {
      console.error(error);
      const k = KNOWN_ERRORS.find((e) => error.message.includes(e));
      setMsg({ error: t(k ? `cc.err.${k}` : 'err.generic'), ok: '' });
    } else if (!(data as { awarded?: boolean } | null)?.awarded) {
      const reason = (data as { reason?: string } | null)?.reason ?? '';
      setMsg({ error: t(KNOWN_ERRORS.includes(reason) ? `cc.err.${reason}` : 'err.generic'), ok: '' });
    } else { setMsg({ error: '', ok: t('cf.awarded') }); setNote(''); }
    await load();
    await loadFocus();
  }

  const label = (s: CcStatus) => t(s === 'draft' ? 'sa.draft' : s === 'active' ? 'cc.on' : s === 'paused' ? 'cc.off' : s === 'pending_verification' ? 'cc.verifying' : 'sc.ended');
  const focusComp = comps.find((x) => x.id === focus) ?? null;
  const pendingComp = comps.find((x) => x.status === 'pending_verification') ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('cc.adminTitle')}</h1>
      <Msg error={msg.error} ok={msg.ok} />

      {pendingComp && check && (
        <Section title={t('cc.verifyTitle')}>
          <p className="text-sm text-ink/70">{t('cc.verifyHelp')}</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink/70">
            <li>{t('cf.step1', { d: check.frozen_at ? fmtDateTime(check.frozen_at, lang) : '—' })}</li>
            <li>{t('cf.step2', { d: check.validated_at ? fmtDateTime(check.validated_at, lang) : '—' })}</li>
            <li>{t('cf.step3')}</li>
            <li>{t('cf.step4')}</li>
          </ol>
          {check.frozen_ranking.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold">{t('cf.frozenBoard')}</p>
              <ol className="text-xs text-ink/80">{check.frozen_ranking.slice(0, 3).map((r) => <li key={r.pos}>#{r.pos} {r.name} — {r.referrals}</li>)}</ol>
            </div>
          )}
          <p className="text-xs text-ink/70">{t('cf.counts', { rej: check.rejected_count, fraud: check.fraud_count })}</p>
          <Link to="/admin/customer-competition/fraud" className="btn-secondary inline-flex">{t('cf.openReview')}</Link>
          {check.has_winner ? (
            <>
              {check.winner_changed_since_freeze && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{t('cf.winnerChanged')}</p>}
              <div className="flex items-center gap-3"><RankBadge rank={1} size={56} /><div><p className="font-semibold">{t('cc.verifyWinner', { name: check.winner_name ?? '—', n: check.winner_referrals ?? 0 })}</p><p className="text-xs text-ink/70">{t('cc.verifyAmount', { amt: rupees(check.reward_amount_inr) })}</p></div></div>
              <ol className="divide-y divide-ink/10 text-sm">
                {check.top.map((r) => <li key={r.rank} className="flex items-center gap-3 py-2"><span className="flex w-12 items-center"><RankBadge rank={r.rank} size={30} /></span><span className="min-w-0 flex-1 truncate">{r.name}</span><span className="font-semibold">{r.referrals}</span></li>)}
              </ol>
              {check.unresolved_review > 0 && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{t('cc.unresolved', { n: check.unresolved_review })}</p>}
              {check.winner_referral_list.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {check.winner_referral_list.map((w) => <li key={w.id} className="rounded-lg bg-ink/5 px-2 py-1">{w.referred_name} · {w.business_name ?? '—'}{w.price != null ? ` · ${rupees(w.price)}` : ''} · {fmtDateTime(w.qualified_at, lang)}</li>)}
                </ul>
              )}
              <Field id="wn" label={t('cc.noteOpt')} value={note} onChange={setNote} disabled={busy} />
              <button className="btn-primary w-full" disabled={busy || !check.can_issue} onClick={() => void confirmWinner(pendingComp)}>{t('cc.confirmWinnerBtn')}</button>
            </>
          ) : (
            <>
              <p className="text-sm">{t('cc.noWinnerYet')}</p>
              <button className="btn-secondary w-full" disabled={busy || check.unresolved_review > 0} onClick={() => void run(() => supabase.rpc('admin_close_customer_competition_no_winner', { p_id: pendingComp.id, p_note: note || null }))}>{t('cc.closeNoWinner')}</button>
            </>
          )}
        </Section>
      )}

      <Section title={form.id ? t('cc.formEdit') : t('cc.formNew')}>
        <p className="text-xs text-ink/60">{t('cc.offByDefault')}</p>
        <Field id="cct" label={t('sa.fTitle')} value={form.title} onChange={(v) => setForm({ ...form, title: v })} disabled={busy} />
        <Field id="ccd" label={t('sa.fDesc')} value={form.desc} onChange={(v) => setForm({ ...form, desc: v })} disabled={busy} />
        <div className="space-y-1.5">
          <label htmlFor="ccs" className="text-sm font-medium">{t('sa.fStart')}</label>
          <input id="ccs" type="datetime-local" className="input" value={form.start} disabled={busy} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cce" className="text-sm font-medium">{t('sa.fEnd')}</label>
          <input id="cce" type="datetime-local" className="input" value={form.end} disabled={busy} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink/70">{t('sa.quick')}:</span>
          {[7, 15, 30].map((n) => <button key={n} type="button" className="btn-secondary" disabled={busy || !form.start} onClick={() => setForm({ ...form, end: addDaysLocal(form.start, n) })}>{t('sa.days', { n })}</button>)}
        </div>
        <Select id="ccr" label={t('cc.fRule')} value={form.rule} onChange={(v) => setForm({ ...form, rule: v as CcRule })} disabled={busy}
          options={[{ value: 'completed_booking', label: t('cc.rule.completed') }, { value: 'confirmed_booking', label: t('cc.rule.confirmed') }]} />
        <Field id="ccm" label={t('cc.fMin')} value={form.min} onChange={(v) => setForm({ ...form, min: v.replace(/[^0-9.]/g, '') })} disabled={busy} />
        <Field id="ccp" label={t('cc.fPrize')} value={form.prize} onChange={(v) => setForm({ ...form, prize: v.replace(/[^0-9.]/g, '') })} disabled={busy} />
        <Select id="ccsp" label={t('cc.fSponsor')} value={form.sponsor} onChange={(v) => setForm({ ...form, sponsor: v })} disabled={busy} placeholder={t('cc.anyShop')}
          options={shops.map((s) => ({ value: s.id, label: s.city ? `${s.name} (${s.city})` : s.name }))} />
        <Field id="ccv" label={t('cc.fValid')} value={form.days} onChange={(v) => setForm({ ...form, days: v.replace(/[^0-9]/g, '') })} disabled={busy} />
        <p className="text-xs text-ink/60">{t('cc.prizeNote')}</p>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>{form.id ? t('sa.saveChanges') : t('sa.saveNew')}</button>
        {form.id && <button className="btn-secondary w-full" disabled={busy} onClick={() => setForm(blankForm())}>{t('sa.cancelEdit')}</button>}
      </Section>

      <Section title={t('cc.list')}>
        {comps.length === 0 && <p className="text-sm text-ink/70">{t('sa.empty')}</p>}
        <ul className="space-y-3">
          {comps.map((c) => (
            <li key={c.id} className={`space-y-2 rounded-xl border p-3 text-sm ${c.id === focus ? 'border-ink/40' : 'border-ink/10'}`}>
              <div className="flex items-center justify-between gap-2">
                <button className="text-left font-semibold" onClick={() => setFocus(c.id)}>{c.title}</button>
                <span className="rounded-full bg-blush/30 px-3 py-1 text-xs font-semibold">{label(c.status)}</span>
              </div>
              <p className="text-ink/70">{fmtDateTime(c.starts_at, lang)} → {fmtDateTime(c.ends_at, lang)} · {t('cc.prizeValue', { amt: rupees(c.reward_amount_inr) })}</p>
              <p className="text-xs text-ink/70">{t(c.eligibility_rule === 'completed_booking' ? 'cc.rule.completed' : 'cc.rule.confirmed')} · {t('cc.fMin')}: {rupees(c.min_booking_value_inr)} · {c.sponsor_business_name ? t('cc.onlyAt', { shop: c.sponsor_business_name }) : t('cc.anyShop')}</p>
              {c.status === 'ended' && <p className="font-medium">{c.winner_name ? t('cc.adminWinnerLine', { name: c.winner_name, n: c.winner_referral_count ?? 0 }) : t('cc.noWinner')}</p>}
              <div className="flex flex-wrap gap-2">
                {c.status === 'draft' && <button className="btn-solid" disabled={busy} onClick={() => act(c, 'start')}>{t('cc.turnOn')}</button>}
                {c.status === 'active' && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'pause')}>{t('cc.turnOff')}</button>}
                {c.status === 'paused' && <button className="btn-solid" disabled={busy} onClick={() => act(c, 'resume')}>{t('cc.turnOn')}</button>}
                {(c.status === 'active' || c.status === 'paused') && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'end')}>{t('cc.btnEnd')}</button>}
                {(c.status === 'draft' || c.status === 'active' || c.status === 'paused') && <button className="btn-secondary" disabled={busy} onClick={() => edit(c)}>{t('sa.btnEdit')}</button>}
                {c.status === 'draft' && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'delete')}>{t('sa.btnDelete')}</button>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {focusComp && (
        <>
          <Section title={`${t('sa.standings')} — ${focusComp.title}`}>
            {board.length === 0 && <p className="text-sm text-ink/70">{t('cc.noEntries')}</p>}
            <ol className="divide-y divide-ink/10 text-sm">
              {board.map((r) => <li key={r.rank} className="flex items-center gap-3 py-2"><span className="flex w-12 items-center"><RankBadge rank={r.rank} size={34} /></span><span className="min-w-0 flex-1 truncate">{r.full_name}</span><span className="font-semibold">{r.referrals}</span></li>)}
            </ol>
          </Section>

          <Section title={t('cc.refChecks')}>
            <p className="text-sm text-ink/70">{t('cf.help')}</p>
            <Link to="/admin/customer-competition/fraud" className="btn-solid inline-flex">{t('cf.openReview')}</Link>
          </Section>

          <Section title={t('cf.auditTitle')}>
            {audit.length === 0 && <p className="text-sm text-ink/70">{t('cf.noHistory')}</p>}
            <ol className="space-y-1.5 text-xs">
              {audit.map((e) => (
                <li key={e.id}>
                  <span className="font-semibold">{t(`cf.audit.${e.action}`)}</span> · {e.actor_name ?? t('cf.system')} · {fmtDateTime(e.created_at, lang)}
                  {e.note ? <span className="block text-ink/70">{e.note}</span> : null}
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Section title={t('cc.promoList')}>
        {balances.length === 0 && <p className="text-sm text-ink/70">{t('cc.noBalance')}</p>}
        <ul className="space-y-2">
          {balances.map((b) => (
            <li key={b.id} className="space-y-1 rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold">{b.code}</span><span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{t(`cc.bal.${b.state}`)}</span></div>
              <p>{b.customer_name} · {t('cc.totalUsed', { total: rupees(b.amount_inr), used: rupees(b.used_inr) })} · {rupees(b.remaining_inr)} {t('cc.remaining')}</p>
              <p className="text-xs text-ink/70">{b.competition_title ?? '—'} · {b.sponsor_business_name ? t('cc.onlyAt', { shop: b.sponsor_business_name }) : t('cc.anyShop')} · {t('cp.expires', { d: fmtDateTime(b.expires_at, lang) })}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
