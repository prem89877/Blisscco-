import type { ReactNode } from 'react';

export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <div className="card space-y-5">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
