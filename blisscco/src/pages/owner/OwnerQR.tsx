import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';

const COLORS = { dark: '#2D2A2E', light: '#FFFFFF' };

export default function OwnerQR() {
  const { id } = useParams();
  const { t } = useI18n();
  const [biz, setBiz] = useState<{ name: string; status: string } | null | undefined>(undefined);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const link = id ? `${window.location.origin}/b/${id}?src=qr` : '';

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      const { data, error: e } = await supabase.from('businesses').select('name,status').eq('id', id).maybeSingle();
      if (!alive) return;
      if (e || !data) { setBiz(null); return; }
      setBiz(data as { name: string; status: string });
      try {
        const s = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: COLORS });
        if (alive) setSvg(s);   // generated locally from our own URL; nothing is sent to any server
      } catch (err) { console.error(err); if (alive) setError(t('err.generic')); }
    })();
    return () => { alive = false; };
  }, [id, link, t]);

  async function downloadPng() {
    try {
      const url = await QRCode.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: COLORS });
      const a = document.createElement('a');
      a.href = url; a.download = 'blisscco-shop-qr.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { console.error(err); setError(t('err.generic')); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setError(''); } catch { setError(t('err.generic')); }
  }

  if (biz === undefined) return <div className="mx-auto h-40 max-w-md animate-pulse rounded-2xl bg-ink/10" />;
  if (biz === null) return <p role="alert" className="p-6 text-center">{t('biz.notFound')}</p>;

  return (
    <section className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm btn-text">{t('p9.back')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('p9.qrTitle')}</h1>
      <Msg error={error} />
      {biz.status !== 'approved' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{t('p9.qrNotLive')}</p>}
      <Section title={biz.name}>
        <div className="print-area space-y-3 text-center">
          <p className="font-display text-xl font-semibold">{biz.name}</p>
          {svg
            ? <div role="img" aria-label={t('p9.qrAlt', { name: biz.name })} className="mx-auto w-64 max-w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="mx-auto h-64 w-64 animate-pulse rounded-xl bg-ink/10" />}
          <p className="text-sm">{t('p9.qrScan')}</p>
        </div>
        <p className="break-all rounded-xl bg-ink/5 p-3 text-xs">{link}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!svg} onClick={() => void downloadPng()}>{t('p9.qrDownload')}</button>
          <button className="btn-secondary" disabled={!svg} onClick={() => window.print()}>{t('p9.qrPrint')}</button>
          <button className="btn-secondary" onClick={() => void copyLink()}>{t('p9.qrCopy')}</button>
        </div>
        <p className="text-sm text-ink/70">{t('p9.qrHint')}</p>
      </Section>
    </section>
  );
}
