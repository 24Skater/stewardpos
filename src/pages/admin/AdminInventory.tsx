import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { adminApi, categoriesApi, productsApi, uploadApi } from '@/lib/api';
import type {
  Category,
  CreateProductRequest,
  Product,
  ProductVariant,
  UnmanagedCategory,
  UpdateProductRequest,
} from '@/lib/api';
import { Search, Plus, Edit, Trash2, Upload, RefreshCw, ImagePlus, X } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import { getCurrentSession, hasPermission, type AuthSession } from '@/lib/auth';
import { exportInventoryToCSV } from '@/lib/export-utils';
import ImportInventoryDialog from '@/components/ImportInventoryDialog';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/errors';
import { applyVariantChanges, diffVariants } from '@/lib/variant-sync';

/** A blank variant row for the editor; the temp id marks it as not yet saved. */
const blankVariant = (): ProductVariant => ({
  id: `new-${Math.random().toString(36).slice(2)}`,
  size: '',
  color: '',
  priceDelta: 0,
  stock: 0,
  enabled: true,
});

export default function AdminInventory() {
  const [products, setProducts] = useState<Product[]>([]);
  /** Products the server considers low, by its threshold rather than this screen's. */
  const [lowStockProductIds, setLowStockProductIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);
  /** Names products use that no category defines — visible so they can be fixed. */
  const [unmanagedCategories, setUnmanagedCategories] = useState<UnmanagedCategory[]>([]);
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  /** When set, the category field is a "name a new one" input rather than the picker. */
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
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
      const [response, lowStock, categoryList] = await Promise.all([
        productsApi.list(),
        // Reloaded alongside the catalog, so correcting a stock count updates
        // the badge without a manual refresh.
        productsApi.lowStock(),
        categoriesApi.listWithUnmanaged(),
      ]);
      setProducts(response);
      setLowStockProductIds(new Set((lowStock ?? []).map(item => item.productId)));
      setCategories(categoryList.data ?? []);
      setUnmanagedCategories(categoryList.meta?.unmanaged ?? []);
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

  // The managed categories, plus whatever this product already says, so an
  // out-of-list value is preserved rather than quietly reassigned on save.
  const categoryOptions = Array.from(
    new Set(
      [
        ...categories.map(c => c.name),
        // Unmanaged names too, so moving a product into one that already exists
        // does not require first recreating it as a managed category.
        ...unmanagedCategories.map(c => c.name),
        editingProduct?.category,
      ].filter(Boolean) as string[]
    )
  ).sort((a, b) => a.localeCompare(b));

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
      variants: [blankVariant()],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setIsNewProduct(true);
    setUploadedImage(null);
    setNewCategory(null);
    setEditDialogOpen(true);
  };

  const handleEdit = (product: Product) => {
    // Copy the variants — the editor mutates this list, and `editingProduct`
    // would otherwise be the same array instance as the row in `products`.
    setEditingProduct({ ...product, variants: product.variants.map(v => ({ ...v })) });
    setIsNewProduct(false);
    setUploadedImage(null);
    setNewCategory(null);
    setEditDialogOpen(true);
  };

  const setVariant = (index: number, patch: Partial<ProductVariant>) => {
    setEditingProduct(prev =>
      prev
        ? { ...prev, variants: prev.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) }
        : prev
    );
  };

  const addVariant = () => {
    setEditingProduct(prev => (prev ? { ...prev, variants: [...prev.variants, blankVariant()] } : prev));
  };

  const removeVariant = (index: number) => {
    setEditingProduct(prev =>
      prev && prev.variants.length > 1
        ? { ...prev, variants: prev.variants.filter((_, i) => i !== index) }
        : prev
    );
  };

  const handleCreateCategory = async () => {
    const name = (newCategory ?? '').trim();
    if (!name) return;
    try {
      setAddingCategory(true);
      await categoriesApi.create({ name });
      await loadProducts();
      setEditingProduct(prev => (prev ? { ...prev, category: name } : prev));
      setNewCategory(null);
      toast({ title: `Category "${name}" created` });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, 'Failed to create category'),
        variant: 'destructive',
      });
    } finally {
      setAddingCategory(false);
    }
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

    // This used to base64 the file into `products.image` and report success
    // without anything having been uploaded. A 5MB photo became ~6.7MB of text
    // in the product row, sent to every client on every catalog load - so the
    // register got slower with each picture a shop added.
    try {
      setIsUploadingImage(true);
      const uploaded = await uploadApi.upload('product', file);
      setUploadedImage(uploaded.url);
      if (editingProduct) {
        setEditingProduct({ ...editingProduct, image: uploaded.url });
      }
      toast({ title: 'Image uploaded' });
    } catch (error: unknown) {
      // Silence here left the old preview showing, so the picture looked
      // attached and then was not there after saving.
      setUploadedImage(null);
      toast({
        title: 'Upload failed',
        description: getErrorMessage(error, 'The image could not be uploaded'),
        variant: 'destructive',
      });
    } finally {
      setIsUploadingImage(false);
    }
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
      setSavingEdit(true);
      if (isNewProduct) {
        // Create new product. Variants go in nested — a `new-…` temp id would be
        // rejected, so send only the fields the API takes.
        const createData: CreateProductRequest = {
          name: editingProduct.name,
          description: editingProduct.description,
          category: editingProduct.category || 'Uncategorized',
          basePrice: editingProduct.basePrice || 0,
          barcode: editingProduct.barcode,
          image: uploadedImage || editingProduct.image,
          variants: editingProduct.variants.map(({ id: _id, ...v }) => v),
        };
        await productsApi.create(createData);
        toast({ title: 'Product added successfully' });
      } else {
        // Product update does not carry variants — persist the edited list
        // through the variant sub-resource, or a stock correction is dropped.
        const updateData: UpdateProductRequest = {
          name: editingProduct.name,
          description: editingProduct.description,
          category: editingProduct.category,
          basePrice: editingProduct.basePrice,
          barcode: editingProduct.barcode,
          image: uploadedImage || editingProduct.image,
        };
        await productsApi.update(editingProduct.id, updateData);

        const original = products.find(p => p.id === editingProduct.id);
        await applyVariantChanges(
          editingProduct.id,
          diffVariants(original?.variants ?? [], editingProduct.variants)
        );
        toast({ title: 'Product updated' });
      }

      setEditDialogOpen(false);
      setEditingProduct(null);
      setIsNewProduct(false);
      setUploadedImage(null);
      setNewCategory(null);
      await loadProducts();
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error, `Failed to ${isNewProduct ? 'create' : 'update'} product`),
        variant: 'destructive',
      });
    } finally {
      setSavingEdit(false);
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
                            <Button variant="ghost" size="icon" aria-label={`Edit ${product.name}`} onClick={() => handleEdit(product)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" aria-label={`Delete ${product.name}`} onClick={() => handleDelete(product.id)}>
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
            setNewCategory(null);
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isNewProduct ? 'Add Product' : 'Edit Product'}</DialogTitle>
            </DialogHeader>
            {editingProduct && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="inventory-name">Name</Label>
                  <Input id="inventory-name"
                    value={editingProduct.name}
                    onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="inventory-description">Description</Label>
                  <Input id="inventory-description"
                    value={editingProduct.description || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  {/*
                    A free-text box here meant a typo produced a second
                    category that no other product would ever share, and the
                    seeded `categories` table went unused because nothing
                    could read it. The picker stays; "New category" is an
                    explicit action that creates a managed row rather than a
                    stray name.

                    A product whose category is not in the list still shows
                    it, rather than appearing blank — otherwise saving an
                    unrelated edit would silently move the product.
                  */}
                  {newCategory === null ? (
                    <div className="flex gap-2">
                      <Select
                        value={editingProduct.category || undefined}
                        onValueChange={(value) => setEditingProduct({ ...editingProduct, category: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" onClick={() => setNewCategory('')}>
                        <Plus className="w-4 h-4 mr-1" />
                        New
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        value={newCategory}
                        placeholder="New category name"
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); }
                        }}
                      />
                      <Button type="button" onClick={handleCreateCategory} disabled={addingCategory || !newCategory.trim()}>
                        Add
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Cancel new category" onClick={() => setNewCategory(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="inventory-base-price">Base Price</Label>
                  <Input id="inventory-base-price"
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
                          disabled={isUploadingImage}
                          className="cursor-pointer"
                        />
                        <Button type="button" variant="outline" size="icon" aria-label="Upload a product image" disabled={isUploadingImage}>
                          <ImagePlus className="w-4 h-4" />
                        </Button>
                      </div>
                      {isUploadingImage && (
                        <p className="text-xs text-muted-foreground">Uploading…</p>
                      )}
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
                  <Label htmlFor="inventory-barcode">Barcode</Label>
                  <Input id="inventory-barcode"
                    value={editingProduct.barcode || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Variants &amp; stock</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                      <Plus className="w-4 h-4 mr-1" />
                      Add variant
                    </Button>
                  </div>
                  {/* Every product needs at least one sellable variant; stock and
                      the active toggle live here, not on the product itself. */}
                  <div className="space-y-2">
                    {editingProduct.variants.map((variant, index) => (
                      <div key={variant.id} className="grid grid-cols-[1fr_1fr_5rem_5rem_auto_auto] items-end gap-2 rounded-md border border-border p-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Size</Label>
                          <Input
                            value={variant.size || ''}
                            placeholder="S, M…"
                            onChange={(e) => setVariant(index, { size: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Color</Label>
                          <Input
                            value={variant.color || ''}
                            placeholder="Red…"
                            onChange={(e) => setVariant(index, { color: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">± Price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={variant.priceDelta ?? 0}
                            onChange={(e) => setVariant(index, { priceDelta: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Stock</Label>
                          <Input
                            type="number"
                            value={variant.stock}
                            onChange={(e) => setVariant(index, { stock: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Active</Label>
                          <div className="flex h-10 items-center">
                            <Switch
                              checked={variant.enabled}
                              onCheckedChange={(checked) => setVariant(index, { enabled: checked })}
                              aria-label={`Variant ${index + 1} active`}
                            />
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove variant ${index + 1}`}
                          disabled={editingProduct.variants.length === 1}
                          onClick={() => removeVariant(index)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={savingEdit} onClick={() => {
                setEditDialogOpen(false);
                setEditingProduct(null);
                setIsNewProduct(false);
                setUploadedImage(null);
                setNewCategory(null);
              }}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : isNewProduct ? 'Create Product' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
