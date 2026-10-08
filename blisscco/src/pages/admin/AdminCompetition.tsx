import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fmtDateTime, rupees } from '../../lib/format';
import { addDaysLocal, isoToLocalInput, localInputToIso, type LeaderRow } from '../../lib/shopReferral';
import { supabase } from '../../lib/supabase';

interface Comp {
  id: string; title: string; description: string | null; status: 'draft' | 'active' | 'paused' | 'ended';
  starts_at: string; ends_at: string; reward_amount_inr: number; winner_business_name: string | null; winner_referral_count: number | null;
}
interface RefRow {
  id: string; status: 'pending' | 'qualified' | 'rejected' | 'revoked'; created_at: string; competition_id: string | null;
  referrer_business: string | null; referred_owner_name: string | null; business_id: string | null; business_name: string | null; business_phone: string | null;
  profile_complete: boolean; phone_verified: boolean; approved: boolean; reject_reason: string | null; revoked_reason: string | null;
}
interface Form { id: string | null; title: string; desc: string; start: string; end: string; prize: string }

const KNOWN_ERRORS = ['another_live', 'invalid_dates', 'ends_in_past', 'invalid_reward', 'already_ended', 'invalid_state', 'no_phone', 'reason_required'];
const inputCls = 'input';

function blankForm(): Form {
  const start = isoToLocalInput(new Date().toISOString());
  return { id: null, title: '', desc: '', start, end: addDaysLocal(start, 7), prize: '1000' };
}

