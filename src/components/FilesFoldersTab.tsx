import React, { useState, useEffect, useCallback } from 'react';
import { Upload, Search, Download, Trash2, FolderPlus, Edit3, Eye, X } from 'lucide-react';
import { apiRequest, buildDownloadUrl, formatArabicDate, formatBytes } from '../lib/api.ts';
import type { FileItem, FolderItem } from '../types.ts';

interface FilesFoldersTabProps {
  mode: 'files' | 'folders';
  onNotify: (msg: string, isError?: boolean) => void;
}

export const FilesFoldersTab: React.FC<FilesFoldersTabProps> = ({ mode, onNotify }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [uploading, setUploading] = useState(false);

  // Modals
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<FileItem | null>(null);
  const [moveFileModal, setMoveFileModal] = useState<FileItem | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [renameFolderTarget, setRenameFolderTarget] = useState<FolderItem | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (selectedFolder !== 'all') qs.set('folderId', selectedFolder);
      if (selectedType !== 'all') qs.set('fileType', selectedType);

      const [filesRes, foldersRes] = await Promise.all([
        apiRequest<{ files: FileItem[] }>(`/api/files?${qs.toString()}`),
        apiRequest<{ folders: FolderItem[] }>('/api/folders'),
      ]);
      setFiles(filesRes.files);
      setFolders(foldersRes.folders);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل الملفات', true);
    } finally {
      setLoading(false);
    }
  }, [search, selectedFolder, selectedType, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (selectedFolder !== 'all') {
        const folderObj = folders.find((f) => f.id === selectedFolder);
        if (folderObj) form.append('folderName', folderObj.name);
      }
      await apiRequest('/api/files/upload', { method: 'POST', body: form });
      onNotify(`تم رفع وتصنيف الملف "${file.name}" بنجاح`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل رفع الملف', true);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteFile = async () => {
    if (!confirmDeleteFile) return;
    try {
      await apiRequest(`/api/files/${confirmDeleteFile.id}`, { method: 'DELETE' });
      onNotify(`تم حذف الملف "${confirmDeleteFile.original_name}"`);
      setConfirmDeleteFile(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل الحذف', true);
    }
  };

  const handleMoveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveFileModal || !moveTargetFolder) return;
    try {
      await apiRequest(`/api/files/${moveFileModal.id}`, {
        method: 'PUT',
        body: JSON.stringify({ folder_id: moveTargetFolder }),
      });
      onNotify('تم نقل الملف للمجلد بنجاح');
      setMoveFileModal(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر نقل الملف', true);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await apiRequest('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: newFolderName.trim(), description: newFolderDesc.trim() }),
      });
      setNewFolderName('');
      setNewFolderDesc('');
      onNotify('تم إنشاء المجلد بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر إنشاء المجلد', true);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameFolderTarget || !renameFolderValue.trim()) return;
    try {
      await apiRequest(`/api/folders/${renameFolderTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: renameFolderValue.trim() }),
      });
      setRenameFolderTarget(null);
      onNotify('تمت إعادة تسمية المجلد');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر التعديل', true);
    }
  };

  const handleDeleteFolder = async (folder: FolderItem) => {
    try {
      await apiRequest(`/api/folders/${folder.id}`, { method: 'DELETE' });
      onNotify(`تم حذف المجلد "${folder.name}"`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حذف المجلد', true);
    }
  };

  if (mode === 'folders') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">إدارة المجلدات</h2>
          <p className="text-sm text-slate-500 mt-1">تنظيم التصنيفات التلقائية والمجلدات المخصصة</p>
        </div>

        <form onSubmit={handleCreateFolder} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">اسم المجلد الجديد</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="مثال: مشاريع التخرج"
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">الوصف (اختياري)</label>
            <input
              type="text"
              value={newFolderDesc}
              onChange={(e) => setNewFolderDesc(e.target.value)}
              placeholder="وصف مختصر لمحتويات المجلد"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>إنشاء مجلد</span>
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders.map((folder) => (
            <div key={folder.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-900">{folder.name}</h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {folder.file_count} ملف
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  {folder.description || 'مجلد لحفظ الملفات المصنفة'}
                </p>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                <span className="text-slate-400">
                  {folder.is_system ? 'مجلد أساسي' : 'مجلد مخصص'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setRenameFolderTarget(folder);
                      setRenameFolderValue(folder.name);
                    }}
                    className="text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>
                  {!folder.is_system && (
                    <button
                      onClick={() => handleDeleteFolder(folder)}
                      className="text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {renameFolderTarget && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <form onSubmit={handleRenameFolder} className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-sm space-y-4">
              <h3 className="text-base font-bold text-slate-900">إعادة تسمية المجلد</h3>
              <input
                type="text"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameFolderTarget(null)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">الملفات المستلمة</h2>
          <p className="text-sm text-slate-500 mt-1">بحث، معاينة تحليل Gemini، نقل بين المجلدات، وتحميل آمن</p>
        </div>
        <label className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0">
          <Upload className="w-4 h-4" />
          <span>{uploading ? 'جاري الرفع والتحليل...' : 'رفع ملف جديد'}</span>
          <input type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم الملف أو الملخص أو المجلد..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
        </div>
        <select
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">جميع المجلدات</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.file_count})
            </option>
          ))}
        </select>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">جميع الأنواع</option>
          <option value="pdf">PDF</option>
          <option value="document">مستندات Word/PPT</option>
          <option value="spreadsheet">جداول Excel</option>
          <option value="image">صور</option>
          <option value="audio">صوتيات</option>
          <option value="video">فيديو</option>
          <option value="text">ملفات نصية</option>
        </select>
      </div>

      {/* Files Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">اسم الملف</th>
                <th className="py-3 px-4 font-semibold">المجلد</th>
                <th className="py-3 px-4 font-semibold">النوع · الحجم</th>
                <th className="py-3 px-4 font-semibold">المرسل</th>
                <th className="py-3 px-4 font-semibold">مرات الإرسال</th>
                <th className="py-3 px-4 font-semibold">تاريخ الاستلام</th>
                <th className="py-3 px-4 font-semibold">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    جاري تحميل الملفات...
                  </td>
                </tr>
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    لا توجد ملفات مطابقة. ارفع ملفاً للبدء.
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-[240px] truncate">
                      {file.original_name}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{file.folder_name || 'غير مصنف'}</td>
                    <td className="py-3 px-4 text-slate-500 tabular-nums font-mono text-xs">
                      {file.file_type} · {formatBytes(file.size_bytes)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-xs" dir="ltr">
                      {file.sender_phone || file.sender_name || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-700 tabular-nums font-mono">
                      {file.send_count}
                    </td>
                    <td className="py-3 px-4 text-slate-500 tabular-nums text-xs whitespace-nowrap">
                      {formatArabicDate(file.received_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPreviewFile(file)}
                          title="تفاصيل وتحليل AI"
                          className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setMoveFileModal(file);
                            setMoveTargetFolder(file.folder_id || folders[0]?.id || '');
                          }}
                          title="نقل لمجلد آخر"
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <a
                          href={buildDownloadUrl(file.id)}
                          title="تحميل الملف"
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => setConfirmDeleteFile(file)}
                          title="حذف الملف"
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* File Detail & AI Analysis Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-lg space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 truncate">{previewFile.original_name}</h3>
              <button onClick={() => setPreviewFile(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-slate-600 space-y-2">
              <div>المجلد: <strong>{previewFile.folder_name || 'غير مصنف'}</strong> · النوع: <span className="font-mono">{previewFile.mime_type}</span></div>
              <div>حالة تحليل Gemini: <strong>{previewFile.analysis_status}</strong></div>
              {previewFile.ai_summary && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed">
                  <div className="font-bold mb-1">ملخص المحتوى:</div>
                  {previewFile.ai_summary}
                </div>
              )}
              {previewFile.transcript && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed">
                  <div className="font-bold mb-1">التفريغ الصوتي:</div>
                  {previewFile.transcript}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveFileModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={handleMoveFile} className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">نقل الملف إلى مجلد</h3>
            <p className="text-xs text-slate-500 truncate">{moveFileModal.original_name}</p>
            <select
              value={moveTargetFolder}
              onChange={(e) => setMoveTargetFolder(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMoveFileModal(null)} className="px-4 py-2 text-sm text-slate-600 cursor-pointer">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer">
                نقل الآن
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">تأكيد حذف الملف</h3>
            <p className="text-sm text-slate-600">
              هل أنت متأكد من حذف الملف <strong>{confirmDeleteFile.original_name}</strong> نهائياً؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteFile(null)} className="px-4 py-2 text-sm text-slate-600 cursor-pointer">
                إلغاء
              </button>
              <button onClick={handleDeleteFile} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 cursor-pointer">
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
