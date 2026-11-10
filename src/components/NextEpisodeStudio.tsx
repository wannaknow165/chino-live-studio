import React, { useState } from 'react';
import { VoiceCandidate, GeneratedEpisode } from '../types';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import {
  Sparkles,
  Clapperboard,
  Send,
  RefreshCw,
  Film,
  Download,
  CheckCircle,
  FileCode,
  BookOpen,
} from 'lucide-react';

interface NextEpisodeStudioProps {
  selectedVoice: VoiceCandidate;
  onOpenExportModal: () => void;
}

const PRESET_TOPICS = [
  {
    title: 'אפקט הפיתיון הנחות (The Decoy Effect)',
    concept: 'למה תמיד מוכרים לך כוס פופקורן גדולה ב-32 שקלים כשבינונית עולה 29? הפסיכולוגיה שמאחורי בחירה מתוכננת מראש.',
  },
  {
    title: 'אשליית הנדירות המזויפת (Artificial Scarcity)',
    concept: '"נשארו רק 2 מקומות אחרונים!"... למה הפחד מהחמצה מוחק את כל הרציונל של הצרכן ב-3 שניות.',
  },
  {
    title: 'מלכודת ה״חינם״ וההדדיות (The Reciprocity Trap)',
    concept: 'אף אחד בעולם העסקים לא נותן לך מתנה חינם. הוא פשוט שותל אצלך חוב פסיכולוגי שייגבה פי עשרה.',
  },
  {
    title: 'הסוד של שעון היוקרה (The Status Flex Paradox)',
    concept: 'אנשים עשירים באמת לא לובשים לוגואים ענקיים. למה מעמד חברתי אמיתי תמיד שקט, ומי שמנופף בו מוכר לך משהו.',
  },
];

