import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LocationProvider } from './context/LocationContext';
import { I18nProvider } from './i18n';
import './lib/installPrompt';
import { registerServiceWorker } from './lib/push';
import { captureRefFromUrl } from './lib/referral';
import './index.css';

captureRefFromUrl();
registerServiceWorker();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <LocationProvider>
            <App />
            <Analytics />
          </LocationProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
