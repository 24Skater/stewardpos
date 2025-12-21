import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';
import type { LoginRequest, LoginResponse } from '@/lib/api-types';
import { useToast } from '@/hooks/use-toast';
import { LogIn } from 'lucide-react';

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

      if (response.success && response.data.token) {
        authStore.setToken(response.data.token, '7d');
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
    } catch (error: any) {
      toast({ 
        title: 'Error', 
        description: error.message || 'Login failed',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Persona POS</CardTitle>
          <CardDescription>Sign in to access the admin portal</CardDescription>
        </CardHeader>
        <CardContent>
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

            <div className="text-sm text-center text-muted-foreground mt-4">
              <p>Demo credentials:</p>
              <p className="font-mono text-xs mt-1">admin@demo.local / DemoPass!1</p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
