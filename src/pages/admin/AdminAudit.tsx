import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function AdminAudit() {
  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground">Track system changes and user actions</p>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
