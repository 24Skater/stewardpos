import { EmailPort, EmailMessage } from '../../core/ports/EmailPort';

export class SMTPEmailAdapter implements EmailPort {
  private config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
  private from: string;

  constructor(config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  }) {
    this.config = config;
    this.from = config.from;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; error?: Error }> {
    console.log('📧 SMTP Email Adapter (Mock)');
    console.log('SMTP Server:', `${this.config.host}:${this.config.port}`);
    console.log('To:', message.to);
    console.log('From:', message.from || this.from);
    console.log('Subject:', message.subject);
    console.log('---');
    console.log(message.text || message.html || '(no body)');
    console.log('---');
    console.log('⚠️ Note: SMTP requires backend implementation for actual sending');
    
    // This is a mock - real implementation would use nodemailer or similar
    return { success: true };
  }

  isConfigured(): boolean {
    return !!(
      this.config.host &&
      this.config.port &&
      this.config.user &&
      this.config.password
    );
  }

  getProviderName(): string {
    return 'smtp';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }
    
    console.log('Testing SMTP connection to', `${this.config.host}:${this.config.port}`);
    // Mock success - real implementation would test actual connection
    return { success: true };
  }
}
