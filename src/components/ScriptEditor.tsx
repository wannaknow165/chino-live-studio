import React, { useState } from 'react';
import {
  DEFAULT_TEST_SCRIPT,
  MIND_BENDING_QUOTES,
  estimateHebrewSpeechDuration,
} from '../utils/audioUtils';
import {
  FileText,
  Clock,
  RotateCcw,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Volume2,
  CheckCircle2,
  Zap,
  FolderArchive,
  Loader2,
} from 'lucide-react';

interface ScriptEditorProps {
  script: string;
  onScriptChange: (newScript: string) => void;
  onGenerateAll: () => void;
  isGeneratingAny: boolean;
  onDownloadZip?: () => void;
  isZipping?: boolean;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  script,
  onScriptChange,
  onGenerateAll,
  isGeneratingAny,
  onDownloadZip,
  isZipping,
}) => {
  const [showDirectingNotes, setShowDirectingNotes] = useState<boolean>(true);
  const wordsCount = script.trim() ? script.trim().split(/\s+/).filter(Boolean).length : 0;
  const estimatedSeconds = estimateHebrewSpeechDuration(script);

  const isDefaultScript = script.trim() === DEFAULT_TEST_SCRIPT.trim();

  return (
    <div className="rounded-2xl bg-gradient-to-b from-[#13131a] to-[#0c0c10] border border-amber-500/20 p-5 sm:p-7 shadow-2xl relative overflow-hidden">
      {/* Decorative luxury ambient glow */}
      <div className="absolute top-0 right-0 w-72 h-72 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative space-y-6">
        {/* Header & Stats Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <FileText className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2 font-hebrew" dir="rtl">
                  <span>ACUITY — פרק 001: אשליית הדאגה</span>
                  <span className="text-xs font-mono font-normal text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                    מאחורי המובן מאליו
                  </span>
                </h2>
                <p className="text-xs text-stone-300 font-hebrew" dir="rtl">
                  קריינות: גבר ישראלי, קול נמוך, בטוח, אינטליגנטי, עם ציניות עדינה. לא קול של פרסומת.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 bg-stone-950/80 px-3.5 py-2 rounded-xl border border-stone-800 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-stone-300">
                <span className="text-stone-400">מילים:</span>
                <span className="font-bold text-amber-400">{wordsCount}</span>
              </div>
              <div className="w-px h-4 bg-stone-800" />
              <div className="flex items-center gap-1.5 text-stone-300">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-stone-400">משך מוערך:</span>
                <span className="font-bold text-amber-400">~{estimatedSeconds}s</span>
              </div>
            </div>

            {!isDefaultScript && (
              <button
                onClick={() => onScriptChange(DEFAULT_TEST_SCRIPT)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-white text-xs border border-stone-700 transition-colors"
                title="חזור לטקסט המקורי של המבחן"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>איפוס לטקסט מקור</span>
              </button>
            )}
          </div>
        </div>

        {/* Mind-Bending Quotes Quick Selector (משפטים שמשאירים סימן במוח) */}
        <div className="p-3.5 rounded-xl bg-stone-950/70 border border-amber-500/20 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-amber-300">
            <span className="flex items-center gap-1.5 font-hebrew" dir="rtl">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-current" />
              משפטי מחץ פסיכולוגיים שמשאירים סימן במוח (טען מיד לבדיקת הקריין):
            </span>
            <span className="text-[10px] text-stone-400 font-mono hidden sm:inline">
              One-Click Audition Load
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2" dir="rtl">
            {MIND_BENDING_QUOTES.map((item, idx) => (
              <button
                key={idx}
                onClick={() => onScriptChange(item.quote)}
                className="px-2.5 py-1.5 rounded-lg bg-stone-900 hover:bg-amber-500/20 text-stone-300 hover:text-amber-200 text-xs border border-stone-800 hover:border-amber-500/40 transition-colors cursor-pointer"
                title={item.quote}
              >
                💡 {item.title}
              </button>
            ))}
          </div>
        </div>

        {/* Script Editor Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Main Text Area (Hebrew RTL) */}
          <div className="lg:col-span-8 space-y-3">
            <div className="relative">
              <textarea
                value={script}
                onChange={(e) => onScriptChange(e.target.value)}
                rows={9}
                dir="rtl"
                aria-label="Hebrew Test Script"
                placeholder="הקלד כאן את תסריט המבחן..."
                className="w-full bg-stone-950/90 text-stone-100 text-base sm:text-lg leading-relaxed p-4 sm:p-5 rounded-xl border border-stone-800 focus:border-amber-400/80 focus:ring-1 focus:ring-amber-400/40 focus:outline-none transition-all font-hebrew resize-y"
              />
              <div className="absolute left-3 bottom-3 text-[11px] font-mono text-stone-400 bg-stone-900/80 px-2 py-0.5 rounded">
                RTL Hebrew Script
              </div>
            </div>

            {/* Quick Beat Markers */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400" dir="rtl">
              <span className="text-stone-400 font-semibold">מהלכים בתסריט:</span>
              <span className="bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800 text-amber-300/80">
                1. הפתיחה והעוקץ
              </span>
              <span className="bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800 text-stone-300">
                2. המוכר שדואג לך
              </span>
              <span className="bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800 text-amber-300/80">
                3. טיקטוק לייב ובאטל
              </span>
              <span className="bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800 text-stone-300">
                4. אשליית הדאגה
              </span>
              <span className="bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800 text-amber-400 font-bold">
                5. פאנץ' המשחק
              </span>
            </div>
          </div>

          {/* Director Guidance & Requirements Box */}
          <div className="lg:col-span-4 bg-stone-950/60 rounded-xl p-4 border border-stone-800/80 space-y-3.5 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <Info className="w-4 h-4" />
                <span>הוראות במאי קול (Voice Direction)</span>
              </div>
              <button
                onClick={() => setShowDirectingNotes(!showDirectingNotes)}
                className="text-stone-400 hover:text-white"
              >
                {showDirectingNotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {showDirectingNotes && (
              <div className="space-y-2.5 text-stone-300 leading-relaxed font-hebrew" dir="rtl">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <span>
                    <strong>עברית ישראלית אותנטית:</strong> דיבור חי וטבעי של בן 28–35, ללא מבטא זר וללא פאתוס מלאכותי.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <span>
                    <strong>סרקזם נינוח:</strong> המשפטים הציניים צריכים להישמע משעשעים ללא מאמץ, כמו חבר מבריק שמבין את המשחק.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <span>
                    <strong>בלי קריינות חדשות:</strong> לא קול של שדרן רדיו, לא טון של מנטור מוטיבציה ולא עצירות תיאטרליות מוגזמות.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <span>
                    <strong>אינטימיות ואינטליגנציה:</strong> מישהו שנשמע מצליח ומנוסה בלי להשוויץ, שמסוגל להפוך משפט קצר לבלתי נשכח.
                  </span>
                </div>
                <div className="flex items-start gap-2 pt-1 border-t border-stone-850">
                  <span className="text-amber-400 font-bold shrink-0">📖 מקור:</span>
                  <span className="text-stone-300 font-semibold">
                    מתוך הספר ״אקואיטי״ — מאחורי המובן מאליו.
                  </span>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-stone-850 space-y-2">
              <button
                onClick={onGenerateAll}
                disabled={isGeneratingAny || isZipping}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-stone-950 font-bold hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-xs sm:text-sm"
              >
                <Sparkles className="w-4 h-4 fill-current" />
                <span>הפק את כל 5 הקולות</span>
              </button>

              {onDownloadZip && (
                <button
                  onClick={onDownloadZip}
                  disabled={isZipping || isGeneratingAny}
                  className="w-full py-2 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 font-bold border border-amber-500/30 hover:border-amber-400/80 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-xs"
                >
                  {isZipping ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  ) : (
                    <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span>{isZipping ? 'מכין חבילת ZIP...' : 'הורד ZIP של כל התוצאות'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
