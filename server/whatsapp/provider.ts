export type WhatsAppConnectionStatus =
  | 'disconnected'
  | 'initializing'
  | 'qr_ready'
  | 'authenticated'
  | 'ready'
  | 'auth_failure'
  | 'error';

export interface IncomingMediaAttachment {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface IncomingWhatsAppMessage {
  messageId: string;
  fromRaw: string; // e.g. 249912345678@c.us or group id
  authorRaw?: string; // participant phone inside group
  senderPhoneE164: string;
  senderDisplayName: string;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  body: string;
  hasMedia: boolean;
  downloadMedia?: () => Promise<IncomingMediaAttachment | null>;
}

export interface RemoteGroupInfo {
  waGroupId: string;
  name: string;
  description?: string;
  memberCount: number;
  members: Array<{ id: string; name?: string; isAdmin?: boolean }>;
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface TransportStateSnapshot {
  provider: 'whatsapp-web';
  isOfficialApi: boolean;
  status: WhatsAppConnectionStatus;
  qrCodeDataUrl: string | null;
  connectedPhone: string | null;
  linkedBotPhone: string;
  connectedName: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  notice: string;
}

export type IncomingMessageListener = (msg: IncomingWhatsAppMessage) => Promise<void>;

export interface WhatsAppTransport {
  readonly providerName: 'whatsapp-web';
  getState(): TransportStateSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
  reconnect(): Promise<void>;
  onMessage(listener: IncomingMessageListener): void;
  sendText(toChatId: string, text: string): Promise<SendMessageResult>;
  sendFile(toChatId: string, filePath: string, caption?: string, filename?: string): Promise<SendMessageResult>;
  fetchGroups(): Promise<RemoteGroupInfo[]>;
}
