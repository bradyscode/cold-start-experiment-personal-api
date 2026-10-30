import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = '';
});

describe('App', () => {
  it('renders the routed screen inside the shell', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    window.location.hash = '#/dashboards';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows a not found page with links for unknown routes', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    window.location.hash = '#/bogus';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the feed' })).toHaveAttribute('href', '#/');
    expect(screen.getByRole('link', { name: 'Go to dashboards' })).toHaveAttribute('href', '#/dashboards');
  });

  it('routes /compare to the compare workbench', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    window.location.hash = '#/compare';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Compare' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page');
  });
});
