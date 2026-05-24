const RBRTW_AREA = [29.46899, -98.78885];

const map = L.map("map", {
  zoomControl: false
}).setView(RBRTW_AREA, 10);

L.control.zoom({
  position: "bottomleft"
}).addTo(map);

let baseLayer = null;
let radarLayer = null;
let pastRadarLayer = null;
let radarFrames = [];
let radarHost = "";
let radarIndex = 0;
let radarTimer = null;
let alertLayer = null;
let qpfLayer = null;
let spcLayer = null;
let wpcLayer = null;
let countyLayer = null;
let tempLayer = null;
let rainfallLayer = null;
let rainfallPeriod = "24";
let rainfallProbeHandler = null;
let rainfallMarker = null;
let airQualityLayer = null;
let surfaceLayer = null;

let hrrrLayer = null;
let hrrrFrames = [];
let hrrrBounds = null;
let hrrrIndex = 0;
let hrrrTimer = null;

const basemaps = {
  standard: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }),
  dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap & CARTO"
  }),
  satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  })
};

function setBasemap(type) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = basemaps[type] || basemaps.standard;
  baseLayer.addTo(map);
  updatePanel("Basemap", `${type.charAt(0).toUpperCase() + type.slice(1)} basemap selected.`);
}

setBasemap("standard");

const locations = {
  bexar: { name: "Bexar County", coords: [29.4241, -98.4936], zoom: 9 },
  medina: { name: "Medina County", coords: [29.3558, -99.1107], zoom: 9 },
  atascosa: { name: "Atascosa County", coords: [28.8936, -98.5273], zoom: 9 }
};

const rbrtwMarker = L.marker(RBRTW_AREA)
  .addTo(map)
  .bindPopup("<strong>RBRTW AREA</strong>")
  .openPopup();

L.circle(RBRTW_AREA, {
  radius: 9000,
  color: "#ff3b3b",
  weight: 1,
  fillColor: "#ff3b3b",
  fillOpacity: 0.12
}).addTo(map);

function toggleCard(id) {
  document.getElementById(id).classList.toggle("collapsed");
}

function focusArea() {
  map.setView(RBRTW_AREA, 11);
  rbrtwMarker.openPopup();
}

function focusCounty(county) {
  const selected = locations[county];
  if (!selected) return;

  map.setView(selected.coords, selected.zoom);

  L.popup()
    .setLatLng(selected.coords)
    .setContent(`<strong>${selected.name}</strong>`)
    .openOn(map);
}

function updatePanel(title, html) {
  const status = document.getElementById("status");
  if (!status) return;
  status.innerHTML = `<strong>${title}</strong><br><br>${html}`;
}


function firstValue(properties, keys, fallback = "") {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function formatDateValue(value) {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number") {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  const text = String(value).trim();
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed) && /\d/.test(text)) {
    return new Date(parsed).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  return text;
}

