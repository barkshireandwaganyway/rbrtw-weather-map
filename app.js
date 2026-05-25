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

function toggleBasemapMenu() {
  const menu = document.getElementById("basemapMenu");
  if (menu) menu.classList.toggle("hidden");
}

function setBasemap(type) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = basemaps[type] || basemaps.standard;
  baseLayer.addTo(map);

  const menu = document.getElementById("basemapMenu");
  if (menu) menu.classList.add("hidden");

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

let rbrtwCircle = null;

function showRbrtwCircle() {
  if (rbrtwCircle) return;

  rbrtwCircle = L.circle(RBRTW_AREA, {
    radius: 9000,
    color: "#ff3b3b",
    weight: 1,
    fillColor: "#ff3b3b",
    fillOpacity: 0.12
  }).addTo(map);
}

function hideRbrtwCircle() {
  if (!rbrtwCircle) return;
  map.removeLayer(rbrtwCircle);
  rbrtwCircle = null;
}

showRbrtwCircle();
rbrtwMarker.on("popupclose", hideRbrtwCircle);

function toggleCard(id) {
  document.getElementById(id).classList.toggle("collapsed");
}

function focusArea() {
  map.setView(RBRTW_AREA, 11);
  showRbrtwCircle();
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
          color: color,
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
          color: wpcColor(p.outlook, p.dn),
          weight: 2.5,
          opacity: 0.95,
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

document.addEventListener("click", event => {
  const menu = document.getElementById("basemapMenu");
  const button = document.querySelector(".basemap-btn");
  if (!menu || !button) return;
  if (menu.classList.contains("hidden")) return;
  if (menu.contains(event.target) || button.contains(event.target)) return;
  menu.classList.add("hidden");
});

loadNwsPointData();


/* ===== RBRTW FINAL OVERRIDES: TEMP, WIND, SURFACE DAYS, SAVE PHOTO, NON-NEON BORDERS ===== */
let windLayer = null;
let surfaceDay = 1;

function alertColorFromEvent(eventName = "") {
  const event = String(eventName).toLowerCase();
  if (event.includes("tornado")) return "#c026d3";
  if (event.includes("severe thunderstorm")) return "#facc15";
  if (event.includes("flash flood")) return "#16a34a";
  if (event.includes("flood")) return "#15803d";
  if (event.includes("winter")) return "#60a5fa";
  if (event.includes("wind")) return "#a16207";
  if (event.includes("heat")) return "#ea580c";
  if (event.includes("fire")) return "#dc2626";
  if (event.includes("marine")) return "#0ea5e9";
  return "#dc2626";
}

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
      <div class="legend-row"><span class="legend-swatch" style="background:#d1d5db"></span>County lines low opacity</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#374151"></span>County lines higher opacity</div>
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
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Outlines match risk color</div>
    `,
    wpc: `
      <div class="legend-row"><span class="legend-swatch" style="background:#66a366"></span>Marginal Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffe066"></span>Slight Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e06666"></span>Moderate Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ee99ee"></span>High Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Outlines match risk color</div>
    `,
    alerts: `
      <div class="legend-row"><span class="legend-swatch" style="background:#c026d3"></span>Tornado</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#facc15"></span>Severe Thunderstorm</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#16a34a"></span>Flash Flood</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ea580c"></span>Heat</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#60a5fa"></span>Winter / Cold</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#dc2626"></span>Other active alert</div>
    `,
    temp: `
      <div class="legend-row"><span class="legend-swatch" style="background:#4f8cff"></span>Cold</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#66d9ff"></span>Cool</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#7bd88f"></span>Mild</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#f5c542"></span>Warm</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffb000"></span>Hot</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff8c00"></span>Heat Index Caution</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff0000"></span>Heat Index Danger</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#6d5dfc"></span>Wind Chill</div>
    `,
    wind: `
      <div class="legend-row"><span class="legend-line blue-line"></span>Wind barb / direction marker</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Arrow points where wind is moving</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#8fd3ff"></span>Opacity slider controls transparency</div>
    `,
    rainfall: `
      <div class="legend-row"><span class="legend-swatch" style="background:#e8f7ff"></span>Trace–0.10 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#79c8ff"></span>0.10–0.50 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#0b72ff"></span>0.50–1.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#22c55e"></span>1.00–2.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#facc15"></span>2.00–4.00 in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ef4444"></span>4.00+ in</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Hover/tap map for estimated value</div>
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
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Highs / lows</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#7dd3fc"></span>Rain / thunderstorms</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ef4444"></span>Heavy rain / severe / fire areas</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#dbeafe"></span>Snow / mixed / freezing precip</div>
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
    wind: "Wind Barbs",
    rainfall: "Rainfall Totals / QPE",
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

function toggleAlerts() {
  if (alertLayer) {
    map.removeLayer(alertLayer);
    alertLayer = null;
    setCheck("alertsCheck", false);
    clearLegend("alerts");
    updatePanel("NWS Alerts", "Alert layer turned off.");
    return;
  }

  fetch(`https://api.weather.gov/alerts/active?point=${RBRTW_AREA[0]},${RBRTW_AREA[1]}`)
    .then(response => {
      if (!response.ok) throw new Error("Alerts request failed");
      return response.json();
    })
    .then(data => {
      alertLayer = L.geoJSON(data, {
        style: function (feature) {
          const color = alertColorFromEvent(feature.properties?.event || "");
          return {
            color,
            weight: 3,
            opacity: 0.95,
            fillColor: color,
            fillOpacity: 0.2
          };
        },
        onEachFeature: function (feature, layer) {
          bindHazardFeature(layer, "NWS Alert", feature);
        }
      }).addTo(map);

      setCheck("alertsCheck", true);
      updateLegend("alerts");

      const alertList = data.features.map(feature => {
        const p = feature.properties;
        return `<div style="margin-bottom:10px;"><strong>${sanitizeForPanel(p.event)}</strong><br><small>${sanitizeForPanel(p.areaDesc || "")}</small></div>`;
      }).join("");

      updatePanel("Active NWS Alerts", `${alertList || "No active alerts for RBRTW AREA."}<br><br>Updated: ${new Date().toLocaleTimeString()}`);
    })
    .catch(error => {
      setCheck("alertsCheck", false);
      updatePanel("NWS Alerts", "Could not load alerts.");
      console.error(error);
    });
}

function heatIndexF(tempF, humidity) {
  const month = new Date().getMonth() + 1;
  const heatSeason = month >= 4 && month <= 10;
  if (!heatSeason) return null;
  if (tempF === null || humidity === null || tempF < 80 || humidity < 40) return null;
  const T = tempF;
  const R = humidity;
  return -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
}

function windChillF(tempF, windMph) {
  if (tempF === null || windMph === null || tempF > 50 || windMph <= 3) return null;
  return 35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tempF * Math.pow(windMph, 0.16);
}

function tempMarkerClass(tempF, feelsLikeType = "") {
  if (feelsLikeType === "heat") {
    if (tempF >= 125) return "temp-extreme-heat";
    if (tempF >= 103) return "temp-danger-heat";
    if (tempF >= 90) return "temp-caution-heat";
    return "temp-hot";
  }
  if (feelsLikeType === "windchill") {
    if (tempF <= 0) return "temp-extreme-cold";
    return "temp-windchill";
  }
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
    const stations = (stationsData.features || []).slice(0, 18);

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
      const officialHeatIndex = p.heatIndex?.value !== null && p.heatIndex?.value !== undefined ? cToF(p.heatIndex.value) : null;
      const officialWindChill = p.windChill?.value !== null && p.windChill?.value !== undefined ? cToF(p.windChill.value) : null;
      const hi = officialHeatIndex !== null ? officialHeatIndex : heatIndexF(tempF, humidity);
      const wc = officialWindChill !== null ? officialWindChill : windChillF(tempF, windMph);
      const showHeatIndex = hi !== null && hi >= 80;
      const showWindChill = !showHeatIndex && wc !== null && wc <= 50;
      const feelsLikeValue = showHeatIndex ? hi : showWindChill ? wc : null;
      const feelsLikeType = showHeatIndex ? "heat" : showWindChill ? "windchill" : "";
      const displayValue = feelsLikeValue !== null ? feelsLikeValue : tempF;
      const stationId = station.properties?.stationIdentifier || station.id.split("/").pop();
      const stationName = station.properties?.name || stationId;
      const lines = [
        `<div class="big-temp">${Math.round(tempF)}°F</div>`,
        `${sanitizeForPanel(p.textDescription || "Latest observation")}`,
        `Station: ${sanitizeForPanel(stationName)}`,
        humidity !== null ? `Humidity: ${Math.round(humidity)}%` : "",
        windMph !== null ? `Wind: ${Math.round(windMph)} mph` : "",
        showHeatIndex ? `<strong>Heat Index: ${Math.round(hi)}°F</strong>` : "",
        showWindChill ? `<strong>Wind Chill: ${Math.round(wc)}°F</strong>` : "",
        p.timestamp ? `Updated: ${new Date(p.timestamp).toLocaleTimeString()}` : ""
      ].filter(Boolean).join("<br>");
      const icon = L.divIcon({
        className: "temp-div-icon",
        html: `<div class="temp-badge ${tempMarkerClass(displayValue, feelsLikeType)}">${Math.round(tempF)}°</div>`,
        iconSize: [44, 28],
        iconAnchor: [22, 14]
      });
      L.marker([coords[1], coords[0]], { icon })
        .bindTooltip(`${stationId}: ${Math.round(tempF)}°F`, { sticky: true })
        .on("click", () => updatePanel(`Station: ${sanitizeForPanel(stationId)}`, lines))
        .addTo(tempLayer);
      plotted++;
    });
    setCheck("tempCheck", true);
    updateLegend("temp");
    updatePanel("Temperatures", `Current temperature markers loaded.<br>Stations plotted: ${plotted}<br>Click a station for temp, humidity, heat index, or wind chill when applicable.`);
  } catch (error) {
    if (tempLayer) map.removeLayer(tempLayer);
    tempLayer = null;
    setCheck("tempCheck", false);
    updatePanel("Temperatures", "Could not load temperature stations.");
    console.error(error);
  }
}

