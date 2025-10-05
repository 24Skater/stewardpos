export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

export interface EmailPort {
  sendEmail(message: EmailMessage): Promise<{ success: boolean; error?: Error }>;
  isConfigured(): boolean;
  getProviderName(): string;
}
