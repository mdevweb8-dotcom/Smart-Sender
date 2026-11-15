import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Play, Pause, XCircle, RotateCcw, Clock } from 'lucide-react';
import { apiRequest, formatArabicDate } from '../lib/api.ts';
import type { FileItem, GroupItem, ScheduledTaskItem, ScheduleType } from '../types.ts';

interface TasksTabProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

const STATUS_AR: Record<string, string> = {
  Pending: 'قادمة (Pending)',
  Running: 'قيد التنفيذ',
  Completed: 'مكتملة',
  Failed: 'فاشلة',
  Cancelled: 'ملغاة',
  Paused: 'متوقفة مؤقتاً',
};

const SCHED_AR: Record<string, string> = {
  once: 'مرة واحدة',
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
  custom_days: 'أيام محددة',
};

export const TasksTab: React.FC<TasksTabProps> = ({ onNotify }) => {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [title, setTitle] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [destType, setDestType] = useState<'group' | 'contact'>('group');
  const [destinationId, setDestinationId] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  const [dateIso, setDateIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [timeOfDay, setTimeOfDay] = useState('20:00');
  const [dayOfWeek, setDayOfWeek] = useState('sunday');
  const [dayOfMonth, setDayOfMonth] = useState(15);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter !== 'all' ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const [tasksRes, filesRes, groupsRes] = await Promise.all([
        apiRequest<{ tasks: ScheduledTaskItem[] }>(`/api/tasks${qs}`),
        apiRequest<{ files: FileItem[] }>('/api/files?limit=100'),
        apiRequest<{ groups: GroupItem[] }>('/api/groups'),
      ]);
      setTasks(tasksRes.tasks);
      setFiles(filesRes.files);
      setGroups(groupsRes.groups);
      if (!destinationId && groupsRes.groups[0]) {
        setDestinationId(groupsRes.groups[0].wa_group_id);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل المهام', true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, destinationId, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = destType === 'group' ? destinationId : contactPhone.trim();
    const groupObj = groups.find((g) => g.wa_group_id === targetId);
    const targetLabel = destType === 'group' ? (groupObj?.alias || groupObj?.name || targetId) : targetId;

    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || 'مهمة إرسال مجدولة',
          fileIds: selectedFileIds,
          messageText,
          destinationType: destType,
          destinationId: targetId,
          destinationLabel: targetLabel,
          scheduleType,
          dateIso: scheduleType === 'once' ? dateIso : undefined,
          timeOfDay,
          daysOfWeek: scheduleType === 'weekly' ? [dayOfWeek] : [],
          dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : null,
          timezone: 'Africa/Khartoum',
        }),
      });
      setShowCreate(false);
      setTitle('');
      setSelectedFileIds([]);
      setMessageText('');
      onNotify('تم إنشاء المهمة المجدولة بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر إنشاء المهمة', true);
    }
  };

  const handleTaskAction = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'run') => {
    try {
      if (action === 'run') {
        await apiRequest(`/api/tasks/${id}/run`, { method: 'POST' });
        onNotify('تم تشغيل المهمة الآن وتسجيل النتيجة');
      } else {
        await apiRequest(`/api/tasks/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ action }),
        });
        onNotify('تم تحديث حالة المهمة');
      }
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء', true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">المهام المجدولة</h2>
          <p className="text-sm text-slate-500 mt-1">تخزين دائم في SQLite بتوقيت Africa/Khartoum</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>جدولة مهمة جديدة</span>
        </button>
      </div>

      {/* Status Filter */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {['all', 'Pending', 'Completed', 'Paused', 'Failed', 'Cancelled'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {st === 'all' ? 'الكل' : STATUS_AR[st] || st}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-4 font-semibold">المهمة</th>
                <th className="py-3 px-4 font-semibold">الوجهة</th>
                <th className="py-3 px-4 font-semibold">التكرار</th>
                <th className="py-3 px-4 font-semibold">الموعد القادم</th>
                <th className="py-3 px-4 font-semibold">الحالة</th>
                <th className="py-3 px-4 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">جاري التحميل...</td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">لا توجد مهام مجدولة في هذا التصنيف.</td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{task.title}</div>
                      {task.message_text && (
                        <div className="text-xs text-slate-500 truncate max-w-[240px]">{task.message_text}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{task.destination_label}</td>
                    <td className="py-3 px-4 text-slate-600 text-xs">
                      {SCHED_AR[task.schedule_type] || task.schedule_type} · {task.time_of_day || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs tabular-nums">
                      {formatArabicDate(task.next_run_at, task.timezone)}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold">
                      <span
                        className={
                          task.status === 'Completed'
                            ? 'text-emerald-700'
                            : task.status === 'Failed'
                              ? 'text-red-600'
                              : task.status === 'Paused'
                                ? 'text-amber-700'
                                : 'text-slate-700'
                        }
                      >
                        {STATUS_AR[task.status] || task.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        {task.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleTaskAction(task.id, 'run')}
                              title="تنفيذ الآن"
                              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleTaskAction(task.id, 'pause')}
                              title="إيقاف مؤقت"
                              className="p-1.5 text-amber-700 hover:bg-amber-50 rounded cursor-pointer"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {task.status === 'Paused' && (
                          <button
                            onClick={() => handleTaskAction(task.id, 'resume')}
                            title="استئناف"
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {(task.status === 'Pending' || task.status === 'Paused') && (
                          <button
                            onClick={() => handleTaskAction(task.id, 'cancel')}
                            title="إلغاء المهمة"
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTask} className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Clock className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">جدولة مهمة إرسال جديدة</h3>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">عنوان المهمة</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="مثال: إرسال محاضرة الأحياء لمجموعة الدراسة"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">اختيار الملفات (اختياري لرسالة نصية فقط)</label>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {files.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2">لا توجد ملفات محفوظة حالياً</p>
                ) : (
                  files.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 text-xs text-slate-700 p-1 hover:bg-slate-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.includes(f.id)}
                        onChange={(e) => {
                          setSelectedFileIds((prev) =>
                            e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id)
                          );
                        }}
                      />
                      <span className="truncate">{f.original_name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">نص الرسالة / التعليق المصاحب</label>
              <textarea
                rows={2}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="اكتب رسالة مرافقة للملف أو رسالة نصية..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">نوع الوجهة</label>
                <select
                  value={destType}
                  onChange={(e) => setDestType(e.target.value as 'group' | 'contact')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="group">مجموعة واتساب</option>
                  <option value="contact">رقم شخصي</option>
                </select>
              </div>

              {destType === 'group' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">المجموعة</label>
                  <select
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {groups.length === 0 && <option value="">لا توجد مجموعات مسجلة</option>}
                    {groups.map((g) => (
                      <option key={g.id} value={g.wa_group_id}>
                        {g.alias ? `${g.alias} (${g.name})` : g.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">رقم الهاتف الدولي</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+249912345678"
                    required
                    dir="ltr"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">نوع التكرار</label>
                <select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="once">مرة واحدة</option>
                  <option value="daily">يومي</option>
                  <option value="weekly">أسبوعي</option>
                  <option value="monthly">شهري</option>
                </select>
              </div>

              {scheduleType === 'once' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={dateIso}
                    onChange={(e) => setDateIso(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              )}

              {scheduleType === 'weekly' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">اليوم</label>
                  <select
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="sunday">الأحد</option>
                    <option value="monday">الإثنين</option>
                    <option value="tuesday">الثلاثاء</option>
                    <option value="wednesday">الأربعاء</option>
                    <option value="thursday">الخميس</option>
                    <option value="friday">الجمعة</option>
                    <option value="saturday">السبت</option>
                  </select>
                </div>
              )}

              {scheduleType === 'monthly' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">يوم الشهر</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">الوقت (Africa/Khartoum)</label>
                <input
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer"
              >
                حفظ المهمة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
