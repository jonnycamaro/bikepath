import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import { setupUpdates } from './updates';

setupUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Debug hooks for development/testing (GPS injection, store access). Not included in production.
if (import.meta.env.DEV) {
  Promise.all([import('./lib/location'), import('./store')]).then(([l, s]) => {
    (window as any).__bikepath = { location: l.location, store: s.useStore };
  });
}
