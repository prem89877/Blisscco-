import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { BEAUTY_TIPS, nextTipIndex, tipText, TIP_EMOJI } from '../lib/beautyTips';

const ROTATE_MS = 20000;

/** Slim strip with a beauty joke / slogan / tip. A new one appears on every page change and every 20 seconds, cycling through all 100. */
export default function BeautyTip() {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [i, setI] = useState(nextTipIndex);

  // new page -> next tip
  useEffect(() => { setI(nextTipIndex()); }, [pathname]);
  // stay on a page -> next tip every 20 s (paused while the tab is hidden)
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) setI(nextTipIndex()); }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const item = BEAUTY_TIPS[i % BEAUTY_TIPS.length];
  return (
    <div role="note" className="border-b border-ink/5 bg-blush/15 px-4 py-2">
      <p key={i} className="tip-fade mx-auto flex max-w-5xl items-center justify-center gap-2 text-center text-xs leading-snug text-ink/80 sm:text-sm">
        <span aria-hidden="true">{TIP_EMOJI[item.k]}</span>
        <span>{tipText(i, lang)}</span>
      </p>
    </div>
  );
}