async function toggleWindLayer() {
  if (windLayer) {
    map.removeLayer(windLayer);
    windLayer = null;
    setCheck("windCheck", false);
    clearLegend("wind");
    updatePanel("Wind Barbs", "Wind barb layer turned off.");
    return;
  }
  try {
    windLayer = L.layerGroup().addTo(map);
    const point = await getNwsPointData();
    const stationsResponse = await fetch(point.properties.observationStations);
    if (!stationsResponse.ok) throw new Error("Observation stations request failed");
    const stationsData = await stationsResponse.json();
    const stations = (stationsData.features || []).slice(0, 18);
    const obsResults = await Promise.allSettled(stations.map(async station => {
      const obsResponse = await fetch(`${station.id}/observations/latest`);
      if (!obsResponse.ok) throw new Error("Latest observation failed");
      const obs = await obsResponse.json();
      return { station, obs };
    }));
    let plotted = 0;
    const opacity = Number(document.getElementById("windOpacity")?.value || 0.55);
    obsResults.forEach(result => {
      if (result.status !== "fulfilled") return;
      const { station, obs } = result.value;
      const coords = station.geometry?.coordinates;
      const p = obs.properties || {};
      if (!coords) return;
      const windMph = mpsToMph(p.windSpeed?.value ?? null);
      const windDirection = p.windDirection?.value ?? null;
      if (windMph === null || windDirection === null || Number.isNaN(windMph) || Number.isNaN(windDirection)) return;
      const stationId = station.properties?.stationIdentifier || station.id.split("/").pop();
      const movingToward = Number(windDirection) + 180;
      const icon = L.divIcon({
        className: "wind-div-icon",
        html: `<div class="wind-barb" style="transform: rotate(${movingToward}deg); --wind-opacity:${opacity};"></div><div class="wind-label">${Math.round(windMph)}</div>`,
        iconSize: [42, 48],
        iconAnchor: [21, 24]
      });
      const panelHtml = [
        `Station: ${sanitizeForPanel(stationId)}`,
        `Wind Speed: ${Math.round(windMph)} mph`,
        `Wind Direction: ${Math.round(windDirection)}° from`,
        `Moving Toward: ${Math.round(movingToward % 360)}°`,
        p.timestamp ? `Updated: ${new Date(p.timestamp).toLocaleTimeString()}` : ""
      ].filter(Boolean).join("<br>");
      L.marker([coords[1], coords[0]], { icon })
        .bindTooltip(`${stationId}: ${Math.round(windMph)} mph`, { sticky: true })
        .on("click", () => updatePanel("Wind Observation", panelHtml))
        .addTo(windLayer);
      plotted++;
    });
    setCheck("windCheck", true);
    updateLegend("wind");
    updatePanel("Wind Barbs", `Wind barb layer loaded.<br>Stations plotted: ${plotted}<br>Arrow points where the wind is moving.`);
  } catch (error) {
    if (windLayer) map.removeLayer(windLayer);
    windLayer = null;
    setCheck("windCheck", false);
    updatePanel("Wind Barbs", "Could not load wind barbs.");
    console.error(error);
  }
}

