import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout, Button, Input, Label } from '@steward-apps/ui';
import { apiClient } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';
import type { LoginRequest, LoginResponse } from '@/lib/api-types';
import { useToast } from '@/hooks/use-toast';
import { LogIn } from 'lucide-react';
import Logo from '@/components/Logo';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiClient.post<LoginResponse>('/api/auth/login', {
        email,
        password,
      } as LoginRequest);

      if (response.token) {
        authStore.setToken(response.token, '7d');
        toast({
          title: 'Success',
          description: 'Logged in successfully',
        });
        navigate('/admin');
      } else {
        toast({
          title: 'Login failed',
          description: 'Invalid email or password',
          variant: 'destructive'
        });
      }
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Login failed',
        variant: 'destructive'
      });
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

        <Button type="submit" className="w-full" disabled={loading}>
          <LogIn className="w-4 h-4 mr-2" />
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>

        <p className="text-xs text-center text-muted-foreground mt-4">
          Demo: <span className="font-mono">admin@demo.local / DemoPass!1</span>
        </p>
      </form>
    </AuthLayout>
  );
}
