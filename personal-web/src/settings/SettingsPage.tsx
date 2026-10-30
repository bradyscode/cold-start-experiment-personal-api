import { useApi } from '../api/ApiProvider';

export function SettingsPage() {
  const { baseUrl } = useApi();

  return (
    <main className="screen stack">
      <h1 className="display">Settings</h1>

      <section className="stack" aria-labelledby="api-heading">
        <h2 id="api-heading">API</h2>
        <label htmlFor="base-url">API base URL</label>
        <input id="base-url" className="field" readOnly value={baseUrl} />
      </section>
    </main>
  );
}
