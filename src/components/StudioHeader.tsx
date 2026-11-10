import React from 'react';
import { VoiceCandidate } from '../types';
import {
  Mic2,
  Sparkles,
  GitCompare,
  Clapperboard,
  FileCode,
  Radio,
  Star,
  CheckCircle,
  FolderArchive,
  Loader2,
} from 'lucide-react';

interface StudioHeaderProps {
  activeTab: 'casting' | 'comparison' | 'nextepisode' | 'postmarriage';
  onTabChange: (tab: 'casting' | 'comparison' | 'nextepisode' | 'postmarriage') => void;
  selectedFavorite: VoiceCandidate;
  onGenerateAll: () => void;
  isGeneratingAny: boolean;
  onOpenExportModal: () => void;
  generatedCount: number;
  onDownloadZip: () => void;
  isZipping: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  activeTab,
  onTabChange,
  selectedFavorite,
  onGenerateAll,
  isGeneratingAny,
  onOpenExportModal,
  generatedCount,
  onDownloadZip,
  isZipping,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#09090d]/95 backdrop-blur-md border-b border-stone-850 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4">
        {/* Top Tier: Brand & Status & Master Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-500 to-amber-300 p-0.5 shadow-lg shadow-amber-500/20 flex items-center justify-center">
              <div className="w-full h-full bg-[#0d0d12] rounded-[14px] flex items-center justify-center text-amber-400">
                <Mic2 className="w-5 h-5 fill-current" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black font-cinzel tracking-wider text-white">
                  ACUITY
                </h1>
                <span className="text-xs font-bold text-amber-400 font-hebrew bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                  THE VOICE • סטודיו קריינות
                </span>
              </div>
              <p className="text-[11px] text-stone-400 line-clamp-1 font-hebrew" dir="rtl">
                ליהוק קולי לסדרת טיקטוק מתוך הספר ״אקואיטי״ • מאחורי המובן מאליו
              </p>
            </div>
          </div>

          {/* Quick Info & Main Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Engine Status */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-950/80 border border-stone-800 text-xs font-mono text-stone-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Gemini 3.8 Flash TTS • 24kHz</span>
            </div>

            {/* Favorite Indicator */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-medium text-amber-300">
              <Star className="w-3.5 h-3.5 fill-current text-amber-400" />
              <span className="hidden sm:inline">הקול הנבחר:</span>
              <span className="font-bold">{selectedFavorite.hebrewName}</span>
            </div>

            {/* Generate All Button */}
            <button
              onClick={onGenerateAll}
              disabled={isGeneratingAny}
              className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 hover:brightness-110 active:scale-95 transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              <span>הפק את כל 5 הקולות</span>
            </button>

            {/* Download Complete ZIP Package Button */}
            <button
              onClick={onDownloadZip}
              disabled={isZipping || isGeneratingAny}
              title="הורד חבילת ZIP מלאה עם כל קובצי ה-WAV, התסריט ומפרט ההפקה"
              className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-500/40 hover:border-amber-400 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-amber-500/10"
            >
              {isZipping ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>{isZipping ? 'מכין ZIP...' : 'הורד ZIP תוצאות'}</span>
            </button>

            {/* Export Spec JSON */}
            <button
              onClick={onOpenExportModal}
              title="ייצא מפרט הפקה מלא כ-JSON"
              className="p-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800 transition-colors"
            >
              <FileCode className="w-4 h-4 text-amber-400" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-stone-800/80 overflow-x-auto">
          <button
            onClick={() => onTabChange('casting')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'casting'
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-sm'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
            }`}
          >
            <Radio className="w-4 h-4 text-amber-400" />
            <span>אודישן וליהוק קולות</span>
            <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-stone-800 text-stone-300">
              {generatedCount}/5 מוכנים
            </span>
          </button>

          <button
            onClick={() => onTabChange('comparison')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'comparison'
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-sm'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
            }`}
          >
            <GitCompare className="w-4 h-4 text-amber-400" />
            <span>השוואת A/B חיה</span>
          </button>

          <button
            onClick={() => onTabChange('nextepisode')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'nextepisode'
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-sm'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
            }`}
          >
            <Clapperboard className="w-4 h-4 text-amber-400" />
            <span>הפקת הפרק הבא בסדרה</span>
          </button>

          <button
            onClick={() => onTabChange('postmarriage')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'postmarriage'
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-sm'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>מריאז׳ פוסטים ואופטימיזציה</span>
            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full border border-amber-400/30">
              חדש
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
