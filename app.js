(() => {
  "use strict";

  const FIB_CARDS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

  const el = {
    joinView: document.getElementById("joinView"),
    roomView: document.getElementById("roomView"),
    nameInput: document.getElementById("nameInput"),
    roomInput: document.getElementById("roomInput"),
    createRoomBtn: document.getElementById("createRoomBtn"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    joinError: document.getElementById("joinError"),

    roomCode: document.getElementById("roomCode"),
    meLabel: document.getElementById("meLabel"),
    hostLabel: document.getElementById("hostLabel"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    leaveBtn: document.getElementById("leaveBtn"),

    playersList: document.getElementById("playersList"),
    cards: document.getElementById("cards"),

    revealBtn: document.getElementById("revealBtn"),
    resetBtn: document.getElementById("resetBtn"),
    status: document.getElementById("status"),
  };

  function setStatus(message) {
    el.status.textContent = message || "";
  }

  function showJoinError(message) {
    el.joinError.hidden = !message;
    el.joinError.textContent = message || "";
  }

  function getUrlParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setUrlRoom(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }

  function clearUrlRoom() {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.toString());
  }

  function normalizeRoomCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function randomRoomCode(length = 6) {
    // Crockford-ish base32 without I/L/O/U to avoid confusion
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  function getOrCreateUserId() {
    const key = "pp:userId";
    let existing = localStorage.getItem(key);
    if (existing) return existing;

    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  }

  function safeName(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "Anonymous";
    return trimmed.slice(0, 32);
  }

  function requireSupabaseConfig() {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase config. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase client not loaded. Check the supabase-js script tag.");
    }
  }

  const state = {
    me: {
      id: getOrCreateUserId(),
      name: "",
    },
    roomId: "",
    hostId: "",
    revealed: false,
    votes: {}, // userId -> number
    lastSnapshotAt: 0,
    selectedCard: null,
    presence: [], // {id,name,joinedAt}
  };

  let supabaseClient = null;
  let roomChannel = null;

  function isHost() {
    return state.hostId && state.me.id === state.hostId;
  }

  function computeHostIdFromPresence(presence) {
    // Host = earliest joinedAt, tie-break by id
    const sorted = [...presence].sort((a, b) => {
      const aj = Number(a.joinedAt || 0);
      const bj = Number(b.joinedAt || 0);
      if (aj !== bj) return aj - bj;
      return String(a.id).localeCompare(String(b.id));
    });
    return sorted[0]?.id || "";
  }

  function setViews(inRoom) {
    el.joinView.hidden = !!inRoom;
    el.roomView.hidden = !inRoom;
  }

  function renderCards() {
    el.cards.innerHTML = "";
    for (const value of FIB_CARDS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cardbtn";
      btn.textContent = String(value);
      btn.dataset.value = String(value);
      btn.addEventListener("click", () => onPickCard(value));
      el.cards.appendChild(btn);
    }
  }

  function render() {
    document.title = window.APP_TITLE || "Planning Poker";

    el.roomCode.textContent = state.roomId;
    el.meLabel.textContent = `You: ${state.me.name}`;

    const hostName = state.presence.find(p => p.id === state.hostId)?.name || "";
    el.hostLabel.textContent = state.hostId
      ? (hostName ? `Host: ${hostName}` : "Host selected")
      : "Host: (none)";

    // Host-only controls (keeps snapshot logic sane)
    el.revealBtn.disabled = !isHost() || state.revealed;
    el.resetBtn.disabled = !isHost();

    // Cards disabled after reveal (until reset)
    const cardButtons = el.cards.querySelectorAll(".cardbtn");
    cardButtons.forEach(btn => {
      const v = Number(btn.dataset.value);
      btn.classList.toggle("selected", state.selectedCard === v);
      btn.disabled = state.revealed;
    });

    // Players list
    el.playersList.innerHTML = "";
    const players = [...state.presence].sort((a, b) => a.name.localeCompare(b.name));

    for (const p of players) {
      const li = document.createElement("li");
      li.className = "player";

      const left = document.createElement("div");
      left.className = "left";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = p.name + (p.id === state.me.id ? " (you)" : "");

      const meta = document.createElement("div");
      meta.className = "muted small";

      const hasVote = Object.prototype.hasOwnProperty.call(state.votes, p.id);
      if (!state.revealed) {
        meta.textContent = hasVote ? "Voted" : "Waiting";
      } else {
        meta.textContent = hasVote ? `Vote: ${state.votes[p.id]}` : "No vote";
      }

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      const badges = [];

      if (p.id === state.hostId) {
        const host = document.createElement("span");
        host.className = "badge host";
        host.textContent = "Host";
        badges.push(host);
      }

      if (!state.revealed && Object.prototype.hasOwnProperty.call(state.votes, p.id)) {
        const voted = document.createElement("span");
        voted.className = "badge ok";
        voted.textContent = "✓";
        badges.push(voted);
      }

      for (const b of badges) right.appendChild(b);

      li.appendChild(left);
      li.appendChild(right);
      el.playersList.appendChild(li);
    }

    // Status
    const total = state.presence.length;
    const voted = Object.keys(state.votes).filter(id => state.presence.some(p => p.id === id)).length;
    setStatus(state.revealed ? `Revealed • ${total} players` : `Waiting • ${voted}/${total} voted`);
  }

  function getPresenceList() {
    if (!roomChannel) return [];
    const raw = roomChannel.presenceState();

    /** @type {Array<{id:string,name:string,joinedAt:number}>} */
    const list = [];

    for (const [id, metas] of Object.entries(raw)) {
      // metas is an array; pick the most recent joinedAt
      const meta = Array.isArray(metas) ? metas[metas.length - 1] : metas;
      list.push({
        id,
        name: safeName(meta?.name || "Anonymous"),
        joinedAt: Number(meta?.joinedAt || 0),
      });
    }

    return list;
  }

  function updatePresenceAndHost() {
    state.presence = getPresenceList();
    const newHost = computeHostIdFromPresence(state.presence);

    const hostChanged = newHost && newHost !== state.hostId;
    state.hostId = newHost;

    // If I just became host, broadcast a snapshot so late-joiners converge.
    if (hostChanged && isHost()) {
      broadcastSnapshot({ toId: null });
    }

    // Drop votes for users who left
    const presentIds = new Set(state.presence.map(p => p.id));
    for (const userId of Object.keys(state.votes)) {
      if (!presentIds.has(userId)) delete state.votes[userId];
    }

    render();
  }

  async function broadcast(event, payload) {
    if (!roomChannel) return;
    await roomChannel.send({
      type: "broadcast",
      event,
      payload,
    });
  }

  async function broadcastSnapshot({ toId }) {
    if (!isHost()) return;

    const snapshot = {
      roomId: state.roomId,
      revealed: state.revealed,
      votes: state.votes,
      hostId: state.hostId,
      fromId: state.me.id,
      toId: toId || null,
      ts: Date.now(),
    };

    await broadcast("state_snapshot", snapshot);
  }

  async function requestSnapshot() {
    await broadcast("state_request", {
      roomId: state.roomId,
      requesterId: state.me.id,
      ts: Date.now(),
    });
  }

  function applySnapshot(payload) {
    // Ignore snapshots not intended for me
    if (payload.toId && payload.toId !== state.me.id) return;

    // Only accept newer snapshots
    const ts = Number(payload.ts || 0);
    if (ts <= state.lastSnapshotAt) return;

    state.lastSnapshotAt = ts;
    state.revealed = !!payload.revealed;

    // Votes are a plain object userId->number
    state.votes = { ...(payload.votes || {}) };

    // Host can shift during sync; presence is still source of truth
    render();
  }

  async function onPickCard(value) {
    if (!state.roomId || !roomChannel) return;
    if (state.revealed) return;

    state.selectedCard = value;
    state.votes[state.me.id] = value;
    render();

    await broadcast("vote", {
      roomId: state.roomId,
      userId: state.me.id,
      name: state.me.name,
      value,
      ts: Date.now(),
    });

    // If I'm host, immediately publish a fresh snapshot
    if (isHost()) {
      await broadcastSnapshot({ toId: null });
    }
  }

  async function onReveal() {
    if (!isHost()) return;
    if (state.revealed) return;

    state.revealed = true;
    render();

    await broadcast("reveal", {
      roomId: state.roomId,
      by: state.me.id,
      ts: Date.now(),
    });

    await broadcastSnapshot({ toId: null });
  }

  async function onReset() {
    if (!isHost()) return;

    state.revealed = false;
    state.votes = {};
    state.selectedCard = null;
    render();

    await broadcast("reset", {
      roomId: state.roomId,
      by: state.me.id,
      ts: Date.now(),
    });

    await broadcastSnapshot({ toId: null });
  }

  function attachUiHandlers() {
    el.createRoomBtn.addEventListener("click", async () => {
      showJoinError("");
      const name = safeName(el.nameInput.value);
      const roomId = randomRoomCode(6);
      await joinRoom(roomId, name);
    });

    el.joinRoomBtn.addEventListener("click", async () => {
      showJoinError("");
      const name = safeName(el.nameInput.value);
      const roomId = normalizeRoomCode(el.roomInput.value);
      if (!roomId) {
        showJoinError("Enter a room code (or create a new room). ");
        return;
      }
      await joinRoom(roomId, name);
    });

    el.copyLinkBtn.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.searchParams.set("room", state.roomId);
      await navigator.clipboard.writeText(url.toString());
      setStatus("Link copied to clipboard.");
      setTimeout(() => render(), 1000);
    });

    el.leaveBtn.addEventListener("click", async () => {
      await leaveRoom();
    });

    el.revealBtn.addEventListener("click", onReveal);
    el.resetBtn.addEventListener("click", onReset);

    // Enter key on room input joins
    el.roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.joinRoomBtn.click();
    });

    el.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.joinRoomBtn.click();
    });
  }

  async function joinRoom(roomId, name) {
    roomId = normalizeRoomCode(roomId);
    name = safeName(name);

    try {
      requireSupabaseConfig();
    } catch (err) {
      showJoinError(String(err.message || err));
      return;
    }

    if (!roomId) {
      showJoinError("Missing room id.");
      return;
    }

    // Persist inputs
    localStorage.setItem("pp:lastName", name);
    localStorage.setItem("pp:lastRoom", roomId);

    if (!supabaseClient) {
      supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }

    // Clean up prior room if any
    await leaveRoom({ silent: true });

    state.roomId = roomId;
    state.me.name = name;
    state.hostId = "";
    state.revealed = false;
    state.votes = {};
    state.selectedCard = null;
    state.lastSnapshotAt = 0;

    setUrlRoom(roomId);
    setViews(true);
    render();

    roomChannel = supabaseClient.channel(`room:${roomId}`, {
      config: {
        presence: { key: state.me.id },
        broadcast: { self: true },
      },
    });

    roomChannel
      .on("presence", { event: "sync" }, () => {
        updatePresenceAndHost();
      })
      .on("presence", { event: "join" }, () => {
        updatePresenceAndHost();
      })
      .on("presence", { event: "leave" }, () => {
        updatePresenceAndHost();
      })
      .on("broadcast", { event: "vote" }, ({ payload }) => {
        if (!payload || payload.roomId !== state.roomId) return;
        if (state.revealed) return; // ignore late votes after reveal
        const userId = String(payload.userId || "");
        const value = Number(payload.value);
        if (!userId || !Number.isFinite(value)) return;
        state.votes[userId] = value;
        render();
      })
      .on("broadcast", { event: "reveal" }, ({ payload }) => {
        if (!payload || payload.roomId !== state.roomId) return;
        state.revealed = true;
        render();
      })
      .on("broadcast", { event: "reset" }, ({ payload }) => {
        if (!payload || payload.roomId !== state.roomId) return;
        state.revealed = false;
        state.votes = {};
        state.selectedCard = null;
        render();
      })
      .on("broadcast", { event: "state_request" }, async ({ payload }) => {
        if (!payload || payload.roomId !== state.roomId) return;
        if (!isHost()) return;
        const requesterId = String(payload.requesterId || "");
        if (!requesterId) return;
        await broadcastSnapshot({ toId: requesterId });
      })
      .on("broadcast", { event: "state_snapshot" }, ({ payload }) => {
        if (!payload || payload.roomId !== state.roomId) return;
        applySnapshot(payload);
      });

    const { error } = await roomChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setStatus("Connected.");
        await roomChannel.track({
          name: state.me.name,
          joinedAt: Date.now(),
        });

        // Ask host for current state
        await requestSnapshot();
      }
    });

    if (error) {
      showJoinError(`Failed to join room: ${error.message}`);
      await leaveRoom({ silent: true });
      setViews(false);
      return;
    }

    updatePresenceAndHost();
  }

  async function leaveRoom({ silent } = {}) {
    if (roomChannel) {
      try {
        await roomChannel.unsubscribe();
      } catch {
        // ignore
      }
    }

    roomChannel = null;

    state.roomId = "";
    state.hostId = "";
    state.revealed = false;
    state.votes = {};
    state.selectedCard = null;
    state.presence = [];
    state.lastSnapshotAt = 0;

    clearUrlRoom();
    setViews(false);
    renderCards();

    if (!silent) {
      setStatus("");
      showJoinError("");
    }
  }

  function bootstrap() {
    renderCards();
    attachUiHandlers();

    // Restore last inputs
    const lastName = localStorage.getItem("pp:lastName") || "";
    const lastRoom = localStorage.getItem("pp:lastRoom") || "";

    if (lastName) el.nameInput.value = lastName;
    if (lastRoom) el.roomInput.value = lastRoom;

    // Auto-join if URL has room
    const roomFromUrl = normalizeRoomCode(getUrlParam("room"));
    if (roomFromUrl) {
      const name = safeName(el.nameInput.value);
      el.roomInput.value = roomFromUrl;
      joinRoom(roomFromUrl, name);
    }

    setViews(false);
    render();
  }

  bootstrap();
})();
