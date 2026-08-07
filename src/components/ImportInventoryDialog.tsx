import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { productsApi, type CreateProductRequest, type ProductVariant } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';

interface ImportInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

export default function ImportInventoryDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportInventoryDialogProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const downloadTemplate = () => {
    const template = `Product ID,Product Name,Category,Base Price,Variant ID,Size,Color,Price Delta,Price Override,SKU,Barcode,Stock,Enabled
1,Sample T-Shirt,Tees,25.00,1-m-black,M,Black,0,,TSH-M-BLK,TSH123456,100,Yes
1,Sample T-Shirt,Tees,25.00,1-l-black,L,Black,0,,TSH-L-BLK,TSH123457,75,Yes
1,Sample T-Shirt,Tees,25.00,1-xl-black,XL,Black,0,,TSH-XL-BLK,TSH123458,50,Yes
1,Sample T-Shirt,Tees,25.00,1-2xl-black,2XL,Black,5,,TSH-2XL-BLK,TSH123459,25,Yes`;

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'inventory-import-template.csv';
    link.click();
    
    toast({ title: 'Template downloaded' });
  };

  const parseCSV = (csvText: string) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });

    return rows;
  };

  /** One CSV row's worth of variant, keyed by the exported column headings. */
  const toVariant = (row: Record<string, unknown>): Omit<ProductVariant, 'id'> => {
    const optional = (key: string): string | undefined => {
      const value = String(row[key] ?? '').trim();
      return value === '' ? undefined : value;
    };

    const override = optional('Price Override');

    return {
      size: optional('Size'),
      color: optional('Color'),
      priceDelta: parseFloat(String(row['Price Delta'] ?? '')) || 0,
      priceOverride: override === undefined ? undefined : parseFloat(override),
      sku: optional('SKU'),
      barcode: optional('Barcode'),
      stock: parseInt(String(row['Stock'] ?? '')) || 0,
      enabled: String(row['Enabled'] ?? '').toLowerCase() === 'yes',
    };
  };

  /**
   * Push the parsed rows to the catalog API.
   *
   * Rows sharing a Product ID collapse into one product with many variants. An ID
   * that matches a live product updates it; anything else is created fresh under
   * a server-assigned ID, because the API does not let a client choose one.
   *
   * Variant rows are applied through the variant sub-resources, since
   * `PUT /api/products/:id` carries no variant payload of its own.
   */
  const processImport = async (rows: Record<string, unknown>[]) => {
    const grouped = new Map<
      string,
      { csvId: string; name: string; category: string; basePrice: number; barcode?: string; variants: Omit<ProductVariant, 'id'>[] }
    >();

    for (const row of rows) {
      const csvId = String(row['Product ID'] ?? '').trim();
      if (!csvId) continue;

      let product = grouped.get(csvId);
      if (!product) {
        product = {
          csvId,
          name: String(row['Product Name'] ?? '').trim(),
          category: String(row['Category'] ?? '').trim(),
          basePrice: parseFloat(String(row['Base Price'] ?? '')) || 0,
          barcode: undefined,
          variants: [],
        };
        grouped.set(csvId, product);
      }

      product.variants.push(toVariant(row));
    }

    const existing = await productsApi.list();
    const byId = new Map(existing.map((product) => [product.id, product]));

    let imported = 0;
    let updated = 0;
    let variantsChanged = 0;

    for (const product of grouped.values()) {
      const existing = byId.get(product.csvId);

      if (existing) {
        await productsApi.update(product.csvId, {
          name: product.name,
          category: product.category,
          basePrice: product.basePrice,
        });
        updated++;

        // Variant rows used to be dropped here, because there was no endpoint to
        // apply them — which made a re-import unable to do the most ordinary
        // thing a shop wants from one: correct stock counts.
        //
        // Matched on SKU, then barcode, then the size/colour pair, since a CSV
        // carries no variant id. Anything unmatched is a new option.
        for (const incoming of product.variants) {
          const match = existing.variants.find(candidate =>
            incoming.sku && candidate.sku
              ? candidate.sku === incoming.sku
              : incoming.barcode && candidate.barcode
                ? candidate.barcode === incoming.barcode
                : (candidate.size ?? '') === (incoming.size ?? '') &&
                  (candidate.color ?? '') === (incoming.color ?? '')
          );

          if (match) {
            await productsApi.variants.update(existing.id, match.id, incoming);
          } else {
            await productsApi.variants.create(existing.id, incoming);
          }
          variantsChanged++;
        }
        continue;
      }

      const body: CreateProductRequest = {
        name: product.name,
        category: product.category,
        basePrice: product.basePrice,
        variants: product.variants,
      };
      await productsApi.create(body);
      imported++;
    }

    return { imported, updated, variantsChanged };
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV file',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      const { imported, updated, variantsChanged } = await processImport(rows);

      toast({
        title: 'Import successful',
        description:
          `${imported} products imported, ${updated} updated` +
          (variantsChanged > 0 ? `, ${variantsChanged} variants applied` : ''),
      });

      onImportComplete();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Import failed',
        description: getErrorMessage(error, 'Please check your CSV format and try again'),
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Inventory</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import or update products and variants
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Download Template */}
          <div className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Need a template?</p>
                <p className="text-xs text-muted-foreground">Download our CSV template to get started</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium mb-2">
              {isProcessing ? 'Processing...' : 'Drag & drop your CSV file here'}
            </p>
            <p className="text-xs text-muted-foreground mb-4">or</p>
            <label htmlFor="file-upload">
              <Button variant="secondary" disabled={isProcessing} asChild>
                <span>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Browse Files
                </span>
              </Button>
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
              disabled={isProcessing}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Supported format: CSV files only. Make sure your file follows the template structure.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
