import type { ReactNode } from 'react';
import Seo from '../components/Seo';
import { LEGAL_LAST_UPDATED } from '../lib/site';

export default function LegalPage({ title, description, path, children }: { title: string; description: string; path: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-relaxed">
      <Seo title={`${title} | Blisscco`} description={description} path={path} />
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="text-ink/60">Last updated: {LEGAL_LAST_UPDATED}</p>
      {children}
    </article>
  );
}

export const H = ({ children }: { children: ReactNode }) => <h2 className="pt-2 text-lg font-semibold">{children}</h2>;
export const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;
