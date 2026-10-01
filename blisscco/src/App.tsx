import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireRole from './components/RequireRole';
import AdminHome from './pages/admin/AdminHome';
import Applications from './pages/admin/Applications';
import Categories from './pages/admin/Categories';
import AuthCallback from './pages/AuthCallback';
import BusinessProfile from './pages/BusinessProfile';
import ForgotPassword from './pages/ForgotPassword';
import Explore from './pages/Explore';
import HomeGate from './pages/HomeGate';
import Login from './pages/Login';
import BusinessEditor from './pages/owner/BusinessEditor';
import NewBusiness from './pages/owner/NewBusiness';
import OwnerDashboard from './pages/owner/OwnerDashboard';
import Privacy from './pages/Privacy';
import PostLogin from './pages/PostLogin';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Terms from './pages/Terms';

const owner = (el: JSX.Element) => <RequireRole roles={['owner']}>{el}</RequireRole>;
const admin = (el: JSX.Element) => <RequireRole roles={['admin']}>{el}</RequireRole>;

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomeGate />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/b/:id" element={<BusinessProfile />} />
        <Route path="/login" element={<Login role="customer" />} />
        <Route path="/register" element={<Register role="customer" />} />
        <Route path="/owner/login" element={<Login role="owner" />} />
        <Route path="/owner/register" element={<Register role="owner" />} />
        <Route path="/admin/login" element={<Login role="admin" />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/post-login" element={<PostLogin />} />
        <Route path="/owner" element={owner(<OwnerDashboard />)} />
        <Route path="/owner/business/new" element={owner(<NewBusiness />)} />
        <Route path="/owner/business/:id" element={owner(<BusinessEditor />)} />
        <Route path="/admin" element={admin(<AdminHome />)} />
        <Route path="/admin/applications" element={admin(<Applications />)} />
        <Route path="/admin/categories" element={admin(<Categories />)} />
        <Route path="*" element={<HomeGate />} />
      </Route>
    </Routes>
  );
}
