interface Props {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: 'text' | 'email' | 'password'; autoComplete?: string; disabled?: boolean;
}

export default function Field({ id, label, value, onChange, type = 'text', autoComplete, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} type={type} value={value} disabled={disabled} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)} className="input" />
    </div>
  );
}
