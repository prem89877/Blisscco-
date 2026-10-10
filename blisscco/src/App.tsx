import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Seo from './components/Seo';
import RequireRole from './components/RequireRole';
import AdminAudit from './pages/admin/AdminAudit';
import AdminCompetition from './pages/admin/AdminCompetition';
import AdminCustomerCompetition from './pages/admin/AdminCustomerCompetition';
import AdminCustomerFraudReview from './pages/admin/AdminCustomerFraudReview';
import AdminFraudReview from './pages/admin/AdminFraudReview';
import AdminDisputes from './pages/admin/AdminDisputes';
import AdminOwnerUpi from './pages/admin/AdminOwnerUpi';
import AdminPromotions from './pages/admin/AdminPromotions';
import AdminReports from './pages/admin/AdminReports';
import AdminUsers from './pages/admin/AdminUsers';
import AdminBanners from './pages/admin/AdminBanners';
import AdminHome from './pages/admin/AdminHome';
import AdminMegaStores from './pages/admin/AdminMegaStores';
import AdminNotify from './pages/admin/AdminNotify';
import AdminPayments from './pages/admin/AdminPayments';
import AdminVerifications from './pages/admin/AdminVerifications';
import AdminReferrals from './pages/admin/AdminReferrals';
import AdminReviews from './pages/admin/AdminReviews';
import Applications from './pages/admin/Applications';
import Categories from './pages/admin/Categories';
import AuthCallback from './pages/AuthCallback';
import BusinessProfile from './pages/BusinessProfile';
import ForgotPassword from './pages/ForgotPassword';
import Explore from './pages/Explore';
import MegaCampaign from './pages/MegaCampaign';
import MyRewards from './pages/MyRewards';
import HomeGate from './pages/HomeGate';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import BusinessEditor from './pages/owner/BusinessEditor';
import MyBookings from './pages/MyBookings';
import NotificationSettings from './pages/NotificationSettings';
import Notifications from './pages/Notifications';
import NewBusiness from './pages/owner/NewBusiness';
import OwnerAnalytics from './pages/owner/OwnerAnalytics';
import OwnerBanners from './pages/owner/OwnerBanners';
import OwnerQR from './pages/owner/OwnerQR';
import MegaStoreDashboard from './pages/owner/MegaStoreDashboard';
import MegaStoreRedeem from './pages/owner/MegaStoreRedeem';
import OwnerCompetition from './pages/owner/OwnerCompetition';
import CustomerCompetition from './pages/CustomerCompetition';
import OwnerCoupons from './pages/owner/OwnerCoupons';
import OwnerPlans from './pages/owner/OwnerPlans';
import OwnerVerify from './pages/owner/OwnerVerify';
import OwnerQueue from './pages/owner/OwnerQueue';
import OwnerReviews from './pages/owner/OwnerReviews';
import Refer from './pages/Refer';
import OwnerDashboard from './pages/owner/OwnerDashboard';
import Privacy from './pages/Privacy';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Support from './pages/Support';
import OwnerAdvisor from './pages/owner/OwnerAdvisor';
import PostLogin from './pages/PostLogin';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Terms from './pages/Terms';

// Navigation (map library included) is loaded only when a customer opens it.
const Navigate = lazy(() => import('./pages/Navigate'));

// Private and sign-in pages are kept out of search results (robots.txt also blocks the dashboards from being crawled).
const hidden = (title: string, el: JSX.Element) => <><Seo title={`${title} | Blisscco`} noindex />{el}</>;
const owner = (el: JSX.Element) => <RequireRole roles={['owner']}>{hidden('Owner dashboard', el)}</RequireRole>;
const anyUser = (el: JSX.Element) => <RequireRole roles={['customer', 'owner', 'admin']}>{hidden('My account', el)}</RequireRole>;
const customer = (el: JSX.Element) => <RequireRole roles={['customer']}>{hidden('My account', el)}</RequireRole>;
const admin = (el: JSX.Element) => <RequireRole roles={['admin']}>{hidden('Admin', el)}</RequireRole>;

