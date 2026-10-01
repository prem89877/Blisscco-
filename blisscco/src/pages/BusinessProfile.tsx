import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BookingPanel from '../components/BookingPanel';
import Skeleton from '../components/Skeleton';
import { useI18n } from '../i18n';
import { directionsUrl, hhmm, rupees } from '../lib/format';
import { signedUrlMap } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { BizImage, Hour, Service } from '../lib/types';

interface Pub {
  id: string; name: string; category_name_en: string; category_name_hi: string | null; category_name_mr: string | null;
  description: string | null; description_i18n: Record<string, string>; address_line: string | null; city: string | null;
  state: string | null; pincode: string | null; latitude: number; longitude: number; phone: string | null;
}

export default function BusinessProfile() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [biz, setBiz] = useState<Pub | null | undefined>(undefined);
  const [images, setImages] = useState<BizImage[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Hour[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (!id) { setBiz(null); return; }
    let alive = true;
    void (async () => {
      const b = await supabase.from('public_businesses').select('*').eq('id', id).maybeSingle();
      if (!alive) return;
      if (b.error || !b.data) { setBiz(null); return; }
      setBiz(b.data as Pub);
      const [i, h, s] = await Promise.all([
        supabase.from('business_images').select('*').eq('business_id', id).order('sort_order'),
        supabase.from('business_hours').select('*').eq('business_id', id).order('day_of_week'),
        supabase.from('services').select('*').eq('business_id', id).eq('is_active', true).order('price_inr'),
      ]);
      if (!alive) return;
      const imgs = (i.data ?? []) as BizImage[];
      setImages(imgs); setHours((h.data ?? []) as Hour[]); setServices((s.data ?? []) as Service[]);
      const m = await signedUrlMap(imgs.map((x) => x.storage_path));
      if (alive) setUrls(m);
    })();
    return () => { alive = false; };
  }, [id]);

  if (biz === undefined) return <Skeleton />;
  if (biz === null) return <p role="alert" className="p-6 text-center">{t('biz.notFound')}</p>;

  const cat = (lang === 'hi' ? biz.category_name_hi : lang === 'mr' ? biz.category_name_mr : null) || biz.category_name_en;
  const desc = biz.description_i18n?.[lang] || biz.description;

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((im) => urls[im.storage_path]
          ? <img key={im.id} src={urls[im.storage_path]} alt={biz.name} loading="lazy" className="h-56 w-72 flex-none rounded-2xl object-cover" />
          : <div key={im.id} className="h-56 w-72 flex-none animate-pulse rounded-2xl bg-ink/10" />)}
      </div>
      <header>
        <p className="text-sm text-ink/70">{cat}</p>
        <h1 className="font-display text-3xl font-semibold">{biz.name}</h1>
        <p className="text-sm text-ink/70">{t('biz.noReviews')}</p>
      </header>
      {desc && <p>{desc}</p>}
      <p className="text-sm">{[biz.address_line, biz.city, biz.state, biz.pincode].filter(Boolean).join(', ')}</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary" href={directionsUrl(biz.latitude, biz.longitude)} target="_blank" rel="noopener noreferrer">{t('biz.directions')}</a>
        {biz.phone && <a className="btn-secondary" href={`tel:${biz.phone}`}>{t('biz.call')}</a>}
      </div>

      <section className="card space-y-2">
        <h2 className="font-display text-xl font-semibold">{t('biz.services')}</h2>
        <ul className="divide-y divide-ink/10">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <p className="font-medium">{s.name || s.service_category}</p>
              <p className="font-semibold">{rupees(s.price_inr)}</p>
            </li>
          ))}
        </ul>
      </section>

      <BookingPanel businessId={biz.id} services={services} hours={hours} />

      <section className="card space-y-2">
        <h2 className="font-display text-xl font-semibold">{t('biz.hours')}</h2>
        <ul className="text-sm">
          {hours.map((h) => <li key={h.day_of_week} className="flex justify-between py-1"><span>{t(`day.${h.day_of_week}`)}</span><span>{h.is_closed ? t('ed.closed') : `${hhmm(h.opens_at)} – ${hhmm(h.closes_at)}`}</span></li>)}
        </ul>
      </section>
    </article>
  );
}
