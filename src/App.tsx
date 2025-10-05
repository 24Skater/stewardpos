import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import POS from "./pages/POS";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import ServicesPos from "./pages/ServicesPos";
import Login from "./pages/Login";
import Dashboard from "./pages/admin/Dashboard";
import AdminInventory from "./pages/admin/AdminInventory";
import AdminReports from "./pages/admin/AdminReports";
import AdminExports from "./pages/admin/AdminExports";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminServices from "./pages/admin/AdminServices";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminRoles from "./pages/admin/AdminRoles";
import AdminAudit from "./pages/admin/AdminAudit";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<POS />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/services" element={<ServicesPos />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<Dashboard />} />
          <Route path="/admin/inventory" element={<AdminInventory />} />
          <Route path="/admin/reports" element={<AdminReports />} />
          <Route path="/admin/exports" element={<AdminExports />} />
          <Route path="/admin/customers" element={<AdminCustomers />} />
          <Route path="/admin/services" element={<AdminServices />} />
          <Route path="/admin/settings" element={<AdminSettings />} />
          <Route path="/admin/roles" element={<AdminRoles />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
