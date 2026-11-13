let voice: SpeechSynthesisVoice | null = null;
let enabled = true;
let volume = 1;

function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang.startsWith('de') && /Anna|Helena|Google|Markus|Petra/i.test(v.name)) ?? vs.find((v) => v.lang.startsWith('de')) ?? null;
}
if (typeof speechSynthesis !== 'undefined') {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function configureSpeech(on: boolean, vol = 1) {
  enabled = on;
  volume = vol;
  if (!on) cancelSpeech();
}

/** iOS requires the first utterance to happen inside a user gesture. */
export function unlockSpeech() {
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function speak(text: string, force = false) {
  if ((!enabled && !force) || typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  if (voice) u.voice = voice;
  u.volume = volume;
  u.rate = 1.02;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function cancelSpeech() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
