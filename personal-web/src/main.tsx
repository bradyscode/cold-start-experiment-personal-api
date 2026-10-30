import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/instrument-sans/400';
import '@fontsource/instrument-sans/500';
import '@fontsource/instrument-sans/600';
import './theme/tokens.css';
import './theme/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { removeLegacyStorage } from './legacyCleanup';

removeLegacyStorage();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
