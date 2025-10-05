import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AdminSettings() {
  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Settings</h1>
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="auth">Authentication</TabsTrigger>
            </TabsList>
            <TabsContent value="general">
              <Card><CardHeader><CardTitle>Store Settings</CardTitle></CardHeader><CardContent><p>Configure store details</p></CardContent></Card>
            </TabsContent>
            <TabsContent value="auth">
              <Card><CardHeader><CardTitle>Authentication Providers</CardTitle></CardHeader><CardContent><p>Manage login methods</p></CardContent></Card>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
