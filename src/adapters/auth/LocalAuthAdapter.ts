import { AuthPort, AuthSession, SignInCredentials } from '../../core/ports/AuthPort';
import { User } from '../../core/models';
import * as auth from '../../lib/auth';
import { getUserByEmail, updateUser } from '../../lib/db-operations';
import bcrypt from 'bcryptjs';

export class LocalAuthAdapter implements AuthPort {
  async signIn(credentials: SignInCredentials): Promise<{ session: AuthSession | null; error: Error | null }> {
    try {
      const user = await getUserByEmail(credentials.email);
      
      if (!user) {
        return { session: null, error: new Error('Invalid credentials') };
      }

      const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
      
      if (!isValid) {
        return { session: null, error: new Error('Invalid credentials') };
      }

      if (user.status !== 'active') {
        return { session: null, error: new Error('Account is inactive') };
      }

      // Update last login
      await updateUser({ ...user, lastLoginAt: Date.now() });

      // Store session (use existing auth system)
      const authSession = await auth.login(credentials.email, credentials.password);
      
      if (!authSession) {
        return { session: null, error: new Error('Failed to create session') };
      }

      const session: AuthSession = {
        user: authSession.user,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };

      return { session, error: null };
    } catch (error) {
      return { session: null, error: error as Error };
    }
  }

  async signOut(): Promise<void> {
    auth.logout();
  }

  async getSession(): Promise<AuthSession | null> {
    const authSession = auth.getCurrentSession();
    if (!authSession) {
      return null;
    }

    return {
      user: authSession.user,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  async getUser(userId: string): Promise<User | null> {
    const authSession = auth.getCurrentSession();
    if (authSession && authSession.user.id === userId) {
      return authSession.user;
    }
    return null;
  }

  async getCurrentUser(): Promise<User | null> {
    const authSession = auth.getCurrentSession();
    return authSession?.user || null;
  }

  getProviderName(): string {
    return 'local';
  }

  isConfigured(): boolean {
    return true;
  }
}