export default function App() {
  return (
    <Routes>
      {/* Full-screen navigation: outside <Layout> so the map owns the whole screen */}
      <Route path="/b/:id/navigate" element={<Suspense fallback={<div className="fixed inset-0 bg-cream" role="status" aria-busy="true" />}><Navigate /></Suspense>} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomeGate />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/b/:id" element={<BusinessProfile />} />
        {/* Mega Store Customer Reward Cycle (migration 0038) */}
        <Route path="/mega/:code" element={hidden('Reward campaign', <MegaCampaign />)} />
        <Route path="/mega/redeem/:code" element={hidden('Redeem reward', <MegaStoreRedeem />)} />
        <Route path="/login" element={hidden('Log in', <Login role="customer" />)} />
        <Route path="/register" element={hidden('Sign up', <Register role="customer" />)} />
        <Route path="/owner/login" element={hidden('Business log in', <Login role="owner" />)} />
        <Route path="/owner/register" element={hidden('Register your business', <Register role="owner" />)} />
        <Route path="/admin/login" element={hidden('Admin log in', <Login role="admin" />)} />
        <Route path="/forgot-password" element={hidden('Forgot password', <ForgotPassword />)} />
        <Route path="/reset-password" element={hidden('Reset password', <ResetPassword />)} />
        <Route path="/auth/callback" element={hidden('Signing in', <AuthCallback />)} />
        <Route path="/post-login" element={hidden('Signing in', <PostLogin />)} />
        <Route path="/owner" element={owner(<OwnerDashboard />)} />
        <Route path="/owner/competition" element={owner(<OwnerCompetition />)} />
        <Route path="/owner/advisor" element={owner(<OwnerAdvisor />)} />
        <Route path="/owner/megastore" element={owner(<MegaStoreDashboard />)} />
        <Route path="/owner/business/new" element={owner(<NewBusiness />)} />
        <Route path="/owner/business/:id" element={owner(<BusinessEditor />)} />
        <Route path="/owner/business/:id/queue" element={owner(<OwnerQueue />)} />
        <Route path="/owner/business/:id/reviews" element={owner(<OwnerReviews />)} />
        <Route path="/owner/business/:id/coupons" element={owner(<OwnerCoupons />)} />
        <Route path="/owner/business/:id/plans" element={owner(<OwnerPlans />)} />
        <Route path="/owner/business/:id/banners" element={owner(<OwnerBanners />)} />
        <Route path="/owner/business/:id/verify" element={owner(<OwnerVerify />)} />
        <Route path="/owner/business/:id/analytics" element={owner(<OwnerAnalytics />)} />
        <Route path="/owner/business/:id/qr" element={owner(<OwnerQR />)} />
        <Route path="/admin/users" element={admin(<AdminUsers />)} />
        <Route path="/admin/disputes" element={admin(<AdminDisputes />)} />
        <Route path="/admin/promotions" element={admin(<AdminPromotions />)} />
        <Route path="/admin/reports" element={admin(<AdminReports />)} />
        <Route path="/admin/audit" element={admin(<AdminAudit />)} />
        <Route path="/admin/banners" element={admin(<AdminBanners />)} />
        <Route path="/admin/verifications" element={admin(<AdminVerifications />)} />
        <Route path="/admin/payments" element={admin(<AdminPayments />)} />
        <Route path="/admin/owner-upi" element={admin(<AdminOwnerUpi />)} />
        <Route path="/admin/notify" element={admin(<AdminNotify />)} />
        <Route path="/refer" element={customer(<Refer />)} />
        <Route path="/my-rewards" element={customer(<MyRewards />)} />
        <Route path="/admin/mega-stores" element={admin(<AdminMegaStores />)} />
        <Route path="/refer/competition" element={customer(<CustomerCompetition />)} />
        <Route path="/admin/reviews" element={admin(<AdminReviews />)} />
        <Route path="/admin/referrals" element={admin(<AdminReferrals />)} />
        <Route path="/admin/competition" element={admin(<AdminCompetition />)} />
        <Route path="/admin/competition/fraud" element={admin(<AdminFraudReview />)} />
        <Route path="/admin/customer-competition" element={admin(<AdminCustomerCompetition />)} />
        <Route path="/admin/customer-competition/fraud" element={admin(<AdminCustomerFraudReview />)} />
        <Route path="/my-bookings" element={anyUser(<MyBookings />)} />
        <Route path="/profile" element={anyUser(<Profile />)} />
        <Route path="/settings" element={anyUser(<Settings />)} />
        <Route path="/support" element={anyUser(<Support />)} />
        <Route path="/notifications" element={anyUser(<Notifications />)} />
        <Route path="/notifications/settings" element={anyUser(<NotificationSettings />)} />
        <Route path="/admin" element={admin(<AdminHome />)} />
        <Route path="/admin/applications" element={admin(<Applications />)} />
        <Route path="/admin/categories" element={admin(<Categories />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
