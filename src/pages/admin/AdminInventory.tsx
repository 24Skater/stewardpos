import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { getAllProducts, Product, resetDatabase, updateProduct, deleteProduct } from '@/lib/db';
import { Search, Plus, Edit, Trash2, Upload, RefreshCw } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission } from '@/lib/auth';
import { exportInventoryToCSV } from '@/lib/export-utils';
import ImportInventoryDialog from '@/components/ImportInventoryDialog';
import { useToast } from '@/hooks/use-toast';

export default function AdminInventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const session = getCurrentSession();
  const { toast } = useToast();

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    const data = await getAllProducts();
    setProducts(data);
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  const canWrite = hasPermission(session, 'inventory', 'write');
  const canDelete = hasPermission(session, 'inventory', 'delete');

  const handleExport = () => {
    exportInventoryToCSV(products);
  };

  const handleReset = async () => {
    if (confirm('This will delete all current data and load fresh inventory. Continue?')) {
      await resetDatabase();
      await loadProducts();
      toast({ title: 'Database reset complete', description: 'Fresh inventory loaded' });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    
    await updateProduct(editingProduct.id, {
      name: editingProduct.name,
      description: editingProduct.description,
      category: editingProduct.category,
      basePrice: editingProduct.basePrice,
      barcode: editingProduct.barcode,
      image: editingProduct.image,
    });
    
    setEditDialogOpen(false);
    setEditingProduct(null);
    await loadProducts();
    toast({ title: 'Product updated' });
  };

  const handleDelete = async (productId: string) => {
    if (confirm('Delete this product? This cannot be undone.')) {
      await deleteProduct(productId);
      await loadProducts();
      toast({ title: 'Product deleted' });
    }
  };

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Inventory Management</h1>
              <p className="text-muted-foreground">Manage products and variants</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExport}>
                Export CSV
              </Button>
              {canWrite && (
                <>
                  <Button variant="outline" onClick={handleReset}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset Data
                  </Button>
                  <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </Button>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Product
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead>Total Stock</TableHead>
                  <TableHead>Status</TableHead>
                  {(canWrite || canDelete) && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => {
                  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
                  const activeVariants = product.variants.filter(v => v.enabled).length;
                  const lowStock = product.variants.some(v => v.enabled && v.stock < 10);

                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.category}</TableCell>
                      <TableCell>${product.basePrice.toFixed(2)}</TableCell>
                      <TableCell>{activeVariants} active</TableCell>
                      <TableCell>
                        <span className={lowStock ? 'text-orange-600 font-semibold' : ''}>
                          {totalStock}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={lowStock ? 'destructive' : 'secondary'}>
                          {lowStock ? 'Low Stock' : 'In Stock'}
                        </Badge>
                      </TableCell>
                      {(canWrite || canDelete) && (
                        <TableCell>
                          <div className="flex gap-2">
                            {canWrite && (
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ImportInventoryDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            onImportComplete={loadProducts}
          />

          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Product</DialogTitle>
              </DialogHeader>
              {editingProduct && (
                <div className="space-y-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={editingProduct.name}
                      onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={editingProduct.description || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Input
                      value={editingProduct.category}
                      onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Base Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editingProduct.basePrice}
                      onChange={(e) => setEditingProduct({ ...editingProduct, basePrice: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label>Image URL</Label>
                    <Input
                      value={editingProduct.image || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, image: e.target.value })}
                      placeholder="https://example.com/image.jpg or /path/to/image.png"
                    />
                  </div>
                  <div>
                    <Label>Barcode</Label>
                    <Input
                      value={editingProduct.barcode || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveEdit}>Save Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
