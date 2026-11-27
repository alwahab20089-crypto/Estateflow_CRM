import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authService } from '@/services/auth-service';
import { renderWithProviders } from '@/test/utils';
import { LoginPage } from './pages/login-page';
import { RegisterPage } from './pages/register-page';

vi.mock('@/services/auth-service', () => ({ authService: { setupStatus: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ login: vi.fn(), register: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('first-run setup', () => {
  it('sends the login page to the owner setup on a brand-new install', async () => {
    vi.mocked(authService.setupStatus).mockResolvedValue({ setupRequired: true });
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    expect(await screen.findByText('elsewhere')).toBeInTheDocument(); // redirected to /register
  });

  it('hides account creation on the login page once setup is done', async () => {
    vi.mocked(authService.setupStatus).mockResolvedValue({ setupRequired: false });
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    expect(await screen.findByText(/Ask your workspace owner to invite you/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('shows the owner setup form on a brand-new install', async () => {
    vi.mocked(authService.setupStatus).mockResolvedValue({ setupRequired: true });
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });
    expect(await screen.findByText('Set up your workspace')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
  });

  it('replaces the register form with a notice once setup is done', async () => {
    vi.mocked(authService.setupStatus).mockResolvedValue({ setupRequired: false });
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });
    expect(await screen.findByText('Setup is already complete')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('keeps the normal pages when the setup status cannot be loaded (the server still decides)', async () => {
    vi.mocked(authService.setupStatus).mockRejectedValue(new Error('offline'));
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    expect(await screen.findByRole('link', { name: 'Create an account' })).toBeInTheDocument();
  });
});