import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { Status } from '../lib/types';

const COLORS: Record<Status, string> = {
  draft: 'bg-ink/10 text-ink', pending_review: 'bg-amber-100 text-amber-900', approved: 'bg-green-100 text-green-900',
  rejected: 'bg-red-100 text-red-900', suspended: 'bg-red-100 text-red-900', inactive: 'bg-ink/10 text-ink',
};

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${COLORS[status]}`}>{t(`status.${status}`)}</span>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Msg({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p role="alert" className="text-sm font-medium text-red-700">{error}</p>;
  if (ok) return <p role="status" className="text-sm font-medium text-green-800">{ok}</p>;
  return null;
}

interface SelProps { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean; placeholder?: string }
export function Select({ id, label, value, onChange, options, disabled, placeholder }: SelProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function TextArea({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <textarea id={id} rows={4} maxLength={2000} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input" />
    </div>
  );
}

export function Check({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-[44px] items-center gap-3 text-sm">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-blush" />
      {label}
    </label>
  );
}
