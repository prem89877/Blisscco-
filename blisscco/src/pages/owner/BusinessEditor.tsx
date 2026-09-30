import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DetailsSection from '../../components/editor/DetailsSection';
import HoursSection from '../../components/editor/HoursSection';
import PhotosSection from '../../components/editor/PhotosSection';
import ServicesSection from '../../components/editor/ServicesSection';
import SubmitSection from '../../components/editor/SubmitSection';
import Skeleton from '../../components/Skeleton';
import { StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import type { BizImage, Business, Category, Hour, Loaded, Service } from '../../lib/types';

export default function BusinessEditor() {
  const { id } = useParams();
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setMissing(true); return; }
    const [b, c, i, h, s] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', id).maybeSingle(),
      supabase.from('business_categories').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('business_images').select('*').eq('business_id', id).order('sort_order'),
      supabase.from('business_hours').select('*').eq('business_id', id),
      supabase.from('services').select('*').eq('business_id', id).order('created_at'),
    ]);
    if (b.error || !b.data) { setMissing(true); return; }
    setData({
      business: b.data as Business, categories: (c.data ?? []) as Category[], images: (i.data ?? []) as BizImage[],
      hours: (h.data ?? []) as Hour[], services: (s.data ?? []) as Service[],
    });
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (missing) return <p role="alert" className="p-6 text-center">{t('owner.notFound')}</p>;
  if (!data) return <Skeleton />;

  const b = data.business;
  const editable = b.status === 'draft' || b.status === 'rejected';

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <Link to="/owner" className="text-sm underline">← {t('owner.title')}</Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{b.name}</h1>
        <StatusBadge status={b.status} />
      </div>
      {b.status === 'rejected' && b.rejection_reason && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm"><strong>{t('owner.reason')}:</strong> {b.rejection_reason}</p>
      )}
      {b.status === 'pending_review' && <p className="text-sm">{t('owner.pendingNote')}</p>}
      {!editable && <p className="text-sm text-ink/70">{t('ed.readOnly')}</p>}

      <DetailsSection data={data} editable={editable} reload={load} />
      <PhotosSection data={data} editable={editable} reload={load} />
      <HoursSection data={data} editable={b.status !== 'suspended'} reload={load} />
      <ServicesSection data={data} reload={load} />
      {editable && <SubmitSection data={data} reload={load} />}
    </div>
  );
}
