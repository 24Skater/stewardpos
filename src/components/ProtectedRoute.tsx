import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const session = await getCurrentSession();
        
        if (!session) {
          logger.info('No session found, redirecting to login');
          navigate('/login');
          setIsLoading(false);
          return;
        }

        if (requireAdmin) {
          const isAdmin = session.user?.roles?.some((role: { systemRole?: string }) => role.systemRole === 'admin') || false;
          if (!isAdmin) {
            logger.warn('Admin access required, redirecting to home');
            navigate('/');
            setIsLoading(false);
            return;
          }
        }

        setIsAuthorized(true);
        setIsLoading(false);
      } catch (err: unknown) {
        logger.error('Error checking auth in ProtectedRoute:', err);
        setError((err as Error).message || 'Authentication check failed');
        setIsLoading(false);
        // Don't redirect on error - let user see the error
      }
    };

    checkAuth();
  }, [navigate, requireAdmin]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold mb-2 text-destructive">Authentication Error</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => window.location.href = '/login'}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
