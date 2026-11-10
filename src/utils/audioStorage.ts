/**
 * Audio storage using IndexedDB for storing base64 audio clips reliably
 * so users can replay and download them across reloads without paying for regeneration.
 */

const DB_NAME = 'TheVoiceNarratorStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_recordings';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudioRecording(
  id: string,
  data: {
    audioBase64: string;
    mimeType: string;
    duration?: number;
    script: string;
    voiceName: string;
    style: string;
    savedAt: string;
  }
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id, ...data });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to save audio in IndexedDB:', e);
  }
}

export async function getAudioRecording(id: string): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to get audio from IndexedDB:', e);
    return null;
  }
}

export async function getAllAudioRecordings(): Promise<Record<string, any>> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = req.result || [];
        const map: Record<string, any> = {};
        for (const item of results) {
          map[item.id] = item;
        }
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to get all audio recordings:', e);
    return {};
  }
}

import { AcuityMasterVoiceConfig } from '../types';

export function saveAcuityMasterVoice(config: AcuityMasterVoiceConfig): void {
  try {
    localStorage.setItem('ACUITY_MASTER_VOICE', JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save Acuity master voice in localStorage:', e);
  }
}

export function getAcuityMasterVoice(): AcuityMasterVoiceConfig | null {
  try {
    const raw = localStorage.getItem('ACUITY_MASTER_VOICE');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
