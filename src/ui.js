import { safeName } from "./utils.js";

export function createElements(doc) {
  return {
    joinView: doc.getElementById("joinView"),
    roomView: doc.getElementById("roomView"),
    nameInput: doc.getElementById("nameInput"),
    roomInput: doc.getElementById("roomInput"),
    createRoomBtn: doc.getElementById("createRoomBtn"),
    joinRoomBtn: doc.getElementById("joinRoomBtn"),
    joinError: doc.getElementById("joinError"),

    roomCode: doc.getElementById("roomCode"),
    meLabel: doc.getElementById("meLabel"),
    hostLabel: doc.getElementById("hostLabel"),
    copyLinkBtn: doc.getElementById("copyLinkBtn"),
    leaveBtn: doc.getElementById("leaveBtn"),

    playersList: doc.getElementById("playersList"),
    cards: doc.getElementById("cards"),

    revealBtn: doc.getElementById("revealBtn"),
    resetBtn: doc.getElementById("resetBtn"),
    status: doc.getElementById("status"),
  };
}

export class Ui {
  constructor(win, doc, el) {
    this.win = win;
    this.doc = doc;
    this.el = el;

    this._deucesEggTimer = null;
  }

  setStatus(message) {
    this.el.status.textContent = message || "";
  }

  showJoinError(message) {
    this.el.joinError.hidden = !message;
    this.el.joinError.textContent = message || "";
  }

  setViews(inRoom) {
    this.el.joinView.hidden = !!inRoom;
    this.el.roomView.hidden = !inRoom;
  }

  requireNameInput() {
    const raw = String(this.el.nameInput.value || "").trim();
    if (!raw) {
      this.showJoinError("Enter your name to join the room.");
      try {
        this.el.nameInput.focus();
      } catch {
        // ignore
      }
      return null;
    }
    return safeName(raw);
  }

  renderCards(deckValues, onPickCard) {
    this.el.cards.innerHTML = "";
    for (const value of deckValues) {
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.className = "cardbtn";
      btn.textContent = String(value);
      btn.dataset.value = String(value);
      btn.addEventListener("click", () => onPickCard(value));
      this.el.cards.appendChild(btn);
    }
  }

  render(state, { canControlRound }) {
    this.doc.title = this.win.APP_TITLE || "Planning Poker";

    this.el.roomCode.textContent = state.roomId;
    this.el.meLabel.textContent = `You: ${state.me.name}`;

    const hostName = state.presence.find(p => p.id === state.hostId)?.name || "";
    this.el.hostLabel.textContent = state.hostId
      ? (hostName ? `Host: ${hostName}` : "Host selected")
      : "Host: (none)";

    this.el.revealBtn.disabled = !canControlRound() || state.revealed;
    this.el.resetBtn.disabled = !canControlRound();

    const cardButtons = this.el.cards.querySelectorAll(".cardbtn");
    cardButtons.forEach(btn => {
      const v = String(btn.dataset.value);
      btn.classList.toggle("selected", state.selectedCard != null && String(state.selectedCard) === v);
      btn.disabled = state.revealed;
    });

    this.el.playersList.innerHTML = "";
    const players = [...state.presence].sort((a, b) => a.name.localeCompare(b.name));

    for (const p of players) {
      const li = this.doc.createElement("li");
      li.className = "player";

      const left = this.doc.createElement("div");
      left.className = "left";

      const name = this.doc.createElement("div");
      name.className = "name";

      const nameText = this.doc.createElement("span");
      nameText.className = "name-text";
      nameText.textContent = p.name + (p.id === state.me.id ? " (you)" : "");
      name.appendChild(nameText);

      if (p.id === state.hostId) {
        const hostInline = this.doc.createElement("span");
        hostInline.className = "badge host host-inline";
        hostInline.textContent = "Host";
        name.appendChild(hostInline);
      }

      const meta = this.doc.createElement("div");
      meta.className = "muted small";

      const hasVote = Object.prototype.hasOwnProperty.call(state.votes, p.id);
      if (!state.revealed) {
        meta.textContent = hasVote ? "Voted" : "Waiting";
      } else {
        meta.textContent = hasVote ? "Revealed" : "No vote";
      }

      left.appendChild(name);
      left.appendChild(meta);

      const right = this.doc.createElement("div");
      right.className = "right";
      const badges = [];

      if (state.revealed && hasVote) {
        const voteCard = this.doc.createElement("span");
        voteCard.className = "vote-card-mini";
        voteCard.textContent = String(state.votes[p.id]);
        badges.push(voteCard);
      }

      if (!state.revealed && Object.prototype.hasOwnProperty.call(state.votes, p.id)) {
        const voted = this.doc.createElement("span");
        voted.className = "badge ok";
        voted.textContent = "✓";
        badges.push(voted);
      }

      for (const b of badges) right.appendChild(b);

      li.appendChild(left);
      li.appendChild(right);
      this.el.playersList.appendChild(li);
    }

    const total = state.presence.length;
    const voted = Object.keys(state.votes).filter(id => state.presence.some(p => p.id === id)).length;
    this.setStatus(state.revealed ? `Revealed • ${total} players` : `Waiting • ${voted}/${total} voted`);
  }

  showDeucesEgg() {
    const existing = this.doc.getElementById("deucesEggOverlay");
    if (existing) return;

    const overlay = this.doc.createElement("div");
    overlay.id = "deucesEggOverlay";
    overlay.className = "deuces-egg-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Deuces" );

    const img = this.doc.createElement("img");
    img.className = "deuces-egg-img";
    img.src = "deuces.png";
    img.alt = "Deuces";
    overlay.appendChild(img);

    const cleanup = () => {
      if (this._deucesEggTimer) {
        this.win.clearTimeout(this._deucesEggTimer);
        this._deucesEggTimer = null;
      }
      try {
        overlay.remove();
      } catch {
        // ignore
      }
    };

    overlay.addEventListener("click", cleanup);
    this.doc.body.appendChild(overlay);

    this._deucesEggTimer = this.win.setTimeout(cleanup, 2500);
  }
}
