import { User } from '../models';

export interface AuthSession {
  user: User;
  token?: string;
  expiresAt?: Date;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface CreateUserData {
  name: string;
  email: string;
  passwordHash: string;
  roleIds: string[];
  status: 'active' | 'inactive';
}

export interface AuthPort {
  // Authentication
  signIn(credentials: SignInCredentials): Promise<{ session: AuthSession | null; error: Error | null }>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  
  // User management
  getUser(userId: string): Promise<User | null>;
  getCurrentUser(): Promise<User | null>;
  
  // Provider info
  getProviderName(): string;
  isConfigured(): boolean;
}
