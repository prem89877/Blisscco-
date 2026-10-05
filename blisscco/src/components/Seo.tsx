import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Public site address used for canonical / Open Graph URLs. Set VITE_SITE_URL in Vercel (e.g. https://www.blisscco.in). Falls back to the address the page is opened on. */
export function siteOrigin(): string {
  const env = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim().replace(/\/+$/, '');
  return env || window.location.origin;
}

const SITE_NAME = 'Blisscco';
const DEFAULT_IMAGE = '/icons/icon-512.png';

interface SeoProps {
  title: string;
  description?: string;
  /** Canonical path, e.g. "/privacy". Defaults to the current path without query string or hash. */
  path?: string;
  /** Absolute or site-relative image for link previews. */
  image?: string;
  /** Keep the page out of search results (login, dashboards, not-found, ...). */
  noindex?: boolean;
  /** Open Graph type; "website" is right for almost every page here. */
  type?: 'website' | 'article';
  /** Structured data (JSON-LD). Only pass data that is really shown on the page. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === null) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) { el?.remove(); return; }
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
  el.setAttribute('href', href);
}

/** Sets the title, description, canonical, robots, Open Graph, Twitter and JSON-LD for the page that renders it.
 *  Every route renders one, so a "noindex" from one page can never leak to the next. */
export default function Seo({ title, description, path, image, noindex = false, type = 'website', jsonLd }: SeoProps) {
  const loc = useLocation();
  const canonicalPath = path ?? loc.pathname;
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    const origin = siteOrigin();
    const url = origin + (canonicalPath === '/' ? '/' : canonicalPath.replace(/\/+$/, ''));
    const img = image ? (/^https?:\/\//.test(image) ? image : origin + image) : origin + DEFAULT_IMAGE;

    document.title = title;
    upsertMeta('name', 'description', description ?? null);
    upsertMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow');
    upsertCanonical(noindex ? null : url);

    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description ?? null);
    upsertMeta('property', 'og:url', noindex ? null : url);
    upsertMeta('property', 'og:image', img);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description ?? null);
    upsertMeta('name', 'twitter:image', img);

    let script: HTMLScriptElement | null = null;
    if (ld && !noindex) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-seo', '1');
      script.text = ld;
      document.head.appendChild(script);
    }
    return () => { script?.remove(); };
  }, [title, description, canonicalPath, image, noindex, type, ld]);

  return null;
}