const surfaceMapServiceUrl = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer";
const surfaceLayerSets = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  2: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  3: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]
};

function setSurfaceChecks(day) {
  setCheck("surfaceDay1Check", day === 1);
  setCheck("surfaceDay2Check", day === 2);
  setCheck("surfaceDay3Check", day === 3);
}

function createSurfaceLayer(day = surfaceDay) {
  return L.esri.dynamicMapLayer({
    url: surfaceMapServiceUrl,
    layers: surfaceLayerSets[day] || surfaceLayerSets[1],
    opacity: Number(document.getElementById("surfaceOpacity")?.value || 0.78)
  });
}

function setSurfaceDay(day) {
  surfaceDay = Number(day);
  setSurfaceChecks(surfaceDay);
  if (!surfaceLayer) return;
  map.removeLayer(surfaceLayer);
  surfaceLayer = createSurfaceLayer(surfaceDay).addTo(map);
  updateLegend("surface");
  updatePanel("Surface Map", `WPC Day ${surfaceDay} surface map information is on.<br>Showing highs/lows, fronts, precipitation, and hazard areas available for Day ${surfaceDay}.`);
}

function toggleSurfaceMap() {
  const subBox = document.getElementById("surfaceSubToggles");
  if (surfaceLayer) {
    map.removeLayer(surfaceLayer);
    surfaceLayer = null;
    if (subBox) subBox.classList.add("hidden");
    setCheck("surfaceCheck", false);
    clearLegend("surface");
    updatePanel("Surface Map", "Surface map layer turned off.");
    return;
  }
  surfaceDay = 1;
  setSurfaceChecks(surfaceDay);
  surfaceLayer = createSurfaceLayer(surfaceDay).addTo(map);
  if (subBox) subBox.classList.remove("hidden");
  setCheck("surfaceCheck", true);
  updateLegend("surface");
  updatePanel("Surface Map", "WPC Day 1 surface map information is on.<br>Use Day 1, Day 2, or Day 3 to switch the surface forecast layer.");
}

