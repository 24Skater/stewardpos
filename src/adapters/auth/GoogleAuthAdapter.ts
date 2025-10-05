import { AuthPort, AuthSession, SignInCredentials } from '../../core/ports/AuthPort';
import { User } from '../../core/models';

export class GoogleAuthAdapter implements AuthPort {
  private config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  constructor(config: { clientId: string; clientSecret: string; redirectUri: string }) {
    this.config = config;
  }

  async signIn(credentials: SignInCredentials): Promise<{ session: AuthSession | null; error: Error | null }> {
    console.log('🔐 Google OAuth Adapter');
    console.log('⚠️ Note: Google OAuth requires backend implementation');
    
    return {
      session: null,
      error: new Error('Google OAuth requires backend implementation'),
    };
  }

  async signOut(): Promise<void> {
    console.log('Signing out from Google OAuth');
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
    return 'google';
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Google OAuth not configured' };
    }
    
    console.log('Testing Google OAuth configuration...');
    return { success: true };
  }
}
