import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { BANNER_BUCKET, signedUrlMap } from '../lib/storage';
import { supabase } from '../lib/supabase';

interface Ban { banner_id: string; business_id: string; business_name: string; title: string; image_path: string }

export default function BannerStrip({ lat, lng }: { lat: number; lng: number }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Ban[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc('active_banners', { p_lat: lat, p_lng: lng });
      if (!alive || error) return;
      const list = (data ?? []) as Ban[];
      setRows(list);
      const m = await signedUrlMap(list.map((b) => b.image_path), BANNER_BUCKET);
      if (alive) setUrls(m);
    })();
    return () => { alive = false; };
  }, [lat, lng]);

  if (rows.length === 0) return null;
  return (
    <section aria-label={t('p8.sponsored')} className="space-y-1">
      <p className="text-xs text-ink/60">{t('p8.sponsored')}</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {rows.map((b) => (
          <Link key={b.banner_id} to={`/b/${b.business_id}?src=search`} className="relative block h-32 w-64 flex-none overflow-hidden rounded-2xl bg-ink/10">
            {urls[b.image_path] && <img src={urls[b.image_path]} alt={b.title} loading="lazy" className="h-full w-full object-cover" />}
            <span className="absolute inset-x-0 bottom-0 truncate bg-ink/60 px-3 py-1.5 text-sm font-medium text-cream">{b.title} · {b.business_name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
