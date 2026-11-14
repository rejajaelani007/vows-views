import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Router,
  EventProvider,
  ToastProvider,
  useRouter,
  GuestRouter,
  useEvent,
  ErrorBox,
  Spinner,
} from './lib';
import { GuestApp } from './guest';
import { AdminApp } from './admin';
import './styles.css';
function App() {
  const { path } = useRouter();
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminApp />;
  const match = /^\/([^/]+)\/([\w-]+)(?:\/(gallery|camera))?\/?$/.exec(path);
  if (match && !['camera', 'gallery', 'api', 'media', 'assets'].includes(match[1])) {
    const base = '/' + match[1] + '/' + match[2];
    return (
      <GuestRouter base={base} path={'/' + (match[3] || '')}>
        <EventProvider key={base} endpoint={'/invites' + base + '/event'}>
          <Invitation />
        </EventProvider>
      </GuestRouter>
    );
  }
  return (
    <EventProvider>
      <GuestApp />
    </EventProvider>
  );
}
function Invitation() {
  const { event, error, refresh } = useEvent();
  if (error)
    return (
      <main className="page narrow">
        <ErrorBox message={error} retry={refresh} />
      </main>
    );
  return event ? <GuestApp /> : <Spinner />;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Router>
  </React.StrictMode>,
);
