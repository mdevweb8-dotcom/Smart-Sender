import { listFiles, type FileRecord } from '../database/repositories/filesRepo.ts';
import { findFolderByNameOrSlug } from '../database/repositories/foldersRepo.ts';

export function searchFilesSmart(options: {
  query?: string;
  folderName?: string;
  todayOnly?: boolean;
  fileType?: string;
  limit?: number;
}): FileRecord[] {
  let folderId: string | undefined;
  if (options.folderName && options.folderName.trim()) {
    const folder = findFolderByNameOrSlug(options.folderName.trim());
    if (folder) {
      folderId = folder.id;
    } else {
      return [];
    }
  }

  return listFiles({
    search: options.query,
    folderId,
    fileType: options.fileType,
    todayOnly: options.todayOnly,
    limit: options.limit || 25,
  });
}

export function findBestMatchingFile(queryOrId: string): FileRecord[] {
  const clean = (queryOrId || '').trim();
  if (!clean) return [];
  const all = listFiles({ search: clean, limit: 10 });
  return all;
}
