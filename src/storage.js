export function getOrCreateUserId(win) {
  const key = "pp:userId";
  let existing = win.localStorage.getItem(key);
  if (existing) return existing;

  const cryptoObj = win.crypto;
  const id = (cryptoObj && cryptoObj.randomUUID)
    ? cryptoObj.randomUUID()
    : `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  win.localStorage.setItem(key, id);
  return id;
}

export function persistLastHost(win, roomId, hostId) {
  if (!roomId || !hostId) return;
  try {
    win.localStorage.setItem(
      `pp:lastHost:${roomId}`,
      JSON.stringify({ hostId, updatedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function loadLastHost(win, roomId, ttlMs = 8 * 60 * 60 * 1000) {
  if (!roomId) return "";
  try {
    const raw = win.localStorage.getItem(`pp:lastHost:${roomId}`);
    if (!raw) return "";

    // Legacy format: plain hostId string
    if (raw[0] !== "{") return raw;

    const parsed = JSON.parse(raw);
    const hostId = String(parsed?.hostId || "");
    const updatedAt = Number(parsed?.updatedAt || 0);
    if (!hostId) return "";
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return hostId;

    const age = Date.now() - updatedAt;
    if (age < 0 || age > ttlMs) return "";
    return hostId;
  } catch {
    return "";
  }
}

export function loadLastInputs(win) {
  return {
    lastName: win.localStorage.getItem("pp:lastName") || "",
    lastRoom: win.localStorage.getItem("pp:lastRoom") || "",
  };
}

export function persistLastInputs(win, { name, roomId }) {
  win.localStorage.setItem("pp:lastName", name);
  win.localStorage.setItem("pp:lastRoom", roomId);
}

export function getOrCreateJoinedAt(win, roomId, userId, ttlMs = 8 * 60 * 60 * 1000) {
  // Persist a stable joinedAt per (roomId,userId) so a refresh doesn't change host ordering.
  // TTL prevents extremely old joins from sticking forever if a room code gets reused.
  const key = `pp:joinedAt:${roomId}:${userId}`;
  const now = Date.now();

  try {
    const raw = win.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const joinedAt = Number(parsed?.joinedAt || 0);
      const updatedAt = Number(parsed?.updatedAt || 0);
      if (Number.isFinite(joinedAt) && joinedAt > 0 && Number.isFinite(updatedAt) && (now - updatedAt) <= ttlMs) {
        win.localStorage.setItem(key, JSON.stringify({ joinedAt, updatedAt: now }));
        return joinedAt;
      }
    }
  } catch {
    // ignore
  }

  try {
    win.localStorage.setItem(key, JSON.stringify({ joinedAt: now, updatedAt: now }));
  } catch {
    // ignore
  }

  return now;
}
