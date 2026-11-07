/*
 * Home Watchdog Card for Home Assistant
 * Shows what needs attention right now: devices that went offline, batteries running low,
 * and batteries that stopped reporting. Finds everything on its own; nothing to list by hand.
 *
 * https://github.com/paultuddenham/home-watchdog-card  (MIT licence)
 */
const VERSION = "1.0.0";

const DEFAULTS = {
  title: "Needs attention",
  battery_threshold: 30,
  min_offline_minutes: 10,
  show_offline: true,
  show_batteries: true,
  max_items: 8,
  exclude: [],
};

const BAD = new Set(["unavailable", "unknown"]);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function ago(iso, now) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

function patternMatcher(list) {
  const rules = (Array.isArray(list) ? list : [list])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => {
      const s = p.trim().toLowerCase();
      if (s.includes("*")) {
        const rx = new RegExp("^" + s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        return (v) => rx.test(v);
      }
      return (v) => v === s;
    });
  return (...values) => values.some((v) => v && rules.some((r) => r(String(v).toLowerCase())));
}

/* Pure function: everything the card shows, worked out from the hass object. Exported for tests. */
function computeWatch(hass, cfg, now = Date.now()) {
  const c = { ...DEFAULTS, ...cfg };
  const excluded = patternMatcher(c.exclude || []);
  const states = hass.states || {};
  const reg = hass.entities || {};
  const devices = hass.devices || {};
  const areas = hass.areas || {};

  const deviceName = (id) => {
    const d = devices[id];
    return d ? d.name_by_user || d.name || id : id;
  };
  const areaOf = (eid, devId) => {
    const e = reg[eid];
    const aid = (e && e.area_id) || (devices[devId] && devices[devId].area_id);
    return aid && areas[aid] ? areas[aid].name : "";
  };
  const friendly = (eid) => {
    const s = states[eid];
    return (s && s.attributes && s.attributes.friendly_name) || eid;
  };
  const skip = (eid) => {
    const e = reg[eid];
    if (e && e.hidden) return true;
    const dev = e && e.device_id;
    return excluded(eid, friendly(eid), dev && deviceName(dev), e && e.platform && `platform:${e.platform}`);
  };

  // 1. Offline devices: every main entity of the device is unavailable.
  const byDevice = {};
  for (const eid of Object.keys(states)) {
    const e = reg[eid];
    if (!e || !e.device_id) continue;
    (byDevice[e.device_id] = byDevice[e.device_id] || []).push(eid);
  }
  const offline = [];
  const offlineDevices = new Set();
  for (const [dev, eids] of Object.entries(byDevice)) {
    const main = eids.filter((eid) => !reg[eid].entity_category);
    const watch = main.length ? main : eids;
    if (!watch.every((eid) => states[eid].state === "unavailable")) continue;
    if (watch.every((eid) => skip(eid))) continue;
    // offline since the most recent change: the moment the last entity dropped
    const since = watch.map((eid) => states[eid].last_changed).filter(Boolean).sort().pop();
    const mins = since ? (now - Date.parse(since)) / 60000 : Infinity;
    if (mins < c.min_offline_minutes) continue;
    offlineDevices.add(dev);
    offline.push({
      name: deviceName(dev), area: areaOf(watch[0], dev), entity: watch[0],
      detail: since ? `offline ${ago(since, now)}` : "offline", sort: since || "",
    });
  }
  offline.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.name.localeCompare(b.name)));

  // 2. Batteries.
  const low = [];
  const silent = [];
  let batteryCount = 0;
  for (const [eid, s] of Object.entries(states)) {
    const dc = s.attributes && s.attributes.device_class;
    if (dc !== "battery") continue;
    const domain = eid.split(".")[0];
    if (domain !== "sensor" && domain !== "binary_sensor") continue;
    if (skip(eid)) continue;
    batteryCount++;
    const e = reg[eid];
    const dev = e && e.device_id;
    const name = dev ? deviceName(dev) : friendly(eid);
    const area = areaOf(eid, dev);
    if (BAD.has(s.state)) {
      if (dev && offlineDevices.has(dev)) continue; // already listed as offline
      silent.push({ name, area, entity: eid, detail: `no data ${ago(s.last_changed, now)}`, sort: s.last_changed || "" });
    } else if (domain === "binary_sensor") {
      if (s.state === "on") low.push({ name, area, entity: eid, level: null, detail: "battery low", sort: -1 });
    } else {
      const v = parseFloat(s.state);
      if (!isNaN(v) && v < c.battery_threshold) {
        low.push({ name, area, entity: eid, level: Math.round(v), detail: `${Math.round(v)}%`, sort: v });
      }
    }
  }
  low.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  silent.sort((a, b) => (a.sort < b.sort ? -1 : 1));

  return {
    offline: c.show_offline ? offline : [],
    low: c.show_batteries ? low : [],
    silent: c.show_batteries ? silent : [],
    deviceCount: Object.keys(byDevice).length,
    batteryCount,
  };
}

