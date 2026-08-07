import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi, productsApi } from '@/lib/api';
import type { CreateProductRequest, Product, UpdateProductRequest } from '@/lib/api';
import { Search, Plus, Edit, Trash2, Upload, RefreshCw, ImagePlus } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, hasPermission, type AuthSession } from '@/lib/auth';
import { exportInventoryToCSV } from '@/lib/export-utils';
import ImportInventoryDialog from '@/components/ImportInventoryDialog';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';

export default function AdminInventory() {
  const [products, setProducts] = useState<Product[]>([]);
  /** Products the server considers low, by its threshold rather than this screen's. */
  const [lowStockProductIds, setLowStockProductIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const loadSession = async () => {
      const currentSession = await getCurrentSession();
      setSession(currentSession);
    };
    loadSession();
  }, []);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const [response, lowStock] = await Promise.all([
        productsApi.list(),
        // Reloaded alongside the catalog, so correcting a stock count updates
        // the badge without a manual refresh.
        productsApi.lowStock(),
      ]);
      setProducts(response);
      setLowStockProductIds(new Set((lowStock ?? []).map(item => item.productId)));
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to load products'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
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
    // The old wording - "load fresh inventory" - undersold this considerably.
    // It also deletes every order and every staff account.
    const warning = [
      'Reset the database?',
      '',
      'This permanently deletes ALL orders and sales history, ALL products, and',
      'ALL staff accounts, then restores demo data with a default admin login.',
      'It cannot be undone.',
      '',
      'The server refuses this in production.',
    ].join('\n');

    if (!confirm(warning)) {
      return;
    }

    try {
      const response = await adminApi.resetDatabase();
      toast({ 
        title: 'Database Reset', 
        description: 'Database reset successfully. Fresh inventory loaded.',
      });
      await loadProducts();
    } catch (error: unknown) {
      toast({ 
        title: 'Error', 
        description: getErrorMessage(error, 'Failed to reset database'),
        variant: 'destructive'
      });
    }
  };

  const handleAddProduct = () => {
    setEditingProduct({
      id: '',
      name: '',
      description: '',
      category: '',
      basePrice: 0,
      image: '',
      barcode: '',
      variants: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setIsNewProduct(true);
    setUploadedImage(null);
    setEditDialogOpen(true);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsNewProduct(false);
    setUploadedImage(null);
    setEditDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be less than 5MB', variant: 'destructive' });
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Please upload an image file', variant: 'destructive' });
      return;
    }

    // Convert to base64 for storage
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setUploadedImage(base64String);
      if (editingProduct) {
        setEditingProduct({ ...editingProduct, image: base64String });
      }
      toast({ title: 'Image uploaded successfully' });
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = async () => {
    if (!editingProduct || !editingProduct.name) {
      toast({
        title: 'Error',
        description: 'Product name is required',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      if (isNewProduct) {
        // Create new product
        const createData: CreateProductRequest = {
          name: editingProduct.name,
          description: editingProduct.description,
          category: editingProduct.category || 'Uncategorized',
          basePrice: editingProduct.basePrice || 0,
          barcode: editingProduct.barcode,
          image: uploadedImage || editingProduct.image,
          variants: editingProduct.variants || [],
        };
        const response = await productsApi.create(createData);
        
        setEditDialogOpen(false);
        setEditingProduct(null);
        setIsNewProduct(false);
        setUploadedImage(null);
        await loadProducts();
        toast({ title: 'Product added successfully' });
      } else {
        // Update existing product
        const updateData: UpdateProductRequest = {
          name: editingProduct.name,
          description: editingProduct.description,
          category: editingProduct.category,
          basePrice: editingProduct.basePrice,
          barcode: editingProduct.barcode,
          image: uploadedImage || editingProduct.image,
        };
        const response = await productsApi.update(editingProduct.id, updateData);
        
        setEditDialogOpen(false);
        setEditingProduct(null);
        setIsNewProduct(false);
        setUploadedImage(null);
        await loadProducts();
        toast({ title: 'Product updated' });
      }
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, `Failed to ${isNewProduct ? 'create' : 'update'} product`),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (productId: string) => {
    if (confirm('Delete this product? This cannot be undone.')) {
      try {
        const response = await productsApi.remove(productId);
        await loadProducts();
        toast({ title: 'Product deleted' });
      } catch (error: unknown) {
        toast({
          title: 'Error',
          description: getErrorMessage(error, 'Failed to delete product'),
          variant: 'destructive',
        });
      }
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
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="text-destructive hover:text-destructive"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset Demo Data
                  </Button>
                  <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </Button>
                  <Button onClick={handleAddProduct}>
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
                  // The server decides what "low" means — it is a store setting
                  // with a per-variant override, and this screen judging for
                  // itself is how it and the dashboard came to disagree.
                  const lowStock = lowStockProductIds.has(product.id);

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

          <Dialog open={editDialogOpen} onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingProduct(null);
              setIsNewProduct(false);
              setUploadedImage(null);
            }
          }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{isNewProduct ? 'Add Product' : 'Edit Product'}</DialogTitle>
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
                    <Label>Product Image</Label>
                    <Tabs defaultValue="upload" className="w-full">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="upload">Upload Image</TabsTrigger>
                        <TabsTrigger value="url">Image URL</TabsTrigger>
                      </TabsList>
                      <TabsContent value="upload" className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="cursor-pointer"
                          />
                          <Button type="button" variant="outline" size="icon">
                            <ImagePlus className="w-4 h-4" />
                          </Button>
                        </div>
                        {(uploadedImage || editingProduct.image) && (
                          <div className="mt-2 border rounded p-2">
                            <img 
                              src={uploadedImage || editingProduct.image} 
                              alt="Preview" 
                              className="max-h-32 object-contain mx-auto"
                            />
                          </div>
                        )}
                      </TabsContent>
                      <TabsContent value="url">
                        <Input
                          value={editingProduct.image || ''}
                          onChange={(e) => setEditingProduct({ ...editingProduct, image: e.target.value })}
                          placeholder="https://example.com/image.jpg"
                        />
                      </TabsContent>
                    </Tabs>
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
                <Button variant="outline" onClick={() => {
                  setEditDialogOpen(false);
                  setEditingProduct(null);
                  setIsNewProduct(false);
                  setUploadedImage(null);
                }}>Cancel</Button>
                <Button onClick={handleSaveEdit}>{isNewProduct ? 'Create Product' : 'Save Changes'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
