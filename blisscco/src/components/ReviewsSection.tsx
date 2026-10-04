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
      <ul className="space-y-3">
        {rows.map((r) => {
          const name = r.reviewer_name?.trim() || '—';
          return (
            <li key={r.id} className="rounded-2xl bg-cream/70 p-4 ring-1 ring-ink/5">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-blush text-lg font-semibold uppercase text-ink">
                  {name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold leading-tight">{name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                    <Stars value={r.rating} size="lg" />
                    <span className="text-xs text-ink/60">{fmtDate(r.created_at.slice(0, 10), lang)}</span>
                  </div>
                </div>
              </div>
              {r.comment && <p className="mt-3 break-words text-base leading-relaxed">{r.comment}</p>}
              {r.owner_response && (
                <p className="mt-3 rounded-xl bg-white p-3 text-sm ring-1 ring-blush/40">
                  <strong>{t('rv.ownerReply')}:</strong> {r.owner_response}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
