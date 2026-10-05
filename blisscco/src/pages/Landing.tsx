import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Seo, { siteOrigin } from '../components/Seo';
import { useI18n } from '../i18n';

const N = 5;
const DESC = 'Blisscco helps you discover salons, spas, tattoo studios and other beauty and personal-care businesses near you, see services and prices, and book an appointment or a walk-in token.';

export default function Landing() {
  const { t } = useI18n();
  const [i, setI] = useState(() => Math.floor(Math.random() * N));

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((v) => (v + 1) % N), 8000);
    return () => clearInterval(id);
  }, []);

  const origin = siteOrigin();
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Blisscco', url: `${origin}/`, logo: `${origin}/icons/icon-512.png` },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Blisscco', url: `${origin}/` },
  ];

  return (
    <section className="mx-auto max-w-xl px-4 py-10 text-center">
      <Seo title="Blisscco - Discover beauty & personal-care services near you" description={DESC} path="/" jsonLd={jsonLd} />
      <p className="text-sm font-medium text-ink/70">{t('app.tagline')}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">{t('landing.headline')}</h1>
      <p className="mx-auto mt-3 max-w-md text-ink/80">{t('landing.sub')}</p>

      <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
        <Link to="/explore" className="btn-primary min-h-[52px] text-base">{t('landing.browse')}</Link>
        <Link to="/owner/login" className="btn min-h-[52px] bg-ink text-base text-cream hover:bg-ink/90">{t('landing.business')}</Link>
        <Link to="/login" className="text-sm btn-text">{t('landing.customerLogin')}</Link>
      </div>

      <figure className="card mx-auto mt-10 max-w-md space-y-4 p-6">
        <span aria-hidden="true" className="font-display text-5xl leading-none text-blush">“</span>
        <blockquote className="font-display text-xl leading-snug" style={{ minHeight: '4.5rem' }}>{t(`quote.${i}`)}</blockquote>
        <div className="flex justify-center gap-1">
          {Array.from({ length: N }, (_, k) => (
            <button key={k} type="button" aria-label={t('landing.quoteN', { n: k + 1 })} aria-current={k === i}
              onClick={() => setI(k)} className="flex h-8 w-8 items-center justify-center">
              <span className={`h-2.5 w-2.5 rounded-full ${k === i ? 'bg-blush' : 'bg-ink/20'}`} />
            </button>
          ))}
        </div>
      </figure>
    </section>
  );
}
