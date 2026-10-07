import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthCard from '../../components/AuthCard';
import Field from '../../components/Field';
import Tutorial, { TutorialButton, useTutorial } from '../../components/Tutorial';
import { Msg, Select } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n';
import { catName } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Category } from '../../lib/types';

const TUT_NEW: [string, string][] = [['tut.new.1t', 'tut.new.1b'], ['tut.new.2t', 'tut.new.2b'], ['tut.new.3t', 'tut.new.3b']];

export default function NewBusiness() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const nav = useNavigate();
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tut = useTutorial('add-business');

  useEffect(() => {
    void supabase.from('business_categories').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => setCats((data ?? []) as Category[]));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !session) return;
    setError('');
    if (name.trim().length < 2) return setError(t('err.nameRequired'));
    if (!cat) return setError(t('common.select'));
    setBusy(true);
    const { data, error: err } = await supabase.from('businesses').insert({ owner_id: session.user.id, name: name.trim(), category_id: cat }).select('id').single();
    setBusy(false);
    if (err || !data) { console.error(err); setError(t('err.generic')); return; }
    nav(`/owner/business/${(data as { id: string }).id}`, { replace: true });
  }

  return (
    <AuthCard title={t('owner.newTitle')}>
      <Tutorial open={tut.open} onClose={tut.close} titleKey="tut.new.title" steps={TUT_NEW} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/70">{t('new.hint')}</p>
        <TutorialButton onClick={tut.show} />
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Field id="name" label={t('ed.name')} value={name} onChange={setName} disabled={busy} />
          <p className="px-1 text-xs text-ink/60">{t('new.nameHint')}</p>
        </div>
        <Select id="cat" label={t('ed.category')} value={cat} onChange={setCat} disabled={busy} placeholder={t('common.select')}
          options={cats.map((c) => ({ value: c.id, label: catName(c, lang) }))} />
        <Msg error={error} />
        <button type="submit" className="btn-solid w-full" disabled={busy}>{busy ? t('common.loading') : t('owner.create')}</button>
      </form>
    </AuthCard>
  );
}
