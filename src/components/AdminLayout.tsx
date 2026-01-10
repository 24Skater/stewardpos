import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  BarChart3, 
  Download, 
  Users, 
  Briefcase, 
  Settings, 
  Shield, 
  FileText,
  LogOut,
  ArrowLeft
} from 'lucide-react';
import { Button } from './ui/button';
import { logout, getCurrentSession } from '@/lib/auth';
import { cn } from '@/lib/utils';
import Logo from './Logo';

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/inventory', label: 'Inventory', icon: Package },
  { path: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { path: '/admin/exports', label: 'Exports', icon: Download },
  { path: '/admin/customers', label: 'Customers', icon: Users },
  { path: '/admin/services', label: 'Services', icon: Briefcase },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
  { path: '/admin/roles', label: 'Roles & Users', icon: Shield },
  { path: '/admin/audit', label: 'Audit Log', icon: FileText },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getCurrentSession();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="mb-3">
            <Logo variant="icon" className="w-10" />
          </div>
          <h1 className="text-xl font-bold text-foreground font-headline">Admin Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">{session?.user.name}</p>
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
