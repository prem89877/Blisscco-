import { useEffect, useState } from 'react';
import { Section } from './ui';
import { Stars } from './Stars';
import { useI18n } from '../i18n';
import { fmtDate } from '../lib/format';
import { supabase } from '../lib/supabase';

interface Rating { avg_rating: number; review_count: number }
interface Row { id: string; reviewer_name: string | null; rating: number; comment: string | null; created_at: string; owner_response: string | null }

export function RatingLine({ businessId, reloadKey = 0 }: { businessId: string; reloadKey?: number }) {
  const { t } = useI18n();
  const [r, setR] = useState<Rating | null | undefined>(undefined);
  useEffect(() => {
    void supabase.from('public_business_ratings').select('avg_rating,review_count').eq('business_id', businessId).maybeSingle()
      .then(({ data }) => setR((data as Rating | null) ?? null));
  }, [businessId, reloadKey]);
  if (r === undefined) return null;
  return <p className="text-sm text-ink/70">{r ? <><Stars value={r.avg_rating} /> {r.avg_rating} ({r.review_count})</> : t('biz.noReviews')}</p>;
}

export function ReviewsSection({ businessId, reloadKey = 0 }: { businessId: string; reloadKey?: number }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void supabase.from('reviews').select('id,reviewer_name,rating,comment,created_at,owner_response')
      .eq('business_id', businessId).eq('status', 'published').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, [businessId, reloadKey]);
  if (rows.length === 0) return null;
  return (
    <Section title={t('rv.title')}>
      <ul className="divide-y divide-ink/10">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 py-3 text-sm">
            <p><Stars value={r.rating} /> <span className="font-medium">{r.reviewer_name ?? '—'}</span> <span className="text-ink/60">· {fmtDate(r.created_at.slice(0, 10), lang)}</span></p>
            {r.comment && <p>{r.comment}</p>}
            {r.owner_response && <p className="rounded-lg bg-cream p-2"><strong>{t('rv.ownerReply')}:</strong> {r.owner_response}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
