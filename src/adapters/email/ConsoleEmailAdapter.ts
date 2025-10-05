import { EmailPort, EmailMessage } from '../../core/ports/EmailPort';

export class ConsoleEmailAdapter implements EmailPort {
  async sendEmail(message: EmailMessage): Promise<{ success: boolean; error?: Error }> {
    console.log('📧 EMAIL (Console Adapter)');
    console.log('To:', message.to);
    console.log('From:', message.from || 'noreply@example.com');
    console.log('Subject:', message.subject);
    console.log('---');
    console.log(message.text || message.html || '(no body)');
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
