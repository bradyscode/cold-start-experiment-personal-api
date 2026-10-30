import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TabBar } from './TabBar';

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>,
  );
}

describe('TabBar', () => {
  it('links Feed, Dashboards, Compare, Add and Settings', () => {
    at('/');
    const hrefs = ['Feed', 'Dashboards', 'Compare', 'Add', 'Settings'].map((n) =>
      screen.getByRole('link', { name: n }).getAttribute('href'),
    );
    expect(hrefs).toEqual(['/', '/dashboards', '/compare', '/add', '/settings']);
  });

  it('marks only the current route with aria-current', () => {
    at('/dashboards');
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Feed' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('marks Compare active on the compare route', () => {
    at('/compare');
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboards' })).not.toHaveAttribute('aria-current');
  });

  it('does not mark Feed active on other routes but does on /', () => {
    at('/');
    expect(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('aria-current', 'page');
  });

  it('hides icons from assistive tech', () => {
    const { container } = at('/');
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(5);
    svgs.forEach((s) => expect(s).toHaveAttribute('aria-hidden', 'true'));
  });
});
