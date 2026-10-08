export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface OutgoingEmail {
  to: EmailRecipient;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}
