import { EmailPort, EmailMessage } from '../../core/ports/EmailPort';

export class ResendEmailAdapter implements EmailPort {
  private apiKey: string;
  private from: string;

  constructor(config: { apiKey: string; from: string }) {
    this.apiKey = config.apiKey;
    this.from = config.from;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; error?: Error }> {
    console.log('📧 Resend Email Adapter (Mock)');
    console.log('To:', message.to);
    console.log('From:', message.from || this.from);
    console.log('Subject:', message.subject);
    console.log('---');
    console.log(message.text || message.html || '(no body)');
    console.log('---');
    console.log('⚠️ Note: Resend requires backend implementation for actual sending');
    
    // Real implementation would call Resend API
    return { success: true };
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.from);
  }

  getProviderName(): string {
    return 'resend';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Resend API key not configured' };
    }
    
    console.log('Testing Resend API connection...');
    // Mock success - real implementation would test API
    return { success: true };
  }
}