async function saveMapPhoto() {
  const btn = document.getElementById("savePhotoBtn");
  const legendBody = document.getElementById("legendBody");
  try {
    if (btn) btn.textContent = "Saving...";
    if (legendBody) legendBody.classList.remove("collapsed");
    document.body.classList.add("capture-mode");
    await new Promise(resolve => setTimeout(resolve, 450));
    if (typeof html2canvas !== "function") throw new Error("html2canvas did not load");
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      scale: 2,
      logging: false
    });
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `RBRTW-weather-map-${timestamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    updatePanel("Save as Photo", "Map photo saved with active layers and active legends.");
  } catch (error) {
    console.error(error);
    updatePanel("Save as Photo", "Could not save the map image. Some external map tiles may block browser screenshot export.");
  } finally {
    document.body.classList.remove("capture-mode");
    if (btn) btn.textContent = "Save as Photo";
  }
}

function setLayerOpacity(type) {
  if (type === "radar") {
    const opacity = Number(document.getElementById("radarOpacity").value);
    if (radarLayer) radarLayer.setOpacity(opacity);
    if (pastRadarLayer) pastRadarLayer.setOpacity(opacity);
  }
  if (type === "qpf" && qpfLayer) qpfLayer.setOpacity(Number(document.getElementById("qpfOpacity").value));
  if (type === "spc" && spcLayer) {
    spcLayer.setStyle({
      fillOpacity: Number(document.getElementById("spcOpacity").value),
      opacity: 0.95
    });
  }
  if (type === "wpc" && wpcLayer) {
    const opacity = Number(document.getElementById("wpcOpacity").value);
    setGroupStyle(wpcLayer, { opacity: 0.95, fillOpacity: opacity });
  }
  if (type === "hrrr" && hrrrLayer) hrrrLayer.setOpacity(Number(document.getElementById("hrrrOpacity").value));
  if (type === "county" && countyLayer) {
    countyLayer.setStyle({
      color: "#374151",
      weight: 1.25,
      opacity: Number(document.getElementById("countyOpacity").value),
      fillOpacity: 0
    });
  }
  if (type === "wind" && windLayer) {
    const opacity = Number(document.getElementById("windOpacity")?.value || 0.55);
    windLayer.eachLayer(layer => {
      const el = layer.getElement?.();
      if (el) el.style.setProperty("--wind-opacity", opacity);
    });
  }
  if (type === "rainfall" && rainfallLayer) rainfallLayer.setOpacity(Number(document.getElementById("rainfallOpacity")?.value || 0.68));
  if (type === "airQuality" && airQualityLayer) airQualityLayer.setOpacity(Number(document.getElementById("airQualityOpacity")?.value || 0.62));
  if (type === "surface" && surfaceLayer) surfaceLayer.setOpacity(Number(document.getElementById("surfaceOpacity")?.value || 0.78));
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
  const windWasOn = !!windLayer;
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
  if (windWasOn) toggleWindLayer();
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
    if (windWasOn) toggleWindLayer();
    if (rainfallWasOn) toggleRainfall72();
    if (airQualityWasOn) toggleAirQuality();
    if (surfaceWasOn) toggleSurfaceMap();
  }, 500);

  updatePanel("Refresh", `Refreshing active layers...<br>${new Date().toLocaleTimeString()}`);
}


/* ===== RBRTW FINAL QPF/QPE POINT FIXES + FOCUS MENU REMOVAL ===== */

var qpfProbeHandler = null;
var qpfHoverMarker = null;
var qpfPermanentMarkers = L.layerGroup().addTo(map);
var rainfallHoverMarker = null;
var rainfallPermanentMarkers = L.layerGroup().addTo(map);

function asNumberFromUnknown(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, " ");
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  const nums = matches.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.max(...nums);
}

function formatInches(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "No data";
  if (n < 0.005) return "Trace/0.00 in";
  return `${n.toFixed(2)} in`;
}

function extractLikelyPrecipValue(obj) {
  if (!obj) return null;

  if (Array.isArray(obj.samples) && obj.samples.length) {
    for (const sample of obj.samples) {
      const sampleValues = [sample.value, sample.Value, sample.pixelValue, sample.PixelValue];
      for (const v of sampleValues) {
        const n = asNumberFromUnknown(v);
        if (n !== null) return n;
      }
      const attrs = sample.attributes || {};
      const attrResult = extractLikelyPrecipValue(attrs);
      if (attrResult !== null) return attrResult;
    }
  }

  if (Array.isArray(obj.results) && obj.results.length) {
    for (const result of obj.results) {
      const attrResult = extractLikelyPrecipValue(result.attributes || result.properties || {});
      if (attrResult !== null) return attrResult;
      const valueResult = asNumberFromUnknown(result.value || result.Value);
      if (valueResult !== null) return valueResult;
    }
  }

  const preferredKeys = [
    "qpf", "QPF", "qpf_in", "QPF_IN", "qpf_inches", "QPF_INCHES",
    "amount", "AMOUNT", "precip", "PRECIP", "rainfall", "RAINFALL",
    "value", "VALUE", "Value", "Pixel Value", "PixelValue", "pixelValue",
    "contour", "CONTOUR", "Contour", "gridcode", "GRIDCODE", "label", "LABEL"
  ];

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const n = asNumberFromUnknown(obj[key]);
      if (n !== null) return n;
    }
  }

  if (obj.value !== undefined) {
    const n = asNumberFromUnknown(obj.value);
    if (n !== null) return n;
  }

  if (obj.properties) {
    const n = extractLikelyPrecipValue(obj.properties);
    if (n !== null) return n;
  }

  return null;
}

function qpfMapExtentParam4326() {
  const b = map.getBounds();
  return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
}

function qpfImageDisplayParam() {
  const size = map.getSize();
  return `${size.x},${size.y},96`;
}

async function identifyQpfAt(latlng) {
  const params = new URLSearchParams({
    f: "json",
    geometry: `${latlng.lng},${latlng.lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: "visible:9",
    tolerance: "6",
    mapExtent: qpfMapExtentParam4326(),
    imageDisplay: qpfImageDisplayParam(),
    returnGeometry: "false"
  });

  const url = `https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/identify?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("QPF identify failed");
  const data = await response.json();
  const value = extractLikelyPrecipValue(data);
  const layerName = data.results?.[0]?.layerName || "QPF 72 Hour Day 1-3";
  return { value, layerName, raw: data };
}

function markerIconForPrecip(text, type) {
  const isQpf = type === "qpf";
  return L.divIcon({
    className: isQpf ? "qpf-probe-icon" : "rain-probe-icon",
    html: `<div class="${isQpf ? "qpf-plus" : "qpe-plus"}">+</div><div class="${isQpf ? "qpf-value" : "qpe-value"}">${sanitizeForPanel(text)}</div>`,
    iconSize: [92, 48],
    iconAnchor: [46, 24]
  });
}

function showQpfHoverMarker(latlng, text) {
  if (qpfHoverMarker) map.removeLayer(qpfHoverMarker);
  qpfHoverMarker = L.marker(latlng, {
    icon: markerIconForPrecip(text, "qpf"),
    interactive: false
  }).addTo(map);
}

function addQpfPermanentMarker(latlng, text) {
  L.marker(latlng, {
    icon: markerIconForPrecip(text, "qpf"),
    interactive: false
  }).addTo(qpfPermanentMarkers);
}

function showRainfallHoverMarker(latlng, text) {
  if (rainfallHoverMarker) map.removeLayer(rainfallHoverMarker);
  rainfallHoverMarker = L.marker(latlng, {
    icon: markerIconForPrecip(text, "qpe"),
    interactive: false
  }).addTo(map);
}

function addRainfallPermanentMarker(latlng, text) {
  L.marker(latlng, {
    icon: markerIconForPrecip(text, "qpe"),
    interactive: false
  }).addTo(rainfallPermanentMarkers);
}

let qpfProbeDebounce = null;
function attachQpfProbe() {
  detachQpfProbe(false);

  qpfProbeHandler = async e => {
    const isClick = e.type === "click";
    if (!qpfLayer) return;

    const runProbe = async () => {
      try {
        if (!isClick) showQpfHoverMarker(e.latlng, "+");
        const result = await identifyQpfAt(e.latlng);
        const text = formatInches(result.value);
        if (isClick) addQpfPermanentMarker(e.latlng, text);
        else showQpfHoverMarker(e.latlng, text);
        updatePanel("QPF Forecast Point", `
          <strong>${sanitizeForPanel(result.layerName)}</strong><br><br>
          Forecast liquid precipitation at selected point: <strong>${text}</strong><br>
          Period: Day 1–3 / 72-hour forecast total<br>
          Source: WPC Quantitative Precipitation Forecast
        `);
      } catch (error) {
        if (isClick) addQpfPermanentMarker(e.latlng, "No data");
        else showQpfHoverMarker(e.latlng, "No data");
      }
    };

    if (isClick) {
      clearTimeout(qpfProbeDebounce);
      runProbe();
    } else {
      clearTimeout(qpfProbeDebounce);
      qpfProbeDebounce = setTimeout(runProbe, 180);
    }
  };

  map.on("mousemove", qpfProbeHandler);
  map.on("click", qpfProbeHandler);
}

function detachQpfProbe(clearPermanent = true) {
  if (qpfProbeHandler) {
    map.off("mousemove", qpfProbeHandler);
    map.off("click", qpfProbeHandler);
    qpfProbeHandler = null;
  }
  if (qpfHoverMarker) {
    map.removeLayer(qpfHoverMarker);
    qpfHoverMarker = null;
  }
  if (clearPermanent && qpfPermanentMarkers) {
    qpfPermanentMarkers.clearLayers();
  }
}

function toggleQpf() {
  if (qpfLayer) {
    map.removeLayer(qpfLayer);
    qpfLayer = null;
    detachQpfProbe(true);
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

  attachQpfProbe();
  setCheck("qpfCheck", true);
  updateLegend("qpf");
  updatePanel("Rainfall / QPF", `
    <strong>WPC QPF 72 Hour Day 1–3</strong><br><br>
    This layer shows forecast liquid precipitation totals in inches for the Day 1–3 period.<br>
    QPF means Quantitative Precipitation Forecast. It is forecast rainfall/liquid equivalent, not observed rainfall.<br><br>
    Hover with a mouse to preview a point value. Tap/click to leave a small saved point marker on the map.
  `);
}

async function getRainfallSampleValue(latlng) {
  const point = L.CRS.EPSG3857.project(latlng);
  const getSamplesParams = new URLSearchParams({
    f: "json",
    geometry: `${point.x},${point.y}`,
    geometryType: "esriGeometryPoint",
    inSR: "102100",
    returnGeometry: "false",
    returnFirstValueOnly: "true",
    sampleDistance: "573",
    outFields: "*",
    renderingRule: JSON.stringify(rainfallRenderingRule())
  });

  const sampleUrl = `${rainfallServiceUrl}/getSamples?${getSamplesParams.toString()}`;
  const sampleResponse = await fetch(sampleUrl);
  if (sampleResponse.ok) {
    const sampleData = await sampleResponse.json();
    const sampleValue = extractLikelyPrecipValue(sampleData);
    if (sampleValue !== null) return sampleValue;
  }

  return await identifyRainfallAt(latlng);
}

async function identifyRainfallAt(latlng) {
  const point = L.CRS.EPSG3857.project(latlng);
  const size = map.getSize();
  const params = new URLSearchParams({
    f: "json",
    geometry: `${point.x},${point.y}`,
    geometryType: "esriGeometryPoint",
    sr: "102100",
    returnGeometry: "false",
    returnCatalogItems: "false",
    pixelSize: "573,573",
    mapExtent: mapExtentParam(),
    imageDisplay: `${size.x},${size.y},96`,
    renderingRule: JSON.stringify(rainfallRenderingRule())
  });

  const response = await fetch(`${rainfallServiceUrl}/identify?${params.toString()}`);
  if (!response.ok) throw new Error("Rainfall identify failed");
  const data = await response.json();
  return extractLikelyPrecipValue(data);
}

function attachRainfallProbe() {
  detachRainfallProbe(false);

  rainfallProbeHandler = e => {
    const isClick = e.type === "click";
    clearTimeout(rainfallProbeDebounce);

    const runProbe = async () => {
      if (!rainfallLayer) return;
      if (!isClick) showRainfallHoverMarker(e.latlng, "+");

      try {
        const value = await getRainfallSampleValue(e.latlng);
        const text = formatInches(value);
        if (isClick) addRainfallPermanentMarker(e.latlng, text);
        else showRainfallHoverMarker(e.latlng, text);
        updatePanel("Rainfall Total Point", `
          <strong>${rainfallLabel()}</strong><br><br>
          Estimated observed rainfall total at selected point: <strong>${text}</strong><br>
          Source: NOAA/NWS MRMS QPE Image Service<br>
          Note: this is radar-only estimated accumulation, not rainfall rate.
        `);
      } catch (error) {
        if (isClick) addRainfallPermanentMarker(e.latlng, "No data");
        else showRainfallHoverMarker(e.latlng, "No data");
      }
    };

    if (isClick) runProbe();
    else rainfallProbeDebounce = setTimeout(runProbe, 180);
  };

  map.on("mousemove", rainfallProbeHandler);
  map.on("click", rainfallProbeHandler);
}

function detachRainfallProbe(clearPermanent = true) {
  if (rainfallProbeHandler) {
    map.off("mousemove", rainfallProbeHandler);
    map.off("click", rainfallProbeHandler);
    rainfallProbeHandler = null;
  }
  if (rainfallHoverMarker) {
    map.removeLayer(rainfallHoverMarker);
    rainfallHoverMarker = null;
  }
  if (rainfallMarker) {
    map.removeLayer(rainfallMarker);
    rainfallMarker = null;
  }
  if (clearPermanent && rainfallPermanentMarkers) {
    rainfallPermanentMarkers.clearLayers();
  }
}

function setRainfallPeriod(period) {
  rainfallPeriod = period;
  setExclusiveRainChecks(period);

  if (!rainfallLayer) return;

  map.removeLayer(rainfallLayer);
  rainfallLayer = createRainfallLayer(period).addTo(map);
  attachRainfallProbe();
  updateLegend("rainfall");
  updatePanel("Rainfall Totals / QPE", `
    <strong>${rainfallLabel(period)} MRMS QPE</strong><br><br>
    This layer shows radar-only estimated rainfall accumulation in inches for the selected lookback period.<br>
    It is not rainfall rate.<br><br>
    Hover with a mouse to preview. Tap/click to leave a small saved point marker on the map.
  `);
}

function toggleRainfall72() {
  const subBox = document.getElementById("rainfallSubToggles");

  if (rainfallLayer) {
    map.removeLayer(rainfallLayer);
    rainfallLayer = null;
    detachRainfallProbe(true);
    if (subBox) subBox.classList.add("hidden");
    setCheck("rain72Check", false);
    clearLegend("rainfall");
    updatePanel("Rainfall Totals / QPE", "Rainfall totals layer turned off.");
    return;
  }

  rainfallPeriod = "24";
  setExclusiveRainChecks("24");
  rainfallLayer = createRainfallLayer(rainfallPeriod).addTo(map);
  attachRainfallProbe();
  if (subBox) subBox.classList.remove("hidden");
  setCheck("rain72Check", true);
  updateLegend("rainfall");
  updatePanel("Rainfall Totals / QPE", `
    <strong>${rainfallLabel()} MRMS QPE</strong><br><br>
    This layer shows radar-only estimated rainfall accumulation in inches for the selected period.<br>
    It is not rainfall rate.<br><br>
    Use the 24/48/72 hour sub toggles. Hover with a mouse to preview. Tap/click to leave small saved point markers.
  `);
}


/* ===== RBRTW LEGEND FILTER + TEMP/HI/WC DATA CARD OVERRIDES ===== */
var tempDisplayMode = "temp";
const allowedMapKeyTypes = new Set(["radar", "pastRadar", "qpf", "rainfall", "temp"]);

function legendHtml(type) {
  if (type === "pastRadar") type = "radar";

  const legends = {
    radar: `
      <div class="key-gradient radar-key-gradient"></div>
      <div class="key-label-row"><span>Light</span><span>Moderate</span><span>Heavy</span><span>Core</span></div>
    `,
    qpf: `
      <div class="key-gradient qpf-key-gradient"></div>
      <div class="key-label-row"><span>Light</span><span>Mod</span><span>Heavy</span><span>Extreme</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Tap/click leaves point value</div>
    `,
    rainfall: `
      <div class="key-gradient rain-key-gradient"></div>
      <div class="key-label-row"><span>T</span><span>0.5</span><span>1</span><span>2</span><span>4+</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Radar QPE inches</div>
    `,
    temp: tempLegendHtml()
  };

  return legends[type] || "";
}

function tempLegendHtml() {
  if (tempDisplayMode === "heat") {
    return `
      <div class="key-gradient heat-key-gradient"></div>
      <div class="key-label-row"><span>80</span><span>90</span><span>103</span><span>125+</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#f97316"></span>Heat index where applicable</div>
    `;
  }

  if (tempDisplayMode === "windchill") {
    return `
      <div class="key-gradient windchill-key-gradient"></div>
      <div class="key-label-row"><span>&lt;0</span><span>0</span><span>15</span><span>32</span><span>50</span></div>
      <div class="legend-row"><span class="legend-swatch" style="background:#60a5fa"></span>Wind chill where applicable</div>
    `;
  }

  return `
    <div class="key-gradient temp-key-gradient"></div>
    <div class="key-label-row"><span>&lt;32</span><span>50</span><span>70</span><span>90</span><span>100+</span></div>
    <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>Station air temperature</div>
  `;
}

function renderLegends() {
  const box = document.getElementById("legendContent");
  if (!box) return;

  const visibleTypes = [...activeLegendTypes].filter(type => allowedMapKeyTypes.has(type));

  if (!visibleTypes.length) {
    box.innerHTML = "No map key needed for active layers.";
    return;
  }

  const titleMap = {
    radar: "Radar",
    pastRadar: "Radar",
    qpf: "QPF Forecast",
    rainfall: "Rainfall QPE",
    temp: tempDisplayMode === "heat" ? "Heat Index" : tempDisplayMode === "windchill" ? "Wind Chill" : "Temperature"
  };

  box.innerHTML = visibleTypes.map(type => `
    <div class="legend-section">
      <div class="legend-section-title">${titleMap[type] || type}</div>
      ${legendHtml(type)}
    </div>
  `).join("");
}

function updateLegend(type) {
  if (!allowedMapKeyTypes.has(type)) {
    activeLegendTypes.delete(type);
    renderLegends();
    return;
  }

  if (type === "pastRadar") {
    activeLegendTypes.delete("radar");
  }
  if (type === "radar") {
    activeLegendTypes.delete("pastRadar");
  }

  activeLegendTypes.add(type);
  renderLegends();
}

function clearLegend(type) {
  activeLegendTypes.delete(type);
  renderLegends();
}

function setTempMode(mode) {
  tempDisplayMode = mode || "temp";

  setCheck("tempModeTempCheck", tempDisplayMode === "temp");
  setCheck("tempModeHeatCheck", tempDisplayMode === "heat");
  setCheck("tempModeWindCheck", tempDisplayMode === "windchill");

  const tempMaster = document.getElementById("tempCheck");
  if (tempMaster && !tempMaster.checked) {
    tempMaster.checked = true;
  }

  if (tempLayer) {
    map.removeLayer(tempLayer);
    tempLayer = null;
  }

  toggleTemperatures();
  updateLegend("temp");
}

function formatMaybe(value, suffix = "", decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return `${Number(value).toFixed(decimals)}${suffix}`;
}

function metersToMiles(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) * 0.000621371;
}

function metersToInches(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) * 39.3701;
}

function pascalToInHg(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) * 0.0002953;
}

function metersToFeet(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) * 3.28084;
}

function stationDataRow(label, value) {
  if (value === null || value === undefined || value === "" || value === "N/A") return "";
  return `<div class="data-row"><span>${sanitizeForPanel(label)}</span><span>${sanitizeForPanel(value)}</span></div>`;
}

function tempClassForValue(value, mode = tempDisplayMode) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "temp-mild";
  const n = Number(value);

  if (mode === "heat") {
    if (n >= 125) return "temp-extreme-heat";
    if (n >= 103) return "temp-danger-heat";
    if (n >= 90) return "temp-caution-heat";
    return "temp-hot";
  }

  if (mode === "windchill") {
    if (n <= 0) return "temp-extreme-cold";
    if (n <= 32) return "temp-windchill";
    return "temp-cool";
  }

  return tempMarkerClass(n, "");
}

function buildStationPanel(station, obs, calculated) {
  const p = obs.properties || {};
  const stationId = station.properties?.stationIdentifier || station.id.split("/").pop();
  const stationName = station.properties?.name || stationId;

  const tempF = calculated.tempF;
  const dewF = cToF(p.dewpoint?.value ?? null);
  const humidity = p.relativeHumidity?.value ?? null;
  const windMph = mpsToMph(p.windSpeed?.value ?? null);
  const gustMph = mpsToMph(p.windGust?.value ?? null);
  const pressureInHg = pascalToInHg(p.barometricPressure?.value ?? null);
  const seaPressureInHg = pascalToInHg(p.seaLevelPressure?.value ?? null);
  const visibilityMiles = metersToMiles(p.visibility?.value ?? null);
  const elevFt = metersToFeet(station.properties?.elevation?.value ?? null);
  const precip1 = metersToInches(p.precipitationLastHour?.value ?? null);
  const precip3 = metersToInches(p.precipitationLast3Hours?.value ?? null);
  const precip6 = metersToInches(p.precipitationLast6Hours?.value ?? null);

  const cloudLayers = Array.isArray(p.cloudLayers)
    ? p.cloudLayers.map(layer => `${layer.amount || "Cloud"}${layer.base?.value ? ` @ ${Math.round(metersToFeet(layer.base.value))} ft` : ""}`).join(", ")
    : "";

  return `
    <div class="big-temp">${Math.round(tempF)}°F</div>
    ${sanitizeForPanel(p.textDescription || "Latest observation")}<br>
    ${stationDataRow("Station", stationName)}
    ${stationDataRow("Station ID", stationId)}
    ${stationDataRow("Temperature", formatMaybe(tempF, "°F"))}
    ${stationDataRow("Dew Point", formatMaybe(dewF, "°F"))}
    ${stationDataRow("Humidity", formatMaybe(humidity, "%"))}
    ${stationDataRow("Heat Index", calculated.showHeatIndex ? `${Math.round(calculated.heatIndex)}°F` : "")}
    ${stationDataRow("Wind Chill", calculated.showWindChill ? `${Math.round(calculated.windChill)}°F` : "")}
    <div class="data-section-title">Wind</div>
    ${stationDataRow("Wind Speed", formatMaybe(windMph, " mph"))}
    ${stationDataRow("Wind Gust", formatMaybe(gustMph, " mph"))}
    ${stationDataRow("Wind Direction", p.windDirection?.value !== null && p.windDirection?.value !== undefined ? `${Math.round(p.windDirection.value)}°` : "")}
    <div class="data-section-title">Pressure / Visibility</div>
    ${stationDataRow("Pressure", formatMaybe(pressureInHg, " inHg", 2))}
    ${stationDataRow("Sea Level Pressure", formatMaybe(seaPressureInHg, " inHg", 2))}
    ${stationDataRow("Visibility", formatMaybe(visibilityMiles, " mi", 1))}
    ${stationDataRow("Elevation", formatMaybe(elevFt, " ft"))}
    <div class="data-section-title">Rain / Clouds</div>
    ${stationDataRow("Precip 1 Hour", formatMaybe(precip1, " in", 2))}
    ${stationDataRow("Precip 3 Hours", formatMaybe(precip3, " in", 2))}
    ${stationDataRow("Precip 6 Hours", formatMaybe(precip6, " in", 2))}
    ${stationDataRow("Cloud Layers", cloudLayers)}
    <div class="data-section-title">Observation</div>
    ${stationDataRow("Updated", p.timestamp ? new Date(p.timestamp).toLocaleString() : "")}
    ${stationDataRow("Raw Station URL", station.id)}
  `;
}

async function toggleTemperatures() {
  const subBox = document.getElementById("tempSubToggles");

  if (tempLayer) {
    map.removeLayer(tempLayer);
    tempLayer = null;
    if (subBox) subBox.classList.add("hidden");
    setCheck("tempCheck", false);
    clearLegend("temp");
    updatePanel("Temperatures", "Temperature layer turned off.");
    return;
  }

  try {
    tempLayer = L.layerGroup().addTo(map);
    if (subBox) subBox.classList.remove("hidden");

    const point = await getNwsPointData();
    const stationsResponse = await fetch(point.properties.observationStations);
    if (!stationsResponse.ok) throw new Error("Observation stations request failed");

    const stationsData = await stationsResponse.json();
    const stations = (stationsData.features || []).slice(0, 22);

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

      const officialHeatIndex = p.heatIndex?.value !== null && p.heatIndex?.value !== undefined ? cToF(p.heatIndex.value) : null;
      const officialWindChill = p.windChill?.value !== null && p.windChill?.value !== undefined ? cToF(p.windChill.value) : null;

      const hi = officialHeatIndex !== null ? officialHeatIndex : heatIndexF(tempF, humidity);
      const wc = officialWindChill !== null ? officialWindChill : windChillF(tempF, windMph);

      const showHeatIndex = hi !== null && hi >= 80;
      const showWindChill = wc !== null && wc <= 50;

      let displayValue = tempF;
      let displayLabel = `${Math.round(tempF)}°`;
      let classMode = "temp";
      let tooltipLabel = "Temp";

      if (tempDisplayMode === "heat" && showHeatIndex) {
        displayValue = hi;
        displayLabel = `${Math.round(hi)}°`;
        classMode = "heat";
        tooltipLabel = "Heat Index";
      }

      if (tempDisplayMode === "windchill" && showWindChill) {
        displayValue = wc;
        displayLabel = `${Math.round(wc)}°`;
        classMode = "windchill";
        tooltipLabel = "Wind Chill";
      }

      const stationId = station.properties?.stationIdentifier || station.id.split("/").pop();
      const calculated = { tempF, heatIndex: hi, windChill: wc, showHeatIndex, showWindChill };
      const panelHtml = buildStationPanel(station, obs, calculated);

      const icon = L.divIcon({
        className: "temp-div-icon",
        html: `<div class="temp-badge ${tempClassForValue(displayValue, classMode)}">${displayLabel}</div>`,
        iconSize: [44, 28],
        iconAnchor: [22, 14]
      });

      L.marker([coords[1], coords[0]], { icon })
        .bindTooltip(`${stationId}: ${tooltipLabel} ${Math.round(displayValue)}°F`, { sticky: true })
        .on("click", () => updatePanel(`Station: ${sanitizeForPanel(stationId)}`, panelHtml))
        .addTo(tempLayer);

      plotted++;
    });

    setCheck("tempCheck", true);
    setCheck("tempModeTempCheck", tempDisplayMode === "temp");
    setCheck("tempModeHeatCheck", tempDisplayMode === "heat");
    setCheck("tempModeWindCheck", tempDisplayMode === "windchill");
    updateLegend("temp");

    const modeText = tempDisplayMode === "heat" ? "Heat index display is selected. Stations without applicable heat index still show air temperature." : tempDisplayMode === "windchill" ? "Wind chill display is selected. Stations without applicable wind chill still show air temperature." : "Air temperature display is selected.";

    updatePanel("Temperatures", `Current station markers loaded.<br>Stations plotted: ${plotted}<br>${modeText}<br>Click a station for all available observation data.`);
  } catch (error) {
    if (tempLayer) map.removeLayer(tempLayer);
    tempLayer = null;
    if (subBox) subBox.classList.add("hidden");
    setCheck("tempCheck", false);
    updatePanel("Temperatures", "Could not load temperature stations.");
    console.error(error);
  }
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
  const windWasOn = !!windLayer;
  const rainfallWasOn = !!rainfallLayer;
  const airQualityWasOn = !!airQualityLayer;
  const surfaceWasOn = !!surfaceLayer;
  const previousTempMode = tempDisplayMode;

  if (radarWasOn) toggleRadar();
  if (pastRadarWasOn) turnOffPastRadar(false);
  if (alertsWasOn) toggleAlerts();
  if (qpfWasOn) toggleQpf();
  if (spcWasOn) toggleSpc();
  if (wpcWasOn) toggleWpc();
  if (countyWasOn) toggleCountyLines();
  if (hrrrWasOn) toggleHrrr();
  if (tempWasOn) toggleTemperatures();
  if (windWasOn) toggleWindLayer();
  if (rainfallWasOn) toggleRainfall72();
  if (airQualityWasOn) toggleAirQuality();
  if (surfaceWasOn) toggleSurfaceMap();

  setTimeout(() => {
    tempDisplayMode = previousTempMode;
    if (radarWasOn) toggleRadar();
    if (pastRadarWasOn) togglePastRadar();
    if (alertsWasOn) toggleAlerts();
    if (qpfWasOn) toggleQpf();
    if (spcWasOn) toggleSpc();
    if (wpcWasOn) toggleWpc();
    if (countyWasOn) toggleCountyLines();
    if (hrrrWasOn) toggleHrrr();
    if (tempWasOn) toggleTemperatures();
    if (windWasOn) toggleWindLayer();
    if (rainfallWasOn) toggleRainfall72();
    if (airQualityWasOn) toggleAirQuality();
    if (surfaceWasOn) toggleSurfaceMap();
  }, 500);

  updatePanel("Refresh", `Refreshing active layers...<br>${new Date().toLocaleTimeString()}`);
}

renderLegends();

/* ===== RBRTW FINAL MAP KEY SCREENSHOT BEHAVIOR FIX =====
   Live map: most active layers may show map keys.
   Saved PNG: only Radar, QPF, Rainfall QPE, Temperature, Air Quality, SPC, WPC, and Surface keys are allowed.
*/
const liveMapKeyTypesFinal = new Set([
  "radar",
  "pastRadar",
  "hrrr",
  "qpf",
  "spc",
  "wpc",
  "alerts",
  "temp",
  "wind",
  "rainfall",
  "airQuality",
  "surface"
]);

const screenshotMapKeyTypesFinal = new Set([
  "radar",
  "pastRadar",
  "qpf",
  "rainfall",
  "temp",
  "airQuality",
  "spc",
  "wpc",
  "surface"
]);

function shouldShowMapKeyTypeFinal(type) {
  if (document.body.classList.contains("capture-mode")) {
    return screenshotMapKeyTypesFinal.has(type);
  }
  return liveMapKeyTypesFinal.has(type);
}

function renderLegends() {
  const box = document.getElementById("legendContent");
  if (!box) return;

  if (document.body.classList.contains("capture-hide-key")) {
    box.innerHTML = "";
    return;
  }

  const visibleTypes = [...activeLegendTypes].filter(type => shouldShowMapKeyTypeFinal(type));

  if (!visibleTypes.length) {
    box.innerHTML = document.body.classList.contains("capture-mode")
      ? ""
      : "No map key needed for active layers.";
    return;
  }

  const titleMap = {
    radar: "Radar",
    pastRadar: "Past Radar",
    hrrr: "HRRR Future Radar",
    qpf: "QPF Forecast",
    spc: "SPC Outlook",
    wpc: "WPC Outlook",
    alerts: "NWS Alerts",
    temp: tempDisplayMode === "heat" ? "Heat Index" : tempDisplayMode === "windchill" ? "Wind Chill" : "Temperature",
    wind: "Wind",
    rainfall: "Rainfall QPE",
    airQuality: "Air Quality",
    surface: "Surface Map"
  };

  box.innerHTML = visibleTypes.map(type => `
    <div class="legend-section" data-key-type="${sanitizeForPanel(type)}">
      <div class="legend-section-title">${titleMap[type] || type}</div>
      ${legendHtml(type)}
    </div>
  `).join("");
}

function updateLegend(type) {
  // County lines intentionally do not need a map key.
  if (type === "county") {
    activeLegendTypes.delete(type);
    renderLegends();
    return;
  }

  // Regular radar and past radar should not duplicate each other.
  if (type === "pastRadar") activeLegendTypes.delete("radar");
  if (type === "radar") activeLegendTypes.delete("pastRadar");

  if (liveMapKeyTypesFinal.has(type) || screenshotMapKeyTypesFinal.has(type)) {
    activeLegendTypes.add(type);
  }

  renderLegends();
}

function clearLegend(type) {
  activeLegendTypes.delete(type);
  renderLegends();
}

async function saveMapPhoto() {
  const btn = document.getElementById("savePhotoBtn");
  const legendBody = document.getElementById("legendBody");
  const includeKey = document.getElementById("photoIncludeKeyCheck")?.checked !== false;
  const includeData = document.getElementById("photoIncludeDataCheck")?.checked === true;

  try {
    if (btn) btn.textContent = "Saving...";
    if (legendBody) legendBody.classList.remove("collapsed");

    document.body.classList.add("capture-mode");
    document.body.classList.toggle("capture-hide-key", !includeKey);
    document.body.classList.toggle("capture-include-data", includeData);

    // Re-render the map key after entering capture mode so only screenshot-approved keys appear.
    renderLegends();

    await new Promise(resolve => setTimeout(resolve, 500));

    if (typeof html2canvas !== "function") throw new Error("html2canvas did not load");

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      scale: 2,
      logging: false
    });

    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `RBRTW-weather-map-${timestamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    updatePanel("Save as Photo", "Map photo saved. Screenshot map keys were filtered to the approved PNG key set.");
  } catch (error) {
    console.error(error);
    updatePanel("Save as Photo", "Could not save the map image. Some external map tiles may block browser screenshot export.");
  } finally {
    document.body.classList.remove("capture-mode", "capture-hide-key", "capture-include-data");
    renderLegends();
    if (btn) btn.textContent = "Save as Photo";
  }
}

renderLegends();
