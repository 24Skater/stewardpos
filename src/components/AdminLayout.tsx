import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  BarChart3, 
  Download, 
  Users, 
  Briefcase, 
  FileCheck,
  Settings, 
  Shield, 
  FileText,
  LogOut,
  ArrowLeft,
  Code,
  Key,
  RotateCcw,
  Receipt,
  Tag,
  Palette
} from 'lucide-react';
import { Button } from './ui/button';
import { logout, getCurrentSession, type AuthSession } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/inventory', label: 'Inventory', icon: Package },
  { path: '/admin/receipts', label: 'Receipts', icon: Receipt },
  { path: '/admin/branding', label: 'Branding', icon: Palette },
  { path: '/admin/returns', label: 'Returns & Refunds', icon: RotateCcw },
  { path: '/admin/discounts', label: 'Discounts & Promos', icon: Tag },
  { path: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { path: '/admin/exports', label: 'Exports', icon: Download },
  { path: '/admin/customers', label: 'Customers', icon: Users },
  { path: '/admin/services', label: 'Services', icon: Briefcase },
  { path: '/admin/quotes', label: 'Quotes', icon: FileCheck },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
  { path: '/admin/roles', label: 'Roles & Users', icon: Shield },
  { path: '/admin/components', label: 'Components', icon: Code },
  { path: '/admin/api-keys', label: 'API Keys', icon: Key },
  { path: '/admin/audit', label: 'Audit Log', icon: FileText },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);
      try {
        const currentSession = await getCurrentSession();
        setSession(currentSession);
      } catch (error) {
        console.error('Failed to load session:', error);
        setSession(null);
      } finally {
        setIsLoading(false);
      }
    };
    loadSession();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Show loading state while session is being fetched
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold text-foreground font-headline">StewardPOS Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {session?.user?.name ?? 'User'}
          </p>
        </div>

        <div className="p-4 border-b border-border">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="w-4 h-4 mr-3" />
            Back to POS
          </Button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start',
                    isActive && 'bg-secondary text-secondary-foreground'
                  )}
                >
                  <Icon className="w-4 h-4 mr-3" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-3" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
