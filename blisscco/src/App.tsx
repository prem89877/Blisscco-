import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireRole from './components/RequireRole';
import ForgotPassword from './pages/ForgotPassword';
import Home from './pages/Home';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import PostLogin from './pages/PostLogin';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login role="customer" />} />
        <Route path="/register" element={<Register role="customer" />} />
        <Route path="/owner/login" element={<Login role="owner" />} />
        <Route path="/owner/register" element={<Register role="owner" />} />
        <Route path="/admin/login" element={<Login role="admin" />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/post-login" element={<PostLogin />} />
        <Route path="/owner" element={<RequireRole roles={['owner']}><Placeholder titleKey="dash.owner" /></RequireRole>} />
        <Route path="/admin" element={<RequireRole roles={['admin']}><Placeholder titleKey="dash.admin" /></RequireRole>} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
