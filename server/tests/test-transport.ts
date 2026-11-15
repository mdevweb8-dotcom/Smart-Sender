import { EventEmitter } from 'node:events';
import type {
  IncomingMessageListener,
  RemoteGroupInfo,
  SendMessageResult,
  TransportStateSnapshot,
  WhatsAppTransport,
} from '../whatsapp/provider.ts';

export class LinkedDeviceTestStub extends EventEmitter implements WhatsAppTransport {
  public readonly providerName = 'whatsapp-web' as const;
  private status: TransportStateSnapshot['status'] = 'disconnected';
  private messageListeners: IncomingMessageListener[] = [];
  public connectedPhone: string | null = null;
  public linkedBotPhone: string;
  public connectedName = 'Smart-Sender Linked Device';
  public shouldFailNextSend = false;
  public outboundHistory: Array<{ to: string; text?: string; filePath?: string; caption?: string }> = [];

  constructor(linkedBotPhone = '249900000001') {
    super();
    this.linkedBotPhone = linkedBotPhone;
  }

  async start(): Promise<void> {
    this.status = 'ready';
    this.connectedPhone = this.linkedBotPhone;
    this.emit('state', this.getState());
  }

  async stop(): Promise<void> {
    this.status = 'disconnected';
    this.connectedPhone = null;
    this.emit('state', this.getState());
  }

  async reconnect(): Promise<void> {
    await this.stop();
    await this.start();
  }

  onMessage(listener: IncomingMessageListener): void {
    this.messageListeners.push(listener);
  }

  getState(): TransportStateSnapshot {
    return {
      provider: 'whatsapp-web',
      isOfficialApi: false,
      status: this.status,
      qrCodeDataUrl: null,
      connectedPhone: this.connectedPhone,
      linkedBotPhone: this.linkedBotPhone,
      connectedName: this.connectedName,
      lastError: null,
      reconnectAttempts: 0,
      lastConnectedAt: this.status === 'ready' ? new Date().toISOString() : null,
      notice: `البوت يعمل عبر رقم الجهاز المرتبط: ${this.linkedBotPhone}`,
    };
  }

  async sendText(toChatId: string, text: string): Promise<SendMessageResult> {
    if (this.shouldFailNextSend) {
      this.shouldFailNextSend = false;
      return { ok: false, error: 'Simulated send failure' };
    }
    this.outboundHistory.push({ to: toChatId, text });
    return { ok: true, messageId: `wa-msg-${Date.now()}-${this.outboundHistory.length}` };
  }

  async sendFile(
    toChatId: string,
    filePath: string,
    caption?: string
  ): Promise<SendMessageResult> {
    if (this.shouldFailNextSend) {
      this.shouldFailNextSend = false;
      return { ok: false, error: 'Simulated media failure' };
    }
    this.outboundHistory.push({ to: toChatId, filePath, caption });
    return { ok: true, messageId: `wa-file-${Date.now()}-${this.outboundHistory.length}` };
  }

  async fetchGroups(): Promise<RemoteGroupInfo[]> {
    return [
      {
        waGroupId: '120363000001@g.us',
        name: 'مجموعة الدراسة - المستوى الرابع',
        memberCount: 24,
        members: [],
      },
    ];
  }
}
