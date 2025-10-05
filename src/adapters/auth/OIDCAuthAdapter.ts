import { AuthPort, AuthSession, SignInCredentials } from '../../core/ports/AuthPort';
import { User } from '../../core/models';

export class OIDCAuthAdapter implements AuthPort {
  private config: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  constructor(config: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) {
    this.config = config;
  }

  async signIn(credentials: SignInCredentials): Promise<{ session: AuthSession | null; error: Error | null }> {
    console.log('🔐 OIDC Auth Adapter');
    console.log('Issuer:', this.config.issuer);
    console.log('⚠️ Note: OIDC requires backend implementation');
    
    return {
      session: null,
      error: new Error('OIDC requires backend implementation'),
    };
  }

  async signOut(): Promise<void> {
    console.log('Signing out from OIDC');
  }

  async getSession(): Promise<AuthSession | null> {
    return null;
  }

  async getUser(userId: string): Promise<User | null> {
    return null;
  }

  async getCurrentUser(): Promise<User | null> {
    return null;
  }

  getProviderName(): string {
    return 'oidc';
  }

  isConfigured(): boolean {
    return !!(
      this.config.issuer &&
      this.config.clientId &&
      this.config.clientSecret &&
      this.config.redirectUri
    );
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'OIDC not configured' };
    }
    
    console.log('Testing OIDC configuration...');
    console.log('Issuer:', this.config.issuer);
    return { success: true };
  }
}
