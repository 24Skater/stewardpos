import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import SetupGuard from "@/components/SetupGuard";
import StoreBranding from "./components/StoreBranding";
import RequireAuth from "@/components/RequireAuth";
import RequireTill from "@/components/RequireTill";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";

/**
 * The register is eager; everything else is split out.
 *
 * A till loads one screen and stays on it all day. Bundling the twenty admin
 * pages into that first paint meant a cashier downloaded the reporting stack —
 * recharts, jspdf, xlsx — before ringing a sale, on whatever connection the
 * shop has. Login is eager too, because it is the only thing in front of POS.
 */
import POS from "./pages/POS";
import Login from "./pages/Login";

const Setup = lazy(() => import("./pages/Setup"));
const PairRegister = lazy(() => import("./pages/PairRegister"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Settings = lazy(() => import("./pages/Settings"));
const ServicesPos = lazy(() => import("./pages/ServicesPos"));
const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminInventory = lazy(() => import("./pages/admin/AdminInventory"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const AdminExports = lazy(() => import("./pages/admin/AdminExports"));
const AdminCustomers = lazy(() => import("./pages/admin/AdminCustomers"));
const AdminServices = lazy(() => import("./pages/admin/AdminServices"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminRoles = lazy(() => import("./pages/admin/AdminRoles"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminComponents = lazy(() => import("./pages/admin/AdminComponents"));
const AdminQuotes = lazy(() => import("./pages/admin/AdminQuotes"));
const AdminApiKeys = lazy(() => import("./pages/admin/AdminApiKeys"));
const AdminReturns = lazy(() => import("./pages/admin/AdminReturns"));
const AdminReceipts = lazy(() => import("./pages/admin/AdminReceipts"));
const AdminDiscounts = lazy(() => import("./pages/admin/AdminDiscounts"));
const AdminRegisters = lazy(() => import("./pages/admin/AdminRegisters"));
const AdminOverrides = lazy(() => import("./pages/admin/AdminOverrides"));
const AdminShifts = lazy(() => import("./pages/admin/AdminShifts"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

/** Shown while a split route's chunk is in flight. */
const RouteFallback = () => (
  <div className="flex h-screen items-center justify-center" role="status" aria-live="polite">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
    <span className="sr-only">Loading</span>
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <TooltipProvider>
          {/* Applies the store's brand colour and favicon to every screen. */}
          <StoreBranding />
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SetupGuard>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              {/* No RequireAuth: the device has no user session when it pairs — see PairRegister.tsx. */}
              <Route path="/pair" element={<PairRegister />} />
              <Route path="/" element={<RequireTill><POS /></RequireTill>} />
              <Route path="/pos" element={<RequireTill><POS /></RequireTill>} />
              <Route path="/inventory" element={<RequireAuth permission={{ domain: "inventory", action: "read" }}><Inventory /></RequireAuth>} />
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
              {/* Admin-only, not settings:write — the server guards every /api/admin/api-keys
                  route with authorize(['admin']). A custom role holding settings:write used to
                  clear this gate, render the page, and be bounced by a second guard inside it. */}
              <Route path="/admin/api-keys" element={<RequireAuth requireAdmin><AdminApiKeys /></RequireAuth>} />
              <Route path="/admin/returns" element={<RequireAuth permission={{ domain: "returns", action: "read" }}><AdminReturns /></RequireAuth>} />
              <Route path="/admin/receipts" element={<RequireAuth permission={{ domain: "orders", action: "read" }}><AdminReceipts /></RequireAuth>} />
              <Route path="/admin/discounts" element={<RequireAuth permission={{ domain: "discounts", action: "read" }}><AdminDiscounts /></RequireAuth>} />
              <Route path="/admin/registers" element={<RequireAuth permission={{ domain: "registers", action: "read" }}><AdminRegisters /></RequireAuth>} />
              <Route path="/admin/overrides" element={<RequireAuth permission={{ domain: "registers", action: "read" }}><AdminOverrides /></RequireAuth>} />
              <Route path="/admin/shifts" element={<RequireAuth permission={{ domain: "registers", action: "read" }}><AdminShifts /></RequireAuth>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </SetupGuard>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
