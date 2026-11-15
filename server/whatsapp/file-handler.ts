import { getAIProvider } from '../ai/gemini.ts';
import { getFileById, updateFileMetadata, type FileRecord } from '../database/repositories/filesRepo.ts';
import { ensureFolder } from '../database/repositories/foldersRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import { suggestFolderByRules } from '../files/classifier.ts';
import { detectLogicalFileType, moveFileToFolder, saveIncomingFile } from '../files/storage.ts';

export interface IngestFileParams {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  explicitFolderName?: string;
  captionHint?: string;
  senderPhone?: string;
  senderName?: string;
  sourceGroupId?: string;
  sourceGroupName?: string;
}

export async function ingestAndAnalyzeFile(params: IngestFileParams): Promise<FileRecord> {
  const logicalType = detectLogicalFileType(params.mimeType, params.originalName);
  const initialFolderName =
    params.explicitFolderName?.trim() ||
    suggestFolderByRules(params.originalName, logicalType, params.captionHint || '');

  ensureFolder(initialFolderName);

  let saved = saveIncomingFile({
    buffer: params.buffer,
    originalName: params.originalName,
    mimeType: params.mimeType,
    folderName: initialFolderName,
    senderPhone: params.senderPhone,
    senderName: params.senderName,
    sourceGroupId: params.sourceGroupId,
    sourceGroupName: params.sourceGroupName,
  });

  // Run Gemini content analysis & transcription when available
  const ai = getAIProvider();
  const analysis = await ai.analyzeFile({
    filePath: saved.storage_path,
    originalName: saved.original_name,
    mimeType: saved.mime_type,
    fileType: saved.file_type,
  });

  updateFileMetadata(saved.id, {
    ai_summary: analysis.summaryAr,
    ai_category: analysis.categoryFolder || initialFolderName,
    analysis_status: analysis.status,
    transcript: analysis.transcript,
  });

  // If user didn't force a specific folder and AI suggested a better valid folder, move it
  if (
    !params.explicitFolderName?.trim() &&
    analysis.status === 'completed' &&
    analysis.categoryFolder &&
    analysis.categoryFolder !== initialFolderName
  ) {
    try {
      const moved = moveFileToFolder(saved.id, analysis.categoryFolder);
      if (moved) saved = moved;
    } catch (err) {
      logSystem('warn', 'files', 'تعذر نقل الملف للمجلد المقترح من الذكاء الاصطناعي', {
        fileId: saved.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return getFileById(saved.id) || saved;
}
