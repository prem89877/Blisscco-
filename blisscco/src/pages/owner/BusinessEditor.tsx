import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import DetailsSection from '../../components/editor/DetailsSection';
import HoursSection from '../../components/editor/HoursSection';
import PhotosSection from '../../components/editor/PhotosSection';
import ServicesSection from '../../components/editor/ServicesSection';
import SubmitSection from '../../components/editor/SubmitSection';
import Skeleton from '../../components/Skeleton';
import Tutorial, { TutorialButton, useTutorial } from '../../components/Tutorial';
import { StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n';
import { checkIndiaCoords, validateAddress } from '../../lib/india';
import { supabase } from '../../lib/supabase';
import type { BizImage, Business, Category, Hour, Loaded, Service, ServiceImage } from '../../lib/types';

const STEPS = ['basic', 'contact', 'photos', 'hours', 'services', 'submit'] as const;
type Step = (typeof STEPS)[number];
const HINT: Record<Step, string> = {
  basic: 'step.hintBasic', contact: 'step.hintContact', photos: 'step.hintPhotos',
  hours: 'step.hintHours', services: 'step.hintServices', submit: 'step.hintSubmit',
};
const TUT_NEW: [string, string][] = [['tut.ed.1t', 'tut.ed.1b'], ['tut.ed.2t', 'tut.ed.2b'], ['tut.ed.3t', 'tut.ed.3b'], ['tut.ed.4t', 'tut.ed.4b']];
const TUT_LIVE: [string, string][] = [['tut.live.1t', 'tut.live.1b'], ['tut.live.2t', 'tut.live.2b'], ['tut.live.3t', 'tut.live.3b']];

/** Every step stays mounted (only hidden), so nothing typed is lost when the owner goes Back or Next. */
function Pane({ show, children }: { show: boolean; children: ReactNode }) {
  return <div hidden={!show}>{children}</div>;
}

export default function BusinessEditor() {
  const { id } = useParams();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<Step>('basic');
  const [stepError, setStepError] = useState('');
  const draftTut = useTutorial('edit-business');
  const liveTut = useTutorial('edit-business-live');

  const load = useCallback(async () => {
    if (!id) { setMissing(true); return; }
    const [b, c, i, h, s, si] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', id).maybeSingle(),
      supabase.from('business_categories').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('business_images').select('*').eq('business_id', id).order('sort_order'),
      supabase.from('business_hours').select('*').eq('business_id', id),
      supabase.from('services').select('*').eq('business_id', id).order('created_at'),
      supabase.from('service_images').select('*').eq('business_id', id).order('sort_order'),
    ]);
    if (b.error || !b.data) { setMissing(true); return; }
    setData({
      business: b.data as Business, categories: (c.data ?? []) as Category[], images: (i.data ?? []) as BizImage[],
      hours: (h.data ?? []) as Hour[], services: (s.data ?? []) as Service[],
      serviceImages: (si.data ?? []) as ServiceImage[],
    });
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const goTo = (s: Step) => { setStepError(''); setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const idx = STEPS.indexOf(step);
  const next = () => { if (idx < STEPS.length - 1) goTo(STEPS[idx + 1]); };

  // Is a step really filled in (as saved in the database)? Used to stop the owner from skipping ahead.
  const isDone = (s: Step): boolean => {
    if (!data) return false;
    const b0 = data.business;
    if (s === 'basic') return b0.name.trim().length >= 2 && !!b0.category_id && !!b0.description?.trim();
    if (s === 'contact') {
      const a = validateAddress({ address_line: b0.address_line ?? '', city: b0.city ?? '', state: b0.state ?? '', pincode: b0.pincode ?? '' }, true);
      return !!b0.phone && !!b0.email && a.errors.length === 0 && checkIndiaCoords(b0.latitude, b0.longitude).ok;
    }
    if (s === 'photos') return data.images.length >= 3;
    if (s === 'hours') return data.hours.some((h) => !h.is_closed);
    if (s === 'services') return data.services.some((x) => x.is_active);
    return true;
  };
  const STEP_MSG: Partial<Record<Step, string>> = { photos: 'ed.needPhotos', services: 'ed.needService' };
  // Going back is always free. Going forward needs every step before the target to be complete.
  const jump = (target: Step) => {
    const to = STEPS.indexOf(target);
    if (to > idx) {
      const blocker = STEPS.slice(0, to).find((s) => !isDone(s));
      if (blocker) {
        if (blocker !== step) goTo(blocker);
        setStepError(t('ed.finishFirst'));
        return;
      }
    }
    goTo(target);
  };
  const nextChecked = () => {
    if (!isDone(step)) { setStepError(t(STEP_MSG[step] ?? 'ed.finishFirst')); return; }
    next();
  };
  const back = () => { if (idx > 0) goTo(STEPS[idx - 1]); };

  // "Edit profile" on the dashboard opens this page with ?edit=1: jump straight to the details form
  useEffect(() => {
    if (data && params.get('edit') === '1') document.getElementById('details-form')?.scrollIntoView({ block: 'start' });
  }, [data, params]);

  if (missing) return <p role="alert" className="p-6 text-center">{t('owner.notFound')}</p>;
  if (!data) return <Skeleton />;

  const b = data.business;
  const editable = b.status === 'draft' || b.status === 'rejected';
  const live = b.status === 'approved' || b.status === 'inactive';
  const tut = editable ? draftTut : liveTut;

  const header = (
    <>
      <Link to="/owner" className="text-sm btn-text">← {t('owner.title')}</Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{b.name}</h1>
        <StatusBadge status={b.status} />
      </div>
      <div><TutorialButton onClick={tut.show} /></div>
      {b.status === 'rejected' && b.rejection_reason && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('owner.reason')}:</strong> {b.rejection_reason}</p>
      )}
      {b.status === 'pending_review' && <p className="text-sm">{t('owner.pendingNote')}</p>}
      {!editable && !live && <p className="text-sm text-ink/70">{t('ed.readOnly')}</p>}
    </>
  );

  // Approved / hidden / under review / suspended: one page, as before; a live shop can edit its contact details.
  if (!editable) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <Tutorial open={tut.open} onClose={tut.close} titleKey="owner.editProfile" steps={TUT_LIVE} />
        {header}
        <div id="details-form"><DetailsSection data={data} editable={false} live={live} reload={load} /></div>
        <PhotosSection data={data} editable={live} minKeep={live ? 3 : 0} reload={load} />
        <HoursSection data={data} editable={b.status !== 'suspended'} reload={load} />
        <ServicesSection data={data} reload={load} />
      </div>
    );
  }

  // Draft / rejected: one small step at a time.
  const pct = Math.round(((idx + 1) / STEPS.length) * 100);
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Tutorial open={tut.open} onClose={tut.close} titleKey="tut.ed.title" steps={TUT_NEW} />
      {header}

      <div className="space-y-2" aria-label={t('step.progress', { n: idx + 1, total: STEPS.length, name: t(`step.${step}`) })}>
        <div className="flex gap-1.5">
          {STEPS.map((s, k) => (
            <button key={s} type="button" onClick={() => jump(s)} aria-label={t(`step.${s}`)} aria-current={k === idx ? 'step' : undefined}
              className={`h-2 flex-1 rounded-full ${k <= idx ? 'bg-blush' : 'bg-ink/10'}`} />
          ))}
        </div>
        <p className="text-sm font-medium">{t('step.progress', { n: idx + 1, total: STEPS.length, name: t(`step.${step}`) })} <span className="text-ink/50">· {pct}%</span></p>
        <p className="text-sm text-ink/70">{t(HINT[step])}</p>
      </div>

      <Pane show={step === 'basic' || step === 'contact'}>
        <div id="details-form">
          <DetailsSection data={data} editable reload={load} part={step === 'contact' ? 'contact' : 'basic'} onSaved={next} />
        </div>
      </Pane>
      <Pane show={step === 'photos'}><PhotosSection data={data} editable reload={load} /></Pane>
      <Pane show={step === 'hours'}><HoursSection data={data} editable reload={load} onSaved={next} /></Pane>
      <Pane show={step === 'services'}><ServicesSection data={data} reload={load} /></Pane>
      <Pane show={step === 'submit'}><SubmitSection data={data} reload={load} /></Pane>

      {stepError && <p role="alert" className="text-sm font-medium text-red-700">{stepError}</p>}
      <div className="flex gap-3">
        {idx > 0 && <button type="button" className="btn-secondary flex-1" onClick={back}>← {t('step.back')}</button>}
        {(step === 'photos' || step === 'services') && <button type="button" className="btn-solid flex-1" onClick={nextChecked}>{t('step.next')} →</button>}
      </div>
    </div>
  );
}
