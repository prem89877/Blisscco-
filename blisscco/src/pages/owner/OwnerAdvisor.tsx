import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

const SUPPORT_EMAIL = 'support.blisscco@gmail.com';
interface Msg { role: 'user' | 'assistant'; content: string }
interface Shop { id: string; name: string; status: string }
const KNOWN_ERR = ['configuration_required', 'rate_limited', 'unauthorized', 'not_owner'];
const CHIPS = ['q1', 'q2', 'q3', 'q4'];

/** AI Advisor: the shop owner chats with an AI that reads their shop's ratings, reviews, services and bookings (see api/owner-advisor.ts). */
export default function OwnerAdvisor() {
  const { t, lang } = useI18n();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void supabase.from('businesses').select('id,name,status').in('status', ['approved', 'inactive', 'pending_review']).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error(error); setShops([]); setErr(t('ad.err.generic')); return; }
        const list = (data ?? []) as Shop[];
        setShops(list);
        if (list.length) setShopId((cur) => cur || list[0].id);
      });
  }, [t]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, err]);

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || busy || !shopId) return;
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next); setText(''); setErr(''); setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setErr(t('ad.err.unauthorized')); return; }
      const r = await fetch('/api/owner-advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next.slice(-10), lang, business_id: shopId }),
      });
      const j = (await r.json().catch(() => ({}))) as { reply?: string; error?: string; detail?: string };
      if (r.ok && j.reply) setMsgs([...next, { role: 'assistant', content: j.reply }]);
      else setErr(t(j.error && KNOWN_ERR.includes(j.error) ? `ad.err.${j.error}` : 'ad.err.generic') + (j.detail ? ` (${j.detail})` : r.ok ? '' : ` (${r.status})`));
    } catch { setErr(t('ad.err.generic')); }
    finally { setBusy(false); }
  }

  if (shops !== null && shops.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="font-display text-2xl font-semibold">{t('ad.title')}</h1>
        <p className="text-ink/70">{t('ad.noShop')}</p>
        <Link to="/owner" className="btn-secondary">{t('dash.owner')}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t('ad.title')}</h1>
          <p className="text-sm text-ink/70">{t('ad.sub')}</p>
        </div>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-secondary flex-none text-sm">{t('sup.email')}</a>
      </div>

      {shops && shops.length > 1 && (
        <div className="mt-3">
          <Select id="adv-shop" label={t('ad.shop')} value={shopId} onChange={(v) => { setShopId(v); setMsgs([]); setErr(''); }} options={shops.map((s) => ({ value: s.id, label: s.name }))} />
        </div>
      )}

      <div className="mt-4 space-y-3 pb-4" aria-live="polite">
        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-blush/25 px-4 py-3 text-sm">{t('ad.hello')}</div>

        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button key={c} type="button" disabled={!shopId} onClick={() => void send(t(`ad.${c}`))}
                className="rounded-full border border-blush px-3.5 py-2 text-left text-sm hover:bg-blush/20 active:bg-blush/30 disabled:opacity-60">{t(`ad.${c}`)}</button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'rounded-br-md bg-ink text-cream' : 'rounded-bl-md bg-blush/25'}`}>{m.content}</div>
          </div>
        ))}

        {busy && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md bg-blush/25 px-4 py-3 text-sm text-ink/60" role="status">{t('ad.typing')}</div></div>}
        {err && (
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">
            {err} <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        )}
        <p className="text-center text-xs text-ink/50">{t('ad.disclaimer')}</p>
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(text); }}
        className="sticky z-10 -mx-4 flex items-end gap-2 border-t border-ink/10 bg-cream/95 px-4 py-2.5 backdrop-blur"
        style={{ bottom: 'calc(58px + env(safe-area-inset-bottom))' }}
      >
        <textarea
          rows={1} value={text} maxLength={500} disabled={busy || !shopId} aria-label={t('ad.placeholder')} placeholder={t('ad.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          className="input max-h-28 min-h-[44px] flex-1 resize-none"
        />
        <button type="submit" className="btn-primary min-h-[44px]" disabled={busy || !shopId || !text.trim()}>{t('sup.send')}</button>
      </form>
    </div>
  );
}
