import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import BookingPanel from '../components/BookingPanel';
import ReviewForm from '../components/ReviewForm';
import { RatingLine, ReviewsSection } from '../components/ReviewsSection';
import Skeleton from '../components/Skeleton';
import { VerifiedTick } from '../components/TierBadge';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { RETURN_KEY } from '../lib/bookingErrors';
import { sourceFromParam, trackView } from '../lib/analytics';
import { getStoredRef } from '../lib/referral';
import { directionsUrl, dowOf, hhmm, istToday, rupees } from '../lib/format';
import { signedUrlMap } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { BizImage, Hour, Service } from '../lib/types';

interface Pub {
  id: string; name: string; category_name_en: string; category_name_hi: string | null; category_name_mr: string | null;
  description: string | null; description_i18n: Record<string, string>; address_line: string | null; city: string | null;
  state: string | null; pincode: string | null; latitude: number; longitude: number; phone: string | null;
}

function WriteShopReview({ businessId, onDone }: { businessId: string; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  if (!session) {
    return <Link to="/login" className="btn-secondary w-full" onClick={() => { try { sessionStorage.setItem(RETURN_KEY, loc.pathname); } catch { /* ignore */ } }}>{t('rv.loginToReview')}</Link>;
  }
  return open
    ? <ReviewForm businessId={businessId} onDone={onDone} />
    : <button className="btn-secondary w-full" onClick={() => setOpen(true)}>{t('rv.write')}</button>;
}

export default function BusinessProfile() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t, lang } = useI18n();
  const [biz, setBiz] = useState<Pub | null | undefined>(undefined);
  const [images, setImages] = useState<BizImage[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Hour[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [rvKey, setRvKey] = useState(0);
  const [flags, setFlags] = useState<{ is_verified: boolean } | null>(null);

  useEffect(() => {
    if (!id) { setBiz(null); return; }
    let alive = true;
    void (async () => {
      const b = await supabase.from('public_businesses').select('*').eq('id', id).maybeSingle();
      if (!alive) return;
      if (b.error || !b.data) { setBiz(null); return; }
      setBiz(b.data as Pub);
      trackView(id, sourceFromParam(params.get('src'), !!getStoredRef()));   // anonymous; counted once per 30 min per visitor
      void supabase.from('public_business_flags').select('is_verified').eq('business_id', id).maybeSingle()
        .then(({ data }) => { if (alive && data) setFlags(data as { is_verified: boolean }); });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- count the visit once per shop, not when other query params change
  }, [id]);

  if (biz === undefined) return <Skeleton />;
  if (biz === null) return <p role="alert" className="p-6 text-center">{t('biz.notFound')}</p>;

  const cat = (lang === 'hi' ? biz.category_name_hi : lang === 'mr' ? biz.category_name_mr : null) || biz.category_name_en;
  const desc = biz.description_i18n?.[lang] || biz.description;

  const today = dowOf(istToday());
  const nowHm = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16);   // IST HH:MM
  const th = hours.find((h) => h.day_of_week === today);
  const openNow = !!th && !th.is_closed && !!th.opens_at && !!th.closes_at && hhmm(th.opens_at) <= nowHm && nowHm < hhmm(th.closes_at);
  const address = [biz.address_line, biz.city, biz.state, biz.pincode].filter(Boolean).join(', ');
  const minPrice = services.length ? Math.min(...services.map((s) => s.price_inr)) : null;

  return (
    <article className="mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-4">
      <div className="relative">
        {images.length > 0 ? (
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-3xl pb-1 [scrollbar-width:none]">
            {images.map((im) => urls[im.storage_path]
              ? <img key={im.id} src={urls[im.storage_path]} alt={biz.name} loading="lazy" className={`h-64 flex-none snap-center rounded-3xl object-cover ${images.length > 1 ? 'w-[85%]' : 'w-full'}`} />
              : <div key={im.id} className={`h-64 flex-none animate-pulse rounded-3xl bg-ink/10 ${images.length > 1 ? 'w-[85%]' : 'w-full'}`} />)}
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-3xl bg-gradient-to-br from-blush/40 via-blush/20 to-cream font-display text-6xl font-semibold text-ink/40" aria-hidden="true">{biz.name.slice(0, 1).toUpperCase()}</div>
        )}
        {images.length > 1 && <span className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-medium text-cream">{images.length} {t('biz.photos')}</span>}
      </div>

      <header className="card relative -mt-10 space-y-3 rounded-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blush/25 px-3 py-1 text-xs font-semibold text-ink">{cat}</span>
          {hours.length > 0 && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${openNow ? 'bg-emerald-50 text-emerald-800' : 'bg-ink/5 text-ink/70'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${openNow ? 'bg-emerald-500' : 'bg-ink/40'}`} />{openNow ? t('biz.openNow') : t('biz.closedNow')}
            </span>
          )}
        </div>
        <h1 className="flex flex-wrap items-center gap-2 font-display text-3xl font-semibold leading-tight">{biz.name}{flags?.is_verified && <VerifiedTick size={26} />}</h1>
        <RatingLine businessId={biz.id} reloadKey={rvKey} />
        {address && (
          <p className="flex items-start gap-2 text-sm text-ink/80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none text-blush" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
            <span>{address}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn-solid" href={directionsUrl(biz.latitude, biz.longitude)} target="_blank" rel="noopener noreferrer">{t('biz.directions')}</a>
          {biz.phone && <a className="btn-secondary" href={`tel:${biz.phone}`}>{t('biz.call')}</a>}
        </div>
      </header>

      {desc && (
        <section className="space-y-1.5 px-1">
          <h2 className="font-display text-xl font-semibold">{t('biz.about')}</h2>
          <p className="leading-relaxed text-ink/80">{desc}</p>
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">{t('biz.services')}</h2>
          {minPrice !== null && <p className="text-xs text-ink/60">{t('biz.from')} {rupees(minPrice)}</p>}
        </div>
        {services.length === 0 && <p className="text-sm text-ink/60">{t('biz.noServices')}</p>}
        {services.length > 0 && (
          <ul className="svc-row" aria-label={t('biz.services')}>
            {services.map((s) => (
              <li key={s.id} className="svc-pill">
                <p className="truncate text-sm font-medium">{s.name || s.service_category}</p>
                <p className="text-base font-semibold" style={{ color: '#2D2A2E' }}>{rupees(s.price_inr)}</p>
                {s.duration_minutes ? <p className="text-xs text-ink/60">{s.duration_minutes} min</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BookingPanel businessId={biz.id} services={services} hours={hours} />

      <section className="card space-y-2">
        <h2 className="font-display text-xl font-semibold">{t('biz.hours')}</h2>
        <ul className="space-y-0.5 text-sm">
          {hours.map((h) => (
            <li key={h.day_of_week} className={`flex justify-between rounded-lg px-3 py-2 ${h.day_of_week === today ? 'bg-blush/15 font-semibold' : ''}`}>
              <span>{t(`day.${h.day_of_week}`)}{h.day_of_week === today ? ` · ${t('biz.today')}` : ''}</span>
              <span>{h.is_closed ? t('ed.closed') : `${hhmm(h.opens_at)} – ${hhmm(h.closes_at)}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <WriteShopReview businessId={biz.id} onDone={async () => { setRvKey((n) => n + 1); }} />
      <ReviewsSection businessId={biz.id} reloadKey={rvKey} />
    </article>
  );
}
