import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { ApiProvider } from './api/ApiProvider';
import { ChartPage } from './chart/ChartPage';
import { ComparePage } from './compare/ComparePage';
import { DashboardPage } from './dashboards/DashboardPage';
import { EntryPage } from './entry/EntryPage';
import { FeedPage } from './feed/FeedPage';
import { TabBar } from './nav/TabBar';
import { SettingsPage } from './settings/SettingsPage';

export function NotFound() {
  return (
    <main className="screen not-found">
      <h1 className="display dash-title">Page not found</h1>
      <p>There is nothing at this address.</p>
      <div className="row">
        <Link className="btn btn-link" to="/">
          Go to the feed
        </Link>
        <Link className="btn btn-primary btn-link" to="/dashboards">
          Go to dashboards
        </Link>
      </div>
    </main>
  );
}

export function Shell() {
  return (
    <div className="shell">
      <TabBar />
      <div className="shell-content">
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/dashboards" element={<DashboardPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/chart/:kind" element={<ChartPage />} />
          <Route path="/add" element={<EntryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <ApiProvider>
        <Shell />
      </ApiProvider>
    </HashRouter>
  );
}
