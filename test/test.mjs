// Plain Node tests for the card logic (no Home Assistant needed): node test/test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";
import { mockHass, NOW } from "./mock-hass.mjs";

const src = readFileSync(fileURLToPath(new URL("../home-watchdog-card.js", import.meta.url)), "utf8");
const defined = {};
const ctx = {
  window: {},
  console: { info() {} },
  HTMLElement: class {},
  CustomEvent: class {},
  customElements: { get: (n) => defined[n], define: (n, c) => { defined[n] = c; } },
  Date,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const raw = ctx.window.__homeWatchdogCompute;
const compute = (...a) => JSON.parse(JSON.stringify(raw(...a))); // plain arrays, not sandbox ones
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("PASS", name); };

const hass = mockHass();

t("registers the card", () => {
  assert.ok(defined["home-watchdog-card"]);
  assert.equal(ctx.window.customCards[0].type, "home-watchdog-card");
});

t("offline devices: grouped per device, oldest first, skips short blips", () => {
  const w = compute(hass, {}, NOW);
  assert.deepEqual(w.offline.map((r) => r.name), ["Garage door sensor", "Hallway motion"]);
  assert.match(w.offline[0].detail, /offline 3 days/);
  // the plug dropped 4 minutes ago: below the 10 minute default
  assert.ok(!w.offline.some((r) => r.name === "Kettle plug"));
  // a device with only its diagnostic entity down is not offline
  assert.ok(!w.offline.some((r) => r.name === "Lounge lamp"));
});

t("low batteries: numeric below threshold, lowest first, binary low included", () => {
  const w = compute(hass, {}, NOW);
  assert.deepEqual(w.low.map((r) => r.name), ["Back door lock", "Bedroom remote", "Front door contact"]);
  assert.equal(w.low[1].detail, "8%");
  assert.equal(w.low[0].detail, "battery low");
});

t("not reporting: battery unavailable while device is online; offline device batteries not repeated", () => {
  const w = compute(hass, {}, NOW);
  assert.deepEqual(w.silent.map((r) => r.name), ["Study temperature"]);
});

t("threshold option changes the low list", () => {
  const w = compute(hass, { battery_threshold: 10 }, NOW);
  assert.deepEqual(w.low.map((r) => r.name), ["Back door lock", "Bedroom remote"]);
});

t("exclude by device name, entity id wildcard and platform", () => {
  const w = compute(hass, { exclude: ["Garage door sensor", "sensor.study_*", "platform:mobile_app"] }, NOW);
  assert.ok(!w.offline.some((r) => r.name === "Garage door sensor"));
  assert.equal(w.silent.length, 0);
  assert.ok(!w.low.some((r) => r.name === "Paul's phone"));
});

t("phone battery from mobile_app counts unless excluded", () => {
  const w = compute(hass, { battery_threshold: 50 }, NOW);
  assert.ok(w.low.some((r) => r.name === "Paul's phone"));
});

t("show_offline / show_batteries switch sections off", () => {
  const w = compute(hass, { show_offline: false, show_batteries: false }, NOW);
  assert.equal(w.offline.length + w.low.length + w.silent.length, 0);
});

t("hidden entities are ignored", () => {
  const h = mockHass();
  h.entities["sensor.bedroom_remote_battery"].hidden = true;
  const w = compute(h, {}, NOW);
  assert.ok(!w.low.some((r) => r.name === "Bedroom remote"));
});

t("names are not trusted as HTML (escaped at render)", () => {
  assert.ok(src.includes("esc(r.name)") && src.includes("esc(r.detail)"));
});

t("all clear when nothing is wrong", () => {
  const h = mockHass({ healthy: true });
  const w = compute(h, {}, NOW);
  assert.equal(w.offline.length + w.low.length + w.silent.length, 0);
  assert.ok(w.batteryCount > 0 && w.deviceCount > 0);
});

console.log(`${n} tests passed`);
