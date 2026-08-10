import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import SetupGuard from "@/components/SetupGuard";
import RequireAuth from "@/components/RequireAuth";
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
import AdminDiscounts from "./pages/admin/AdminDiscounts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SetupGuard>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<RequireAuth><POS /></RequireAuth>} />
              <Route path="/pos" element={<RequireAuth><POS /></RequireAuth>} />
              <Route path="/inventory" element={<RequireAuth permission={{ domain: "inventory", action: "read" }}><Inventory /></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth permission={{ domain: "reports", action: "read" }}><Reports /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth permission={{ domain: "settings", action: "read" }}><Settings /></RequireAuth>} />
              <Route path="/services" element={<RequireAuth permission={{ domain: "services", action: "read" }}><ServicesPos /></RequireAuth>} />
              <Route path="/admin" element={<RequireAuth permission={{ domain: "reports", action: "read" }}><Dashboard /></RequireAuth>} />
              <Route path="/admin/inventory" element={<RequireAuth permission={{ domain: "inventory", action: "read" }}><AdminInventory /></RequireAuth>} />
              <Route path="/admin/reports" element={<RequireAuth permission={{ domain: "reports", action: "read" }}><AdminReports /></RequireAuth>} />
              <Route path="/admin/exports" element={<RequireAuth permission={{ domain: "exports", action: "read" }}><AdminExports /></RequireAuth>} />
              <Route path="/admin/customers" element={<RequireAuth permission={{ domain: "customers", action: "read" }}><AdminCustomers /></RequireAuth>} />
              <Route path="/admin/services" element={<RequireAuth permission={{ domain: "services", action: "read" }}><AdminServices /></RequireAuth>} />
              <Route path="/admin/quotes" element={<RequireAuth permission={{ domain: "services", action: "read" }}><AdminQuotes /></RequireAuth>} />
              <Route path="/admin/settings" element={<RequireAuth permission={{ domain: "settings", action: "read" }}><AdminSettings /></RequireAuth>} />
              <Route path="/admin/roles" element={<RequireAuth permission={{ domain: "users", action: "read" }}><AdminRoles /></RequireAuth>} />
              <Route path="/admin/audit" element={<RequireAuth permission={{ domain: "settings", action: "read" }}><AdminAudit /></RequireAuth>} />
              <Route path="/admin/components" element={<RequireAuth permission={{ domain: "settings", action: "write" }}><AdminComponents /></RequireAuth>} />
              <Route path="/admin/api-keys" element={<RequireAuth permission={{ domain: "settings", action: "write" }}><AdminApiKeys /></RequireAuth>} />
              <Route path="/admin/returns" element={<RequireAuth permission={{ domain: "returns", action: "read" }}><AdminReturns /></RequireAuth>} />
              <Route path="/admin/receipts" element={<RequireAuth permission={{ domain: "orders", action: "read" }}><AdminReceipts /></RequireAuth>} />
              <Route path="/admin/discounts" element={<RequireAuth permission={{ domain: "discounts", action: "read" }}><AdminDiscounts /></RequireAuth>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </SetupGuard>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