function Step({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-green-100 text-green-900' : 'bg-ink/10 text-ink/70'}`}>{ok ? '✓' : '○'} {label}</span>;
}

export default function AdminCompetition() {
  const { t, lang } = useI18n();
  const [comps, setComps] = useState<Comp[]>([]);
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [form, setForm] = useState<Form>(blankForm);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([supabase.rpc('admin_list_shop_competitions'), supabase.rpc('admin_shop_referral_overview', { p_limit: 100 })]);
    const list = (c.data ?? []) as Comp[];
    setComps(list);
    setRefs((r.data ?? []) as RefRow[]);
    const liveOne = list.find((x) => x.status === 'active' || x.status === 'paused');
    if (liveOne) {
      const lb = await supabase.rpc('get_shop_competition_leaderboard', { p_competition_id: liveOne.id, p_limit: 20 });
      setBoard((lb.data ?? []) as LeaderRow[]);
    } else setBoard([]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    if (busy) return;
    setBusy(true); setMsg({ error: '', ok: '' });
    const { error } = await fn();
    setBusy(false);
    if (error) {
      console.error(error);
      const k = KNOWN_ERRORS.find((e) => error.message.includes(e));
      setMsg({ error: t(k ? `sa.err.${k}` : 'err.generic'), ok: '' });
    } else { setMsg({ error: '', ok: t('admin.done') }); after?.(); }
    await load();
  }

  function save() {
    const prize = Number(form.prize);
    if (form.title.trim().length < 3 || form.title.trim().length > 100) { setMsg({ error: t('sa.err.title'), ok: '' }); return; }
    if (!form.start || !form.end || new Date(localInputToIso(form.end)) <= new Date(localInputToIso(form.start))) { setMsg({ error: t('sa.err.invalid_dates'), ok: '' }); return; }
    if (!(prize > 0)) { setMsg({ error: t('sa.err.invalid_reward'), ok: '' }); return; }
    void run(() => supabase.rpc('admin_save_shop_competition', {
      p_id: form.id, p_title: form.title, p_description: form.desc, p_starts_at: localInputToIso(form.start), p_ends_at: localInputToIso(form.end), p_reward_inr: prize,
    }), () => setForm(blankForm()));
  }

  function act(c: Comp, action: 'start' | 'pause' | 'resume' | 'end' | 'delete') {
    if (action === 'end' && !window.confirm(t('sa.confirmEnd'))) return;
    if (action === 'delete' && !window.confirm(t('sa.confirmDelete'))) return;
    void run(() => supabase.rpc('admin_set_shop_competition_status', { p_id: c.id, p_action: action }));
  }

  function edit(c: Comp) {
    setForm({ id: c.id, title: c.title, desc: c.description ?? '', start: isoToLocalInput(c.starts_at), end: isoToLocalInput(c.ends_at), prize: String(c.reward_amount_inr) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const label = (s: Comp['status']) => t(s === 'draft' ? 'sa.draft' : s === 'active' ? 'sc.live' : s === 'paused' ? 'sc.paused' : 'sc.ended');

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('sa.title')}</h1>
      <Msg error={msg.error} ok={msg.ok} />

      <Section title={form.id ? t('sa.formEdit') : t('sa.formNew')}>
        <Field id="ct" label={t('sa.fTitle')} value={form.title} onChange={(v) => setForm({ ...form, title: v })} disabled={busy} />
        <Field id="cd" label={t('sa.fDesc')} value={form.desc} onChange={(v) => setForm({ ...form, desc: v })} disabled={busy} />
        <div className="space-y-1.5">
          <label htmlFor="cs" className="text-sm font-medium">{t('sa.fStart')}</label>
          <input id="cs" type="datetime-local" className={inputCls} value={form.start} disabled={busy} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ce" className="text-sm font-medium">{t('sa.fEnd')}</label>
          <input id="ce" type="datetime-local" className={inputCls} value={form.end} disabled={busy} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink/70">{t('sa.quick')}:</span>
          {[7, 15, 30].map((n) => (
            <button key={n} type="button" className="btn-secondary" disabled={busy || !form.start} onClick={() => setForm({ ...form, end: addDaysLocal(form.start, n) })}>{t('sa.days', { n })}</button>
          ))}
        </div>
        <Field id="cp" label={t('sa.fPrize')} value={form.prize} onChange={(v) => setForm({ ...form, prize: v.replace(/[^0-9.]/g, '') })} disabled={busy} />
        <p className="text-xs text-ink/60">{t('sc.prizeNote')}</p>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>{form.id ? t('sa.saveChanges') : t('sa.saveNew')}</button>
        {form.id && <button className="btn-secondary w-full" disabled={busy} onClick={() => setForm(blankForm())}>{t('sa.cancelEdit')}</button>}
      </Section>

      <Section title={t('sa.list')}>
        {comps.length === 0 && <p className="text-sm text-ink/70">{t('sa.empty')}</p>}
        <ul className="space-y-3">
          {comps.map((c) => (
            <li key={c.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.title}</span>
                <span className="rounded-full bg-blush/30 px-3 py-1 text-xs font-semibold">{label(c.status)}</span>
              </div>
              <p className="text-ink/70">{fmtDateTime(c.starts_at, lang)} → {fmtDateTime(c.ends_at, lang)} · {t('sc.prizeValue', { amt: rupees(c.reward_amount_inr) })}</p>
              {c.status === 'ended' && <p className="font-medium">{c.winner_business_name ? t('sa.winnerLine', { name: c.winner_business_name, n: c.winner_referral_count ?? 0 }) : t('sa.noWinner')}</p>}
              <div className="flex flex-wrap gap-2">
                {c.status === 'draft' && <button className="btn-solid" disabled={busy} onClick={() => act(c, 'start')}>{t('sa.btnStart')}</button>}
                {c.status === 'active' && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'pause')}>{t('sa.btnPause')}</button>}
                {c.status === 'paused' && <button className="btn-solid" disabled={busy} onClick={() => act(c, 'resume')}>{t('sa.btnResume')}</button>}
                {(c.status === 'active' || c.status === 'paused') && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'end')}>{t('sa.btnEnd')}</button>}
                {c.status !== 'ended' && <button className="btn-secondary" disabled={busy} onClick={() => edit(c)}>{t('sa.btnEdit')}</button>}
                {c.status === 'draft' && <button className="btn-secondary" disabled={busy} onClick={() => act(c, 'delete')}>{t('sa.btnDelete')}</button>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {board.length > 0 && (
        <Section title={t('sa.standings')}>
          <ol className="divide-y divide-ink/10 text-sm">
            {board.map((r) => (
              <li key={r.rank} className="flex items-center gap-3 py-2"><span className="w-10">#{r.rank}</span><span className="min-w-0 flex-1 truncate">{r.business_name}</span><span className="font-semibold">{r.referrals}</span></li>
            ))}
          </ol>
        </Section>
      )}

      <Section title={t('sa.refChecks')}>
        <p className="text-sm text-ink/70">{t('sa.refHelp')}</p>
        <Field id="rr" label={t('sa.reason')} value={reason} onChange={setReason} disabled={busy} />
        {refs.length === 0 && <p className="text-sm text-ink/70">{t('sc.noReferrals')}</p>}
        <ul className="space-y-3">
          {refs.map((r) => (
            <li key={r.id} className="space-y-2 rounded-xl border border-ink/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.business_name ?? t('sa.noBusiness')}</span>
                <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">{r.status === 'qualified' ? t(r.competition_id ? 'sc.state.counted' : 'sc.state.valid') : t(`sc.state.${r.status}`)}</span>
              </div>
              <p className="text-xs text-ink/70">{t('sa.owner')}: {r.referred_owner_name ?? '—'} · {t('sa.referredBy', { name: r.referrer_business ?? '—' })} · {fmtDateTime(r.created_at, lang)}</p>
              {r.business_phone && <p className="text-xs">{r.business_phone}</p>}
              <div className="flex flex-wrap gap-1.5">
                <Step ok={r.profile_complete} label={t('sc.step.profile')} />
                <Step ok={r.phone_verified} label={t('sc.step.phone')} />
                <Step ok={r.approved} label={t('sc.step.approved')} />
              </div>
              {(r.reject_reason || r.revoked_reason) && <p className="text-xs text-red-700">{r.reject_reason ? t(`sc.reason.${r.reject_reason}`) : r.revoked_reason}</p>}
              <div className="flex flex-wrap gap-2">
                {r.business_id && !r.phone_verified && r.status === 'pending' && (
                  <button className="btn-solid" disabled={busy} onClick={() => void run(() => supabase.rpc('admin_set_business_phone_verified', { p_business_id: r.business_id, p_verified: true }))}>{t('sa.markPhone')}</button>
                )}
                {r.business_id && r.phone_verified && r.status === 'pending' && (
                  <button className="btn-secondary" disabled={busy} onClick={() => void run(() => supabase.rpc('admin_set_business_phone_verified', { p_business_id: r.business_id, p_verified: false }))}>{t('sa.unmarkPhone')}</button>
                )}
                {r.status === 'qualified' && (
                  <button className="btn-secondary" disabled={busy || reason.trim().length < 3} onClick={() => void run(() => supabase.rpc('admin_revoke_shop_referral', { p_id: r.id, p_reason: reason }))}>{t('sa.revoke')}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
