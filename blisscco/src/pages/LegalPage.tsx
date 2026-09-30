import type { ReactNode } from 'react';

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-relaxed">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-amber-900">Draft for launch. Have a lawyer review this before going live.</p>
      {children}
    </article>
  );
}

export const H = ({ children }: { children: ReactNode }) => <h2 className="pt-2 text-lg font-semibold">{children}</h2>;
