import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout, Button, Input, Label } from '@steward-apps/ui';
import { authApi } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';
import { getErrorMessage } from '@/lib/errors';
import { USE_PIN_AT_TILL } from '@/lib/register-error-codes';
import { useInvalidateSession } from '@/hooks/queries/useSession';
import { useToast } from '@/hooks/use-toast';
import { LogIn, ShieldAlert } from 'lucide-react';
import Logo from '@/components/Logo';

/**
 * Where to send the user after signing in.
 *
 * `RequireAuth` records the route it turned away in `?next=`. Only same-site
 * paths are honoured - an absolute URL there would turn the login page into an
 * open redirect, which is a stock phishing primitive.
 */
function safeRedirect(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/pos';
  return next;
}

/**
 * Whether to print the seeded demo credentials on the form.
 *
 * Off unless explicitly enabled, so a real install never advertises a known
 * account. The demo deployment sets VITE_DEMO_MODE=true.
 */
const SHOW_DEMO_CREDENTIALS = import.meta.env.VITE_DEMO_MODE === 'true';

/**
 * What to tell someone the form just turned away.
 *
 * A cashier's password is not wrong — this screen is simply not their door, and
 * the generic message would have them retyping a password that works. Branches
 * on the envelope's `code`, never on the message text.
 */
function describeLoginFailure(error: unknown): string {
  const code = error instanceof ApiClientError ? (error.body as { code?: string } | undefined)?.code : undefined;

  if (code === USE_PIN_AT_TILL) {
    return 'Use your PIN at the till. This screen is for back-office accounts.';
  }

  return getErrorMessage(error, 'Could not sign you in');
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  /**
   * Shown on the form rather than in a toast: a rejection here is an
   * instruction the reader has to act on, and a toast that fades takes it away
   * mid-sentence.
   */
  const [failure, setFailure] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invalidateSession = useInvalidateSession();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFailure(null);

    try {
      const response = await authApi.login({ email, password });

      if (response.token) {
        authStore.setToken(response.token, response.expiresIn);
        // The guards read the session through TanStack Query; without this they
        // would still hold the cached "signed out" answer and bounce straight back.
        await invalidateSession();
        toast({
          title: 'Success',
          description: 'Logged in successfully',
        });
        navigate(safeRedirect(searchParams.get('next')), { replace: true });
      } else {
        setFailure('Invalid email or password');
      }
    } catch (error: unknown) {
      setFailure(describeLoginFailure(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="flex flex-col items-center mb-8">
        <Logo variant="lockup" className="mb-6" />
        <h1 className="text-2xl font-bold text-foreground font-headline">Admin Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">Sign in to access your dashboard</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@demo.local"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        {failure && (
          <div
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{failure}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          <LogIn className="w-4 h-4 mr-2" />
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>

        {SHOW_DEMO_CREDENTIALS && (
          <p className="text-xs text-center text-muted-foreground mt-4">
            Demo: <span className="font-mono">admin@demo.local / DemoPass!1</span>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
