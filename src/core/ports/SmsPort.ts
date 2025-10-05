export interface SmsMessage {
  to: string;
  body: string;
  from?: string;
}

export interface SmsPort {
  sendSms(message: SmsMessage): Promise<{ success: boolean; error?: Error }>;
  isConfigured(): boolean;
  getProviderName(): string;
}
