import React, { useState } from 'react';
import { Send, CheckCircle2, Paperclip, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

interface AiTesterTabProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

export const AiTesterTab: React.FC<AiTesterTabProps> = ({ onNotify }) => {
  const [health, setHealth] = useState<{ ok: boolean; model: string; configured: boolean; message: string } | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [commandInput, setCommandInput] = useState('استلم هذا الملف واحفظه في مجلد المحاضرات، وأرسله إلى مجموعة الدراسة يوم الأحد الساعة 8 مساءً');
  const [parsedResult, setParsedResult] = useState<string>('');
  const [parsing, setParsing] = useState(false);

  // End-to-end Arabic bot simulator
  const [simMessage, setSimMessage] = useState('');
  const [simFile, setSimFile] = useState<File | null>(null);
  const [simLog, setSimLog] = useState<Array<{ who: 'user' | 'bot'; text: string }>>([]);
  const [simSending, setSimSending] = useState(false);

  const checkGeminiHealth = async () => {
    setCheckingHealth(true);
    try {
      const res = await apiRequest<{ ok: boolean; model: string; configured: boolean; message: string }>('/api/gemini/health');
      setHealth(res);
      onNotify(res.ok ? 'اتصال Gemini يعمل بنجاح' : res.message, !res.ok);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل فحص Gemini', true);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleParseCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    setParsing(true);
    try {
      const res = await apiRequest<{ parsed: unknown }>('/api/gemini/parse', {
        method: 'POST',
        body: JSON.stringify({ message: commandInput }),
      });
      setParsedResult(JSON.stringify(res.parsed, null, 2));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل تحليل الأمر', true);
    } finally {
      setParsing(false);
    }
  };

  const handleSimulateSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessage.trim() && !simFile) return;
    setSimSending(true);
    const label = simFile ? `${simMessage || ''} [مرفق: ${simFile.name}]`.trim() : simMessage;
    setSimLog((prev) => [...prev, { who: 'user', text: label }]);

    try {
      const form = new FormData();
      form.append('message', simMessage);
      if (simFile) form.append('file', simFile);
      const res = await apiRequest<{ ok: boolean; reply: string }>('/api/simulator/message', {
        method: 'POST',
        body: form,
      });
      setSimLog((prev) => [...prev, { who: 'bot', text: res.reply }]);
      setSimMessage('');
      setSimFile(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل تنفيذ المحاكاة', true);
    } finally {
      setSimSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">محرك Gemini واختبار الأوامر العربية</h2>
          <p className="text-sm text-slate-500 mt-1">
            فحص اتصال Gemini على الخادم واختبار تحويل اللغة الطبيعية إلى JSON منظم
          </p>
        </div>
        <button
          onClick={checkGeminiHealth}
          disabled={checkingHealth}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg flex items-center gap-2 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{checkingHealth ? 'جاري الاختبار...' : 'فحص اتصال Gemini'}</span>
        </button>
      </div>

      {health && (
        <div className={`p-4 rounded-xl border text-sm ${health.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="font-bold">الحالة: {health.ok ? 'متصل وجاهز' : 'غير متصل'} · النموذج: <span className="font-mono">{health.model}</span></div>
          <div className="text-xs mt-1">{health.message}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Structured JSON Parser Tester */}
        <form onSubmit={handleParseCommand} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
          <div className="text-base font-bold text-slate-900">1. اختبار استخراج الأوامر (Structured JSON)</div>
          <textarea
            rows={3}
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            className="w-full p-3 text-sm border border-slate-300 rounded-lg"
            placeholder="اكتب أمراً بالعربية..."
          />
          <button
            type="submit"
            disabled={parsing}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg w-fit cursor-pointer"
          >
            {parsing ? 'جاري التحليل...' : 'تحليل الأمر إلى JSON'}
          </button>
          {parsedResult && (
            <pre dir="ltr" className="p-3 bg-slate-900 text-emerald-300 rounded-lg text-xs font-mono overflow-x-auto max-h-64">
              {parsedResult}
            </pre>
          )}
        </form>

        {/* Interactive End-to-End Bot Conversation Simulator */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-bold text-slate-900">2. محاكي محادثة البوت (اختبار فعلي للنظام)</div>
            <button
              type="button"
              onClick={async () => {
                await apiRequest('/api/gemini/memory/clear', { method: 'POST', body: JSON.stringify({}) });
                setSimLog([]);
                onNotify('تم مسح ذاكرة المحادثة');
              }}
              className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>مسح الذاكرة</span>
            </button>
          </div>

          <div className="flex-1 min-h-[200px] max-h-64 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
            {simLog.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">
                أرسل رسالة أو أرفق ملفاً لاختبار استقبال الملف، التصنيف، الجدولة، أو الاستعلامات في قاعدة البيانات.
              </p>
            ) : (
              simLog.map((entry, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg text-xs whitespace-pre-wrap leading-relaxed ${
                    entry.who === 'user'
                      ? 'bg-emerald-600 text-white mr-8'
                      : 'bg-white border border-slate-200 text-slate-800 ml-8'
                  }`}
                >
                  {entry.text}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSimulateSend} className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 cursor-pointer shrink-0" title="إرفاق ملف">
                <Paperclip className="w-4 h-4" />
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setSimFile(e.target.files?.[0] || null)}
                />
              </label>
              <input
                type="text"
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                placeholder="مثال: ما الملفات التي استلمتها اليوم؟"
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                disabled={simSending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{simSending ? '...' : 'إرسال'}</span>
              </button>
            </div>
            {simFile && (
              <div className="text-xs text-slate-600 flex items-center justify-between bg-slate-100 px-3 py-1 rounded">
                <span>ملف مرفق: {simFile.name}</span>
                <button type="button" onClick={() => setSimFile(null)} className="text-red-600 cursor-pointer">إزالة</button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
