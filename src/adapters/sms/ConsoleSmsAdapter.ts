import { SmsPort, SmsMessage } from '../../core/ports/SmsPort';

export class ConsoleSmsAdapter implements SmsPort {
  async sendSms(message: SmsMessage): Promise<{ success: boolean; error?: Error }> {
    console.log('📱 SMS (Console Adapter)');
    console.log('To:', message.to);
    console.log('From:', message.from || '(system)');
    console.log('---');
    console.log(message.body);
    console.log('---');
    
    return { success: true };
  }

  isConfigured(): boolean {
    return true;
  }

  getProviderName(): string {
    return 'console';
  }
}
