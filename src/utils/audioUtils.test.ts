import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateHebrewSpeechDuration,
  formatTime,
  isValidWavBase64,
  getDefaultCandidates,
  buildProductionExport,
  DEFAULT_TEST_SCRIPT,
} from './audioUtils';

test('estimateHebrewSpeechDuration returns reasonable duration for Hebrew script', () => {
  const duration = estimateHebrewSpeechDuration(DEFAULT_TEST_SCRIPT);
  // Script is ~190 words, so at ~120 wpm plus pauses it should be roughly 100-130 seconds
  assert.ok(duration > 25, `Expected duration > 25s, got ${duration}`);
  assert.ok(duration < 180, `Expected duration < 180s, got ${duration}`);
});

test('estimateHebrewSpeechDuration handles empty input', () => {
  assert.equal(estimateHebrewSpeechDuration(''), 0);
  assert.equal(estimateHebrewSpeechDuration('   '), 0);
});

test('formatTime formats seconds accurately', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(12), '00:12');
  assert.equal(formatTime(120), '02:00');
});

test('getDefaultCandidates returns 5 distinctive numbered Israeli voice options', () => {
  const candidates = getDefaultCandidates();
  assert.equal(candidates.length, 5);
  const ids = candidates.map(c => c.id);
  assert.deepEqual(ids, ['mastermind', 'gentleman', 'street-genius', 'charming-devil', 'ice-man']);
  
  // Verify each candidate has voiceNumber 1 to 5 and a supported base voice
  const validVoices = ['Charon', 'Puck', 'Zephyr', 'Fenrir', 'Orus'];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    assert.equal(c.voiceNumber, i + 1);
    assert.ok(validVoices.includes(c.baseVoice), `Candidate ${c.id} has invalid base voice: ${c.baseVoice}`);
    assert.ok(c.deliveryStylePrompt.length > 20, `Candidate ${c.id} delivery style prompt is too short`);
    assert.ok(c.hebrewName.length > 0, `Candidate ${c.id} has empty hebrewName`);
  }
});

test('buildProductionExport creates valid JSON export structure', () => {
  const candidates = getDefaultCandidates();
  const exported = buildProductionExport(candidates[0], DEFAULT_TEST_SCRIPT);
  assert.equal(exported.selectedCandidate.id, 'mastermind');
  assert.equal(exported.selectedCandidate.baseVoice, 'Fenrir');
  assert.ok(exported.audioMetadata?.durationEstimateSec! > 0);
  assert.equal(exported.script, DEFAULT_TEST_SCRIPT);
});

test('isValidWavBase64 correctly detects RIFF headers', () => {
  // A minimal base64 starting with "RIFF....WAVE"
  // "RIFF" in ASCII is 0x52, 0x49, 0x46, 0x46
  // Followed by 4 bytes size, then "WAVE" (0x57, 0x41, 0x56, 0x45)
  const headerBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // 36 bytes
    0x57, 0x41, 0x56, 0x45, // WAVE
    0x66, 0x6d, 0x74, 0x20, // fmt 
  ]);
  let binary = '';
  for (let i = 0; i < headerBytes.length; i++) {
    binary += String.fromCharCode(headerBytes[i]);
  }
  const base64 = btoa(binary);
  assert.equal(isValidWavBase64(base64), true);
  assert.equal(isValidWavBase64('invalid-base64'), false);
  assert.equal(isValidWavBase64(''), false);
});
