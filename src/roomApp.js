import {
  clearUrlRoom,
  getUrlParam,
  normalizeRoomCode,
  randomRoomCode,
  safeName,
  setUrlRoom,
} from "./utils.js";

import {
  getOrCreateUserId,
  getOrCreateJoinedAt,
  loadLastHost,
  loadLastInputs,
  persistLastInputs,
} from "./storage.js";

import { createElements, Ui } from "./ui.js";
import { HostController } from "./hostController.js";
import { RealtimeRoom } from "./realtimeRoom.js";
import {
  applyLocalVote,
  applyReset,
  applyReveal,
  applySnapshot,
  createInitialState,
  enterRoom,
  leaveRoomState,
  pruneVotesToPresence,
  setPresence,
  setSelectedCard,
} from "./roomState.js";

export class RoomApp {
  constructor(win, doc) {
    this.win = win;
    this.doc = doc;

    this.HOST_GRACE_MS = 15_000;

    this.FIB_CARDS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, "?"];

    this.el = createElements(doc);
    this.ui = new Ui(win, doc, this.el);

    this.state = createInitialState({ userId: getOrCreateUserId(win) });

    this._lastRevealed = false;
    this._deucesEggShown = false;
    this._deucesEggPending = false;

    this.supabaseClient = null;
    this.realtime = null;
    this.host = new HostController(win, this.state);

