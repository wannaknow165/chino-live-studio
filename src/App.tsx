import React, { useState, useEffect } from 'react';
import { VoiceCandidate, AcuityMasterVoiceConfig } from './types';
import {
  getDefaultCandidates,
  DEFAULT_TEST_SCRIPT,
  base64ToWavBlobUrl,
} from './utils/audioUtils';
import {
  saveAudioRecording,
  getAllAudioRecordings,
  saveAcuityMasterVoice,
  getAcuityMasterVoice,
} from './utils/audioStorage';
import { createAndDownloadResultsZip } from './utils/zipUtils';
import { StudioHeader } from './components/StudioHeader';
import { ScriptEditor } from './components/ScriptEditor';
import { VoiceCandidateCard } from './components/VoiceCandidateCard';
import { SideBySideComparison } from './components/SideBySideComparison';
import { NextEpisodeStudio } from './components/NextEpisodeStudio';
import { ExportModal } from './components/ExportModal';
import { LionVoiceStudio } from './components/LionVoiceStudio';
import { PostMarriageStudio } from './components/PostMarriageStudio';
import {
  Sparkles,
  Award,
  Layers,
  HelpCircle,
  AlertTriangle,
  Film,
  CheckCircle2,
  Lock,
  FolderArchive,
  Loader2,
} from 'lucide-react';

