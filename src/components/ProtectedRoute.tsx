import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentSession } from '@/lib/auth';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      const session = await getCurrentSession();
      
      if (!session) {
        navigate('/login');
        setIsLoading(false);
        return;
      }

      if (requireAdmin) {
        const isAdmin = session.user.roles.some((role: any) => role.systemRole === 'admin');
        if (!isAdmin) {
          navigate('/');
          setIsLoading(false);
          return;
        }
      }

      setIsAuthorized(true);
      setIsLoading(false);
    };

    checkAuth();
  }, [navigate, requireAdmin]);

  if (isLoading) {
    return <div>Loading...</div>; // TODO: Add proper loading component
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