    this.attachUiHandlers = this.attachUiHandlers.bind(this);
    this.onPickCard = this.onPickCard.bind(this);
    this.onReveal = this.onReveal.bind(this);
    this.onReset = this.onReset.bind(this);
  }

  getPresentVoteMatchInfo(value) {
    const present = this.state.presence || [];
    const presentIds = new Set(present.map(p => p.id));

    let count = 0;
    let mismatch = false;
    for (const [userId, v] of Object.entries(this.state.votes || {})) {
      if (!presentIds.has(userId)) continue;
      count += 1;
      if (!(v === value || String(v) === String(value))) {
        mismatch = true;
        break;
      }
    }

    return {
      count,
      mismatch,
      allMatch: count > 0 && !mismatch,
    };
  }

  requireSupabaseConfig() {
    if (!this.win.SUPABASE_URL || !this.win.SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase config. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
    }
    if (!this.win.supabase || !this.win.supabase.createClient) {
      throw new Error("Supabase client not loaded. Check the supabase-js script tag.");
    }
  }


  renderCards() {
    this.ui.renderCards(this.FIB_CARDS, this.onPickCard);
  }

  render() {
    const wasRevealed = this._lastRevealed;
    this.ui.render(this.state, { canControlRound: () => this.host.canControlRound() });

    if (!wasRevealed && this.state.revealed && !this._deucesEggShown) {
      this._deucesEggPending = true;
    }

    if (!this.state.revealed) {
      this._deucesEggPending = false;
    }

    if (this._deucesEggPending && this.state.revealed && !this._deucesEggShown) {
      // Snapshots can land after the reveal broadcast.
      // Trigger if everyone who voted (among present players) voted 2.
      const info = this.getPresentVoteMatchInfo(2);
      if (info.allMatch) {
        this.ui.showDeucesEgg();
        this._deucesEggShown = true;
        this._deucesEggPending = false;
      } else if (info.mismatch && info.count > 0) {
        // Someone voted something else; don't keep waiting.
        this._deucesEggPending = false;
      }
    }

    this._lastRevealed = !!this.state.revealed;
  }

  updatePresenceAndHost() {
    if (!this.realtime) return;
    setPresence(this.state, this.realtime.getPresenceList());

    this.host.ensureHostSelected();

    pruneVotesToPresence(this.state);

    this.render();
  }

  async broadcast(event, payload) {
    if (!this.realtime) return;
    await this.realtime.send(event, payload);
  }

  async broadcastSnapshot({ toId }) {
    if (!this.host.isHost() && this.host.isHostPresent()) return;

    const snapshot = {
      roomId: this.state.roomId,
      revealed: this.state.revealed,
      votes: this.state.votes,
      hostId: this.state.hostId,
      fromId: this.state.me.id,
      toId: toId || null,
      ts: Date.now(),
    };

    await this.broadcast("state_snapshot", snapshot);
  }

  async requestSnapshot() {
    await this.broadcast("state_request", {
      roomId: this.state.roomId,
      requesterId: this.state.me.id,
      ts: Date.now(),
    });
  }

  applySnapshot(payload) {
    if (payload.toId && payload.toId !== this.state.me.id) return;

    const wasRevealed = !!this.state.revealed;

    if (!applySnapshot(this.state, payload)) return;

    // If a snapshot transitions us back to hidden, allow the easter egg again on the next reveal.
    if (wasRevealed && !this.state.revealed) {
      this._deucesEggShown = false;
      this._deucesEggPending = false;
      this._lastRevealed = false;
    }

    // Sync designated hostId via snapshots, but avoid overriding an active present host.
    // If snapshot hostId is NOT currently present, treat it as the designated (possibly-missing) host.
    this.host.applyHostFromSnapshot(payload);

    this.render();
  }

  async onPickCard(value) {
    if (!this.state.roomId || !this.realtime) return;
    if (this.state.revealed) return;

    setSelectedCard(this.state, value);
    applyLocalVote(this.state, { userId: this.state.me.id, value });
    this.render();

    await this.broadcast("vote", {
      roomId: this.state.roomId,
      userId: this.state.me.id,
      name: this.state.me.name,
      value,
      ts: Date.now(),
    });

    if (this.host.isHost()) {
      await this.broadcastSnapshot({ toId: null });
    }
  }

  async onReveal() {
    if (!this.host.canControlRound()) return;
    if (this.state.revealed) return;

    applyReveal(this.state);
    this.render();

    await this.broadcast("reveal", {
      roomId: this.state.roomId,
      by: this.state.me.id,
      ts: Date.now(),
    });

    await this.broadcastSnapshot({ toId: null });
  }

  async onReset() {
    if (!this.host.canControlRound()) return;

    applyReset(this.state);
    this._deucesEggShown = false;
    this._deucesEggPending = false;
    this._lastRevealed = false;
    this.render();

    await this.broadcast("reset", {
      roomId: this.state.roomId,
      by: this.state.me.id,
      ts: Date.now(),
    });

    await this.broadcastSnapshot({ toId: null });
  }

  attachUiHandlers() {
    this.el.createRoomBtn.addEventListener("click", async () => {
      this.ui.showJoinError("");
      const name = this.ui.requireNameInput();
      if (!name) return;
      const roomId = randomRoomCode(this.win.crypto, 6);
      await this.joinRoom(roomId, name);
    });

    this.el.joinRoomBtn.addEventListener("click", async () => {
      this.ui.showJoinError("");
      const name = this.ui.requireNameInput();
      if (!name) return;
      const roomId = normalizeRoomCode(this.el.roomInput.value);
      if (!roomId) {
        this.ui.showJoinError("Enter a room code (or create a new room). ");
        return;
      }
      await this.joinRoom(roomId, name);
    });

    this.el.copyLinkBtn.addEventListener("click", async () => {
      const url = new URL(this.win.location.href);
      url.searchParams.set("room", this.state.roomId);
      await this.win.navigator.clipboard.writeText(url.toString());
      this.ui.setStatus("Link copied to clipboard.");
      setTimeout(() => this.render(), 1000);
    });

    this.el.leaveBtn.addEventListener("click", async () => {
      await this.leaveRoom();
    });

    this.el.revealBtn.addEventListener("click", this.onReveal);
    this.el.resetBtn.addEventListener("click", this.onReset);

    this.el.roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.el.joinRoomBtn.click();
    });

    this.el.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.el.joinRoomBtn.click();
    });
  }

  async joinRoom(roomId, name) {
    roomId = normalizeRoomCode(roomId);
    name = safeName(name);

    if (name === "Anonymous") {
      this.ui.showJoinError("Enter your name to join the room.");
      try {
        this.el.nameInput.focus();
      } catch {
        // ignore
      }
      return;
    }

    try {
      this.requireSupabaseConfig();
    } catch (err) {
      this.ui.showJoinError(String(err.message || err));
      return;
    }

    if (!roomId) {
      this.ui.showJoinError("Missing room id.");
      return;
    }

    persistLastInputs(this.win, { name, roomId });

    if (!this.supabaseClient) {
      this.supabaseClient = this.win.supabase.createClient(this.win.SUPABASE_URL, this.win.SUPABASE_ANON_KEY);
    }

    await this.leaveRoom({ silent: true });

    enterRoom(this.state, {
      roomId,
      name,
      hostId: loadLastHost(this.win, roomId),
    });

    setUrlRoom(this.win, roomId);
    this.ui.setViews(true);
    this.render();

    this.realtime = new RealtimeRoom({
      supabaseClient: this.supabaseClient,
      roomId,
      presenceKey: this.state.me.id,
    });
    this.realtime.connect();
    this.realtime.onPresenceChanged(() => this.updatePresenceAndHost());

    this.realtime.onBroadcast("vote", (payload) => {
      if (!payload || payload.roomId !== this.state.roomId) return;
      if (this.state.revealed) return;
      const userId = String(payload.userId || "");
      const raw = payload.value;
      let value;
      if (raw === "?") {
        value = "?";
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        value = n;
      }
      if (!userId) return;
      applyLocalVote(this.state, { userId, value });
      this.render();
    });

    this.realtime.onBroadcast("reveal", (payload) => {
      if (!payload || payload.roomId !== this.state.roomId) return;
      if (this.host.isHostPresent() && String(payload.by || "") !== this.state.hostId) return;
      applyReveal(this.state);
      this.render();
    });

    this.realtime.onBroadcast("reset", (payload) => {
      if (!payload || payload.roomId !== this.state.roomId) return;
      if (this.host.isHostPresent() && String(payload.by || "") !== this.state.hostId) return;
      applyReset(this.state);
      this._deucesEggShown = false;
      this._deucesEggPending = false;
      this._lastRevealed = false;
      this.render();
    });

    this.realtime.onBroadcast("state_request", async (payload) => {
      if (!payload || payload.roomId !== this.state.roomId) return;
      if (!this.host.isHost() && this.host.isHostPresent()) return;
      const requesterId = String(payload.requesterId || "");
      if (!requesterId) return;
      await this.broadcastSnapshot({ toId: requesterId });
    });

    this.realtime.onBroadcast("state_snapshot", (payload) => {
      if (!payload || payload.roomId !== this.state.roomId) return;
      this.applySnapshot(payload);
    });

    const { error } = await this.realtime.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        this.ui.setStatus("Connected.");

        const joinedAt = getOrCreateJoinedAt(this.win, this.state.roomId, this.state.me.id);
        await this.realtime.track({
          name: this.state.me.name,
          joinedAt,
        });

        await this.requestSnapshot();
      }
    });

    if (error) {
      this.ui.showJoinError(`Failed to join room: ${error.message}`);
      await this.leaveRoom({ silent: true });
      this.ui.setViews(false);
      return;
    }

    this.updatePresenceAndHost();
  }

  async leaveRoom({ silent } = {}) {
    if (this.realtime) {
      await this.realtime.unsubscribe();
    }
    this.realtime = null;

    leaveRoomState(this.state);

    clearUrlRoom(this.win);
    this.ui.setViews(false);
    this.renderCards();

    if (!silent) {
      this.ui.setStatus("");
      this.ui.showJoinError("");
    }
  }

  bootstrap() {
    this.renderCards();
    this.attachUiHandlers();

    const { lastName, lastRoom } = loadLastInputs(this.win);

    if (lastName) this.el.nameInput.value = lastName;
    if (lastRoom) this.el.roomInput.value = lastRoom;

    this.ui.setViews(false);

    const roomFromUrl = normalizeRoomCode(getUrlParam(this.win, "room"));
    if (roomFromUrl) {
      this.el.roomInput.value = roomFromUrl;

      if (!String(this.el.nameInput.value || "").trim() || safeName(this.el.nameInput.value) === "Anonymous") {
        this.el.nameInput.value = "";
      }

      requestAnimationFrame(() => {
        try {
          this.el.nameInput.focus();
          this.el.nameInput.select();
        } catch {
          // ignore
        }
      });
    }

    this.render();
  }
}