export default function App() {
  const [candidates, setCandidates] = useState<VoiceCandidate[]>(getDefaultCandidates());
  const [script, setScript] = useState<string>(DEFAULT_TEST_SCRIPT);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<string>(() => {
    const saved = getAcuityMasterVoice();
    return saved?.candidateId || 'mastermind';
  });
  const [comparisonAId, setComparisonAId] = useState<string>('mastermind');
  const [comparisonBId, setComparisonBId] = useState<string>('gentleman');
  const [activeTab, setActiveTab] = useState<'casting' | 'comparison' | 'nextepisode' | 'postmarriage'>('casting');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [apiErrorGlobal, setApiErrorGlobal] = useState<string | null>(null);
  const [lockedVoiceToast, setLockedVoiceToast] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [zippingStatus, setZippingStatus] = useState<string | null>(null);

  // Restore saved audio from IndexedDB on initial mount
  useEffect(() => {
    async function restoreSavedAudios() {
      try {
        const savedMap = await getAllAudioRecordings();
        if (Object.keys(savedMap).length > 0) {
          setCandidates((prev) =>
            prev.map((c) => {
              const saved = savedMap[c.id];
              if (saved && saved.audioBase64) {
                return {
                  ...c,
                  audioBase64: saved.audioBase64,
                  audioUrl: base64ToWavBlobUrl(saved.audioBase64),
                  status: 'ready',
                  generatedAt: saved.savedAt,
                };
              }
              return c;
            })
          );
        }
      } catch (err) {
        console.warn('Could not restore cached audio:', err);
      }
    }
    restoreSavedAudios();
  }, []);

  // Generate audio for an individual candidate using real Gemini TTS
  const handleGenerateAudio = async (candidateId: string) => {
    setApiErrorGlobal(null);
    const target = candidates.find((c) => c.id === candidateId);
    if (!target) return;

    setCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, status: 'generating', errorMessage: undefined } : c))
    );

    try {
      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          voiceName: target.baseVoice,
          style: target.deliveryStylePrompt,
          model: target.model,
          candidateId: target.id,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate speech with Gemini TTS');
      }

      const audioUrl = base64ToWavBlobUrl(data.audioBase64);
      const generatedAt = new Date().toISOString();

      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId
            ? {
                ...c,
                audioBase64: data.audioBase64,
                audioUrl,
                status: 'ready',
                generatedAt,
              }
            : c
        )
      );

      // Persist in IndexedDB
      await saveAudioRecording(candidateId, {
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || 'audio/wav',
        script,
        voiceName: target.baseVoice,
        style: target.deliveryStylePrompt,
        savedAt: generatedAt,
      });
    } catch (error: any) {
      console.error(`Audio generation error for ${candidateId}:`, error);
      const msg = error?.message || 'Server error generating audio.';
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId
            ? {
                ...c,
                status: 'error',
                errorMessage: msg,
              }
            : c
        )
      );
      setApiErrorGlobal(msg);
    }
  };

  // Generate all 5 candidates sequentially
  const handleGenerateAll = async () => {
    for (const candidate of candidates) {
      await handleGenerateAudio(candidate.id);
    }
  };

  const isGeneratingAny = candidates.some((c) => c.status === 'generating');
  const generatedCount = candidates.filter((c) => Boolean(c.audioBase64)).length;
  const selectedFavorite = candidates.find((c) => c.id === selectedFavoriteId) || candidates[0];

  const handleUpdateStylePrompt = (candidateId: string, newPrompt: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, deliveryStylePrompt: newPrompt } : c))
    );
  };

  const handleUpdateBaseVoice = (candidateId: string, newVoice: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, baseVoice: newVoice } : c))
    );
  };

  const handleAddToComparison = (candidate: VoiceCandidate) => {
    if (comparisonAId !== candidate.id) {
      setComparisonBId(candidate.id);
    } else {
      setComparisonAId(candidate.id);
    }
    setActiveTab('comparison');
  };

  const handleSelectFavorite = (candidate: VoiceCandidate) => {
    setSelectedFavoriteId(candidate.id);
    const masterConfig: AcuityMasterVoiceConfig = {
      key: 'ACUITY_MASTER_VOICE',
      voiceNumber: candidate.voiceNumber,
      candidateId: candidate.id,
      name: candidate.name,
      hebrewName: candidate.hebrewName,
      baseVoice: candidate.baseVoice,
      model: candidate.model,
      deliveryStylePrompt: candidate.deliveryStylePrompt,
      vocalProfile: candidate.vocalProfile,
      selectedAt: new Date().toISOString(),
      testScript: script,
    };
    saveAcuityMasterVoice(masterConfig);
    setLockedVoiceToast(
      `אפשרות #${candidate.voiceNumber} (${candidate.name} — ${candidate.hebrewName}) ננעלה בהצלחה כקול הקבוע לסדרת ACUITY!`
    );
    setTimeout(() => {
      setLockedVoiceToast(null);
    }, 5000);
  };

  // Comprehensive ZIP download handler
  const handleDownloadResultsZip = async () => {
    setIsZipping(true);
    setZippingStatus('בודק את מצב ההקלטות של כל 5 הקולות...');
    try {
      let currentCandidates = [...candidates];

      // Check if any candidates are missing audio and generate them on-the-fly
      const missing = currentCandidates.filter((c) => !c.audioBase64);
      if (missing.length > 0) {
        for (let i = 0; i < missing.length; i++) {
          const target = missing[i];
          setZippingStatus(
            `מפיק אודיו עבור אפשרות #${target.voiceNumber} (${target.hebrewName}) [${i + 1}/${missing.length}]...`
          );

          try {
            const response = await fetch('/api/tts/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: script,
                voiceName: target.baseVoice,
                style: target.deliveryStylePrompt,
                model: target.model,
                candidateId: target.id,
              }),
            });
            const data = await response.json();
            if (response.ok && data.success && data.audioBase64) {
              const audioUrl = base64ToWavBlobUrl(data.audioBase64);
              const generatedAt = new Date().toISOString();

              currentCandidates = currentCandidates.map((c) =>
                c.id === target.id
                  ? { ...c, audioBase64: data.audioBase64, audioUrl, status: 'ready', generatedAt }
                  : c
              );
              setCandidates(currentCandidates);

              await saveAudioRecording(target.id, {
                audioBase64: data.audioBase64,
                mimeType: data.mimeType || 'audio/wav',
                script,
                voiceName: target.baseVoice,
                style: target.deliveryStylePrompt,
                savedAt: generatedAt,
              });
            }
          } catch (genErr) {
            console.warn(`Could not generate candidate ${target.id} for zip:`, genErr);
          }
        }
      }

      setZippingStatus('אורז את 5 קובצי ה-WAV (24kHz), תסריט פרק 001, ומפרט הפקה מלא ל-ZIP...');
      const res = await createAndDownloadResultsZip({
        candidates: currentCandidates,
        script,
        selectedFavoriteId,
      });

      if (!res.success) {
        throw new Error(res.error || 'שגיאה ביצירת קובץ ה-ZIP');
      }

      setLockedVoiceToast(
        'חבילת ה-ZIP המלאה הורדה בהצלחה! מכילה את כל 5 קובצי ה-WAV, תסריט פרק 001 ומפרט הפקה.'
      );
      setTimeout(() => setLockedVoiceToast(null), 6000);
    } catch (err: any) {
      console.error('ZIP generation failed:', err);
      setApiErrorGlobal(err?.message || 'שגיאה ביצירת קובץ ה-ZIP');
    } finally {
      setIsZipping(false);
      setZippingStatus(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#07070a] text-stone-100 flex flex-col font-hebrew selection:bg-amber-500/30 selection:text-amber-200">
      {/* Studio Header */}
      <StudioHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedFavorite={selectedFavorite}
        onGenerateAll={handleGenerateAll}
        isGeneratingAny={isGeneratingAny}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        generatedCount={generatedCount}
        onDownloadZip={handleDownloadResultsZip}
        isZipping={isZipping}
      />

      {/* ZIP Packaging In-Progress Banner */}
      {isZipping && zippingStatus && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-4 animate-in fade-in duration-200">
          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-600/30 via-amber-500/20 to-amber-700/30 border border-amber-400/50 flex items-center justify-between gap-3 text-amber-200 shadow-xl shadow-amber-500/15">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-400 text-stone-950 flex items-center justify-center font-bold shrink-0">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <span className="font-bold text-white text-sm block">מכין את חבילת ה-ZIP להורדה:</span>
                <span className="text-amber-300 text-xs font-mono">{zippingStatus}</span>
              </div>
            </div>
            <div className="text-xs font-mono text-amber-400/80 hidden sm:block">
              24kHz Unary WAV Package
            </div>
          </div>
        </div>
      )}

      {/* Locked Permanent Voice Toast Banner */}
      {lockedVoiceToast && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/20 via-amber-400/10 to-amber-600/20 border border-amber-400/40 flex items-center justify-between gap-3 text-amber-200 text-sm shadow-lg shadow-amber-500/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-amber-400 text-stone-950 flex items-center justify-center font-bold shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-white block">הקול הקבוע ננעל:</span>
                <span className="text-amber-300 text-xs">{lockedVoiceToast}</span>
              </div>
            </div>
            <button
              onClick={() => setLockedVoiceToast(null)}
              className="text-amber-400 hover:text-white text-xs font-bold px-2 py-1 rounded border border-amber-400/20 hover:border-amber-400/50"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* Global API Error Banner if present */}
      {apiErrorGlobal && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-4">
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-500/40 flex items-start gap-3 text-red-200 text-xs">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold">הודעת מודל Gemini TTS:</span>
              <p>{apiErrorGlobal}</p>
            </div>
            <button
              onClick={() => setApiErrorGlobal(null)}
              className="mr-auto text-red-400 hover:text-white text-xs font-bold"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      {/* Main Studio Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        {/* TAB 1: CASTING STUDIO */}
        {activeTab === 'casting' && (
          <div className="space-y-8">
            {/* The Lion King Video Reference & Fast Voice Audition */}
            <LionVoiceStudio
              lionCandidate={candidates.find((c) => c.id === 'mastermind') || candidates[0]}
              onSelectCandidate={handleSelectFavorite}
              onGenerateAudio={handleGenerateAudio}
              onLoadScript={setScript}
              onGoToPostMarriage={() => setActiveTab('postmarriage')}
            />

            {/* Script Director Console */}
            <ScriptEditor
              script={script}
              onScriptChange={setScript}
              onGenerateAll={handleGenerateAll}
              isGeneratingAny={isGeneratingAny}
              onDownloadZip={handleDownloadResultsZip}
              isZipping={isZipping}
            />

            {/* Candidates Section Title & Subtext */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div>
                <h3 className="text-xl sm:text-2xl font-bold font-cinzel text-white flex items-center gap-2.5">
                  <span>5 Voice Archetype Candidates</span>
                  <span className="text-xs font-mono font-normal text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/20">
                    5 אפשרויות לבחירת הקול הקבוע
                  </span>
                </h3>
                <p className="text-xs text-stone-300 font-hebrew" dir="rtl">
                  5 אינטרפרטציות קוליות שונות לקריאת פרק 001. האזן לכולן, השווה ראש-בראש ב-A/B, ובחר את האחת שתהפוך לקול הקבוע של הסדרה.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-stone-400">
                <span>מצב הפקה:</span>
                <span className="font-bold text-amber-300">
                  {generatedCount === 5 ? 'כל 5 האפשרויות הוקלטו' : `${generatedCount} מתוך 5 מוכנות להאזנה`}
                </span>
              </div>
            </div>

            {/* 5 Voice Candidates Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {candidates.map((candidate) => (
                <VoiceCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  isSelectedFavorite={selectedFavoriteId === candidate.id}
                  onSelectFavorite={handleSelectFavorite}
                  onGenerateAudio={handleGenerateAudio}
                  onUpdateStylePrompt={handleUpdateStylePrompt}
                  onUpdateBaseVoice={handleUpdateBaseVoice}
                  onAddToComparison={handleAddToComparison}
                  isInComparison={comparisonAId === candidate.id || comparisonBId === candidate.id}
                  script={script}
                />
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: SIDE-BY-SIDE COMPARISON */}
        {activeTab === 'comparison' && (
          <SideBySideComparison
            candidates={candidates}
            candidateAId={comparisonAId}
            candidateBId={comparisonBId}
            onSelectCandidateA={setComparisonAId}
            onSelectCandidateB={setComparisonBId}
            selectedFavoriteId={selectedFavoriteId}
            onSelectFavorite={handleSelectFavorite}
            onClose={() => setActiveTab('casting')}
          />
        )}

        {/* TAB 3: NEXT EPISODE STUDIO */}
        {activeTab === 'nextepisode' && (
          <NextEpisodeStudio
            selectedVoice={selectedFavorite}
            onOpenExportModal={() => setIsExportModalOpen(true)}
          />
        )}

        {/* TAB 4: POST MARRIAGE & SOCIAL OPTIMIZATION */}
        {activeTab === 'postmarriage' && (
          <PostMarriageStudio
            currentScript={script}
            selectedVoice={selectedFavorite}
            onLoadScript={setScript}
            onGoToVideo={() => setActiveTab('casting')}
          />
        )}
      </main>

      {/* Production Spec Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        selectedCandidate={selectedFavorite}
        script={script}
        onDownloadZip={handleDownloadResultsZip}
        isZipping={isZipping}
      />

      {/* Studio Footer */}
      <footer className="border-t border-stone-850 bg-[#08080b] py-6 text-center text-xs text-stone-400 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-bold text-stone-300">THE VOICE STUDIO</span>
            <span>• Powered by Gemini 3.8 Flash TTS (Audio 24kHz Unary WAV)</span>
          </div>
          <div className="text-[11px] text-stone-400">
            Hebrew RTL Cinematic TikTok Voice Casting Engine
          </div>
        </div>
      </footer>
    </div>
  );
}
