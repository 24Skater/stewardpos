import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Search, RefreshCw, Download, Package, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { getCurrentSession, type AuthSession } from '@/lib/auth';

interface Component {
  name: string;
  currentVersion: string;
  type: 'frontend' | 'backend';
  category: 'dependency' | 'devDependency';
}

interface ComponentUpdate extends Component {
  latestVersion: string;
}

export default function AdminComponents() {
  const [components, setComponents] = useState<Component[]>([]);
  const [updates, setUpdates] = useState<ComponentUpdate[]>([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'frontend' | 'backend'>('all');
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateType, setUpdateType] = useState<'frontend' | 'backend'>('frontend');
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
    loadComponents();
  }, []);

  const loadComponents = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.get<{ success: boolean; data: Component[] }>('/api/admin/components');
      if (response && response.success && response.data) {
        setComponents(response.data);
      } else {
        console.error('Unexpected API response:', response);
        toast({
          title: 'Error',
          description: 'Unexpected response format from server',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error loading components:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load components',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const checkForUpdates = async () => {
    try {
      setIsCheckingUpdates(true);
      const response = await apiClient.get<{ success: boolean; data: ComponentUpdate[] }>('/api/admin/components/updates');
      if (response.success) {
        setUpdates(response.data);
        if (response.data.length > 0) {
          toast({
            title: 'Updates Available',
            description: `Found ${response.data.length} package(s) with available updates`,
          });
        } else {
          toast({
            title: 'All Up to Date',
            description: 'All packages are up to date',
          });
        }
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to check for updates',
        variant: 'destructive',
      });
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleUpdateSelected = async () => {
    if (selectedPackages.length === 0) {
      toast({
        title: 'No Packages Selected',
        description: 'Please select packages to update',
        variant: 'destructive',
      });
      return;
    }

    setUpdateDialogOpen(true);
  };

  const confirmUpdate = async () => {
    try {
      setIsUpdating(true);
      const response = await apiClient.post<{ success: boolean; message: string; data: any }>('/api/admin/components/update', {
        packages: selectedPackages,
        type: updateType,
      });

      if (response.success) {
        toast({
          title: 'Success',
          description: response.message || 'Packages updated successfully',
        });
        setUpdateDialogOpen(false);
        setSelectedPackages([]);
        await loadComponents();
        await checkForUpdates();
      }
    } catch (error: any) {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update packages',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdateAll = async (type: 'frontend' | 'backend') => {
    if (!confirm(`Update all ${type} packages to latest versions? This may take several minutes.`)) {
      return;
    }

    try {
      setIsUpdating(true);
      const response = await apiClient.post<{ success: boolean; message: string; data: any }>('/api/admin/components/update-all', {
        type,
      });

      if (response.success) {
        toast({
          title: 'Success',
          description: response.message || 'All packages updated successfully',
        });
        await loadComponents();
        await checkForUpdates();
      }
    } catch (error: any) {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update all packages',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const togglePackageSelection = (packageName: string) => {
    setSelectedPackages(prev =>
      prev.includes(packageName)
        ? prev.filter(p => p !== packageName)
        : [...prev, packageName]
    );
  };

  const filteredComponents = components.filter(comp => {
    const matchesSearch = comp.name.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === 'all' || comp.type === selectedType;
    return matchesSearch && matchesType;
  });

  const filteredUpdates = updates.filter(update => {
    const matchesSearch = update.name.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === 'all' || update.type === selectedType;
    return matchesSearch && matchesType;
  });

  const hasUpdates = updates.length > 0;

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Component Management</h1>
              <p className="text-muted-foreground">Manage and update application dependencies</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={checkForUpdates}
                disabled={isCheckingUpdates || isUpdating}
              >
                {isCheckingUpdates ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Check for Updates
                  </>
                )}
              </Button>
              {selectedPackages.length > 0 && (
                <Button
                  onClick={handleUpdateSelected}
                  disabled={isUpdating}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Update Selected ({selectedPackages.length})
                </Button>
              )}
            </div>
          </div>

          <Tabs defaultValue="all" className="space-y-4">
            <TabsList>
              <TabsTrigger value="all" onClick={() => setSelectedType('all')}>All Components</TabsTrigger>
              <TabsTrigger value="frontend" onClick={() => setSelectedType('frontend')}>Frontend</TabsTrigger>
              <TabsTrigger value="backend" onClick={() => setSelectedType('backend')}>Backend</TabsTrigger>
              <TabsTrigger value="updates" onClick={() => setSelectedType('all')}>
                Updates Available {hasUpdates && <Badge variant="destructive" className="ml-2">{updates.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search components..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <TabsContent value="all" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>All Components</CardTitle>
                  <CardDescription>
                    {filteredComponents.length} component(s) found
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <Checkbox
                              checked={selectedPackages.length === filteredComponents.length && filteredComponents.length > 0}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedPackages(filteredComponents.map(c => c.name));
                                } else {
                                  setSelectedPackages([]);
                                }
                              }}
                            />
                          </TableHead>
                          <TableHead>Package Name</TableHead>
                          <TableHead>Current Version</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredComponents.map((component) => {
                          const hasUpdate = updates.some(u => u.name === component.name);
                          return (
                            <TableRow key={`${component.name}-${component.type}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedPackages.includes(component.name)}
                                  onCheckedChange={() => togglePackageSelection(component.name)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{component.name}</TableCell>
                              <TableCell>{component.currentVersion}</TableCell>
                              <TableCell>
                                <Badge variant={component.type === 'frontend' ? 'default' : 'secondary'}>
                                  {component.type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{component.category}</Badge>
                              </TableCell>
                              <TableCell>
                                {hasUpdate ? (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Update Available
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Up to Date
                                  </Badge>
                                )}
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

            <TabsContent value="frontend" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle>Frontend Components</CardTitle>
                      <CardDescription>
                        {filteredComponents.filter(c => c.type === 'frontend').length} component(s)
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleUpdateAll('frontend')}
                      disabled={isUpdating}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Update All Frontend
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedPackages.length === filteredComponents.filter(c => c.type === 'frontend').length && filteredComponents.filter(c => c.type === 'frontend').length > 0}
                            onCheckedChange={(checked) => {
                              const frontendPackages = filteredComponents.filter(c => c.type === 'frontend').map(c => c.name);
                              if (checked) {
                                setSelectedPackages(prev => [...new Set([...prev, ...frontendPackages])]);
                              } else {
                                setSelectedPackages(prev => prev.filter(p => !frontendPackages.includes(p)));
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Package Name</TableHead>
                        <TableHead>Current Version</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredComponents
                        .filter(c => c.type === 'frontend')
                        .map((component) => {
                          const hasUpdate = updates.some(u => u.name === component.name);
                          return (
                            <TableRow key={`${component.name}-${component.type}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedPackages.includes(component.name)}
                                  onCheckedChange={() => togglePackageSelection(component.name)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{component.name}</TableCell>
                              <TableCell>{component.currentVersion}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{component.category}</Badge>
                              </TableCell>
                              <TableCell>
                                {hasUpdate ? (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Update Available
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Up to Date
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="backend" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle>Backend Components</CardTitle>
                      <CardDescription>
                        {filteredComponents.filter(c => c.type === 'backend').length} component(s)
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleUpdateAll('backend')}
                      disabled={isUpdating}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Update All Backend
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedPackages.length === filteredComponents.filter(c => c.type === 'backend').length && filteredComponents.filter(c => c.type === 'backend').length > 0}
                            onCheckedChange={(checked) => {
                              const backendPackages = filteredComponents.filter(c => c.type === 'backend').map(c => c.name);
                              if (checked) {
                                setSelectedPackages(prev => [...new Set([...prev, ...backendPackages])]);
                              } else {
                                setSelectedPackages(prev => prev.filter(p => !backendPackages.includes(p)));
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Package Name</TableHead>
                        <TableHead>Current Version</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredComponents
                        .filter(c => c.type === 'backend')
                        .map((component) => {
                          const hasUpdate = updates.some(u => u.name === component.name);
                          return (
                            <TableRow key={`${component.name}-${component.type}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedPackages.includes(component.name)}
                                  onCheckedChange={() => togglePackageSelection(component.name)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{component.name}</TableCell>
                              <TableCell>{component.currentVersion}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{component.category}</Badge>
                              </TableCell>
                              <TableCell>
                                {hasUpdate ? (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Update Available
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Up to Date
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="updates" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Available Updates</CardTitle>
                  <CardDescription>
                    {filteredUpdates.length} package(s) have updates available
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {filteredUpdates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {hasUpdates ? 'No updates match your filters' : 'No updates available. All packages are up to date.'}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <Checkbox
                              checked={selectedPackages.length === filteredUpdates.length && filteredUpdates.length > 0}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedPackages(filteredUpdates.map(u => u.name));
                                } else {
                                  setSelectedPackages([]);
                                }
                              }}
                            />
                          </TableHead>
                          <TableHead>Package Name</TableHead>
                          <TableHead>Current Version</TableHead>
                          <TableHead>Latest Version</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUpdates.map((update) => (
                          <TableRow key={`${update.name}-${update.type}`}>
                            <TableCell>
                              <Checkbox
                                checked={selectedPackages.includes(update.name)}
                                onCheckedChange={() => togglePackageSelection(update.name)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{update.name}</TableCell>
                            <TableCell>{update.currentVersion}</TableCell>
                            <TableCell>
                              <Badge variant="default">{update.latestVersion}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={update.type === 'frontend' ? 'default' : 'secondary'}>
                                {update.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedPackages([update.name]);
                                  setUpdateType(update.type);
                                  handleUpdateSelected();
                                }}
                                disabled={isUpdating}
                              >
                                <Download className="w-3 h-3 mr-1" />
                                Update
                              </Button>
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

          <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Package Update</DialogTitle>
                <DialogDescription>
                  You are about to update {selectedPackages.length} package(s) in the {updateType} environment.
                  This may take several minutes and will require rebuilding the application.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selectedPackages.map((pkg) => (
                  <div key={pkg} className="flex items-center justify-between p-2 bg-muted rounded">
                    <span className="font-medium">{pkg}</span>
                    {updates.find(u => u.name === pkg) && (
                      <span className="text-sm text-muted-foreground">
                        {updates.find(u => u.name === pkg)?.currentVersion} → {updates.find(u => u.name === pkg)?.latestVersion}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUpdateDialogOpen(false)} disabled={isUpdating}>
                  Cancel
                </Button>
                <Button onClick={confirmUpdate} disabled={isUpdating}>
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Confirm Update'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

