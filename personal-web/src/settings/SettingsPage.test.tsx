import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import { SettingsPage } from './SettingsPage';

function mount() {
  return render(
    <MemoryRouter>
      <ApiProvider baseUrl="http://api.test">
        <SettingsPage />
      </ApiProvider>
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  it('shows the base URL read only', () => {
    mount();
    const input = screen.getByLabelText('API base URL');
    expect(input).toHaveValue('http://api.test');
    expect(input).toHaveAttribute('readonly');
  });

  it('has a Settings heading and nothing to sign in to', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
