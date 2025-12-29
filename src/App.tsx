import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import SetupGuard from "@/components/SetupGuard";
import POS from "./pages/POS";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import ServicesPos from "./pages/ServicesPos";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/admin/Dashboard";
import AdminInventory from "./pages/admin/AdminInventory";
import AdminReports from "./pages/admin/AdminReports";
import AdminExports from "./pages/admin/AdminExports";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminServices from "./pages/admin/AdminServices";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminRoles from "./pages/admin/AdminRoles";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminComponents from "./pages/admin/AdminComponents";
import AdminQuotes from "./pages/admin/AdminQuotes";
import AdminApiKeys from "./pages/admin/AdminApiKeys";
import AdminReturns from "./pages/admin/AdminReturns";
import AdminReceipts from "./pages/admin/AdminReceipts";
import AdminBranding from "./pages/admin/AdminBranding";
import AdminDiscounts from "./pages/admin/AdminDiscounts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <SetupGuard>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<POS />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/services" element={<ServicesPos />} />
              <Route path="/admin" element={<Dashboard />} />
              <Route path="/admin/inventory" element={<AdminInventory />} />
              <Route path="/admin/reports" element={<AdminReports />} />
              <Route path="/admin/exports" element={<AdminExports />} />
              <Route path="/admin/customers" element={<AdminCustomers />} />
              <Route path="/admin/services" element={<AdminServices />} />
              <Route path="/admin/quotes" element={<AdminQuotes />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/roles" element={<AdminRoles />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
              <Route path="/admin/components" element={<AdminComponents />} />
              <Route path="/admin/api-keys" element={<AdminApiKeys />} />
              <Route path="/admin/returns" element={<AdminReturns />} />
              <Route path="/admin/receipts" element={<AdminReceipts />} />
              <Route path="/admin/branding" element={<AdminBranding />} />
              <Route path="/admin/discounts" element={<AdminDiscounts />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </SetupGuard>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
