export function getUrlParam(win, name) {
  const url = new URL(win.location.href);
  return url.searchParams.get(name);
}

export function setUrlRoom(win, roomId) {
  const url = new URL(win.location.href);
  url.searchParams.set("room", roomId);
  win.history.replaceState({}, "", url.toString());
}

export function clearUrlRoom(win) {
  const url = new URL(win.location.href);
  url.searchParams.delete("room");
  win.history.replaceState({}, "", url.toString());
}

export function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function randomRoomCode(cryptoObj, length = 6) {
  // Crockford-ish base32 without I/L/O/U to avoid confusion
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function safeName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "Anonymous";
  return trimmed.slice(0, 32);
}