class HomeWatchdogCard extends HTMLElement {
  static getStubConfig() {
    return { title: DEFAULTS.title, battery_threshold: DEFAULTS.battery_threshold };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "battery_threshold", selector: { number: { min: 5, max: 95, step: 5, mode: "slider", unit_of_measurement: "%" } } },
        { name: "min_offline_minutes", selector: { number: { min: 0, max: 1440, step: 5, mode: "box", unit_of_measurement: "min" } } },
        { name: "max_items", selector: { number: { min: 1, max: 50, step: 1, mode: "box" } } },
        { name: "show_offline", selector: { boolean: {} } },
        { name: "show_batteries", selector: { boolean: {} } },
        { name: "exclude", selector: { text: { multiple: true } } },
      ],
      computeLabel: (s) => ({
        title: "Title",
        battery_threshold: "Low battery below",
        min_offline_minutes: "Count a device as offline after (minutes)",
        max_items: "Most rows per list",
        show_offline: "Show offline devices",
        show_batteries: "Show batteries",
        exclude: "Ignore (entity id, device name, platform:<name>; * works as a wildcard)",
      }[s.name]),
    };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const t = Number(config.battery_threshold ?? DEFAULTS.battery_threshold);
    if (isNaN(t) || t < 0 || t > 100) throw new Error("battery_threshold must be a number from 0 to 100");
    this._config = { ...DEFAULTS, ...config, battery_threshold: t };
    this._last = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  _section(label, icon, cls, rows) {
    if (!rows.length) return "";
    const max = Math.max(1, Number(this._config.max_items) || DEFAULTS.max_items);
    const shown = rows.slice(0, max);
    const more = rows.length - shown.length;
    return `
      <div class="section">
        <div class="label"><ha-icon icon="${icon}"></ha-icon>${esc(label)} <span class="count">${rows.length}</span></div>
        ${shown.map((r) => `
          <div class="row" data-entity="${esc(r.entity)}" tabindex="0" role="button">
            <span class="dot ${cls}"></span>
            <span class="name">${esc(r.name)}${r.area ? `<span class="area">${esc(r.area)}</span>` : ""}</span>
            <span class="detail ${cls}">${esc(r.detail)}</span>
          </div>`).join("")}
        ${more > 0 ? `<div class="more">and ${more} more</div>` : ""}
      </div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const w = computeWatch(this._hass, this._config);
    const c = this._config;
    const body = [
      this._section("Offline", "mdi:lan-disconnect", "bad", w.offline),
      this._section(`Battery below ${c.battery_threshold}%`, "mdi:battery-alert-variant-outline", "warn", w.low),
      this._section("Battery not reporting", "mdi:battery-unknown", "bad", w.silent),
    ].join("");
    const parts = [];
    if (c.show_offline) parts.push(`${w.deviceCount} devices online`);
    if (c.show_batteries) parts.push(`${w.batteryCount} batteries above ${c.battery_threshold}%`);
    const clear = `<div class="clear"><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>All good: ${esc(parts.join(", ") || "nothing to watch")}.</span></div>`;
    const html = `
      <ha-card>
        ${c.title ? `<h1 class="card-header">${esc(c.title)}</h1>` : ""}
        <div class="content">${body || clear}</div>
      </ha-card>`;
    if (html === this._last) return;
    this._last = html;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => this._open(ev));
      this.shadowRoot.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") this._open(ev);
      });
    }
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${html}`;
  }

  _open(ev) {
    const row = ev.composedPath().find((n) => n.classList && n.classList.contains("row"));
    if (!row) return;
    ev.preventDefault();
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: row.dataset.entity }, bubbles: true, composed: true,
    }));
  }
}

const STYLE = `
  .card-header { margin: 0; padding: 16px 16px 0; font-size: var(--ha-card-header-font-size, 20px); font-weight: 400; }
  .content { padding: 8px 16px 16px; }
  .section + .section { margin-top: 12px; }
  .label { display: flex; align-items: center; gap: 6px; font-weight: 500; color: var(--secondary-text-color); font-size: 0.9em; margin: 4px 0; }
  .label ha-icon { --mdc-icon-size: 18px; }
  .count { margin-left: auto; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 8px; cursor: pointer; }
  .row:hover, .row:focus-visible { background: var(--secondary-background-color); outline: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.bad { background: var(--error-color, #db4437); }
  .dot.warn { background: var(--warning-color, #ffa600); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .area { color: var(--secondary-text-color); font-size: 0.85em; margin-left: 6px; }
  .detail { flex: none; font-size: 0.9em; font-variant-numeric: tabular-nums; }
  .detail.bad { color: var(--error-color, #db4437); }
  .detail.warn { color: var(--warning-color, #ffa600); }
  .more { color: var(--secondary-text-color); font-size: 0.85em; padding: 2px 4px 0 22px; }
  .clear { display: flex; align-items: center; gap: 10px; color: var(--secondary-text-color); padding: 4px 0; }
  .clear ha-icon { color: var(--success-color, #43a047); }
`;

if (!customElements.get("home-watchdog-card")) {
  customElements.define("home-watchdog-card", HomeWatchdogCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "home-watchdog-card",
    name: "Home Watchdog Card",
    description: "Offline devices, low batteries and batteries that stopped reporting, found automatically.",
    preview: true,
    documentationURL: "https://github.com/paultuddenham/home-watchdog-card",
  });
  console.info(`%c HOME-WATCHDOG-CARD %c v${VERSION} `, "color:#fff;background:#3f51b5;font-weight:600", "color:#3f51b5");
}

window.__homeWatchdogCompute = computeWatch; // used by the tests; harmless in Home Assistant
