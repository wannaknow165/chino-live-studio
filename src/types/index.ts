export interface VoiceCandidate {
  id: string;
  voiceNumber: number; // 1 to 6
  name: string;
  hebrewName: string;
  archetype: string;
  ageRange: string;
  baseVoice: string; // Supported Gemini prebuilt voice: 'Charon' | 'Puck' | 'Zephyr' | 'Fenrir' | 'Orus' | 'Aoede' | 'Kore'
  model: string; // 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts'
  vocalProfile: {
    pitch: string;
    tempo: string;
    timbre: string;
    texture: string;
  };
  personality: string;
  deliveryStylePrompt: string;
  hebrewDirectionGuide: string;
  avatarColor: string;
  audioUrl?: string;
  audioBase64?: string;
  duration?: number;
  generatedAt?: string;
  status: 'idle' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
}

export interface AcuityMasterVoiceConfig {
  key: 'ACUITY_MASTER_VOICE';
  voiceNumber: number;
  candidateId: string;
  name: string;
  hebrewName: string;
  baseVoice: string;
  model: string;
  deliveryStylePrompt: string;
  vocalProfile: {
    pitch: string;
    tempo: string;
    timbre: string;
    texture: string;
  };
  selectedAt: string;
  testScript: string;
}

export interface GenerationSettings {
  model: 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts';
  speakingRate?: number;
  enhanceIsraeliCadence?: boolean;
}

export interface ProductionExportConfig {
  studio: string;
  seriesTitle: string;
  exportDate: string;
  selectedCandidate: {
    id: string;
    name: string;
    hebrewName: string;
    baseVoice: string;
    model: string;
    deliveryStylePrompt: string;
    vocalProfile: {
      pitch: string;
      tempo: string;
      timbre: string;
      texture: string;
    };
  };
  script: string;
  audioMetadata?: {
    format: string;
    sampleRate: number;
    channels: number;
    durationEstimateSec: number;
  };
  notes: string;
}

export interface GeneratedEpisode {
  id: string;
  title: string;
  concept: string;
  script: string;
  audioBase64?: string;
  audioUrl?: string;
  createdAt: string;
  duration?: number;
}
