import { useState } from 'react';
import { useAuth } from '@/store/auth';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Sign in failed');
    }
    // On success the AuthProvider's cache update flips the route guard,
    // so we don't navigate manually.
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 shadow-lg"
      >
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Film Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">Papa Steve's kitchen inventory</p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-2"
              data-testid="input-email"
            />
          </div>

          <div>
            <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-2"
              data-testid="input-password"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive-border bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="hover-elevate active-elevate-2 inline-flex h-12 w-full items-center justify-center rounded-md border border-primary-border bg-primary font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="button-submit"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
