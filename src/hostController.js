import { persistLastHost } from "./storage.js";

export class HostController {
  constructor(win, state) {
    this.win = win;
    this.state = state;
  }

  isHost() {
    return this.state.hostId && this.state.me.id === this.state.hostId;
  }

  isHostPresent() {
    if (!this.state.hostId) return false;
    return this.state.presence.some(p => p.id === this.state.hostId);
  }

  canControlRound() {
    return this.isHost() || !this.isHostPresent();
  }

  computeHostIdFromPresence(presence) {
    const sorted = [...presence].sort((a, b) => {
      const aj = Number(a.joinedAt || 0);
      const bj = Number(b.joinedAt || 0);
      if (aj !== bj) return aj - bj;
      return String(a.id).localeCompare(String(b.id));
    });
    return sorted[0]?.id || "";
  }

  ensureHostSelected() {
    if (this.state.hostId) return;
    const elected = this.computeHostIdFromPresence(this.state.presence);
    if (!elected) return;
    this.state.hostId = elected;
    this.state.hostMissingSince = 0;
    persistLastHost(this.win, this.state.roomId, this.state.hostId);
  }

  applyHostFromSnapshot(payload) {
    const snapHostId = String(payload.hostId || "");
    if (!snapHostId) return false;

    const snapHostPresent = this.state.presence.some(p => p.id === snapHostId);
    const fromId = String(payload.fromId || "");

    // If the host itself is broadcasting this snapshot, treat that as authoritative.
    if (fromId && fromId === snapHostId) {
      this.state.hostId = snapHostId;
      persistLastHost(this.win, this.state.roomId, this.state.hostId);
      return true;
    }

    if (!this.state.hostId) {
      this.state.hostId = snapHostId;
      persistLastHost(this.win, this.state.roomId, this.state.hostId);
      return true;
    }

    // If snapshot host isn't present, treat it as designated (possibly missing) host.
    if (!snapHostPresent) {
      this.state.hostId = snapHostId;
      persistLastHost(this.win, this.state.roomId, this.state.hostId);
      return true;
    }

    return false;
  }
}
