import { useI18n } from '../i18n';
import { fmtTime } from '../lib/format';
import type { QueueInfo } from '../lib/types';

const STALE_MS = 60 * 60 * 1000;

export default function QueueCard({ info }: { info: QueueInfo }) {
  const { t, lang } = useI18n();
  const stale = Date.now() - new Date(info.queue_updated_at).getTime() > STALE_MS;
  const stat = (label: string, value: string | number | null) => (
    <div className="rounded-xl bg-cream p-3 text-center">
      <p className="text-xs text-ink/70">{label}</p>
      <p className="text-lg font-semibold">{value ?? '—'}</p>
    </div>
  );
  return (
    <div className="space-y-3 rounded-2xl border border-ink/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t('q.title')}</h3>
        <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-semibold">
          {info.temporarily_unavailable ? t('q.unavailable') : t(`q.status.${info.queue_status}`)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat(t('q.waiting'), info.waiting_count)}
        {stat(t('q.serving'), info.serving_token)}
        {stat(t('q.next'), info.next_token)}
        {stat(t('q.wait'), info.est_wait_minutes === null ? null : t('q.minutes', { n: info.est_wait_minutes }))}
      </div>
      <p className="text-xs text-ink/70">{t('q.updated', { time: fmtTime(info.queue_updated_at, lang) })} · {t('q.manual')}</p>
      {stale && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{t('q.stale')}</p>}
    </div>
  );
}
