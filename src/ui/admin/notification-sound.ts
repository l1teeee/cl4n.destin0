const PREFERENCE_STORAGE_KEY = "cl4n_admin_sound";
const NOTE_FREQUENCIES_HZ = [880, 1320];
const NOTE_DURATION_SECONDS = 0.12;
const NOTE_ATTACK_SECONDS = 0.02;
const PEAK_GAIN = 0.12;
const SILENT_GAIN = 0.0001;
const CHIME_COOLDOWN_MS = 3_000;

const preferenceListeners = new Set<() => void>();
let audioContext: AudioContext | null = null;
let lastChimeAt = Number.NEGATIVE_INFINITY;

function unlockAudio(): void {
  if (!audioContext) {
    if (typeof window.AudioContext === "undefined") return;
    audioContext = new window.AudioContext();
  }
  void audioContext.resume();
}

// WHY: browsers block audio until a user gesture, so the context is created on the first one.
export function installAudioUnlock(): () => void {
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  return () => {
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  };
}

function playNote(context: AudioContext, frequencyHz: number, startTime: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const endTime = startTime + NOTE_DURATION_SECONDS;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequencyHz, startTime);
  gain.gain.setValueAtTime(SILENT_GAIN, startTime);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, startTime + NOTE_ATTACK_SECONDS);
  gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, endTime);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

export function playNotificationChime(): void {
  if (!audioContext || audioContext.state !== "running") return;

  // WHY: the unread poll and the open conversation can both notice the same new message.
  const now = Date.now();
  if (now - lastChimeAt < CHIME_COOLDOWN_MS) return;
  lastChimeAt = now;

  const firstNoteStart = audioContext.currentTime;
  NOTE_FREQUENCIES_HZ.forEach((frequencyHz, index) => {
    playNote(
      audioContext as AudioContext,
      frequencyHz,
      firstNoteStart + index * NOTE_DURATION_SECONDS,
    );
  });
}

export function isNotificationSoundEnabled(): boolean {
  return window.localStorage.getItem(PREFERENCE_STORAGE_KEY) !== "off";
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  window.localStorage.setItem(PREFERENCE_STORAGE_KEY, enabled ? "on" : "off");
  preferenceListeners.forEach((listener) => listener());
}

export function subscribeToNotificationSoundPreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
