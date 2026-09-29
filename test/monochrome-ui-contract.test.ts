import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/styles.css", "utf8");
const brand = fs.readFileSync("src/components/Brand.tsx", "utf8");
const icon = fs.readFileSync("public/app-icon.svg", "utf8");

test("semantic UI palette is monochrome", () => {
  for (const color of ["#5b6cff","#4a59e6","#7c8aff","#ff6369","#3dd68c","#f5a524","#c0272d","#1f7048","#8f5a09"]) {
    assert.equal(css.includes(color), false, `legacy chromatic token remains: ${color}`);
  }
  assert.match(css, /--brand: #18181b/);
  assert.match(css, /\.dark[\s\S]*--brand: #ededf0/);
});

test("primary brand surfaces are DIZA monochrome", () => {
  assert.match(brand, />\s*DIZA BOT\s*</);
  assert.match(brand, /fill=\{fill \?\? "currentColor"\}/);
  assert.match(icon, /DIZA BOT/);
  assert.doesNotMatch(icon, /#004aad|#ff751f|#cb6ce6|#ff3131|#5ce1e6|#7ed957|#ffbd59/i);
});

test("mobile safe area is present without changing component navigation", () => {
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /100dvh/);
});

test("visible source has no chromatic hard-coded hex palette", () => {
  const files = [
    "src/components/Brand.tsx",
    "src/components/Intro.tsx",
    "src/components/Terminal.tsx",
    "src/components/McpApps.tsx",
    "src/components/ProviderIcons.tsx",
    "src/lib/mascot.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/#[0-9a-fA-F]{6}/g)) {
      const hex = match[0].slice(1);
      const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 12, `${file} contains chromatic UI color ${match[0]}`);
    }
  }
});
