// A small fake `hass` object shaped like the one Home Assistant passes to cards.
export const NOW = Date.parse("2026-11-07T10:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();

export function mockHass({ healthy = false } = {}) {
  const states = {};
  const entities = {};
  const devices = {};
  const areas = {
    garage: { area_id: "garage", name: "Garage" },
    hall: { area_id: "hall", name: "Hallway" },
    bed: { area_id: "bed", name: "Bedroom" },
    study: { area_id: "study", name: "Study" },
    kitchen: { area_id: "kitchen", name: "Kitchen" },
    lounge: { area_id: "lounge", name: "Lounge" },
    front: { area_id: "front", name: "Entrance" },
  };
  const add = (eid, state, attrs, reg = {}, changedMin = 60) => {
    states[eid] = { entity_id: eid, state, attributes: attrs, last_changed: ago(changedMin) };
    entities[eid] = { entity_id: eid, platform: "zha", ...reg };
  };
  const dev = (id, name, area) => { devices[id] = { id, name, area_id: area }; };

  dev("d_garage", "Garage door sensor", "garage");
  dev("d_hall", "Hallway motion", "hall");
  dev("d_remote", "Bedroom remote", "bed");
  dev("d_study", "Study temperature", "study");
  dev("d_kettle", "Kettle plug", "kitchen");
  dev("d_lamp", "Lounge lamp", "lounge");
  dev("d_lock", "Back door lock", "front");
  dev("d_front", "Front door contact", "front");
  dev("d_phone", "Paul's phone", null);
  dev("d_bath", "Bathroom humidity", null);

  const off = healthy ? "off" : "unavailable";
  const batt = (d) => ({ device_class: "battery", unit_of_measurement: "%", friendly_name: `${d} battery` });

  add("binary_sensor.garage_door", off, { device_class: "door" }, { device_id: "d_garage" }, 3 * 24 * 60);
  add("sensor.garage_door_battery", healthy ? "80" : "unavailable", batt("Garage"), { device_id: "d_garage", entity_category: "diagnostic" }, 3 * 24 * 60);
  add("binary_sensor.hallway_motion", off, { device_class: "motion" }, { device_id: "d_hall" }, 5 * 60);
  add("sensor.bedroom_remote_battery", healthy ? "70" : "8", batt("Remote"), { device_id: "d_remote", entity_category: "diagnostic" });
  add("sensor.study_temperature", "22.4", { device_class: "temperature" }, { device_id: "d_study" });
  add("sensor.study_temperature_battery", healthy ? "90" : "unavailable", batt("Study"), { device_id: "d_study", entity_category: "diagnostic" }, 2 * 24 * 60);
  add("switch.kettle_plug", healthy ? "off" : "unavailable", {}, { device_id: "d_kettle" }, 4);
  add("light.lounge_lamp", "on", {}, { device_id: "d_lamp" });
  add("sensor.lounge_lamp_rssi", "unavailable", {}, { device_id: "d_lamp", entity_category: "diagnostic" });
  add("lock.back_door", "locked", {}, { device_id: "d_lock" });
  add("binary_sensor.back_door_lock_battery", healthy ? "off" : "on", { device_class: "battery" }, { device_id: "d_lock", entity_category: "diagnostic" });
  add("binary_sensor.front_door", "off", { device_class: "door" }, { device_id: "d_front" });
  add("sensor.front_door_battery", healthy ? "95" : "22", batt("Front door"), { device_id: "d_front", entity_category: "diagnostic" });
  add("sensor.pauls_phone_battery_level", "41", batt("Phone"), { device_id: "d_phone", platform: "mobile_app" });
  add("sensor.bathroom_humidity", "64", { device_class: "humidity" }, { device_id: "d_bath" });
  add("sensor.bathroom_humidity_battery", "100", batt("Bathroom"), { device_id: "d_bath", entity_category: "diagnostic" });
  // a Browser Mod tab that was closed days ago: always unavailable, even in a healthy home
  dev("d_tab", "browser_mod_59244b4b_af48e86f", null);
  add("binary_sensor.browser_mod_59244b4b_af48e86f", "unavailable", {}, { device_id: "d_tab", platform: "browser_mod" }, 6 * 24 * 60);
  add("sensor.browser_mod_59244b4b_af48e86f_browser_battery", "unavailable", batt("Tab"), { device_id: "d_tab", platform: "browser_mod" }, 6 * 24 * 60);
  add("sun.sun", "above_horizon", {}, {});
  delete entities["sun.sun"].device_id;

  return { states, entities, devices, areas };
}
