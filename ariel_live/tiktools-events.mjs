// Keep documented event fields intact for review, without auth/profile blobs.
// Reference: https://tik.tools/docs (battleArmies, battleItemCard, roomUserSeq).
const scalarFields = ['msgId','timestamp','serverTsMs','matchId','sessionId','battleId',
  'status','durationSec','battleDuration','secsRemaining','transactionId','giftId',
  'giftName','giftType','diamondCount','totalDiamondCount','repeatCount','repeatEnd',
  'comment','text','action','likeCount','totalLikeCount','viewerCount','totalViewers',
  'cardType','effect','multiplier','senderUserId','senderNickname','sideHostUserId',
  'targetUserId','subMonth'];
const take = (o, fields) => Object.fromEntries(fields.filter(k => ['string','number','boolean'].includes(typeof o?.[k])).map(k => [k, o[k]]));
export function normalizeTikEvent(type, data, src, receivedAt = Date.now()) {
  if (!/^(chat|comment|gift|like|member|follow|share|social|subscribe|roomUserSeq|battle.*|linkMic.*)$/.test(type)) return null;
  const payload = take(data, scalarFields);
  if (data.user) payload.user = take(data.user, ['id','uniqueId','nickname']);
  if (Array.isArray(data.teams)) payload.teams = data.teams.map(t => ({
    ...take(t, ['hostUserId','score']),
    contributors: (t.users || []).slice(0, 20).map(u => ({ ...take(u, ['score']), user: take(u.user, ['id','uniqueId','nickname']) })),
  }));
  if (Array.isArray(data.hosts)) payload.hosts = data.hosts.map(h => ({
    ...take(h, ['hostUserId','teamTotalScore','teamIdx','isTeam']),
    members: (h.members || []).map(m => take(m, ['userId','score'])),
    contributors: (h.contributors || []).slice(0, 20).map(m => take(m, ['userId','score','nickname'])),
  }));
  if (data.lastGift) payload.lastGift = take(data.lastGift, ['gifterUserId','giftId','count','diamondCount','repeatCount']);
  // UNKNOWN, not a guessed winner, when the event lacks completion/score data.
  const phase = type === 'battleArmies' ? (data.secsRemaining === 0 || data.status === 2 ? 'ended' : [1, 4].includes(data.status) ? 'active' : 'unknown') : undefined;
  return { src, eventType: type, receivedAt, sourceTimestamp: data.serverTsMs ?? data.timestamp ?? null, phase, payload };
}
