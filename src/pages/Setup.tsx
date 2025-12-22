import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { 
  Database, 
  User, 
  Shield, 
  Server, 
  CheckCircle2, 
  Loader2,
  AlertCircle,
  Info
} from 'lucide-react';

interface SetupStatus {
  isInitialized: boolean;
  hasAdminUser: boolean;
  needsSetup: boolean;
  databaseAdapter: string;
}

export default function Setup() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [testingDb, setTestingDb] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Form state
  const [adminUser, setAdminUser] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [database, setDatabase] = useState({
    adapter: 'postgres' as 'postgres' | 'sqlite',
    host: '',
    port: 5432,
    name: '',
    user: '',
    password: '',
    filename: './data/stewardpos.db',
  });

  const [auth, setAuth] = useState({
    methods: ['local'] as string[],
    google: { clientId: '', clientSecret: '' },
    oidc: { issuer: '', clientId: '', clientSecret: '' },
  });

  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('production');
  const [demoMode, setDemoMode] = useState(false);
  const [replication, setReplication] = useState({
    enabled: false,
    source: 'dev' as 'dev' | 'qa' | 'prod',
    target: 'prod' as 'dev' | 'qa' | 'prod',
  });

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: SetupStatus }>('/api/setup/status');
      if (response.success) {
        setSetupStatus(response.data);
        if (!response.data.needsSetup) {
          // Setup already complete, redirect to login
          navigate('/login');
        }
      }
    } catch (error: any) {
      // If setup endpoint doesn't exist or fails, assume setup is needed
      console.error('Failed to check setup status:', error);
    }
  };

  const testDatabaseConnection = async () => {
    setTestingDb(true);
    try {
      const response = await apiClient.post<{ success: boolean; message?: string; error?: string }>(
        '/api/setup/test-database',
        database
      );
      
      if (response.success) {
        toast({
          title: 'Success',
          description: 'Database connection successful!',
        });
        return true;
      } else {
        toast({
          title: 'Connection Failed',
          description: response.error || 'Failed to connect to database',
          variant: 'destructive',
        });
        return false;
      }
    } catch (error: any) {
      toast({
        title: 'Connection Failed',
        description: error.message || 'Failed to connect to database',
        variant: 'destructive',
      });
      return false;
    } finally {
      setTestingDb(false);
    }
  };

  const handleCompleteSetup = async () => {
    // Validation
    if (!adminUser.name || !adminUser.email || !adminUser.password) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all admin user fields',
        variant: 'destructive',
      });
      return;
    }

    if (adminUser.password !== adminUser.confirmPassword) {
      toast({
        title: 'Validation Error',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    if (adminUser.password.length < 8) {
      toast({
        title: 'Validation Error',
        description: 'Password must be at least 8 characters',
        variant: 'destructive',
      });
      return;
    }

    // In demo mode, use existing database config from environment
    const dbConfig = demoMode ? {
      adapter: (import.meta.env.VITE_DB_ADAPTER || 'postgres') as 'postgres' | 'sqlite',
      // Use existing env vars or defaults
    } : database;

    if (!demoMode && database.adapter === 'postgres') {
      if (!database.host || !database.name || !database.user) {
        toast({
          title: 'Validation Error',
          description: 'Please fill in all PostgreSQL connection details',
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      const response = await apiClient.post<{ success: boolean; message?: string; data?: any }>(
        '/api/setup/complete',
        {
          adminUser: {
            name: adminUser.name,
            email: adminUser.email,
            password: adminUser.password,
          },
          database: dbConfig,
          auth,
          environment,
          demoMode,
          replication: replication.enabled ? replication : undefined,
        }
      );

      if (response.success) {
        toast({
          title: 'Setup Complete!',
          description: 'Your POS system is now configured. Redirecting to login...',
        });
        
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      }
    } catch (error: any) {
      toast({
        title: 'Setup Failed',
        description: error.message || 'Failed to complete setup',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = 6;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-full">
              <Server className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-3xl">Welcome to stewardPOS</CardTitle>
          <CardDescription className="text-lg mt-2">
            Let's get your system configured for production use
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Progress indicator */}
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <div
                  key={s}
                  className={`flex-1 h-2 mx-1 rounded ${
                    s <= step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Step {step} of {totalSteps}
            </p>
          </div>

          {/* Step 1: Welcome & Mode Selection */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4">Choose Setup Mode</h3>
                <div className="space-y-4">
                  <Card 
                    className={`cursor-pointer transition-all ${
                      !demoMode ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                    onClick={() => setDemoMode(false)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <Server className="w-6 h-6 text-primary mt-1" />
                        <div className="flex-1">
                          <h4 className="font-semibold mb-2">Production Setup</h4>
                          <p className="text-sm text-muted-foreground">
                            Configure your system for production use with your own database and admin account.
                            Recommended for real deployments.
                          </p>
                        </div>
                        <RadioGroup value={demoMode ? 'demo' : 'prod'} onValueChange={(v) => setDemoMode(v === 'demo')}>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="prod" id="prod" />
                          </div>
                        </RadioGroup>
                      </div>
                    </CardContent>
                  </Card>

                  <Card 
                    className={`cursor-pointer transition-all ${
                      demoMode ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                    onClick={() => setDemoMode(true)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <Info className="w-6 h-6 text-primary mt-1" />
                        <div className="flex-1">
                          <h4 className="font-semibold mb-2">Demo Mode</h4>
                          <p className="text-sm text-muted-foreground">
                            Quick setup with demo data. Perfect for testing and evaluation.
                            Uses default database configuration.
                          </p>
                        </div>
                        <RadioGroup value={demoMode ? 'demo' : 'prod'} onValueChange={(v) => setDemoMode(v === 'demo')}>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="demo" id="demo" />
                          </div>
                        </RadioGroup>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {demoMode && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Demo mode will use the existing database configuration and load sample data.
                    You'll still need to create an admin account.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end">
                <Button onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Database Configuration (skip if demo mode) */}
          {step === 2 && !demoMode ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Database Configuration
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Configure your database connection. You can use an existing database server or set up a new one.
                </p>

                <div className="space-y-4">
                  <div>
                    <Label>Database Type</Label>
                    <Select
                      value={database.adapter}
                      onValueChange={(v) => setDatabase({ ...database, adapter: v as 'postgres' | 'sqlite' })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="postgres">PostgreSQL (Recommended for Production)</SelectItem>
                        <SelectItem value="sqlite">SQLite (Simple, File-based)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {database.adapter === 'postgres' ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Host</Label>
                          <Input
                            value={database.host}
                            onChange={(e) => setDatabase({ ...database, host: e.target.value })}
                            placeholder="localhost or database server IP"
                          />
                        </div>
                        <div>
                          <Label>Port</Label>
                          <Input
                            type="number"
                            value={database.port}
                            onChange={(e) => setDatabase({ ...database, port: parseInt(e.target.value) || 5432 })}
                            placeholder="5432"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Database Name</Label>
                        <Input
                          value={database.name}
                          onChange={(e) => setDatabase({ ...database, name: e.target.value })}
                          placeholder="stewardpos"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Username</Label>
                          <Input
                            value={database.user}
                            onChange={(e) => setDatabase({ ...database, user: e.target.value })}
                            placeholder="postgres"
                          />
                        </div>
                        <div>
                          <Label>Password</Label>
                          <Input
                            type="password"
                            value={database.password}
                            onChange={(e) => setDatabase({ ...database, password: e.target.value })}
                            placeholder="••••••••"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <Label>Database File Path</Label>
                      <Input
                        value={database.filename}
                        onChange={(e) => setDatabase({ ...database, filename: e.target.value })}
                        placeholder="./data/stewardpos.db"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        SQLite will create the database file automatically if it doesn't exist.
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={testDatabaseConnection}
                    disabled={testingDb}
                    variant="outline"
                    className="w-full"
                  >
                    {testingDb ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing Connection...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Test Connection
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </div>
          ) : step === 2 && demoMode ? (
            // Skip database step in demo mode, go directly to admin user
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Demo mode will use the existing database configuration. Proceeding to admin account creation...
                </AlertDescription>
              </Alert>
              <div className="flex justify-end">
                <Button onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </div>
          ) : null}

          {/* Step 3: Admin User */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Create Admin Account
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Create the root administrator account. This account will have full access to all system settings.
                </p>

                <div className="space-y-4">
                  <div>
                    <Label>Full Name</Label>
                    <Input
                      value={adminUser.name}
                      onChange={(e) => setAdminUser({ ...adminUser, name: e.target.value })}
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <Label>Email Address</Label>
                    <Input
                      type="email"
                      value={adminUser.email}
                      onChange={(e) => setAdminUser({ ...adminUser, email: e.target.value })}
                      placeholder="admin@yourcompany.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={adminUser.password}
                        onChange={(e) => setAdminUser({ ...adminUser, password: e.target.value })}
                        placeholder="••••••••"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Minimum 8 characters
                      </p>
                    </div>
                    <div>
                      <Label>Confirm Password</Label>
                      <Input
                        type="password"
                        value={adminUser.confirmPassword}
                        onChange={(e) => setAdminUser({ ...adminUser, confirmPassword: e.target.value })}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(demoMode ? 1 : 2)}>
                  Back
                </Button>
                <Button onClick={() => setStep(4)}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Authentication Methods */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Authentication Configuration
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Select which authentication methods users can use to log in.
                </p>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Available Methods</Label>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="local"
                          checked={auth.methods.includes('local')}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setAuth({ ...auth, methods: [...auth.methods, 'local'] });
                            } else {
                              setAuth({ ...auth, methods: auth.methods.filter(m => m !== 'local') });
                            }
                          }}
                        />
                        <Label htmlFor="local" className="cursor-pointer">
                          Local Authentication (Email/Password)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="google"
                          checked={auth.methods.includes('google')}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setAuth({ ...auth, methods: [...auth.methods, 'google'] });
                            } else {
                              setAuth({ ...auth, methods: auth.methods.filter(m => m !== 'google') });
                            }
                          }}
                        />
                        <Label htmlFor="google" className="cursor-pointer">
                          Google OAuth (Requires configuration)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="oidc"
                          checked={auth.methods.includes('oidc')}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setAuth({ ...auth, methods: [...auth.methods, 'oidc'] });
                            } else {
                              setAuth({ ...auth, methods: auth.methods.filter(m => m !== 'oidc') });
                            }
                          }}
                        />
                        <Label htmlFor="oidc" className="cursor-pointer">
                          OIDC/SAML (Enterprise SSO)
                        </Label>
                      </div>
                    </div>
                  </div>

                  {auth.methods.includes('google') && (
                    <div className="pl-6 border-l-2 border-primary/20 space-y-4">
                      <h4 className="font-medium">Google OAuth Configuration</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Client ID</Label>
                          <Input
                            value={auth.google.clientId}
                            onChange={(e) => setAuth({
                              ...auth,
                              google: { ...auth.google, clientId: e.target.value }
                            })}
                            placeholder="your-google-client-id"
                          />
                        </div>
                        <div>
                          <Label>Client Secret</Label>
                          <Input
                            type="password"
                            value={auth.google.clientSecret}
                            onChange={(e) => setAuth({
                              ...auth,
                              google: { ...auth.google, clientSecret: e.target.value }
                            })}
                            placeholder="••••••••"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {auth.methods.includes('oidc') && (
                    <div className="pl-6 border-l-2 border-primary/20 space-y-4">
                      <h4 className="font-medium">OIDC Configuration</h4>
                      <div>
                        <Label>Issuer URL</Label>
                        <Input
                          value={auth.oidc.issuer}
                          onChange={(e) => setAuth({
                            ...auth,
                            oidc: { ...auth.oidc, issuer: e.target.value }
                          })}
                          placeholder="https://your-identity-provider.com"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Client ID</Label>
                          <Input
                            value={auth.oidc.clientId}
                            onChange={(e) => setAuth({
                              ...auth,
                              oidc: { ...auth.oidc, clientId: e.target.value }
                            })}
                            placeholder="your-oidc-client-id"
                          />
                        </div>
                        <div>
                          <Label>Client Secret</Label>
                          <Input
                            type="password"
                            value={auth.oidc.clientSecret}
                            onChange={(e) => setAuth({
                              ...auth,
                              oidc: { ...auth.oidc, clientSecret: e.target.value }
                            })}
                            placeholder="••••••••"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button onClick={() => setStep(5)}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Environment & Advanced */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  Environment & Advanced Options
                </h3>

                <div className="space-y-6">
                  <div>
                    <Label>Environment</Label>
                    <Select
                      value={environment}
                      onValueChange={(v) => setEnvironment(v as any)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="development">Development</SelectItem>
                        <SelectItem value="staging">Staging/QA</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      This affects logging levels and security settings.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="replication"
                        checked={replication.enabled}
                        onCheckedChange={(checked) => setReplication({ ...replication, enabled: !!checked })}
                      />
                      <Label htmlFor="replication" className="cursor-pointer">
                        Enable Data Replication (Multi-Environment Setup)
                      </Label>
                    </div>

                    {replication.enabled && (
                      <div className="pl-6 border-l-2 border-primary/20 space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Configure data replication between environments (dev, qa, prod).
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Source Environment</Label>
                            <Select
                              value={replication.source}
                              onValueChange={(v) => setReplication({ ...replication, source: v as any })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="dev">Development</SelectItem>
                                <SelectItem value="qa">QA/Staging</SelectItem>
                                <SelectItem value="prod">Production</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Target Environment</Label>
                            <Select
                              value={replication.target}
                              onValueChange={(v) => setReplication({ ...replication, target: v as any })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="dev">Development</SelectItem>
                                <SelectItem value="qa">QA/Staging</SelectItem>
                                <SelectItem value="prod">Production</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            Data replication will be configured after setup. You can manage replication jobs from the admin panel.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(4)}>
                  Back
                </Button>
                <Button onClick={() => setStep(6)}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 6: Review & Complete */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-4">Review Configuration</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Review your configuration before completing setup.
                </p>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Admin Account</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <p><strong>Name:</strong> {adminUser.name}</p>
                      <p><strong>Email:</strong> {adminUser.email}</p>
                    </CardContent>
                  </Card>

                  {!demoMode && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Database</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm">
                        <p><strong>Type:</strong> {database.adapter === 'postgres' ? 'PostgreSQL' : 'SQLite'}</p>
                        {database.adapter === 'postgres' && (
                          <>
                            <p><strong>Host:</strong> {database.host}</p>
                            <p><strong>Database:</strong> {database.name}</p>
                            <p><strong>User:</strong> {database.user}</p>
                          </>
                        )}
                        {database.adapter === 'sqlite' && (
                          <p><strong>File:</strong> {database.filename}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Authentication</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <p><strong>Methods:</strong> {auth.methods.join(', ')}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Environment</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <p><strong>Mode:</strong> {environment}</p>
                      {demoMode && <p><strong>Demo Mode:</strong> Enabled</p>}
                      {replication.enabled && (
                        <p><strong>Replication:</strong> {replication.source} → {replication.target}</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(5)}>
                  Back
                </Button>
                <Button onClick={handleCompleteSetup} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Complete Setup
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

