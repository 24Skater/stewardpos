import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { Loader2 } from 'lucide-react';

interface SetupStatus {
  isInitialized: boolean;
  hasAdminUser: boolean;
  needsSetup: boolean;
  databaseAdapter: string;
}

interface SetupGuardProps {
  children: React.ReactNode;
}

// Routes that don't require setup check
const PUBLIC_ROUTES = ['/setup', '/login'];

export default function SetupGuard({ children }: SetupGuardProps) {
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Skip setup check for public routes
    if (PUBLIC_ROUTES.includes(location.pathname)) {
      setChecking(false);
      return;
    }
    checkSetupStatus();
  }, [location.pathname]);

  const checkSetupStatus = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: SetupStatus }>('/api/setup/status');
      if (response && response.success && response.data) {
        if (response.data.needsSetup) {
          setNeedsSetup(true);
          navigate('/setup');
        } else {
          setNeedsSetup(false);
        }
      } else {
        // If response is not successful, assume setup is complete (don't block access)
        console.warn('Setup status check returned unsuccessful response, allowing access');
        setNeedsSetup(false);
      }
    } catch (error: any) {
      // If setup endpoint doesn't exist or fails, assume setup is complete
      // This allows the app to work even if setup endpoint is unavailable
      console.warn('Failed to check setup status, allowing access:', error);
      setNeedsSetup(false);
    } finally {
      setChecking(false);
    }
  };

  // Don't show loading for public routes
  if (PUBLIC_ROUTES.includes(location.pathname)) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return null; // Setup page will be shown via navigation
  }

  return <>{children}</>;
}

