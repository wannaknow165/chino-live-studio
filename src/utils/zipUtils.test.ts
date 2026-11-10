import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultCandidates, DEFAULT_TEST_SCRIPT } from './audioUtils.ts';
import { createAndDownloadResultsZip } from './zipUtils.ts';

test('createAndDownloadResultsZip packages candidates without throwing', async () => {
  const candidates = getDefaultCandidates();
  // Mock a mini valid base64 wav for candidate 1
  candidates[0].audioBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  const result = await createAndDownloadResultsZip({
    candidates,
    script: DEFAULT_TEST_SCRIPT,
    selectedFavoriteId: 'mastermind',
  });

  assert.equal(result.success, true);
});