function localRadarTime(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function sanitizeForPanel(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function riskLabelFromDn(dn, source) {
  const n = Number(dn);

  if (source === "WPC") {
    if (n === 1) return "Marginal — at least 5% chance of flash flooding";
    if (n === 2) return "Slight — at least 15% chance of flash flooding";
    if (n === 3) return "Moderate — at least 40% chance of flash flooding";
    if (n === 4) return "High — at least 70% chance of flash flooding";
  }

  if (source === "SPC") {
    if (n === 2) return "Thunderstorm";
    if (n === 3) return "Marginal";
    if (n === 4) return "Slight";
    if (n === 5) return "Enhanced";
    if (n === 6) return "Moderate";
    if (n === 8) return "High";
  }

  return "";
}

function hazardPanelHtml(source, properties = {}, extra = {}) {
  const product = firstValue(properties, [
    "event", "headline", "product", "outlook", "label", "label2", "valid", "phenomena", "name", "title"
  ], `${source} Hazard`);

  const risk = firstValue(properties, ["outlook", "label", "label2", "risk", "category"], "") || riskLabelFromDn(properties.dn, source);
  const issued = formatDateValue(firstValue(properties, ["issue", "issue_time", "sent", "effective", "onset"], ""));
  const valid = formatDateValue(firstValue(properties, ["valid", "valid_time", "start_time"], ""));
  const expires = formatDateValue(firstValue(properties, ["expire", "expires", "end_time", "ends"], ""));
  const area = firstValue(properties, ["areaDesc", "area", "location", "states"], "");
  const severity = firstValue(properties, ["severity"], "");
  const urgency = firstValue(properties, ["urgency"], "");
  const certainty = firstValue(properties, ["certainty"], "");
  const description = firstValue(properties, ["description", "snippet", "summary", "discussion", "text"], "");
  const instruction = firstValue(properties, ["instruction"], "");

  const rows = [];
  if (extra.layerName) rows.push(["Layer", extra.layerName]);
  if (risk && risk !== product) rows.push(["Risk / Category", risk]);
  if (severity) rows.push(["Severity", severity]);
  if (urgency) rows.push(["Urgency", urgency]);
  if (certainty) rows.push(["Certainty", certainty]);
  if (area) rows.push(["Area", area]);
  if (issued) rows.push(["Issued", issued]);
  if (valid) rows.push(["Valid / Starts", valid]);
  if (expires) rows.push(["Expires / Ends", expires]);
  if (description) rows.push(["Details", description]);
  if (instruction) rows.push(["Action", instruction]);

  const detailRows = rows.map(([label, value]) => `
    <div class="hazard-detail-row"><span>${sanitizeForPanel(label)}:</span> ${sanitizeForPanel(value)}</div>
  `).join("");

  return {
    title: `${source}: ${sanitizeForPanel(product)}`,
    html: detailRows || "No detailed properties were returned for this polygon."
  };
}

function bindHazardFeature(layer, source, feature, extra = {}) {
  const properties = feature?.properties || {};
  const details = hazardPanelHtml(source, properties, extra);

  layer.on("click", () => {
    updatePanel(details.title, details.html);
  });

  layer.bindPopup(`<strong>${details.title}</strong><br>${details.html}`);

  layer.bindTooltip(details.title, {
    sticky: true,
    direction: "top",
    className: "hazard-tooltip"
  });

  layer.on("mouseover", function () {
    if (layer.setStyle) {
      layer.setStyle({ weight: 5, opacity: 1 });
    }
  });

  layer.on("mouseout", function () {
    if (layer.setStyle) {
      layer.setStyle({ weight: 3, opacity: 1 });
    }
  });
}

function setGroupStyle(groupLayer, style) {
  if (!groupLayer) return;

  if (groupLayer.setStyle) {
    groupLayer.setStyle(style);
    return;
  }

  if (groupLayer.eachLayer) {
    groupLayer.eachLayer(layer => {
      if (layer.setStyle) layer.setStyle(style);
      if (layer.eachLayer) setGroupStyle(layer, style);
    });
  }
}

function setCheck(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function assetPath(path) {
  if (!path) return "";
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

const activeLegendTypes = new Set();

function legendHtml(type) {
  const legends = {
    radar: `
      <div class="legend-row"><span class="legend-swatch" style="background:#44ff44"></span>Light precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff44"></span>Moderate precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4444"></span>Heavy precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff44ff"></span>Very heavy / hail core</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Source: NOAA/NWS MRMS</div>
    `,
    pastRadar: `
      <div class="legend-row"><span class="legend-swatch" style="background:#44ff44"></span>Light precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff44"></span>Moderate precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4444"></span>Heavy precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff44ff"></span>Very heavy / hail core</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Source: RainViewer past radar</div>
    `,
    hrrr: `
      <div class="legend-row"><span class="legend-swatch" style="background:#44ff44"></span>5–20 dBZ Light</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff44"></span>20–35 dBZ Moderate</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff5500"></span>35–50 dBZ Heavy</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff0000"></span>50–65 dBZ Strong</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff00ff"></span>65+ dBZ Extreme / Hail Core</div>
    `,
    county: `
      <div class="legend-row"><span class="legend-swatch" style="background:#00ff88"></span>County boundary lines</div>
    `,
    qpf: `
      <div class="legend-row"><span class="legend-swatch" style="background:#b7e4c7"></span>Light forecast rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#52b788"></span>Moderate forecast rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#2d6a4f"></span>Heavy forecast rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#7209b7"></span>Extreme forecast rainfall</div>
    `,
    spc: `
      <div class="legend-row"><span class="legend-swatch" style="background:#c1e9c1"></span>General Thunder</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#66a366"></span>Marginal</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffe066"></span>Slight</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffa366"></span>Enhanced</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e06666"></span>Moderate</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ee99ee"></span>High</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#00ffff"></span>Neon cyan outline</div>
    `,
    wpc: `
      <div class="legend-row"><span class="legend-swatch" style="background:#66a366"></span>Marginal Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffe066"></span>Slight Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e06666"></span>Moderate Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ee99ee"></span>High Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#00ffff"></span>Bright service outline</div>
    `,
    alerts: `
      <div class="legend-row"><span class="legend-swatch" style="background:#ff0033"></span>Active NWS Alert Fill</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff00ff"></span>Neon warning outline</div>
    `,
    temp: `
      <div class="legend-row"><span class="legend-swatch temp-swatch"></span>Station temperature</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff8c00"></span>Heat index shown only when applicable</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#66d9ff"></span>Wind chill shown only when applicable</div>
    `,
    rainfall: `
      <div class="legend-row"><span class="legend-swatch" style="background:#e8f7ff"></span>Trace–0.10 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#79c8ff"></span>0.10–0.50 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#0b72ff"></span>0.50–1.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#22c55e"></span>1.00–2.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#facc15"></span>2.00–4.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ef4444"></span>4.00+ in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Hover/tap map for pixel value</div>
    `,
    airQuality: `
      <div class="legend-row"><span class="legend-swatch" style="background:#00e400"></span>Good</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff00"></span>Moderate</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff7e00"></span>Unhealthy for Sensitive Groups</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff0000"></span>Unhealthy</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#8f3f97"></span>Very Unhealthy</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#7e0023"></span>Hazardous</div>
    `,
    surface: `
      <div class="legend-row"><span class="legend-line blue-line"></span>Cold front</div>
      <div class="legend-row"><span class="legend-line red-line"></span>Warm front</div>
      <div class="legend-row"><span class="legend-line purple-line"></span>Occluded front</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Highs, lows, fronts, precip areas</div>
    `
  };
  return legends[type] || "";
}

function renderLegends() {
  const box = document.getElementById("legendContent");
  if (!box) return;

  if (!activeLegendTypes.size) {
    box.innerHTML = "Turn on a layer to view its legend.";
    return;
  }

  const titleMap = {
    radar: "Radar",
    pastRadar: "Past Radar",
    hrrr: "HRRR Future Radar",
    county: "County Lines",
    qpf: "QPF Forecast",
    spc: "SPC Outlook",
    wpc: "WPC Outlook",
    alerts: "NWS Alerts",
    temp: "Temperatures",
    rainfall: "Rainfall Totals",
    airQuality: "Air Quality",
    surface: "Surface Map"
  };

  box.innerHTML = [...activeLegendTypes].map(type => `
    <div class="legend-section">
      <div class="legend-section-title">${titleMap[type] || type}</div>
      ${legendHtml(type)}
    </div>
  `).join("");
}

function updateLegend(type) {
  activeLegendTypes.add(type);
  renderLegends();
}

function clearLegend(type) {
  activeLegendTypes.delete(type);
  renderLegends();
}

function setLayerOpacity(type) {
  if (type === "radar") {
    const opacity = Number(document.getElementById("radarOpacity").value);
    if (radarLayer) radarLayer.setOpacity(opacity);
    if (pastRadarLayer) pastRadarLayer.setOpacity(opacity);
  }

  if (type === "qpf" && qpfLayer) {
    qpfLayer.setOpacity(Number(document.getElementById("qpfOpacity").value));
  }

  if (type === "spc" && spcLayer) {
    spcLayer.setStyle({
      fillOpacity: Number(document.getElementById("spcOpacity").value),
      opacity: 1
    });
  }

  if (type === "wpc" && wpcLayer) {
    const opacity = Number(document.getElementById("wpcOpacity").value);
    setGroupStyle(wpcLayer, {
      opacity: 1,
      fillOpacity: opacity
    });
  }

  if (type === "hrrr" && hrrrLayer) {
    hrrrLayer.setOpacity(Number(document.getElementById("hrrrOpacity").value));
  }

  if (type === "county" && countyLayer) {
  countyLayer.setStyle({
    color: "#374151",
    weight: 1.4,
    opacity: Number(document.getElementById("countyOpacity").value),
    fillOpacity: 0
  });
  }

  if (type === "rainfall" && rainfallLayer) {
    rainfallLayer.setOpacity(Number(document.getElementById("rainfallOpacity")?.value || 0.68));
  }

  if (type === "airQuality" && airQualityLayer) {
    airQualityLayer.setOpacity(Number(document.getElementById("airQualityOpacity")?.value || 0.62));
  }

  if (type === "surface" && surfaceLayer) {
    surfaceLayer.setOpacity(Number(document.getElementById("surfaceOpacity")?.value || 0.78));
  }
}
async function getNwsPointData() {
  const response = await fetch(
    `https://api.weather.gov/points/${RBRTW_AREA[0]},${RBRTW_AREA[1]}`,
    { headers: { Accept: "application/geo+json" } }
  );

  if (!response.ok) throw new Error("NWS point request failed");
  return await response.json();
}

async function loadNwsPointData() {
  try {
    const data = await getNwsPointData();
    updatePanel("RBRTW AREA", `Office: ${data.properties.cwa}<br>Grid: ${data.properties.gridId} ${data.properties.gridX},${data.properties.gridY}`);
  } catch (error) {
    updatePanel("Error", "Could not load RBRTW AREA data.");
    console.error(error);
  }
}

async function loadRadarFrames() {
  const response = await fetch("https://api.rainviewer.com/public/weather-maps.json?cache=" + Date.now());
  if (!response.ok) throw new Error("Past radar timeline request failed");

  const data = await response.json();
  radarHost = data.host;
  radarFrames = data?.radar?.past || [];

  if (!radarFrames.length) {
    throw new Error("No past radar frames returned.");
  }

  radarIndex = radarFrames.length - 1;

  const slider = document.getElementById("radarFrameSlider");
  if (slider) {
    slider.max = radarFrames.length - 1;
    slider.value = radarIndex;
  }
}

function showRadarFrame(index) {
  if (!radarFrames.length || !radarHost) return;

  radarIndex = index;
  if (radarIndex < 0) radarIndex = radarFrames.length - 1;
  if (radarIndex >= radarFrames.length) radarIndex = 0;

  if (pastRadarLayer) {
    map.removeLayer(pastRadarLayer);
  }

  const frame = radarFrames[radarIndex];

  // RainViewer past radar only supports tile zooms up to z7. Leaflet will stretch
  // the z7 tile when the map is zoomed closer, which prevents gray unsupported tiles.
  // Color scheme 2 is the only public color scheme currently documented by RainViewer.
  const tileUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/2/0_0.png`;

  pastRadarLayer = L.tileLayer(tileUrl, {
    opacity: Number(document.getElementById("radarOpacity").value),
    tileSize: 256,
    maxZoom: 19,
    minZoom: 0,
    maxNativeZoom: 7,
    keepBuffer: 2,
    errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
    attribution: "Past Radar: RainViewer"
  }).addTo(map);

  const slider = document.getElementById("radarFrameSlider");
  const label = document.getElementById("radarFrameLabel");

  if (slider) slider.value = radarIndex;
  if (label) label.textContent = localRadarTime(frame.time);
}

function toggleRadar() {
  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
    setCheck("radarCheck", false);
    clearLegend("radar");
    updatePanel("Radar", "NOAA/NWS MRMS radar layer turned off.");
    return;
  }

  if (pastRadarLayer || radarFrames.length) {
    turnOffPastRadar(false);
  }

  radarLayer = L.tileLayer.wms(
    "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows",
    {
      layers: "conus_bref_qcd",
      format: "image/png",
      transparent: true,
      opacity: Number(document.getElementById("radarOpacity").value),
      attribution: "NOAA/NWS/NCEP MRMS Radar"
    }
  ).addTo(map);

  setCheck("radarCheck", true);
  setCheck("pastRadarCheck", false);
  updateLegend("radar");
  updatePanel("Radar", `NOAA/NWS MRMS radar layer on.<br>Source: Original radar source.<br>Updated: ${new Date().toLocaleTimeString()}`);
}

function turnOffPastRadar(updateMessage = true) {
  stopRadarAnimation();
  if (pastRadarLayer) map.removeLayer(pastRadarLayer);
  pastRadarLayer = null;
  radarFrames = [];
  radarHost = "";
  const timeline = document.getElementById("radarTimeline");
  if (timeline) timeline.classList.add("hidden");
  setCheck("pastRadarCheck", false);
  clearLegend("pastRadar");
  if (updateMessage) updatePanel("Past Radar", "Past radar playback turned off.");
}

async function togglePastRadar() {
  if (pastRadarLayer || radarFrames.length) {
    turnOffPastRadar(true);
    return;
  }

  try {
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
      setCheck("radarCheck", false);
    }

    await loadRadarFrames();
    const timeline = document.getElementById("radarTimeline");
    if (timeline) timeline.classList.remove("hidden");
    showRadarFrame(radarIndex);

    setCheck("pastRadarCheck", true);
    updateLegend("pastRadar");
    updatePanel("Past Radar Playback", `
      Past radar timeline loaded.<br>
      Frames: ${radarFrames.length}<br>
      Current frame: ${localRadarTime(radarFrames[radarIndex].time)}<br><br>
      Source: RainViewer public past radar feed.<br>
      Note: this source is lower-resolution than the live NOAA/NWS MRMS layer.
    `);
  } catch (error) {
    setCheck("pastRadarCheck", false);
    updatePanel("Past Radar", "Could not load past radar timeline.");
    console.error(error);
  }
}

function setRadarFrameFromSlider() {
  stopRadarAnimation();
  const slider = document.getElementById("radarFrameSlider");
  showRadarFrame(Number(slider.value));
}

function nextRadarFrame() {
  showRadarFrame(radarIndex + 1);
}

function previousRadarFrame() {
  showRadarFrame(radarIndex - 1);
}

function toggleRadarAnimation() {
  const playBtn = document.getElementById("radarPlayBtn");
  const loopText = document.getElementById("radarLoopText");

  if (radarTimer) {
    stopRadarAnimation();
    return;
  }

  if (!radarFrames.length) return;

  radarTimer = setInterval(() => {
    showRadarFrame(radarIndex + 1);
  }, 700);

  if (playBtn) playBtn.textContent = "Pause";
  if (loopText) loopText.textContent = "Loop playing";
}

function stopRadarAnimation() {
  const playBtn = document.getElementById("radarPlayBtn");
  const loopText = document.getElementById("radarLoopText");

  if (radarTimer) {
    clearInterval(radarTimer);
    radarTimer = null;
  }

  if (playBtn) playBtn.textContent = "Play";
  if (loopText) loopText.textContent = "Loop paused";
}
async function toggleAlerts() {
  if (alertLayer) {
    map.removeLayer(alertLayer);
    alertLayer = null;
    setCheck("alertsCheck", false);
    clearLegend("alerts");
    updatePanel("NWS Alerts", "Alert layer turned off.");
    return;
  }

  try {
    const response = await fetch(`https://api.weather.gov/alerts/active?point=${RBRTW_AREA[0]},${RBRTW_AREA[1]}`);
    if (!response.ok) throw new Error("Alerts request failed");

    const data = await response.json();

    alertLayer = L.geoJSON(data, {
      style: {
        color: "#ff00ff",
        weight: 3,
        opacity: 1,
        fillColor: "#ff0033",
        fillOpacity: 0.2
      },
      onEachFeature: function (feature, layer) {
        bindHazardFeature(layer, "NWS Alert", feature);
      }
    }).addTo(map);

    setCheck("alertsCheck", true);
    updateLegend("alerts");

    const alertList = data.features.map(feature => {
      const p = feature.properties;
      return `<div style="margin-bottom:10px;"><strong>${p.event}</strong><br><small>${p.areaDesc}</small></div>`;
    }).join("");

    updatePanel("Active NWS Alerts", `${alertList || "No active alerts for RBRTW AREA."}<br><br>Updated: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setCheck("alertsCheck", false);
    updatePanel("NWS Alerts", "Could not load alerts.");
    console.error(error);
  }
}
function toggleQpf() {
  if (qpfLayer) {
    map.removeLayer(qpfLayer);
    qpfLayer = null;
    setCheck("qpfCheck", false);
    clearLegend("qpf");
    updatePanel("Rainfall / QPF", "QPF layer turned off.");
    return;
  }

  qpfLayer = L.esri.dynamicMapLayer({
    url: "https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer",
    layers: [9],
    opacity: Number(document.getElementById("qpfOpacity").value)
  }).addTo(map);

  setCheck("qpfCheck", true);
  updateLegend("qpf");
  updatePanel("Rainfall / QPF", `WPC QPF layer on.<br>Updated: ${new Date().toLocaleTimeString()}`);
}

function spcColor(label, dn) {
  const value = String(label || dn || "").toLowerCase();
  if (value.includes("high") || dn === 8) return "#ee99ee";
  if (value.includes("moderate") || dn === 6) return "#e06666";
  if (value.includes("enhanced") || dn === 5) return "#ffa366";
  if (value.includes("slight") || dn === 4) return "#ffe066";
  if (value.includes("marginal") || dn === 3) return "#66a366";
  if (value.includes("thunder") || dn === 2) return "#c1e9c1";
  return "#f5c542";
}

async function toggleSpc() {
  if (spcLayer) {
    map.removeLayer(spcLayer);
    spcLayer = null;
    setCheck("spcCheck", false);
    clearLegend("spc");
    updatePanel("SPC Outlook", "SPC outlook layer turned off.");
    return;
  }

  try {
    const url = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson";
    const response = await fetch(url);
    if (!response.ok) throw new Error("SPC request failed");

    const data = await response.json();

    spcLayer = L.geoJSON(data, {
      style: function (feature) {
        const p = feature.properties;
        const color = spcColor(p.label, p.dn);
        return {
          color: "#00ffff",
          fillColor: color,
          weight: 3,
          opacity: 1,
          fillOpacity: Number(document.getElementById("spcOpacity").value)
        };
      },
      onEachFeature: function (feature, layer) {
        bindHazardFeature(layer, "SPC", feature, { layerName: "Day 1 Categorical Outlook" });
      }
    }).addTo(map);

    setCheck("spcCheck", true);
    updateLegend("spc");

    const hazards = data.features.map(feature => {
      const p = feature.properties || {};
      return p.label || p.label2 || riskLabelFromDn(p.dn, "SPC") || "SPC Outlook Area";
    });

    const uniqueHazards = [...new Set(hazards)].join(", ");

    updatePanel("SPC Outlook", `
      Active SPC Day 1 categorical outlook polygons loaded.<br>
      Hazards: ${uniqueHazards || "None returned"}<br>
      Click a polygon for the exact outlook details.
    `);
  } catch (error) {
    setCheck("spcCheck", false);
    updatePanel("SPC Outlook", "Could not load SPC outlook.");
    console.error(error);
  }
}
function wpcColor(outlook, dn) {
  const value = String(outlook || dn || "").toLowerCase();
  if (value.includes("high") || dn === 4) return "#ee99ee";
  if (value.includes("moderate") || dn === 3) return "#e06666";
  if (value.includes("slight") || dn === 2) return "#ffe066";
  if (value.includes("marginal") || dn === 1) return "#66a366";
  return "#9254de";
}

function toggleWpc() {
  if (wpcLayer) {
    map.removeLayer(wpcLayer);
    wpcLayer = null;
    setCheck("wpcCheck", false);
    clearLegend("wpc");
    updatePanel("WPC Outlook", "WPC outlook layer turned off.");
    return;
  }

  const opacity = Number(document.getElementById("wpcOpacity").value);
  const serviceUrl = "https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer";
  const wpcDayLayers = [
    { id: 0, name: "Excessive Rainfall Day 1" },
    { id: 1, name: "Excessive Rainfall Day 2" },
    { id: 2, name: "Excessive Rainfall Day 3" },
    { id: 3, name: "Excessive Rainfall Day 4" },
    { id: 4, name: "Excessive Rainfall Day 5" }
  ];

  const layers = wpcDayLayers.map(day => {
    return L.esri.featureLayer({
      url: `${serviceUrl}/${day.id}`,
      where: "1=1",
      simplifyFactor: 0.35,
      precision: 5,
      style: function (feature) {
        const p = feature.properties || {};
        return {
          color: "#00ffff",
          weight: 3,
          opacity: 1,
          fillColor: wpcColor(p.outlook, p.dn),
          fillOpacity: opacity
        };
      },
      onEachFeature: function (feature, layer) {
        bindHazardFeature(layer, "WPC", feature, { layerName: day.name });
      }
    });
  });

  wpcLayer = L.layerGroup(layers).addTo(map);

  setCheck("wpcCheck", true);
  updateLegend("wpc");
  updatePanel("WPC Outlook", `
    WPC Excessive Rainfall Outlook polygons loaded.<br>
    Days: 1–5<br>
    Click a WPC polygon for product, risk category, valid time, and issue time.
  `);
}
async function toggleCountyLines() {
  if (countyLayer) {
    map.removeLayer(countyLayer);
    countyLayer = null;
    setCheck("countyCheck", false);
    clearLegend("county");
    updatePanel("County Lines", "County line layer turned off.");
    return;
  }

  try {
    const url = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";
    const response = await fetch(url);
    if (!response.ok) throw new Error("County GeoJSON request failed");

    const data = await response.json();

    const texasCountyFeatures = data.features.filter(feature => {
      const fips = String(feature.id || feature.properties.GEO_ID || "");
      return fips.startsWith("48");
    });

    countyLayer = L.geoJSON({
      type: "FeatureCollection",
      features: texasCountyFeatures
    }, {
      style: {
  color: "#1f2933",
  weight: 1.4,
  opacity: Number(document.getElementById("countyOpacity").value),
  fillOpacity: 0
    },
      onEachFeature: function (feature, layer) {
        const name = feature.properties.NAME || "County";
        layer.bindPopup(`<strong>${name} County</strong>`);
      }
    }).addTo(map);

    setCheck("countyCheck", true);
    updateLegend("county");
    updatePanel("County Lines", "Texas county boundary layer turned on.");
  } catch (error) {
    setCheck("countyCheck", false);
    updatePanel("County Lines", "Could not load county lines.");
    console.error(error);
  }
}

async function toggleHrrr() {
  if (hrrrLayer) {
    stopHrrrAnimation();
    map.removeLayer(hrrrLayer);
    hrrrLayer = null;
    hrrrFrames = [];
    document.getElementById("hrrrTimeline").classList.add("hidden");
    setCheck("hrrrCheck", false);
    clearLegend("hrrr");
    updatePanel("HRRR Future Radar", "HRRR layer turned off.");
    return;
  }

  try {
    const response = await fetch(`/public/data/model/hrrr/latest.json?cache=${Date.now()}`);
    if (!response.ok) throw new Error("Could not load HRRR latest.json");

    const data = await response.json();

    if (!data.frames || data.frames.length === 0) {
      throw new Error("No HRRR PNG frames found.");
    }

    hrrrFrames = data.frames;
    hrrrBounds = [
      [data.bounds.south, data.bounds.west],
      [data.bounds.north, data.bounds.east]
    ];
    hrrrIndex = 0;

    const slider = document.getElementById("hrrrFrameSlider");
    slider.max = hrrrFrames.length - 1;
    slider.value = 0;

    document.getElementById("hrrrTimeline").classList.remove("hidden");

    showHrrrFrame(0);
    setCheck("hrrrCheck", true);
    updateLegend("hrrr");

    updatePanel("HRRR Future Radar", `
      HRRR simulated reflectivity loaded.<br>
      Frames: ${hrrrFrames.length}<br>
      Current: ${hrrrFrames[0].label}
    `);
  } catch (error) {
    setCheck("hrrrCheck", false);
    updatePanel("HRRR Future Radar", "Could not load HRRR processed frames. Check latest.json and PNG files.");
    console.error(error);
  }
}

function showHrrrFrame(index) {
  if (!hrrrFrames.length || !hrrrBounds) return;

  hrrrIndex = index;

  if (hrrrIndex < 0) hrrrIndex = hrrrFrames.length - 1;
  if (hrrrIndex >= hrrrFrames.length) hrrrIndex = 0;

  if (hrrrLayer) {
    map.removeLayer(hrrrLayer);
  }

  const frame = hrrrFrames[hrrrIndex];

  hrrrLayer = L.imageOverlay(assetPath(frame.file), hrrrBounds, {
    opacity: Number(document.getElementById("hrrrOpacity").value),
    interactive: false
  }).addTo(map);

  const slider = document.getElementById("hrrrFrameSlider");
  const label = document.getElementById("hrrrFrameLabel");

  if (slider) slider.value = hrrrIndex;
  if (label) label.textContent = frame.label || `F${String(hrrrIndex + 1).padStart(2, "0")}`;
}

function setHrrrFrameFromSlider() {
  const slider = document.getElementById("hrrrFrameSlider");
  showHrrrFrame(Number(slider.value));
}

function nextHrrrFrame() {
  showHrrrFrame(hrrrIndex + 1);
}

function previousHrrrFrame() {
  showHrrrFrame(hrrrIndex - 1);
}

function toggleHrrrAnimation() {
  const playBtn = document.getElementById("hrrrPlayBtn");
  const loopText = document.getElementById("hrrrLoopText");

  if (hrrrTimer) {
    stopHrrrAnimation();
    return;
  }

  hrrrTimer = setInterval(() => {
    showHrrrFrame(hrrrIndex + 1);
  }, 900);

  if (playBtn) playBtn.textContent = "Pause";
  if (loopText) loopText.textContent = "Loop playing";
}

function stopHrrrAnimation() {
  const playBtn = document.getElementById("hrrrPlayBtn");
  const loopText = document.getElementById("hrrrLoopText");

  if (hrrrTimer) {
    clearInterval(hrrrTimer);
    hrrrTimer = null;
  }

  if (playBtn) playBtn.textContent = "Play";
  if (loopText) loopText.textContent = "Loop paused";
}

function cToF(value) {
  return value === null || value === undefined ? null : (value * 9) / 5 + 32;
}

function mpsToMph(value) {
  return value === null || value === undefined ? null : value * 2.23694;
}

function heatIndexF(tempF, humidity) {
  if (tempF === null || humidity === null || tempF < 80 || humidity < 40) return null;
  const T = tempF;
  const R = humidity;
  return -42.379 + 2.04901523*T + 10.14333127*R - 0.22475541*T*R - 0.00683783*T*T - 0.05481717*R*R + 0.00122874*T*T*R + 0.00085282*T*R*R - 0.00000199*T*T*R*R;
}

function windChillF(tempF, windMph) {
  if (tempF === null || windMph === null || tempF > 50 || windMph < 3) return null;
  return 35.74 + 0.6215*tempF - 35.75*Math.pow(windMph, 0.16) + 0.4275*tempF*Math.pow(windMph, 0.16);
}

function tempMarkerClass(tempF) {
  if (tempF >= 100) return "temp-hot";
  if (tempF >= 90) return "temp-warm";
  if (tempF >= 70) return "temp-mild";
  if (tempF >= 50) return "temp-cool";
  return "temp-cold";
}

async function toggleTemperatures() {
  if (tempLayer) {
    map.removeLayer(tempLayer);
    tempLayer = null;
    setCheck("tempCheck", false);
    clearLegend("temp");
    updatePanel("Temperatures", "Temperature layer turned off.");
    return;
  }

  try {
    tempLayer = L.layerGroup().addTo(map);
    const point = await getNwsPointData();
    const stationsResponse = await fetch(point.properties.observationStations);
    if (!stationsResponse.ok) throw new Error("Observation stations request failed");
    const stationsData = await stationsResponse.json();
    const stations = (stationsData.features || []).slice(0, 14);

    const obsResults = await Promise.allSettled(stations.map(async station => {
      const obsResponse = await fetch(`${station.id}/observations/latest`);
      if (!obsResponse.ok) throw new Error("Latest observation failed");
      const obs = await obsResponse.json();
      return { station, obs };
    }));

    let plotted = 0;
    obsResults.forEach(result => {
      if (result.status !== "fulfilled") return;
      const { station, obs } = result.value;
      const coords = station.geometry?.coordinates;
      const p = obs.properties || {};
      if (!coords || !p.temperature) return;

      const tempF = cToF(p.temperature.value);
      if (tempF === null || Number.isNaN(tempF)) return;

      const humidity = p.relativeHumidity?.value ?? null;
      const windMph = mpsToMph(p.windSpeed?.value ?? null);
      const hi = p.heatIndex?.value !== null && p.heatIndex?.value !== undefined ? cToF(p.heatIndex.value) : heatIndexF(tempF, humidity);
      const wc = p.windChill?.value !== null && p.windChill?.value !== undefined ? cToF(p.windChill.value) : windChillF(tempF, windMph);
      const stationId = station.properties?.stationIdentifier || station.id.split("/").pop();

      const lines = [
        `<div class="big-temp">${Math.round(tempF)}°F</div>`,
        `${sanitizeForPanel(p.textDescription || "Latest observation")}`,
        humidity !== null ? `Humidity: ${Math.round(humidity)}%` : "",
        windMph !== null ? `Wind: ${Math.round(windMph)} mph` : "",
        hi !== null && hi >= 80 ? `<strong>Heat Index: ${Math.round(hi)}°F</strong>` : "",
        wc !== null && wc <= 50 ? `<strong>Wind Chill: ${Math.round(wc)}°F</strong>` : "",
        p.timestamp ? `Updated: ${new Date(p.timestamp).toLocaleTimeString()}` : ""
      ].filter(Boolean).join("<br>");

      const icon = L.divIcon({
        className: "temp-div-icon",
        html: `<div class="temp-badge ${tempMarkerClass(tempF)}">${Math.round(tempF)}°</div>`,
        iconSize: [44, 28],
        iconAnchor: [22, 14]
      });

      L.marker([coords[1], coords[0]], { icon })
        .bindTooltip(`${stationId}: ${Math.round(tempF)}°F`, { sticky: true })
        .on("click", () => updatePanel(`Temperature: ${sanitizeForPanel(stationId)}`, lines))
        .addTo(tempLayer);
      plotted++;
    });

    setCheck("tempCheck", true);
    updateLegend("temp");
    updatePanel("Temperatures", `Current temperature markers loaded.<br>Stations plotted: ${plotted}<br>Heat index and wind chill only display when applicable.`);
  } catch (error) {
    if (tempLayer) map.removeLayer(tempLayer);
    tempLayer = null;
    setCheck("tempCheck", false);
    updatePanel("Temperatures", "Could not load temperature stations.");
    console.error(error);
  }
}

const rainfallServiceUrl = "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer";
const rainfallRules = {
  "24": "rft_24hr",
  "48": "rft_48hr",
  "72": "rft_72hr"
};

function rainfallLabel(period = rainfallPeriod) {
  return period === "24" ? "Past 24 Hours" : period === "48" ? "Past 48 Hours" : "Past 72 Hours";
}

function setExclusiveRainChecks(period) {
  const ids = { "24": "rain24Check", "48": "rain48Check", "72": "rain72SubCheck" };
  Object.entries(ids).forEach(([key, id]) => setCheck(id, key === period));
}

function rainfallRenderingRule(period = rainfallPeriod) {
  return { rasterFunction: rainfallRules[period] || "rft_24hr" };
}

function createRainfallLayer(period = rainfallPeriod) {
  return L.esri.imageMapLayer({
    url: rainfallServiceUrl,
    opacity: 0.68,
    renderingRule: rainfallRenderingRule(period),
    useCors: false,
    attribution: "NOAA/NWS MRMS QPE"
  });
}

function setRainfallPeriod(period) {
  rainfallPeriod = period;
  setExclusiveRainChecks(period);

  if (!rainfallLayer) return;

  map.removeLayer(rainfallLayer);
  rainfallLayer = createRainfallLayer(period).addTo(map);
  attachRainfallProbe();
  updateLegend("rainfall");
  updatePanel("Rainfall Rates / Totals", `${rainfallLabel(period)} MRMS QPE layer is on.<br>Hover or tap the map to estimate rainfall under the pointer.`);
}

function mapExtentParam() {
  const b = map.getBounds();
  const sw = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne = L.CRS.EPSG3857.project(b.getNorthEast());
  return `${sw.x},${sw.y},${ne.x},${ne.y}`;
}

async function identifyRainfallAt(latlng) {
  const point = L.CRS.EPSG3857.project(latlng);
  const size = map.getSize();
  const params = new URLSearchParams({
    f: "json",
    geometry: `${point.x},${point.y}`,
    geometryType: "esriGeometryPoint",
    returnGeometry: "false",
    returnCatalogItems: "false",
    pixelSize: "1000,1000",
    mapExtent: mapExtentParam(),
    imageDisplay: `${size.x},${size.y},96`,
    renderingRule: JSON.stringify(rainfallRenderingRule())
  });

  const response = await fetch(`${rainfallServiceUrl}/identify?${params.toString()}`);
  if (!response.ok) throw new Error("Rainfall identify failed");
  const data = await response.json();
  const raw = data.value ?? data.properties?.value ?? data.catalogItems?.features?.[0]?.attributes?.value;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

let rainfallProbeDebounce = null;

function showRainfallMarker(latlng, text) {
  if (rainfallMarker) map.removeLayer(rainfallMarker);
  rainfallMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: "rain-probe-icon",
      html: `<div class="rain-plus">+</div><div class="rain-value">${sanitizeForPanel(text)}</div>`,
      iconSize: [86, 48],
      iconAnchor: [43, 24]
    }),
    interactive: false
  }).addTo(map);
}

function attachRainfallProbe() {
  if (rainfallProbeHandler) {
    map.off("mousemove", rainfallProbeHandler);
    map.off("click", rainfallProbeHandler);
  }

  rainfallProbeHandler = e => {
    clearTimeout(rainfallProbeDebounce);
    rainfallProbeDebounce = setTimeout(async () => {
      if (!rainfallLayer) return;
      showRainfallMarker(e.latlng, "+");
      try {
        const value = await identifyRainfallAt(e.latlng);
        const text = value === null ? "No data" : `${value.toFixed(2)} in`;
        showRainfallMarker(e.latlng, text);
        updatePanel("Rainfall Probe", `${rainfallLabel()}<br>Estimated rainfall at pointer: <strong>${text}</strong>`);
      } catch (error) {
        showRainfallMarker(e.latlng, "No identify");
      }
    }, 160);
  };

  map.on("mousemove", rainfallProbeHandler);
  map.on("click", rainfallProbeHandler);
}

function detachRainfallProbe() {
  if (rainfallProbeHandler) {
    map.off("mousemove", rainfallProbeHandler);
    map.off("click", rainfallProbeHandler);
    rainfallProbeHandler = null;
  }
  if (rainfallMarker) {
    map.removeLayer(rainfallMarker);
    rainfallMarker = null;
  }
}

function toggleRainfall72() {
  const subBox = document.getElementById("rainfallSubToggles");

  if (rainfallLayer) {
    map.removeLayer(rainfallLayer);
    rainfallLayer = null;
    detachRainfallProbe();
    if (subBox) subBox.classList.add("hidden");
    setCheck("rain72Check", false);
    clearLegend("rainfall");
    updatePanel("Rainfall Rates / Totals", "Rainfall layer turned off.");
    return;
  }

  rainfallPeriod = "24";
  setExclusiveRainChecks("24");
  rainfallLayer = createRainfallLayer(rainfallPeriod).addTo(map);
  attachRainfallProbe();
  if (subBox) subBox.classList.remove("hidden");
  setCheck("rain72Check", true);
  updateLegend("rainfall");
  updatePanel("Rainfall Rates / Totals", `${rainfallLabel()} MRMS QPE loaded.<br>Use the 24/48/72 hour sub toggles. Hover with mouse or tap on mobile to show the estimated rainfall amount under that point.`);
}

function toggleAirQuality() {
  if (airQualityLayer) {
    map.removeLayer(airQualityLayer);
    airQualityLayer = null;
    setCheck("airQualityCheck", false);
    clearLegend("airQuality");
    updatePanel("Air Quality", "Air quality layer turned off.");
    return;
  }

  airQualityLayer = L.esri.imageMapLayer({
    url: "https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_mpm25_hr01/ImageServer",
    opacity: 0.62,
    useCors: false,
    attribution: "NOAA/NWS Air Quality Guidance"
  }).addTo(map);

  setCheck("airQualityCheck", true);
  updateLegend("airQuality");
  updatePanel("Air Quality", "Air quality PM2.5 guidance layer turned on.<br>Legend uses AQI-style categories for quick visual reference.");
}

function toggleSurfaceMap() {
  if (surfaceLayer) {
    map.removeLayer(surfaceLayer);
    surfaceLayer = null;
    setCheck("surfaceCheck", false);
    clearLegend("surface");
    updatePanel("Surface Map", "Surface map layer turned off.");
    return;
  }

  surfaceLayer = L.esri.dynamicMapLayer({
    url: "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer",
    layers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    opacity: 0.78
  }).addTo(map);

  setCheck("surfaceCheck", true);
  updateLegend("surface");
  updatePanel("Surface Map", "Current WPC Day 1 surface map information is on.<br>Includes highs/lows, fronts, and broad weather areas when available.");
}

function refreshActiveLayers() {
  const radarWasOn = !!radarLayer;
  const pastRadarWasOn = !!pastRadarLayer || radarFrames.length > 0;
  const alertsWasOn = !!alertLayer;
  const qpfWasOn = !!qpfLayer;
  const spcWasOn = !!spcLayer;
  const wpcWasOn = !!wpcLayer;
  const countyWasOn = !!countyLayer;
  const hrrrWasOn = !!hrrrLayer;
  const tempWasOn = !!tempLayer;
  const rainfallWasOn = !!rainfallLayer;
  const airQualityWasOn = !!airQualityLayer;
  const surfaceWasOn = !!surfaceLayer;

  if (radarWasOn) toggleRadar();
  if (pastRadarWasOn) turnOffPastRadar(false);
  if (alertsWasOn) toggleAlerts();
  if (qpfWasOn) toggleQpf();
  if (spcWasOn) toggleSpc();
  if (wpcWasOn) toggleWpc();
  if (countyWasOn) toggleCountyLines();
  if (hrrrWasOn) toggleHrrr();
  if (tempWasOn) toggleTemperatures();
  if (rainfallWasOn) toggleRainfall72();
  if (airQualityWasOn) toggleAirQuality();
  if (surfaceWasOn) toggleSurfaceMap();

  setTimeout(() => {
    if (radarWasOn) toggleRadar();
    if (pastRadarWasOn) togglePastRadar();
    if (alertsWasOn) toggleAlerts();
    if (qpfWasOn) toggleQpf();
    if (spcWasOn) toggleSpc();
    if (wpcWasOn) toggleWpc();
    if (countyWasOn) toggleCountyLines();
    if (hrrrWasOn) toggleHrrr();
    if (tempWasOn) toggleTemperatures();
    if (rainfallWasOn) toggleRainfall72();
    if (airQualityWasOn) toggleAirQuality();
    if (surfaceWasOn) toggleSurfaceMap();
  }, 500);

  updatePanel("Refresh", `Refreshing active layers...<br>${new Date().toLocaleTimeString()}`);
}

async function loadForecast() {
  try {
    const point = await getNwsPointData();
    const response = await fetch(point.properties.forecast);
    if (!response.ok) throw new Error("Forecast request failed");
    const data = await response.json();

    const forecastHtml = data.properties.periods.slice(0, 7).map(period => `
      <div style="margin-bottom:12px;">
        <strong>${period.name}</strong><br>
        ${period.temperature}°${period.temperatureUnit}<br>
        ${period.shortForecast}<br>
        <small>${period.windSpeed} ${period.windDirection}</small>
      </div>
    `).join("");

    updatePanel("Official NWS Forecast", forecastHtml);
  } catch (error) {
    updatePanel("Forecast", "Could not load forecast.");
    console.error(error);
  }
}

async function loadHourlyForecast() {
  try {
    const point = await getNwsPointData();
    const response = await fetch(point.properties.forecastHourly);
    if (!response.ok) throw new Error("Hourly forecast request failed");
    const data = await response.json();

    const hourlyHtml = data.properties.periods.slice(0, 12).map(period => `
      <div style="margin-bottom:10px;">
        <strong>${new Date(period.startTime).toLocaleTimeString([], { hour: "numeric" })}</strong>
        — ${period.temperature}°${period.temperatureUnit}, ${period.shortForecast}
      </div>
    `).join("");

    updatePanel("Hourly NWS Forecast", hourlyHtml);
  } catch (error) {
    updatePanel("Hourly Forecast", "Could not load hourly forecast.");
    console.error(error);
  }
}

async function loadCurrentConditions() {
  try {
    const point = await getNwsPointData();
    const stationsResponse = await fetch(point.properties.observationStations);
    if (!stationsResponse.ok) throw new Error("Stations request failed");

    const stationsData = await stationsResponse.json();
    const stationUrl = `${stationsData.features[0].id}/observations/latest`;

    const obsResponse = await fetch(stationUrl);
    if (!obsResponse.ok) throw new Error("Observation request failed");

    const obsData = await obsResponse.json();
    const p = obsData.properties;

    const tempC = p.temperature.value;
    const dewC = p.dewpoint.value;
    const windMps = p.windSpeed.value;
    const gustMps = p.windGust.value;
    const humidity = p.relativeHumidity.value;

    const tempF = tempC !== null ? Math.round((tempC * 9) / 5 + 32) : "N/A";
    const dewF = dewC !== null ? Math.round((dewC * 9) / 5 + 32) : "N/A";
    const windMph = windMps !== null ? Math.round(windMps * 2.23694) : "N/A";
    const gustMph = gustMps !== null ? Math.round(gustMps * 2.23694) : "N/A";
    const humidityText = humidity !== null ? `${Math.round(humidity)}%` : "N/A";

    updatePanel("Current Conditions", `
      <div class="big-temp">${tempF}°F</div>
      ${p.textDescription || "Current conditions"}<br><br>
      Dew Point: ${dewF}°F<br>
      Humidity: ${humidityText}<br>
      Wind: ${windMph} mph<br>
      Wind Gust: ${gustMph} mph<br>
      Updated: ${new Date(p.timestamp).toLocaleTimeString()}
    `);
  } catch (error) {
    updatePanel("Current Conditions", "Could not load current conditions.");
    console.error(error);
  }
}

loadNwsPointData();