export const NextEpisodeStudio: React.FC<NextEpisodeStudioProps> = ({
  selectedVoice,
  onOpenExportModal,
}) => {
  const [topic, setTopic] = useState<string>(PRESET_TOPICS[0].title);
  const [concept, setConcept] = useState<string>(PRESET_TOPICS[0].concept);
  const [script, setScript] = useState<string>(
    `תכירו את הטריק שגורם לכם להוציא פי שניים בסופר.
הם לא צריכים לשכנע אתכם שהמוצר שווה את זה.
הם פשוט שמים לידו מוצר שלישי – כל כך גרוע ויקר...
שפתאום הבחירה היקרה נראית כמו עסקת המאה.
איזה גאונים, אה?
רק שברגע שאתם מרגישים שניצחתם את המערכת...
הקופה כבר רושמת את הרווח שלהם.
חוק מספר שתיים. אשליית ההשוואה.
כי המוח לא מחפש ערך אמיתי...
הוא רק מחפש להרגיש שהוא לא יצא פראייר.`
  );

  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [currentEpisodeAudio, setCurrentEpisodeAudio] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [pastEpisodes, setPastEpisodes] = useState<GeneratedEpisode[]>([]);

  const handleSelectPreset = (preset: { title: string; concept: string }) => {
    setTopic(preset.title);
    setConcept(preset.concept);
  };

  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    setGenerationError(null);
    try {
      const res = await fetch('/api/generate-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          concept,
          seriesVibe: `${selectedVoice.name} - ${selectedVoice.personality}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשלה יצירת התסריט');
      }

      setScript(data.script);
    } catch (e: any) {
      console.error(e);
      setGenerationError(e.message || 'שגיאה בעת יצירת התסריט');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleGenerateEpisodeAudio = async () => {
    if (!script.trim()) return;
    setIsGeneratingAudio(true);
    setGenerationError(null);
    try {
      const res = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          voiceName: selectedVoice.baseVoice,
          style: selectedVoice.deliveryStylePrompt,
          model: selectedVoice.model,
          candidateId: selectedVoice.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשלה הפקת האודיו עם המודל');
      }

      setCurrentEpisodeAudio(data.audioBase64);

      // Save to episode list
      const newEp: GeneratedEpisode = {
        id: `ep-${Date.now()}`,
        title: topic,
        concept,
        script,
        audioBase64: data.audioBase64,
        createdAt: new Date().toLocaleTimeString(),
      };
      setPastEpisodes((prev) => [newEp, ...prev]);
    } catch (e: any) {
      console.error(e);
      setGenerationError(e.message || 'שגיאה בהפקת האודיו');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  return (
    <div className="rounded-2xl bg-gradient-to-b from-[#13131c] via-[#0e0e13] to-[#08080b] border border-amber-500/30 p-5 sm:p-7 shadow-2xl space-y-7">
      {/* Active Voice Cast Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-900/10 to-stone-950 border border-amber-500/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300 font-cinzel font-bold text-lg">
            {selectedVoice.name.charAt(0)}
          </div>
          <div>
            <div className="text-xs text-stone-400 flex items-center gap-2">
              <span>הקריין המוביל של הסדרה:</span>
              <span className="font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded text-[10px] font-bold">
                Base: {selectedVoice.baseVoice}
              </span>
            </div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>{selectedVoice.name}</span>
              <span className="text-amber-300">• {selectedVoice.hebrewName}</span>
            </h3>
            <p className="text-xs text-stone-400 line-clamp-1">
              {selectedVoice.archetype}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenExportModal}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-white text-xs border border-stone-800 transition-colors"
          >
            <FileCode className="w-3.5 h-3.5 text-amber-400" />
            <span>ייצוא מפרט הפקה JSON</span>
          </button>
        </div>
      </div>

      {/* Preset Topics Selector */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-stone-300 block">
          בחר נושא פסיכולוגי לפרק הבא או הגדר נושא מותאם אישית:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {PRESET_TOPICS.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSelectPreset(p)}
              className={`p-3 rounded-xl text-right text-xs transition-all border ${
                topic === p.title
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-sm'
                  : 'bg-stone-950/70 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
              }`}
            >
              <div className="font-bold text-white mb-1 line-clamp-1">{p.title}</div>
              <div className="text-[11px] text-stone-400 line-clamp-2 leading-tight">
                {p.concept}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Topic Inputs & Script Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-stone-300">
              כותרת הפרק:
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full bg-stone-950 text-white text-sm p-3 rounded-xl border border-stone-800 focus:border-amber-400 focus:outline-none"
              placeholder="למשל: אפקט הפיתיון הנחות"
              dir="rtl"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-stone-300">
              תקציר הקונספט הפסיכולוגי:
            </label>
            <textarea
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              rows={3}
              className="w-full bg-stone-950 text-stone-300 text-xs p-3 rounded-xl border border-stone-800 focus:border-amber-400 focus:outline-none"
              placeholder="מה התכסיס החברתי או המניפולציה שחושפים בפרק?"
              dir="rtl"
            />
          </div>

          <button
            onClick={handleGenerateScript}
            disabled={isGeneratingScript}
            className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isGeneratingScript ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>כותב תסריט מהודק עם Gemini 3.8 Flash...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>כתוב תסריט חדש בסגנון הסדרה</span>
              </>
            )}
          </button>
        </div>

        {/* Script Editor & Audio Trigger */}
        <div className="lg:col-span-7 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-stone-300">
                תסריט הפרק (ערוך לפי רצונך):
              </label>
              <span className="text-[11px] font-mono text-stone-400">
                ~{script.split(/\s+/).filter(Boolean).length} מילים
              </span>
            </div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              dir="rtl"
              className="w-full bg-stone-950 text-stone-100 text-base leading-relaxed p-4 rounded-xl border border-stone-800 focus:border-amber-400 focus:outline-none font-hebrew"
            />
          </div>

          <button
            onClick={handleGenerateEpisodeAudio}
            disabled={isGeneratingAudio || !script.trim()}
            className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-stone-950 hover:brightness-110 active:scale-[0.99] flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 cursor-pointer transition-all"
          >
            {isGeneratingAudio ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>מקליט ביצוע עם {selectedVoice.hebrewName}...</span>
              </>
            ) : (
              <span className="flex items-center gap-2" dir="rtl">
                <Clapperboard className="w-4 h-4 shrink-0" />
                <span>הפק אודיו לפרק עם</span>
                <span dir="ltr" className="font-cinzel font-bold">{selectedVoice.name}</span>
                <span>({selectedVoice.hebrewName})</span>
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Error state */}
      {generationError && (
        <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">
          {generationError}
        </div>
      )}

      {/* Generated Audio Player for current episode */}
      {currentEpisodeAudio && (
        <div className="space-y-3 pt-3 border-t border-stone-800">
          <div className="flex items-center justify-between text-xs font-bold text-amber-300">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              ביצוע הפרק מוכן להאזנה ולהורדה
            </span>
            <span className="font-mono text-stone-400 text-[11px]">
              Voice: {selectedVoice.baseVoice} • Master 24kHz
            </span>
          </div>
          <AudioWaveformPlayer
            audioBase64={currentEpisodeAudio}
            candidateName={`${selectedVoice.name}-${topic}`}
            hebrewName={selectedVoice.hebrewName}
          />
        </div>
      )}

      {/* Past Generated Episodes History */}
      {pastEpisodes.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-stone-850">
          <h4 className="text-xs font-bold uppercase text-stone-400 tracking-wider">
            פרקים שהופקו בסשן זה ({pastEpisodes.length})
          </h4>
          <div className="space-y-3">
            {pastEpisodes.map((ep) => (
              <div
                key={ep.id}
                className="bg-stone-950/80 p-4 rounded-xl border border-stone-800 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="font-bold text-white flex items-center gap-2">
                    <Film className="w-3.5 h-3.5 text-amber-400" />
                    <span>{ep.title}</span>
                  </div>
                  <span className="text-stone-400 font-mono text-[10px]">{ep.createdAt}</span>
                </div>
                <p className="text-xs text-stone-300 font-hebrew line-clamp-2" dir="rtl">
                  {ep.script}
                </p>
                {ep.audioBase64 && (
                  <AudioWaveformPlayer
                    audioBase64={ep.audioBase64}
                    candidateName={`ep-${ep.title}`}
                    hebrewName={selectedVoice.hebrewName}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
