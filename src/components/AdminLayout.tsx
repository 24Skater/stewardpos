import { ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
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
  Sun,
  Moon,
  Store,
} from 'lucide-react';
import {
  Button,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarSection,
  SidebarLink,
  SidebarFooter,
  SidebarSeparator,
} from '@steward-apps/ui';
import { logout, getCurrentSession, type AuthSession } from '@/lib/auth';

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/inventory', label: 'Inventory', icon: Package },
  { path: '/admin/receipts', label: 'Receipts', icon: Receipt },
  { path: '/admin/returns', label: 'Returns & Refunds', icon: RotateCcw },
  { path: '/admin/discounts', label: 'Discounts & Promos', icon: Tag },
  { path: '/admin/registers', label: 'Registers', icon: Store },
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
  const { theme, setTheme } = useTheme();
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
      <Sidebar>
        <SidebarHeader>
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground font-headline">Steward · Register</h1>
            <p className="text-xs text-sidebar-foreground/60 mt-0.5">
              {session?.user?.name ?? 'User'}
            </p>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarSection>
            <SidebarLink
              href="/"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={(e) => { e.preventDefault(); navigate('/'); }}
            >
              Back to POS
            </SidebarLink>
          </SidebarSection>

          <SidebarSeparator />

          <SidebarSection>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarLink
                  key={item.path}
                  href={item.path}
                  active={location.pathname === item.path}
                  icon={<Icon className="w-4 h-4" />}
                  onClick={(e) => { e.preventDefault(); navigate(item.path); }}
                >
                  {item.label}
                </SidebarLink>
              );
            })}
          </SidebarSection>
        </SidebarContent>

        <SidebarFooter>
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-hover"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 mr-3" /> : <Moon className="w-4 h-4 mr-3" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-3" />
            Logout
          </Button>
        </SidebarFooter>
      </Sidebar>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
