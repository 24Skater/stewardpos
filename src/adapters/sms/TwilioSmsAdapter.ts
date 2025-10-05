import { SmsPort, SmsMessage } from '../../core/ports/SmsPort';

export class TwilioSmsAdapter implements SmsPort {
  private config: {
    accountSid: string;
    authToken: string;
  };
  private from: string;

  constructor(config: { accountSid: string; authToken: string; from: string }) {
    this.config = config;
    this.from = config.from;
  }

  async sendSms(message: SmsMessage): Promise<{ success: boolean; error?: Error }> {
    console.log('📱 Twilio SMS Adapter (Mock)');
    console.log('Account SID:', this.config.accountSid);
    console.log('To:', message.to);
    console.log('From:', message.from || this.from);
    console.log('---');
    console.log(message.body);
    console.log('---');
    console.log('⚠️ Note: Twilio requires backend implementation for actual sending');
    
    // Real implementation would call Twilio API
    return { success: true };
  }

  isConfigured(): boolean {
    return !!(this.config.accountSid && this.config.authToken && this.from);
  }

  getProviderName(): string {
    return 'twilio';
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Twilio not configured' };
    }
    
    console.log('Testing Twilio API connection...');
    // Mock success - real implementation would test API
    return { success: true };
  }
}
