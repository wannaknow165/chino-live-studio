import React, { useState } from 'react';
import { VoiceCandidate } from '../types';
import { buildProductionExport } from '../utils/audioUtils';
import {
  X,
  Copy,
  Check,
  Download,
  FileCode,
  Sparkles,
  Sliders,
  CheckCircle2,
  FolderArchive,
  Loader2,
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCandidate: VoiceCandidate;
  script: string;
  onDownloadZip?: () => void;
  isZipping?: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  selectedCandidate,
  script,
  onDownloadZip,
  isZipping,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const exportData = buildProductionExport(selectedCandidate, script);
  const jsonString = JSON.stringify(exportData, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sanitized = selectedCandidate.name.toLowerCase().replace(/\s+/g, '-');
    a.download = `voice-production-spec-${sanitized}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl rounded-2xl bg-[#0f0f14] border border-amber-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-stone-800 bg-[#13131c]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>ייצוא מפרט הפקה מלא (Production Spec JSON)</span>
              </h3>
              <p className="text-xs text-stone-400">
                כולל מודל, קול אב נבחר, הנחיית סגנון מדויקת והגדרות שמע לשימוש בכל פרקי הסדרה
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected Voice Summary Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 bg-stone-950/60 border-b border-stone-850 text-xs">
          <div className="p-2.5 rounded-lg bg-stone-900/80 border border-stone-800">
            <span className="text-stone-400 text-[10px] block">הקריין הנבחר:</span>
            <span className="font-bold text-amber-300">{selectedCandidate.name}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-stone-900/80 border border-stone-800">
            <span className="text-stone-400 text-[10px] block">Base Gemini Voice:</span>
            <span className="font-bold text-white font-mono">{selectedCandidate.baseVoice}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-stone-900/80 border border-stone-800">
            <span className="text-stone-400 text-[10px] block">מודל TTS:</span>
            <span className="font-bold text-stone-200 font-mono text-[11px] truncate">
              {selectedCandidate.model}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-stone-900/80 border border-stone-800">
            <span className="text-stone-400 text-[10px] block">פורמט מאסטר:</span>
            <span className="font-bold text-emerald-400 font-mono">24kHz WAV 16-bit</span>
          </div>
        </div>

        {/* JSON Code Viewer */}
        <div className="flex-1 overflow-auto p-5 bg-[#0a0a0d]">
          <pre className="text-xs font-mono text-amber-200/90 leading-relaxed selection:bg-amber-500/30">
            {jsonString}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t border-stone-800 bg-[#121218] gap-3">
          <span className="text-xs text-stone-400">
            הקובץ מוכן לשיתוף עם מחלקת הסאונד והעריכה של סדרת הטיקטוק
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            {onDownloadZip && (
              <button
                onClick={onDownloadZip}
                disabled={isZipping}
                className="px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-500/40 hover:border-amber-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isZipping ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                ) : (
                  <FolderArchive className="w-4 h-4 text-amber-400" />
                )}
                <span>{isZipping ? 'מכין ZIP...' : 'הורד הכל ב-ZIP (5 הקלטות + מפרט)'}</span>
              </button>
            )}

            <button
              onClick={handleCopy}
              className="px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>הועתק ללוח!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>העתק JSON</span>
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 font-bold text-xs flex items-center gap-1.5 hover:brightness-110 active:scale-95 transition-all shadow-md shadow-amber-500/20 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>הורד קובץ .JSON</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
