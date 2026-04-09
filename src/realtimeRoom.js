import { safeName } from "./utils.js";

export class RealtimeRoom {
  constructor({ supabaseClient, roomId, presenceKey }) {
    this.supabaseClient = supabaseClient;
    this.roomId = roomId;
    this.presenceKey = presenceKey;
    this.channel = null;
  }

  connect() {
    this.channel = this.supabaseClient.channel(`room:${this.roomId}`, {
      config: {
        presence: { key: this.presenceKey },
        broadcast: { self: true },
      },
    });
    return this.channel;
  }

  onPresenceChanged(callback) {
    // Only "sync" — it fires after every join/leave with the reconciled
    // presence state.  Listening to join+leave as well causes the callback
    // to fire 2-3× per event, creating render storms and broadcast floods.
    this.channel.on("presence", { event: "sync" }, callback);
  }

  onBroadcast(event, callback) {
    this.channel.on("broadcast", { event }, ({ payload }) => callback(payload));
  }

  async send(event, payload) {
    if (!this.channel) return;
    await this.channel.send({ type: "broadcast", event, payload });
  }

  presenceState() {
    if (!this.channel) return {};
    return this.channel.presenceState();
  }

  getPresenceList() {
    const raw = this.presenceState();

    const list = [];
    for (const [id, metas] of Object.entries(raw)) {
      const meta = Array.isArray(metas) ? metas[metas.length - 1] : metas;
      list.push({
        id,
        name: safeName(meta?.name || "Anonymous"),
        joinedAt: Number(meta?.joinedAt || 0),
      });
    }

    return list;
  }

  async subscribe(onStatus) {
    if (!this.channel) throw new Error("Channel not connected.");
    return await this.channel.subscribe(onStatus);
  }

  async track(payload) {
    if (!this.channel) return;
    await this.channel.track(payload);
  }

  async unsubscribe() {
    if (!this.channel) return;
    try {
      await this.channel.unsubscribe();
    } catch {
      // ignore
    }
    this.channel = null;
  }
}
