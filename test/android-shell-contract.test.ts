import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const activity = fs.readFileSync("android/app/src/main/java/com/diza/personalai/MainActivity.java", "utf8");
const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const settings = fs.readFileSync("src/components/AppSettingsPanel.tsx", "utf8");

test("Android shell starts against same-phone Termux and can switch to HostC", () => {
  assert.match(activity, /DEFAULT_SERVER = "http:\/\/127\.0\.0\.1:8788"/);
  assert.match(activity, /addJavascriptInterface\(new NativeBridge\(\), "DizaNative"\)/);
  assert.match(activity, /public void setServerUrl\(String raw\)/);
  assert.match(activity, /public String testServer\(String raw\)/);
  assert.match(settings, /native\?\.setServerUrl/);
  assert.match(settings, /native\?\.testServer/);
});

test("Android Back is delegated to the locked React Back contract", () => {
  assert.match(activity, /evaluateJavascript\("history\.back\(\)"/);
  assert.match(app, /Apakah Anda yakin ingin keluar\?/);
  assert.match(app, /native\?\.exitApp/);
});

test("Android file chooser supports the Foto Kamera Video File inputs", () => {
  assert.match(activity, /onShowFileChooser/);
  assert.match(activity, /ACTION_IMAGE_CAPTURE/);
  assert.match(activity, /ACTION_VIDEO_CAPTURE/);
  assert.match(activity, /ACTION_OPEN_DOCUMENT/);
});

test("Android networking is HTTPS-only except local Termux loopback", () => {
  assert.match(manifest, /networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(activity, /boolean localHttp = local && "http"\.equalsIgnoreCase\(scheme\)/);
});
