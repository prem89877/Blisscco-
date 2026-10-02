import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Field from '../../components/Field';
import { Check, Msg, Section } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import type { Category } from '../../lib/types';

const empty = { slug: '', name_en: '', name_hi: '', name_mr: '' };

export default function Categories() {
  const { t } = useI18n();
  const [cats, setCats] = useState<Category[]>([]);
  const [f, setF] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('business_categories').select('*').order('sort_order');
    setCats((data ?? []) as Category[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!/^[a-z0-9-]{2,60}$/.test(f.slug) || f.name_en.trim().length < 2) return setError(t('err.generic'));
    setBusy(true);
    const row = { slug: f.slug, name_en: f.name_en.trim(), name_hi: f.name_hi.trim() || null, name_mr: f.name_mr.trim() || null };
    const { error: err } = editId
      ? await supabase.from('business_categories').update(row).eq('id', editId)
      : await supabase.from('business_categories').insert({ ...row, sort_order: cats.length + 1 });
    setBusy(false);
    if (err) { console.error(err); setError(t('err.generic')); return; }
    setF(empty); setEditId(null);
    await load();
  }

  async function setActive(c: Category, v: boolean) {
    await supabase.from('business_categories').update({ is_active: v }).eq('id', c.id);
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/admin" className="text-sm btn-text">← {t('dash.admin')}</Link>
      <h1 className="font-display text-2xl font-semibold">{t('admin.categories')}</h1>
      <Section title={t('admin.catAdd')}>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field id="slug" label={t('admin.catSlug')} value={f.slug} onChange={(v) => setF({ ...f, slug: v })} disabled={busy || !!editId} />
          <Field id="ne" label={t('admin.nameEn')} value={f.name_en} onChange={(v) => setF({ ...f, name_en: v })} disabled={busy} />
          <Field id="nh" label={t('admin.nameHi')} value={f.name_hi} onChange={(v) => setF({ ...f, name_hi: v })} disabled={busy} />
          <Field id="nm" label={t('admin.nameMr')} value={f.name_mr} onChange={(v) => setF({ ...f, name_mr: v })} disabled={busy} />
          <Msg error={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{editId ? t('common.save') : t('common.add')}</button>
            {editId && <button type="button" className="btn-secondary" onClick={() => { setEditId(null); setF(empty); }}>{t('common.cancel')}</button>}
          </div>
        </form>
      </Section>
      <ul className="card divide-y divide-ink/10">
        {cats.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className={c.is_active ? '' : 'text-ink/50 line-through'}>{c.name_en}</span>
            <div className="flex items-center gap-3">
              <Check id={`a-${c.id}`} label={t('admin.catActive')} checked={c.is_active} onChange={(v) => void setActive(c, v)} />
              <button className="btn-secondary" onClick={() => { setEditId(c.id); setF({ slug: c.slug, name_en: c.name_en, name_hi: c.name_hi ?? '', name_mr: c.name_mr ?? '' }); }}>{t('common.edit')}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
