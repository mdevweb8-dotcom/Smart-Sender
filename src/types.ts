export type DashboardRole = 'owner' | 'admin' | 'viewer';
export type WhatsAppRole = 'owner' | 'admin' | 'authorized' | 'unauthorized';
export type ContactPermission = 'chat' | 'view_only' | 'blocked';
export type TaskStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled' | 'Paused';
export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom_days';

export interface AuthUser {
  id: string;
  username: string;
  role: DashboardRole;
  full_name: string;
}

export interface WhatsAppState {
  provider: 'whatsapp-web';
  isOfficialApi: boolean;
  status: 'disconnected' | 'initializing' | 'qr_ready' | 'authenticated' | 'ready' | 'auth_failure' | 'error';
  qrCodeDataUrl: string | null;
  connectedPhone: string | null;
  linkedBotPhone: string;
  connectedName: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  notice: string;
}

export interface FileItem {
  id: string;
  original_name: string;
  stored_name: string;
  folder_id: string | null;
  folder_name?: string;
  mime_type: string;
  file_type: string;
  size_bytes: number;
  sender_phone: string;
  sender_name: string;
  source_group_name: string;
  ai_summary: string;
  ai_category: string;
  analysis_status: 'pending' | 'completed' | 'failed' | 'unsupported';
  transcript: string;
  send_count: number;
  received_at: string;
}

export interface FolderItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_system: number;
  file_count: number;
  created_at: string;
}

export interface GroupItem {
  id: string;
  wa_group_id: string;
  name: string;
  alias: string;
  description: string;
  member_count: number;
  members_json: string;
  is_allowed: number;
  last_synced_at: string | null;
}

export interface ScheduledTaskItem {
  id: string;
  title: string;
  task_type: 'file' | 'text' | 'multi_file';
  file_ids_json: string;
  message_text: string;
  destination_type: 'group' | 'contact';
  destination_id: string;
  destination_label: string;
  schedule_type: ScheduleType;
  cron_days_json: string;
  day_of_month: number | null;
  time_of_day: string;
  next_run_at: string | null;
  timezone: string;
  status: TaskStatus;
  retry_count: number;
  last_run_at: string | null;
  created_at: string;
}

export type MessageInteractionType =
  | 'live_chat'
  | 'bot_auto'
  | 'unauthorized_attempt'
  | 'direct_chat'
  | 'bot_command'
  | 'scheduled'
  | 'file_upload'
  | 'system_reply';

export interface MessageLogItem {
  id: string;
  direction: 'inbound' | 'outbound';
  whatsapp_message_id?: string;
  phone?: string;
  nickname?: string;
  message_text?: string;
  sender_phone: string;
  recipient_id: string;
  recipient_label: string;
  contact_phone?: string;
  interaction_type?: MessageInteractionType;
  message_type: string;
  content_preview: string;
  file_name?: string;
  status: string;
  error_message: string;
  created_at: string;
}

export interface SystemLogItem {
  id: string;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  meta_json: string;
  created_at: string;
}

export type ContactConnectionState = 'registered' | 'active' | 'pending' | 'blocked';

export interface WhatsAppUserItem {
  id: string;
  phone: string;
  phone_e164: string;
  display_name: string;
  nickname: string;
  alias: string;
  permission: ContactPermission;
  role: WhatsAppRole;
  is_active: number;
  notes: string;
  connection_state: ContactConnectionState;
  unread_count: number;
  last_chat_at: string | null;
  created_at: string;
}

export interface SettingItem {
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

export interface BackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DashboardStats {
  botStatus: string;
  schedulerRunning: boolean;
  whatsapp: WhatsAppState;
  gemini: {
    configured: boolean;
    model: string;
  };
  files: {
    total_files: number;
    total_bytes: number;
    by_type: Array<{ file_type: string; count: number }>;
  };
  tasks: Record<string, number>;
  groupsCount: number;
  unreadDirectChats?: number;
  newContactsCount?: number;
  registeredContactsCount?: number;
  recentFiles: FileItem[];
  recentMessages: MessageLogItem[];
  upcomingTasks: ScheduledTaskItem[];
}
