import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentSession } from '@/lib/auth';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const session = getCurrentSession();
    
    if (!session) {
      navigate('/login');
      return;
    }

    if (requireAdmin) {
      const isAdmin = session.roles.some(role => role.systemRole === 'admin');
      if (!isAdmin) {
        navigate('/');
      }
    }
  }, [navigate, requireAdmin]);

  return <>{children}</>;
}
