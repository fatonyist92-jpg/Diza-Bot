import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const voice = fs.readFileSync("src/components/Voice.tsx", "utf8");
const composer = fs.readFileSync("src/components/Composer.tsx", "utf8");
const settings = fs.readFileSync("src/components/AppSettingsPanel.tsx", "utf8");

test("calls use local playback and expose mute, end and barge-in", () => {
  assert.match(voice, /playSystemSpeech/);
  assert.match(voice, /Mute microphone/);
  assert.match(voice, /End call/);
  assert.match(voice, /callState === "speaking" \|\| callState === "thinking"/);
  assert.match(voice, /type: "interrupt"/);
  assert.doesNotMatch(voice, /\/api\/bots\/\$\{botId\}\/speak/);
});

test("composer has a browser/PWA speech-recognition path", () => {
  assert.match(composer, /browserRecognitionAvailable\(\)/);
  assert.match(composer, /startFreeRecognition/);
  assert.doesNotMatch(composer, /Voice input needs the desktop app/);
});

test("voice settings do not invite paid speech keys", () => {
  const voicePanel = settings.slice(settings.indexOf('{tab === "voices"'));
  assert.match(voicePanel, /mode GRATIS SAJA/);
  assert.doesNotMatch(voicePanel, /OpenAI API key \(speech\)/);
  assert.doesNotMatch(voicePanel, /ElevenLabs API key/);
});
