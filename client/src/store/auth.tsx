import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { SessionUser } from './types';

// /api/auth/me returns { user } on 200, or 401 (which getQueryFn maps to null
// via on401: 'returnNull'). The query stays cached so route guards are sync.

const ME_KEY = ['/api/auth/me'] as const;

interface MeResponse {
  user: SessionUser;
}

interface AuthCtx {
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MeResponse | null>({
    queryKey: ME_KEY,
    // Custom queryFn — we want 401 to resolve to null instead of throwing,
    // so route guards can render the Login page without an error boundary.
    queryFn: async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`auth/me ${res.status}`);
      return res.json();
    },
    retry: false,
    staleTime: 60_000,
  });

  const user = data?.user ?? null;

  async function login(email: string, password: string) {
    try {
      const res = await apiRequest('POST', '/api/auth/login', { email, password });
      const body = await res.json();
      // Prime the cache so the route guard re-renders without a refetch.
      queryClient.setQueryData(ME_KEY, { user: body.user });
      // Force /api/state to re-fetch with the new session.
      queryClient.invalidateQueries({ queryKey: ['/api/state'] });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      // apiRequest throws "401: Invalid email or password" on bad creds.
      const cleaned = msg.replace(/^\d+:\s*/, '').replace(/^\{.*\}$/, 'Invalid email or password');
      return { ok: false, error: cleaned };
    }
  }

  async function logout() {
    try {
      await apiRequest('POST', '/api/auth/logout', {});
    } catch {
      // Ignore — we still want to clear the local cache.
    }
    queryClient.setQueryData(ME_KEY, null);
    queryClient.removeQueries({ queryKey: ['/api/state'] });
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
