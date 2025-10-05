import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Product, ProductVariant, getAllProducts, addProduct, updateProduct, deleteProduct } from "@/lib/db";
import { ArrowLeft, Plus, Pencil, Trash2, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<Product | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    const allProducts = await getAllProducts();
    setProducts(allProducts);
  };

  const handleAddProduct = () => {
    const newProduct: Product = {
      id: `prod-${Date.now()}`,
      name: "",
      category: "Apparel",
      basePrice: 0,
      variants: [{ id: `var-${Date.now()}`, priceDelta: 0, stock: 0, enabled: true }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setCurrentProduct(newProduct);
    setEditDialogOpen(true);
  };

  const handleEditProduct = (product: Product) => {
    setCurrentProduct({ ...product });
    setEditDialogOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!currentProduct || !currentProduct.name) {
      toast({
        title: "Error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }

    const isNew = !products.find(p => p.id === currentProduct.id);
    currentProduct.updatedAt = Date.now();

    if (isNew) {
      await addProduct(currentProduct);
      toast({ title: "Product added successfully" });
    } else {
      await updateProduct(currentProduct);
      toast({ title: "Product updated successfully" });
    }

    await loadProducts();
    setEditDialogOpen(false);
    setCurrentProduct(null);
  };

  const handleDeleteProduct = async (id: string) => {
    if (confirm("Delete this product?")) {
      await deleteProduct(id);
      toast({ title: "Product deleted" });
      await loadProducts();
    }
  };

  const handleAddVariant = () => {
    if (!currentProduct) return;
    const newVariant: ProductVariant = {
      id: `var-${Date.now()}`,
      priceDelta: 0,
      stock: 0,
      enabled: true,
    };
    setCurrentProduct({
      ...currentProduct,
      variants: [...currentProduct.variants, newVariant],
    });
  };

  const handleUpdateVariant = (index: number, field: keyof ProductVariant, value: any) => {
    if (!currentProduct) return;
    const updatedVariants = [...currentProduct.variants];
    updatedVariants[index] = { ...updatedVariants[index], [field]: value };
    setCurrentProduct({ ...currentProduct, variants: updatedVariants });
  };

  const handleRemoveVariant = (index: number) => {
    if (!currentProduct || currentProduct.variants.length === 1) return;
    setCurrentProduct({
      ...currentProduct,
      variants: currentProduct.variants.filter((_, i) => i !== index),
    });
  };

  const totalStock = (product: Product) => product.variants.reduce((sum, v) => sum + v.stock, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/')}
              className="hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="bg-gradient-to-br from-primary to-primary-glow p-2 rounded-lg">
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Inventory Management</h1>
              <p className="text-xs text-muted-foreground">{products.length} products</p>
            </div>
          </div>
          <Button onClick={handleAddProduct} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="w-4 h-4" />
            Add Product
          </Button>
        </div>
      </header>

      {/* Products Table */}
      <div className="p-6">
        <Card className="bg-card border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-foreground font-semibold">Product</TableHead>
                <TableHead className="text-foreground font-semibold">Category</TableHead>
                <TableHead className="text-foreground font-semibold">Base Price</TableHead>
                <TableHead className="text-foreground font-semibold">Variants</TableHead>
                <TableHead className="text-foreground font-semibold">Stock</TableHead>
                <TableHead className="text-right text-foreground font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map(product => (
                <TableRow key={product.id} className="border-border hover:bg-secondary/20">
                  <TableCell className="font-medium text-foreground">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">{product.category}</TableCell>
                  <TableCell className="text-foreground">${product.basePrice.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                      {product.variants.length}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={totalStock(product) > 0 ? "default" : "destructive"}
                      className={totalStock(product) > 0 ? "bg-accent text-accent-foreground" : ""}
                    >
                      {totalStock(product)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditProduct(product)}
                        className="hover:bg-secondary"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteProduct(product.id)}
                        className="hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {products.length === 0 && (
            <div className="py-16 text-center">
              <Package className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No products yet</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Add your first product to get started</p>
            </div>
          )}
        </Card>
      </div>

      {/* Edit Product Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {currentProduct?.name ? "Edit Product" : "New Product"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Configure product details and variants
            </DialogDescription>
          </DialogHeader>

          {currentProduct && (
            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-foreground">Product Name</Label>
                  <Input
                    id="name"
                    value={currentProduct.name}
                    onChange={(e) => setCurrentProduct({ ...currentProduct, name: e.target.value })}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-foreground">Category</Label>
                  <Input
                    id="category"
                    value={currentProduct.category}
                    onChange={(e) => setCurrentProduct({ ...currentProduct, category: e.target.value })}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="basePrice" className="text-foreground">Base Price</Label>
                  <Input
                    id="basePrice"
                    type="number"
                    step="0.01"
                    value={currentProduct.basePrice}
                    onChange={(e) => setCurrentProduct({ ...currentProduct, basePrice: parseFloat(e.target.value) || 0 })}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="barcode" className="text-foreground">Barcode</Label>
                  <Input
                    id="barcode"
                    value={currentProduct.barcode || ""}
                    onChange={(e) => setCurrentProduct({ ...currentProduct, barcode: e.target.value })}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              {/* Variants */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-foreground text-base">Variants</Label>
                  <Button onClick={handleAddVariant} variant="outline" size="sm" className="border-border">
                    <Plus className="w-4 h-4" />
                    Add Variant
                  </Button>
                </div>

                <div className="space-y-2">
                  {currentProduct.variants.map((variant, index) => (
                    <Card key={variant.id} className="p-4 bg-secondary/20 border-border">
                      <div className="grid grid-cols-5 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Size</Label>
                          <Input
                            value={variant.size || ""}
                            onChange={(e) => handleUpdateVariant(index, 'size', e.target.value)}
                            placeholder="S, M, L..."
                            className="bg-background border-border"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Color</Label>
                          <Input
                            value={variant.color || ""}
                            onChange={(e) => handleUpdateVariant(index, 'color', e.target.value)}
                            placeholder="Red, Blue..."
                            className="bg-background border-border"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Price Delta</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={variant.priceDelta || 0}
                            onChange={(e) => handleUpdateVariant(index, 'priceDelta', parseFloat(e.target.value) || 0)}
                            className="bg-background border-border"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Stock</Label>
                          <Input
                            type="number"
                            value={variant.stock}
                            onChange={(e) => handleUpdateVariant(index, 'stock', parseInt(e.target.value) || 0)}
                            className="bg-background border-border"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveVariant(index)}
                            disabled={currentProduct.variants.length === 1}
                            className="hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleSaveProduct} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Save Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
