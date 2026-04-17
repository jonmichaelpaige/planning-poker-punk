export function createInitialState({ userId }) {
  return {
    me: {
      id: userId,
      name: "",
    },
    roomId: "",
    hostId: "",
    hostMissingSince: 0,
    lastHostSetAt: 0,
    revealed: false,
    votes: {},
    lastSnapshotAt: 0,
    selectedCard: null,
    presence: [],
    logId: null,
  };
}

export function enterRoom(state, { roomId, name, hostId, logId }) {
  state.roomId = roomId;
  state.me.name = name;
  state.hostId = hostId || "";

  state.hostMissingSince = 0;
  state.lastHostSetAt = 0;

  state.revealed = false;
  state.votes = {};
  state.selectedCard = null;
  state.lastSnapshotAt = 0;
  state.presence = [];
  state.logId = logId ?? null;
}

export function leaveRoomState(state) {
  state.roomId = "";
  state.hostId = "";
  state.hostMissingSince = 0;
  state.lastHostSetAt = 0;

  state.revealed = false;
  state.votes = {};
  state.selectedCard = null;
  state.presence = [];
  state.lastSnapshotAt = 0;
  state.logId = null;
}

export function setPresence(state, presenceList) {
  state.presence = presenceList;
}

export function pruneVotesToPresence(state) {
  const presentIds = new Set(state.presence.map(p => p.id));
  for (const userId of Object.keys(state.votes)) {
    if (!presentIds.has(userId)) delete state.votes[userId];
  }
}

export function setSelectedCard(state, value) {
  state.selectedCard = value;
}

export function applyLocalVote(state, { userId, value }) {
  state.votes[userId] = value;
}

export function applyReveal(state) {
  state.revealed = true;
}

export function applyReset(state) {
  state.revealed = false;
  state.votes = {};
  state.selectedCard = null;
}

export function applySnapshot(state, payload) {
  const ts = Number(payload.ts || 0);
  if (ts <= state.lastSnapshotAt) return false;

  state.lastSnapshotAt = ts;
  state.revealed = !!payload.revealed;
  state.votes = { ...(payload.votes || {}) };
  if (payload.logId != null && state.logId == null) {
    state.logId = payload.logId;
  }
  return true;
}
