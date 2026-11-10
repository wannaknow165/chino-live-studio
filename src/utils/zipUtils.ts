import JSZip from 'jszip';
import { VoiceCandidate } from '../types';
import { buildProductionExport } from './audioUtils';

export interface ZipProgressStatus {
  step: 'checking' | 'generating' | 'packaging' | 'complete' | 'error';
  currentCandidate?: string;
  completedCount: number;
  totalCount: number;
  message: string;
}

/**
 * Creates and triggers download of a comprehensive ZIP archive containing
 * all 5 voice performance WAV files, Hebrew script, production JSON spec, and README.
 */
export async function createAndDownloadResultsZip({
  candidates,
  script,
  selectedFavoriteId,
}: {
  candidates: VoiceCandidate[];
  script: string;
  selectedFavoriteId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const zip = new JSZip();

    // 1. Create subfolder for Audio files
    const audioFolder = zip.folder('audio_recordings') || zip;

    let wavFilesCount = 0;

    for (const candidate of candidates) {
      if (candidate.audioBase64) {
        // Strip data:audio/wav;base64, prefix if present
        let cleanBase64 = candidate.audioBase64;
        const commaIdx = cleanBase64.indexOf(',');
        if (commaIdx !== -1) {
          cleanBase64 = cleanBase64.substring(commaIdx + 1);
        }

        const safeName = candidate.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `Option_${candidate.voiceNumber}_${safeName}_${candidate.baseVoice}.wav`;

        audioFolder.file(filename, cleanBase64, { base64: true });
        wavFilesCount++;
      }
    }

    // 2. Add Hebrew Script File
    const scriptContent = `=====================================================
ACUITY — פרק 001: אשליית הדאגה
מתוך הספר ״אקואיטי״ — מאחורי המובן מאליו
=====================================================

${script}

-----------------------------------------------------
תאריך יצירה: ${new Date().toLocaleString('he-IL')}
הנחיות בימוי: גבר ישראלי, קול נמוך, בטוח, אינטליגנטי, עם ציניות עדינה. לא קול של פרסומת.
`;
    zip.file('Acuity_Episode_001_Script_HE.txt', scriptContent);

    // 3. Add Production JSON Spec
    const selected = candidates.find((c) => c.id === selectedFavoriteId) || candidates[0];
    const exportSpec = buildProductionExport(selected, script);
    zip.file('Acuity_Voice_Production_Spec.json', JSON.stringify(exportSpec, null, 2));

    // 4. Add Comprehensive README & Production Guide
    const readmeContent = `=====================================================
THE VOICE — ACUITY HEBREW NARRATOR STUDIO
חבילת תוצאות מלאה: פרק 001 - אשליית הדאגה
=====================================================

תוכן החבילה:
1. תיקיית audio_recordings/
   מכילה קובצי WAV באיכות מאסטר אולפנית (24kHz Mono 16-bit PCM) של כל האפשרויות שהופקו:
${candidates
  .map(
    (c) =>
      `   - אפשרות #${c.voiceNumber}: ${c.name} (${c.hebrewName}) | קול בסיס: ${c.baseVoice} | סטטוס: ${
        c.audioBase64 ? 'מוקלט ומוכן' : 'לא הופק עדיין'
      }`
  )
  .join('\n')}

2. קובץ Acuity_Episode_001_Script_HE.txt:
   התסריט המקורי בעברית עם סימוני פיסוק והדגשות לקריאה טבעית ואינטליגנטית.

3. קובץ Acuity_Voice_Production_Spec.json:
   מפרט מלא של הקול שנבחר, פרופיל קולי (pitch, tempo, timbre, texture),
   הנחיות בימוי למודל Gemini TTS, והגדרות לשימוש עקבי בכל פרקי הסדרה.

הקול הנבחר כרגע כקול קבוע:
- אפשרות #${selected.voiceNumber}: ${selected.name} (${selected.hebrewName})
- קול בסיס: ${selected.baseVoice}
- ארכיטיפ: ${selected.archetype}

הנחיות שימוש בעריכת וידאו:
- קובצי ה-WAV תואמים ישירות לכל תוכנת עריכה: Premiere Pro, DaVinci Resolve, CapCut, After Effects.
- קצב דגימה: 24,000Hz (24kHz), 16-bit PCM Mono.
- מומלץ בעריכה להוסיף EQ עדין להדגשת התדרים הנמוכים (100-250Hz) וקומפרסור קל לקבלת צליל קולנועי הדוק.

=====================================================
`;
    zip.file('README_ACUITY_STUDIO.txt', readmeContent);

    // 5. Generate ZIP Blob
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().slice(0, 10);
      link.download = `Acuity_Ep001_All_Voices_Bundle_${timestamp}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to create ZIP package:', err);
    return { success: false, error: err?.message || 'שגיאה ביצירת קובץ ה-ZIP' };
  }
}

