import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import { 
  Plus, Pencil, Trash2, Tag, Users, Percent, DollarSign, 
  Gift, Clock, Search, CheckCircle2, XCircle, AlertCircle,
  UserCheck, GraduationCap, Shield, Heart, Cake, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';

interface DiscountType {
  id: string;
  name: string;
  description?: string;
  code?: string;
  discountType: 'percentage' | 'fixed' | 'buy_x_get_y';
  discountValue: number;
  minPurchase: number;
  maxDiscount?: number | null;
  appliesTo: string;
  applicableIds: string[];
  requiresApproval: boolean;
  approvalThreshold?: number | null;
  requiresEmployeeId: boolean;
  displayOrder: number;
  color: string;
  icon?: string;
  showInPos: boolean;
  isActive: boolean;
  createdAt: number;
}

interface PromoCode {
  id: string;
  code: string;
  name: string;
  description?: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping' | 'buy_x_get_y' | 'free_item';
  discountValue: number;
  minPurchase: number;
  maxDiscount?: number | null;
  maxUses?: number | null;
  maxUsesPerCustomer: number;
  currentUses: number;
  startsAt: number;
  expiresAt?: number | null;
  firstOrderOnly: boolean;
  stackable: boolean;
  isActive: boolean;
  createdAt: number;
  createdByName?: string;
}

interface EmployeeDiscount {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  discountPercentage: number;
  maxDiscountAmount?: number | null;
  currentMonthUsage: number;
  requiresManagerApprovalAbove?: number | null;
  isActive: boolean;
  approvedByName?: string;
  approvedAt?: number;
}

const iconMap: Record<string, any> = {
  'user': UserCheck,
  'shield': Shield,
  'graduation-cap': GraduationCap,
  'heart': Heart,
  'cake': Cake,
  'alert-triangle': AlertTriangle,
};

const colorMap: Record<string, string> = {
  'blue': 'bg-blue-100 text-blue-800 border-blue-200',
  'green': 'bg-green-100 text-green-800 border-green-200',
  'purple': 'bg-purple-100 text-purple-800 border-purple-200',
  'red': 'bg-red-100 text-red-800 border-red-200',
  'pink': 'bg-pink-100 text-pink-800 border-pink-200',
  'orange': 'bg-orange-100 text-orange-800 border-orange-200',
  'gray': 'bg-gray-100 text-gray-800 border-gray-200',
};

export default function AdminDiscounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State
  const [activeTab, setActiveTab] = useState('quick-discounts');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Dialogs
  const [discountTypeDialog, setDiscountTypeDialog] = useState(false);
  const [promoCodeDialog, setPromoCodeDialog] = useState(false);
  const [employeeDiscountDialog, setEmployeeDiscountDialog] = useState(false);
  const [editingDiscountType, setEditingDiscountType] = useState<DiscountType | null>(null);
  const [editingPromoCode, setEditingPromoCode] = useState<PromoCode | null>(null);
  const [editingEmployeeDiscount, setEditingEmployeeDiscount] = useState<EmployeeDiscount | null>(null);

  // Form state
  const [discountTypeForm, setDiscountTypeForm] = useState({
    name: '',
    description: '',
    code: '',
    discountType: 'percentage' as const,
    discountValue: 10,
    minPurchase: 0,
    maxDiscount: '',
    requiresApproval: false,
    approvalThreshold: '',
    requiresEmployeeId: false,
    displayOrder: 0,
    color: 'gray',
    icon: 'tag',
    showInPos: true,
    isActive: true,
  });

  const [promoCodeForm, setPromoCodeForm] = useState({
    code: '',
    name: '',
    description: '',
    discountType: 'percentage' as const,
    discountValue: 10,
    minPurchase: 0,
    maxDiscount: '',
    maxUses: '',
    maxUsesPerCustomer: 1,
    startsAt: new Date().toISOString().slice(0, 16),
    expiresAt: '',
    firstOrderOnly: false,
    stackable: false,
    isActive: true,
  });

  const [employeeDiscountForm, setEmployeeDiscountForm] = useState({
    userId: '',
    discountPercentage: 10,
    maxDiscountAmount: '',
    requiresManagerApprovalAbove: '',
    isActive: true,
  });

  // Queries
  const { data: discountTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ['discount-types'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DiscountType[] }>('/api/discounts/types');
      return res.data;
    },
  });

  const { data: promoCodes = [], isLoading: loadingPromos } = useQuery({
    queryKey: ['promo-codes'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: PromoCode[] }>('/api/discounts/promos');
      return res.data;
    },
  });

  const { data: employeeDiscounts = [], isLoading: loadingEmployee } = useQuery({
    queryKey: ['employee-discounts'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: EmployeeDiscount[] }>('/api/discounts/employee');
      return res.data;
    },
  });

  const { data: discountStats } = useQuery({
    queryKey: ['discount-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: any }>('/api/discounts/stats');
      return res.data;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-for-employee-discount'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: any[] }>('/api/admin/users');
      return res.data;
    },
  });

  // Mutations
  const createDiscountType = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/discounts/types', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-types'] });
      setDiscountTypeDialog(false);
      toast({ title: 'Quick discount created successfully' });
    },
    onError: () => toast({ title: 'Failed to create discount', variant: 'destructive' }),
  });

  const updateDiscountType = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.put(`/api/discounts/types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-types'] });
      setDiscountTypeDialog(false);
      toast({ title: 'Quick discount updated successfully' });
    },
    onError: () => toast({ title: 'Failed to update discount', variant: 'destructive' }),
  });

  const deleteDiscountType = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/discounts/types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-types'] });
      toast({ title: 'Quick discount deleted' });
    },
    onError: () => toast({ title: 'Failed to delete discount', variant: 'destructive' }),
  });

  const createPromoCode = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/discounts/promos', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      setPromoCodeDialog(false);
      toast({ title: 'Promo code created successfully' });
    },
    onError: () => toast({ title: 'Failed to create promo code', variant: 'destructive' }),
  });

  const updatePromoCode = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiClient.put(`/api/discounts/promos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      setPromoCodeDialog(false);
      toast({ title: 'Promo code updated successfully' });
    },
    onError: () => toast({ title: 'Failed to update promo code', variant: 'destructive' }),
  });

  const deletePromoCode = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/discounts/promos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      toast({ title: 'Promo code deleted' });
    },
    onError: () => toast({ title: 'Failed to delete promo code', variant: 'destructive' }),
  });

  const upsertEmployeeDiscount = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/discounts/employee', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-discounts'] });
      setEmployeeDiscountDialog(false);
      toast({ title: 'Employee discount saved successfully' });
    },
    onError: () => toast({ title: 'Failed to save employee discount', variant: 'destructive' }),
  });

  const deleteEmployeeDiscount = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/discounts/employee/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-discounts'] });
      toast({ title: 'Employee discount removed' });
    },
    onError: () => toast({ title: 'Failed to remove employee discount', variant: 'destructive' }),
  });

  // Handlers
  const openNewDiscountType = () => {
    setEditingDiscountType(null);
    setDiscountTypeForm({
      name: '',
      description: '',
      code: '',
      discountType: 'percentage',
      discountValue: 10,
      minPurchase: 0,
      maxDiscount: '',
      requiresApproval: false,
      approvalThreshold: '',
      requiresEmployeeId: false,
      displayOrder: 0,
      color: 'gray',
      icon: 'tag',
      showInPos: true,
      isActive: true,
    });
    setDiscountTypeDialog(true);
  };

  const openEditDiscountType = (dt: DiscountType) => {
    setEditingDiscountType(dt);
    setDiscountTypeForm({
      name: dt.name,
      description: dt.description || '',
      code: dt.code || '',
      discountType: dt.discountType,
      discountValue: dt.discountValue,
      minPurchase: dt.minPurchase,
      maxDiscount: dt.maxDiscount?.toString() || '',
      requiresApproval: dt.requiresApproval,
      approvalThreshold: dt.approvalThreshold?.toString() || '',
      requiresEmployeeId: dt.requiresEmployeeId,
      displayOrder: dt.displayOrder,
      color: dt.color,
      icon: dt.icon || 'tag',
      showInPos: dt.showInPos,
      isActive: dt.isActive,
    });
    setDiscountTypeDialog(true);
  };

  const handleSaveDiscountType = () => {
    const data = {
      ...discountTypeForm,
      maxDiscount: discountTypeForm.maxDiscount ? parseFloat(discountTypeForm.maxDiscount) : null,
      approvalThreshold: discountTypeForm.approvalThreshold ? parseFloat(discountTypeForm.approvalThreshold) : null,
    };
    
    if (editingDiscountType) {
      updateDiscountType.mutate({ id: editingDiscountType.id, data });
    } else {
      createDiscountType.mutate(data);
    }
  };

  const openNewPromoCode = () => {
    setEditingPromoCode(null);
    setPromoCodeForm({
      code: '',
      name: '',
      description: '',
      discountType: 'percentage',
      discountValue: 10,
      minPurchase: 0,
      maxDiscount: '',
      maxUses: '',
      maxUsesPerCustomer: 1,
      startsAt: new Date().toISOString().slice(0, 16),
      expiresAt: '',
      firstOrderOnly: false,
      stackable: false,
      isActive: true,
    });
    setPromoCodeDialog(true);
  };

  const openEditPromoCode = (pc: PromoCode) => {
    setEditingPromoCode(pc);
    setPromoCodeForm({
      code: pc.code,
      name: pc.name,
      description: pc.description || '',
      discountType: pc.discountType as any,
      discountValue: pc.discountValue,
      minPurchase: pc.minPurchase,
      maxDiscount: pc.maxDiscount?.toString() || '',
      maxUses: pc.maxUses?.toString() || '',
      maxUsesPerCustomer: pc.maxUsesPerCustomer,
      startsAt: new Date(pc.startsAt).toISOString().slice(0, 16),
      expiresAt: pc.expiresAt ? new Date(pc.expiresAt).toISOString().slice(0, 16) : '',
      firstOrderOnly: pc.firstOrderOnly,
      stackable: pc.stackable,
      isActive: pc.isActive,
    });
    setPromoCodeDialog(true);
  };

  const handleSavePromoCode = () => {
    const data = {
      ...promoCodeForm,
      maxDiscount: promoCodeForm.maxDiscount ? parseFloat(promoCodeForm.maxDiscount) : null,
      maxUses: promoCodeForm.maxUses ? parseInt(promoCodeForm.maxUses) : null,
      startsAt: new Date(promoCodeForm.startsAt).toISOString(),
      expiresAt: promoCodeForm.expiresAt ? new Date(promoCodeForm.expiresAt).toISOString() : null,
    };
    
    if (editingPromoCode) {
      updatePromoCode.mutate({ id: editingPromoCode.id, data });
    } else {
      createPromoCode.mutate(data);
    }
  };

  const openNewEmployeeDiscount = () => {
    setEditingEmployeeDiscount(null);
    setEmployeeDiscountForm({
      userId: '',
      discountPercentage: 10,
      maxDiscountAmount: '',
      requiresManagerApprovalAbove: '',
      isActive: true,
    });
    setEmployeeDiscountDialog(true);
  };

  const openEditEmployeeDiscount = (ed: EmployeeDiscount) => {
    setEditingEmployeeDiscount(ed);
    setEmployeeDiscountForm({
      userId: ed.userId,
      discountPercentage: ed.discountPercentage,
      maxDiscountAmount: ed.maxDiscountAmount?.toString() || '',
      requiresManagerApprovalAbove: ed.requiresManagerApprovalAbove?.toString() || '',
      isActive: ed.isActive,
    });
    setEmployeeDiscountDialog(true);
  };

  const handleSaveEmployeeDiscount = () => {
    const data = {
      ...employeeDiscountForm,
      maxDiscountAmount: employeeDiscountForm.maxDiscountAmount ? parseFloat(employeeDiscountForm.maxDiscountAmount) : null,
      requiresManagerApprovalAbove: employeeDiscountForm.requiresManagerApprovalAbove ? parseFloat(employeeDiscountForm.requiresManagerApprovalAbove) : null,
    };
    upsertEmployeeDiscount.mutate(data);
  };

  const getPromoStatus = (promo: PromoCode) => {
    const now = Date.now();
    if (!promo.isActive) return { label: 'Inactive', color: 'bg-gray-100 text-gray-600' };
    if (promo.expiresAt && promo.expiresAt < now) return { label: 'Expired', color: 'bg-red-100 text-red-600' };
    if (promo.startsAt > now) return { label: 'Scheduled', color: 'bg-blue-100 text-blue-600' };
    if (promo.maxUses && promo.currentUses >= promo.maxUses) return { label: 'Exhausted', color: 'bg-orange-100 text-orange-600' };
    return { label: 'Active', color: 'bg-green-100 text-green-600' };
  };

  // Filter
  const filteredTypes = discountTypes.filter(dt => 
    dt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    dt.code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPromos = promoCodes.filter(pc =>
    pc.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">Discounts & Promotions</h1>
              <p className="text-muted-foreground">Manage promo codes, quick discounts, and employee discounts</p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Discounts Given</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{discountStats?.totalDiscounts || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Discount Amount</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${(discountStats?.totalDiscountAmount || 0).toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Promo Codes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {promoCodes.filter(p => p.isActive && (!p.expiresAt || p.expiresAt > Date.now())).length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Employees with Discount</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{employeeDiscounts.filter(e => e.isActive).length}</div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search discounts or promo codes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="quick-discounts">
                <Tag className="w-4 h-4 mr-2" />
                Quick Discounts
              </TabsTrigger>
              <TabsTrigger value="promo-codes">
                <Gift className="w-4 h-4 mr-2" />
                Promo Codes
              </TabsTrigger>
              <TabsTrigger value="employee-discounts">
                <Users className="w-4 h-4 mr-2" />
                Employee Discounts
              </TabsTrigger>
            </TabsList>

            {/* Quick Discounts Tab */}
            <TabsContent value="quick-discounts" className="mt-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Quick Discounts</CardTitle>
                    <CardDescription>Pre-configured discounts for fast checkout (Senior, Military, etc.)</CardDescription>
                  </div>
                  <Button onClick={openNewDiscountType}>
                    <Plus className="w-4 h-4 mr-2" /> Add Quick Discount
                  </Button>
                </CardHeader>
                <CardContent>
                  {loadingTypes ? (
                    <p>Loading...</p>
                  ) : filteredTypes.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No quick discounts found</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredTypes.map((dt) => {
                        const IconComponent = iconMap[dt.icon || ''] || Tag;
                        return (
                          <Card key={dt.id} className={`border-2 ${!dt.isActive ? 'opacity-50' : ''}`}>
                            <CardContent className="pt-6">
                              <div className="flex items-start justify-between mb-4">
                                <div className={`p-2 rounded-lg ${colorMap[dt.color] || colorMap.gray}`}>
                                  <IconComponent className="w-5 h-5" />
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openEditDiscountType(dt)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-destructive"
                                    onClick={() => deleteDiscountType.mutate(dt.id)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                              <h3 className="font-semibold text-lg">{dt.name}</h3>
                              {dt.code && <p className="text-sm text-muted-foreground">Code: {dt.code}</p>}
                              <p className="text-sm text-muted-foreground mt-1">{dt.description}</p>
                              <div className="mt-4 flex items-center justify-between">
                                <Badge variant="secondary" className="text-lg font-bold">
                                  {dt.discountType === 'percentage' ? `${dt.discountValue}%` : `$${dt.discountValue}`}
                                </Badge>
                                <Badge variant={dt.showInPos ? 'default' : 'outline'}>
                                  {dt.showInPos ? 'Visible in POS' : 'Hidden'}
                                </Badge>
                              </div>
                              {dt.requiresApproval && (
                                <p className="text-xs text-orange-600 mt-2 flex items-center">
                                  <AlertCircle className="w-3 h-3 mr-1" /> Requires manager approval
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Promo Codes Tab */}
            <TabsContent value="promo-codes" className="mt-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Promo Codes</CardTitle>
                    <CardDescription>Create and manage promotional codes for customers</CardDescription>
                  </div>
                  <Button onClick={openNewPromoCode}>
                    <Plus className="w-4 h-4 mr-2" /> Create Promo Code
                  </Button>
                </CardHeader>
                <CardContent>
                  {loadingPromos ? (
                    <p>Loading...</p>
                  ) : filteredPromos.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No promo codes found</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Discount</TableHead>
                          <TableHead>Usage</TableHead>
                          <TableHead>Valid Period</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPromos.map((pc) => {
                          const status = getPromoStatus(pc);
                          return (
                            <TableRow key={pc.id}>
                              <TableCell>
                                <code className="px-2 py-1 bg-muted rounded font-mono text-sm">{pc.code}</code>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{pc.name}</p>
                                  {pc.description && (
                                    <p className="text-xs text-muted-foreground">{pc.description}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {pc.discountType === 'percentage' ? `${pc.discountValue}%` : `$${pc.discountValue}`}
                                </Badge>
                                {pc.minPurchase > 0 && (
                                  <p className="text-xs text-muted-foreground">Min: ${pc.minPurchase}</p>
                                )}
                              </TableCell>
                              <TableCell>
                                {pc.maxUses ? (
                                  <span>{pc.currentUses} / {pc.maxUses}</span>
                                ) : (
                                  <span>{pc.currentUses} / ∞</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  <p>{format(pc.startsAt, 'MMM d, yyyy')}</p>
                                  {pc.expiresAt ? (
                                    <p className="text-muted-foreground">to {format(pc.expiresAt, 'MMM d, yyyy')}</p>
                                  ) : (
                                    <p className="text-muted-foreground">No expiry</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={status.color}>{status.label}</Badge>
                                {pc.firstOrderOnly && (
                                  <Badge variant="outline" className="ml-1 text-xs">First order only</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openEditPromoCode(pc)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-destructive"
                                    onClick={() => deletePromoCode.mutate(pc.id)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Employee Discounts Tab */}
            <TabsContent value="employee-discounts" className="mt-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Employee Discounts</CardTitle>
                    <CardDescription>Configure discount rates for employees</CardDescription>
                  </div>
                  <Button onClick={openNewEmployeeDiscount}>
                    <Plus className="w-4 h-4 mr-2" /> Add Employee Discount
                  </Button>
                </CardHeader>
                <CardContent>
                  {loadingEmployee ? (
                    <p>Loading...</p>
                  ) : employeeDiscounts.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No employee discounts configured</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Discount %</TableHead>
                          <TableHead>Monthly Cap</TableHead>
                          <TableHead>Month Usage</TableHead>
                          <TableHead>Approval Required</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeeDiscounts.map((ed) => (
                          <TableRow key={ed.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{ed.userName}</p>
                                <p className="text-xs text-muted-foreground">{ed.userEmail}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{ed.discountPercentage}%</Badge>
                            </TableCell>
                            <TableCell>
                              {ed.maxDiscountAmount ? `$${ed.maxDiscountAmount}` : 'Unlimited'}
                            </TableCell>
                            <TableCell>
                              ${ed.currentMonthUsage.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              {ed.requiresManagerApprovalAbove ? (
                                <span className="text-sm">Above ${ed.requiresManagerApprovalAbove}</span>
                              ) : (
                                <span className="text-muted-foreground">No</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ed.isActive ? 'default' : 'secondary'}>
                                {ed.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditEmployeeDiscount(ed)}>
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="text-destructive"
                                  onClick={() => deleteEmployeeDiscount.mutate(ed.userId)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Quick Discount Dialog */}
          <Dialog open={discountTypeDialog} onOpenChange={setDiscountTypeDialog}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingDiscountType ? 'Edit Quick Discount' : 'Create Quick Discount'}</DialogTitle>
                <DialogDescription>
                  Configure a quick discount that can be applied at checkout
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={discountTypeForm.name}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, name: e.target.value})}
                      placeholder="Senior Discount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Internal Code</Label>
                    <Input
                      value={discountTypeForm.code}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, code: e.target.value.toUpperCase()})}
                      placeholder="SENIOR"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={discountTypeForm.description}
                    onChange={(e) => setDiscountTypeForm({...discountTypeForm, description: e.target.value})}
                    placeholder="10% discount for customers 65+"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount Type</Label>
                    <Select
                      value={discountTypeForm.discountType}
                      onValueChange={(v: any) => setDiscountTypeForm({...discountTypeForm, discountType: v})}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                        <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Discount Value *</Label>
                    <Input
                      type="number"
                      value={discountTypeForm.discountValue}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, discountValue: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Min Purchase ($)</Label>
                    <Input
                      type="number"
                      value={discountTypeForm.minPurchase}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, minPurchase: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Discount Cap ($)</Label>
                    <Input
                      type="number"
                      value={discountTypeForm.maxDiscount}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, maxDiscount: e.target.value})}
                      placeholder="No cap"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Color</Label>
                    <Select
                      value={discountTypeForm.color}
                      onValueChange={(v) => setDiscountTypeForm({...discountTypeForm, color: v})}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gray">Gray</SelectItem>
                        <SelectItem value="blue">Blue</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="purple">Purple</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="pink">Pink</SelectItem>
                        <SelectItem value="orange">Orange</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input
                      type="number"
                      value={discountTypeForm.displayOrder}
                      onChange={(e) => setDiscountTypeForm({...discountTypeForm, displayOrder: parseInt(e.target.value) || 0})}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show in POS</Label>
                      <p className="text-xs text-muted-foreground">Display as quick-select button in checkout</p>
                    </div>
                    <Switch
                      checked={discountTypeForm.showInPos}
                      onCheckedChange={(v) => setDiscountTypeForm({...discountTypeForm, showInPos: v})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Requires Manager Approval</Label>
                      <p className="text-xs text-muted-foreground">Manager must approve this discount</p>
                    </div>
                    <Switch
                      checked={discountTypeForm.requiresApproval}
                      onCheckedChange={(v) => setDiscountTypeForm({...discountTypeForm, requiresApproval: v})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Active</Label>
                      <p className="text-xs text-muted-foreground">Enable this discount</p>
                    </div>
                    <Switch
                      checked={discountTypeForm.isActive}
                      onCheckedChange={(v) => setDiscountTypeForm({...discountTypeForm, isActive: v})}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDiscountTypeDialog(false)}>Cancel</Button>
                <Button onClick={handleSaveDiscountType} disabled={!discountTypeForm.name || discountTypeForm.discountValue <= 0}>
                  {editingDiscountType ? 'Save Changes' : 'Create Discount'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Promo Code Dialog */}
          <Dialog open={promoCodeDialog} onOpenChange={setPromoCodeDialog}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingPromoCode ? 'Edit Promo Code' : 'Create Promo Code'}</DialogTitle>
                <DialogDescription>
                  Set up a promotional code that customers can enter at checkout
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Promo Code *</Label>
                    <Input
                      value={promoCodeForm.code}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, code: e.target.value.toUpperCase().replace(/\s/g, '')})}
                      placeholder="SAVE20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name *</Label>
                    <Input
                      value={promoCodeForm.name}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, name: e.target.value})}
                      placeholder="Summer Sale 20%"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={promoCodeForm.description}
                    onChange={(e) => setPromoCodeForm({...promoCodeForm, description: e.target.value})}
                    placeholder="Get 20% off your summer purchase"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount Type</Label>
                    <Select
                      value={promoCodeForm.discountType}
                      onValueChange={(v: any) => setPromoCodeForm({...promoCodeForm, discountType: v})}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                        <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                        <SelectItem value="free_shipping">Free Shipping</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Discount Value *</Label>
                    <Input
                      type="number"
                      value={promoCodeForm.discountValue}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, discountValue: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Min Purchase ($)</Label>
                    <Input
                      type="number"
                      value={promoCodeForm.minPurchase}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, minPurchase: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Discount Cap ($)</Label>
                    <Input
                      type="number"
                      value={promoCodeForm.maxDiscount}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, maxDiscount: e.target.value})}
                      placeholder="No cap"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Input
                      type="datetime-local"
                      value={promoCodeForm.startsAt}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, startsAt: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="datetime-local"
                      value={promoCodeForm.expiresAt}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, expiresAt: e.target.value})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Max Total Uses</Label>
                    <Input
                      type="number"
                      value={promoCodeForm.maxUses}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, maxUses: e.target.value})}
                      placeholder="Unlimited"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Uses Per Customer</Label>
                    <Input
                      type="number"
                      value={promoCodeForm.maxUsesPerCustomer}
                      onChange={(e) => setPromoCodeForm({...promoCodeForm, maxUsesPerCustomer: parseInt(e.target.value) || 1})}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>First Order Only</Label>
                      <p className="text-xs text-muted-foreground">Only valid for customer's first order</p>
                    </div>
                    <Switch
                      checked={promoCodeForm.firstOrderOnly}
                      onCheckedChange={(v) => setPromoCodeForm({...promoCodeForm, firstOrderOnly: v})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Stackable</Label>
                      <p className="text-xs text-muted-foreground">Can be combined with other promotions</p>
                    </div>
                    <Switch
                      checked={promoCodeForm.stackable}
                      onCheckedChange={(v) => setPromoCodeForm({...promoCodeForm, stackable: v})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Active</Label>
                      <p className="text-xs text-muted-foreground">Enable this promo code</p>
                    </div>
                    <Switch
                      checked={promoCodeForm.isActive}
                      onCheckedChange={(v) => setPromoCodeForm({...promoCodeForm, isActive: v})}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPromoCodeDialog(false)}>Cancel</Button>
                <Button 
                  onClick={handleSavePromoCode} 
                  disabled={!promoCodeForm.code || !promoCodeForm.name || promoCodeForm.discountValue <= 0}
                >
                  {editingPromoCode ? 'Save Changes' : 'Create Promo Code'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Employee Discount Dialog */}
          <Dialog open={employeeDiscountDialog} onOpenChange={setEmployeeDiscountDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingEmployeeDiscount ? 'Edit Employee Discount' : 'Add Employee Discount'}</DialogTitle>
                <DialogDescription>
                  Configure discount privileges for an employee
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Employee *</Label>
                  <Select
                    value={employeeDiscountForm.userId}
                    onValueChange={(v) => setEmployeeDiscountForm({...employeeDiscountForm, userId: v})}
                    disabled={!!editingEmployeeDiscount}
                  >
                    <SelectTrigger><SelectValue placeholder="Select an employee" /></SelectTrigger>
                    <SelectContent>
                      {users.map((user: any) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name} ({user.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount Percentage *</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={employeeDiscountForm.discountPercentage}
                      onChange={(e) => setEmployeeDiscountForm({...employeeDiscountForm, discountPercentage: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Cap ($)</Label>
                    <Input
                      type="number"
                      value={employeeDiscountForm.maxDiscountAmount}
                      onChange={(e) => setEmployeeDiscountForm({...employeeDiscountForm, maxDiscountAmount: e.target.value})}
                      placeholder="Unlimited"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Require Manager Approval Above ($)</Label>
                  <Input
                    type="number"
                    value={employeeDiscountForm.requiresManagerApprovalAbove}
                    onChange={(e) => setEmployeeDiscountForm({...employeeDiscountForm, requiresManagerApprovalAbove: e.target.value})}
                    placeholder="No approval required"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Active</Label>
                    <p className="text-xs text-muted-foreground">Enable this employee discount</p>
                  </div>
                  <Switch
                    checked={employeeDiscountForm.isActive}
                    onCheckedChange={(v) => setEmployeeDiscountForm({...employeeDiscountForm, isActive: v})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmployeeDiscountDialog(false)}>Cancel</Button>
                <Button 
                  onClick={handleSaveEmployeeDiscount} 
                  disabled={!employeeDiscountForm.userId || employeeDiscountForm.discountPercentage <= 0}
                >
                  {editingEmployeeDiscount ? 'Save Changes' : 'Add Discount'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

