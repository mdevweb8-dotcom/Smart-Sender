import { config, normalizePhoneDigits } from '../config/env.ts';
import { getSetting } from '../database/repositories/settingsRepo.ts';
import { scheduler } from '../scheduler/scheduler.ts';
import { syncGroupsFromTransport } from './group-manager.ts';
import { handleIncomingWhatsAppMessage } from './message-handler.ts';
import type { TransportStateSnapshot, WhatsAppTransport } from './provider.ts';
import { executeTaskDelivery } from './sender.ts';
import { WebJSProvider } from './webjs-provider.ts';

class WhatsAppManager {
  private transport: WhatsAppTransport;

  constructor() {
    this.transport = new WebJSProvider();
    this.wireTransport(this.transport);
  }

  private wireTransport(transport: WhatsAppTransport): void {
    transport.onMessage(async (msg) => {
      await handleIncomingWhatsAppMessage(transport, msg);
    });

    scheduler.setExecutor(async (task) => {
      return executeTaskDelivery(this.transport, task);
    });
  }

  getTransport(): WhatsAppTransport {
    return this.transport;
  }

  /**
   * Used only by automated integration tests when Chromium isn't present in CI.
   */
  setTransportForTesting(transport: WhatsAppTransport): void {
    this.transport = transport;
    this.wireTransport(transport);
  }

  getLinkedBotPhone(): string {
    const state = this.transport.getState();
    const fromState = normalizePhoneDigits(state.connectedPhone || state.linkedBotPhone || '');
    if (fromState) return fromState;
    try {
      const fromSetting = normalizePhoneDigits(getSetting('whatsapp_bot_phone', ''));
      if (fromSetting) return fromSetting;
    } catch {
      // ignore if DB not initialized
    }
    return config.whatsappBotPhone;
  }

  getState(): TransportStateSnapshot {
    const base = this.transport.getState();
    const linkedBotPhone = base.linkedBotPhone || this.getLinkedBotPhone();
    return {
      ...base,
      linkedBotPhone,
    };
  }

  async connect(): Promise<TransportStateSnapshot> {
    await this.transport.start();
    return this.getState();
  }

  async disconnect(): Promise<TransportStateSnapshot> {
    await this.transport.stop();
    return this.getState();
  }

  async reconnect(): Promise<TransportStateSnapshot> {
    await this.transport.reconnect();
    return this.getState();
  }

  async syncGroups() {
    return syncGroupsFromTransport(this.transport);
  }
}

let managerInstance: WhatsAppManager | null = null;

export function getWhatsAppManager(): WhatsAppManager {
  if (!managerInstance) {
    managerInstance = new WhatsAppManager();
  }
  return managerInstance;
}
