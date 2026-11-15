import type { LogicalFileType } from './storage.ts';

export function suggestFolderByRules(
  filename: string,
  fileType: LogicalFileType,
  hintText = ''
): string {
  const combined = `${filename} ${hintText}`.toLowerCase();

  if (/(محاضر|lecture|lec|slides|شرائح|سلايد|مقرر|كورس|course|chapter|فصل)/.test(combined)) {
    return 'المحاضرات';
  }
  if (/(دراس|study|ملخص|summary|واجب|assignment|homework|امتحان|exam|quiz|مراجع|أحياء|رياضيات|فيزياء|كيمياء)/.test(combined)) {
    return 'الدراسة';
  }
  if (/(شخصي|personal|هوية|جواز|سيرة|cv|resume|عقد|فاتور)/.test(combined)) {
    return 'الملفات الشخصية';
  }
  if (/(أرشيف|archive|قديم|old)/.test(combined)) {
    return 'الأرشيف';
  }

  switch (fileType) {
    case 'image':
      return 'الصور';
    case 'video':
      return 'الفيديوهات';
    case 'audio':
      return 'الصوتيات';
    case 'pdf':
    case 'document':
    case 'spreadsheet':
    case 'text':
      return 'المستندات';
    default:
      return 'المستندات';
  }
}
