import { z } from 'zod';
import { Type, type Schema } from '@google/genai';

export const CommandIntentEnum = z.enum([
  'schedule_file',
  'send_now',
  'organize_file',
  'create_folder',
  'list_files',
  'search_files',
  'delete_file',
  'list_tasks',
  'task_update',
  'task_cancel',
  'task_pause',
  'task_resume',
  'list_groups',
  'set_group_alias',
  'query_stats',
  'confirm_action',
  'cancel_pending',
  'clear_memory',
  'clarify',
  'chat_help',
]);

export type CommandIntent = z.infer<typeof CommandIntentEnum>;

export const ScheduleSpecSchema = z.object({
  type: z.enum(['once', 'daily', 'weekly', 'monthly', 'custom_days']).default('once'),
  date_iso: z.string().optional().default(''),
  relative_day: z.enum(['', 'today', 'tomorrow']).optional().default(''),
  day_of_week: z
    .enum(['', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
    .optional()
    .default(''),
  days_of_week: z.array(z.string()).optional().default([]),
  day_of_month: z.number().int().min(1).max(31).nullable().optional().default(null),
  time_hhmm: z.string().optional().default(''),
});

export const ParsedCommandSchema = z.object({
  intent: CommandIntentEnum,
  file_query: z.string().optional().default(''),
  file_ids: z.array(z.string()).optional().default([]),
  folder_name: z.string().optional().default(''),
  new_name: z.string().optional().default(''),
  destination: z.string().optional().default(''),
  group_alias: z.string().optional().default(''),
  message_text: z.string().optional().default(''),
  task_query: z.string().optional().default(''),
  task_id: z.string().optional().default(''),
  today_only: z.boolean().optional().default(false),
  schedule: ScheduleSpecSchema.optional(),
  requires_confirmation: z.boolean().optional().default(false),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  clarification_question_ar: z.string().optional().default(''),
  reply_ar: z.string().optional().default(''),
});

export type ParsedCommand = z.infer<typeof ParsedCommandSchema>;

export const GEMINI_COMMAND_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      description:
        'One of: schedule_file, send_now, organize_file, create_folder, list_files, search_files, delete_file, list_tasks, task_update, task_cancel, task_pause, task_resume, list_groups, set_group_alias, query_stats, confirm_action, cancel_pending, clear_memory, clarify, chat_help',
    },
    file_query: {
      type: Type.STRING,
      description: 'File name, keyword, or "latest" if referring to the recently uploaded/mentioned file.',
    },
    folder_name: {
      type: Type.STRING,
      description: 'Target or queried Arabic/English folder name (e.g., المحاضرات, الدراسة).',
    },
    new_name: {
      type: Type.STRING,
      description: 'New file or folder name when renaming.',
    },
    destination: {
      type: Type.STRING,
      description: 'Group name, group alias, or contact phone/name to send to.',
    },
    group_alias: {
      type: Type.STRING,
      description: 'Alias to assign to a WhatsApp group.',
    },
    message_text: {
      type: Type.STRING,
      description: 'Text message or caption to send along with or instead of a file.',
    },
    task_query: {
      type: Type.STRING,
      description: 'Keyword or title identifying the scheduled task to modify/cancel/pause/resume.',
    },
    today_only: {
      type: Type.BOOLEAN,
      description: 'True if user asks specifically about files received today.',
    },
    schedule: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          description: 'once | daily | weekly | monthly | custom_days',
        },
        date_iso: {
          type: Type.STRING,
          description: 'YYYY-MM-DD if explicit date is given.',
        },
        relative_day: {
          type: Type.STRING,
          description: 'today | tomorrow | empty string',
        },
        day_of_week: {
          type: Type.STRING,
          description: 'sunday | monday | tuesday | wednesday | thursday | friday | saturday | empty string',
        },
        days_of_week: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Multiple days of week for custom_days schedule.',
        },
        day_of_month: {
          type: Type.INTEGER,
          description: 'Day number 1-31 for monthly schedule, or null.',
          nullable: true,
        },
        time_hhmm: {
          type: Type.STRING,
          description: '24-hour HH:MM time (e.g., 20:00 for 8 PM, 09:00 for 9 AM).',
        },
      },
    },
    requires_confirmation: {
      type: Type.BOOLEAN,
      description: 'True for sensitive actions like deleting files or sending/scheduling to groups.',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0 and 1.',
    },
    clarification_question_ar: {
      type: Type.STRING,
      description: 'Short clear Arabic question if intent or required fields are ambiguous.',
    },
    reply_ar: {
      type: Type.STRING,
      description: 'Helpful natural Arabic acknowledgement when intent is chat_help.',
    },
  },
  required: ['intent', 'requires_confirmation', 'confidence'],
};

export const GEMINI_FILE_ANALYSIS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    category_folder: {
      type: Type.STRING,
      description: 'Suggested Arabic folder from: المحاضرات, الدراسة, المستندات, الصور, الفيديوهات, الصوتيات, الملفات الشخصية, الأرشيف',
    },
    summary_ar: {
      type: Type.STRING,
      description: 'Concise factual Arabic summary of the file content (2-3 sentences max).',
    },
    transcript_ar: {
      type: Type.STRING,
      description: 'Accurate transcription if the file is audio/speech, otherwise empty string.',
    },
  },
  required: ['category_folder', 'summary_ar'],
};
