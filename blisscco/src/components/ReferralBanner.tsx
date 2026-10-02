import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';

// Shown only while an admin-configured campaign is active. No reward amount is advertised.
export default function ReferralBanner() {
  const { t } = useI18n();
  const { session, profile } = useAuth();
  const [active, setActive] = useState(false);
  useEffect(() => { void supabase.rpc('referral_campaign_active').then(({ data }) => setActive(data === true)); }, []);
  if (!active || (session && profile?.role !== 'customer')) return null;
  return <Link to={session ? '/refer' : '/register'} className="card block bg-blush/25 text-center text-sm font-medium">{t('ref.banner')}</Link>;
}
