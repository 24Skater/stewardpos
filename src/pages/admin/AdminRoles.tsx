import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function AdminRoles() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">Roles & Users</h1>
          <p className="text-muted-foreground">Manage user roles and permissions</p>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
