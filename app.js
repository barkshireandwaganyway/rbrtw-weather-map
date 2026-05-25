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

function mapExtentParam() {
  const b = map.getBounds();
  const sw = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne = L.CRS.EPSG3857.project(b.getNorthEast());
  return `${sw.x},${sw.y},${ne.x},${ne.y}`;
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

function toggleAlerts() {
  if (alertLayer) {
    map.removeLayer(alertLayer);
    alertLayer = null;
    setCheck("alertsCheck", false);
    clearLegend("alerts");
    updatePanel("NWS Alerts / Statements", "Alert and statement layer turned off.");
    return;
  }

  fetch("https://api.weather.gov/alerts/active?area=TX")
    .then(response => {
      if (!response.ok) throw new Error("Alerts request failed");
      return response.json();
    })
    .then(data => {
      const polygonFeatures = (data.features || []).filter(feature => !!feature.geometry);

      alertLayer = L.geoJSON({ type: "FeatureCollection", features: polygonFeatures }, {
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
          bindHazardFeature(layer, "NWS Alert / Statement", feature);
        }
      }).addTo(map);

      setCheck("alertsCheck", true);
      updateLegend("alerts");

      const alertList = polygonFeatures.slice(0, 18).map(feature => {
        const p = feature.properties || {};
        return `<div style="margin-bottom:10px;"><strong>${sanitizeForPanel(p.event || "NWS product")}</strong><br><small>${sanitizeForPanel(p.areaDesc || "")}</small></div>`;
      }).join("");

      updatePanel("Active NWS Alerts / Statements", `${alertList || "No active Texas polygon alerts/statements returned."}<br><br>Polygon products loaded: ${polygonFeatures.length}<br>Updated: ${new Date().toLocaleTimeString()}`);
    })
    .catch(error => {
      setCheck("alertsCheck", false);
      updatePanel("NWS Alerts / Statements", "Could not load alerts/statements.");
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

renderLegends();


/* ===== RBRTW FINAL CORRECT DATA MAP KEYS =====
   Live map keys: most active layers get a compact key.
   PNG/screenshot keys: limited to Radar, QPF, Rainfall QPE, Temperature, Air Quality, SPC, WPC, and Surface Map.
*/
function keyRow(color, label, value) {
  return `<div class="mapkey-row"><span class="mapkey-swatch" style="background:${color}"></span><span class="mapkey-label">${label}</span><span class="mapkey-value">${value || ""}</span></div>`;
}

function keyLine(color, label, value) {
  return `<div class="mapkey-row"><span class="mapkey-line" style="border-color:${color}"></span><span class="mapkey-label">${label}</span><span class="mapkey-value">${value || ""}</span></div>`;
}

function keyNote(text) {
  return `<div class="mapkey-note">${sanitizeForPanel(text)}</div>`;
}

function radarKeyHtml(sourceName) {
  return `
    ${keyRow("#44ff44", "Light", "5–20 dBZ")}
    ${keyRow("#ffff44", "Moderate", "20–35 dBZ")}
    ${keyRow("#ff5500", "Heavy", "35–50 dBZ")}
    ${keyRow("#ff0000", "Strong", "50–65 dBZ")}
    ${keyRow("#ff00ff", "Extreme / hail core", "65+ dBZ")}
    ${keyNote(sourceName)}
  `;
}

function qpfKeyHtml() {
  return `
    ${keyRow("#d8f3dc", "Very light", "0.01–0.10 in")}
    ${keyRow("#95d5b2", "Light", "0.10–0.25 in")}
    ${keyRow("#52b788", "Moderate", "0.25–1.00 in")}
    ${keyRow("#2d6a4f", "Heavy", "1.00–2.00 in")}
    ${keyRow("#7209b7", "Very heavy", "2.00+ in")}
    ${keyNote("WPC forecast liquid precipitation total. Tap/click leaves an inches point value.")}
  `;
}

function rainfallKeyHtml() {
  return `
    ${keyRow("#e8f7ff", "Trace", "0.01–0.10 in")}
    ${keyRow("#79c8ff", "Light", "0.10–0.50 in")}
    ${keyRow("#0b72ff", "Moderate", "0.50–1.00 in")}
    ${keyRow("#22c55e", "Heavy", "1.00–2.00 in")}
    ${keyRow("#facc15", "Very heavy", "2.00–4.00 in")}
    ${keyRow("#ef4444", "Extreme", "4.00+ in")}
    ${keyNote("MRMS QPE estimated observed accumulation, not rainfall rate.")}
  `;
}

function spcKeyHtml() {
  return `
    ${keyRow("#c1e9c1", "General Thunder", "Non-severe storms")}
    ${keyRow("#66a366", "Marginal", "Level 1 of 5")}
    ${keyRow("#ffe066", "Slight", "Level 2 of 5")}
    ${keyRow("#ffa366", "Enhanced", "Level 3 of 5")}
    ${keyRow("#e06666", "Moderate", "Level 4 of 5")}
    ${keyRow("#ee99ee", "High", "Level 5 of 5")}
    ${keyNote("SPC categorical severe-weather outlook. Polygon borders match risk color.")}
  `;
}

function wpcKeyHtml() {
  return `
    ${keyRow("#66a366", "Marginal", "At least 5% flash-flood risk")}
    ${keyRow("#ffe066", "Slight", "At least 15% flash-flood risk")}
    ${keyRow("#e06666", "Moderate", "At least 40% flash-flood risk")}
    ${keyRow("#ee99ee", "High", "At least 70% flash-flood risk")}
    ${keyNote("WPC Excessive Rainfall Outlook. Polygon borders match risk color.")}
  `;
}

function alertKeyHtml() {
  return `
    ${keyRow("#c026d3", "Tornado", "Warning/watch")}
    ${keyRow("#facc15", "Severe Thunderstorm", "Warning/watch")}
    ${keyRow("#16a34a", "Flash Flood", "Warning/watch")}
    ${keyRow("#15803d", "Flood", "Warning/watch/advisory")}
    ${keyRow("#ea580c", "Heat", "Watch/warning/advisory")}
    ${keyRow("#60a5fa", "Winter / Cold", "Warning/advisory")}
    ${keyRow("#dc2626", "Other Alert", "Active hazard")}
    ${keyNote("NWS active alert polygons use hazard-family colors.")}
  `;
}

function windKeyHtml() {
  return `
    ${keyLine("#8fd3ff", "Wind barb", "Arrow points downwind")}
    ${keyRow("#ffffff", "Number", "Wind speed mph")}
    ${keyNote("Station wind direction is converted from wind-from to wind-moving-toward.")}
  `;
}

function tempLegendHtml() {
  if (tempDisplayMode === "heat") {
    return `
      ${keyRow("#facc15", "Caution", "80–89°F")}
      ${keyRow("#f97316", "Extreme Caution", "90–102°F")}
      ${keyRow("#dc2626", "Danger", "103–124°F")}
      ${keyRow("#7f1d1d", "Extreme Danger", "125°F+")}
      ${keyNote("Heat index markers only replace temperature where heat index is applicable.")}
    `;
  }

  if (tempDisplayMode === "windchill") {
    return `
      ${keyRow("#2b1a78", "Extreme cold", "Below 0°F")}
      ${keyRow("#4338ca", "Very cold", "0–14°F")}
      ${keyRow("#2563eb", "Cold", "15–31°F")}
      ${keyRow("#38bdf8", "Chilly", "32–50°F")}
      ${keyNote("Wind chill markers only replace temperature where wind chill is applicable.")}
    `;
  }

  return `
    ${keyRow("#4f8cff", "Cold", "Below 50°F")}
    ${keyRow("#66d9ff", "Cool", "50–69°F")}
    ${keyRow("#7bd88f", "Mild", "70–89°F")}
    ${keyRow("#f5c542", "Warm", "90–99°F")}
    ${keyRow("#ff3b3b", "Hot", "100°F+")}
    ${keyNote("Station air temperature from latest NWS observation.")}
  `;
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
    box.innerHTML = document.body.classList.contains("capture-mode") ? "" : "No map key needed for active layers.";
    return;
  }

  const titleMap = {
    radar: "Radar Reflectivity",
    pastRadar: "Past Radar",
    hrrr: "HRRR Future Radar",
    qpf: "WPC QPF Forecast",
    spc: "SPC Outlook",
    wpc: "WPC Excessive Rainfall",
    alerts: "NWS Alerts",
    temp: tempDisplayMode === "heat" ? "Heat Index" : tempDisplayMode === "windchill" ? "Wind Chill" : "Temperature",
    wind: "Wind Barbs",
    rainfall: "Rainfall Totals / QPE",
    airQuality: "Air Quality",
    surface: "Surface Map"
  };

  box.innerHTML = visibleTypes.map(type => `
    <div class="legend-section" data-key-type="${sanitizeForPanel(type)}">
      <div class="legend-section-title">${titleMap[type] || sanitizeForPanel(type)}</div>
      ${legendHtml(type)}
    </div>
  `).join("");
}

function updateLegend(type) {
  if (type === "county") {
    activeLegendTypes.delete(type);
    renderLegends();
    return;
  }
  if (type === "pastRadar") activeLegendTypes.delete("radar");
  if (type === "radar") activeLegendTypes.delete("pastRadar");
  if (liveMapKeyTypesFinal.has(type) || screenshotMapKeyTypesFinal.has(type)) activeLegendTypes.add(type);
  renderLegends();
}

function clearLegend(type) {
  activeLegendTypes.delete(type);
  renderLegends();
}

renderLegends();


/* ===== RBRTW FINAL FIX: AIR QUALITY TOUCH DATA + QPF ALL-LAYER PROBE + SURFACE KEY + QPE RAW INCHES ===== */

var airQualityProbeHandler = null;
var airQualityHoverMarker = null;
var radarProbeHandler = null;
var radarHoverMarker = null;

function extractRawRasterValue(obj) {
  if (!obj) return null;
  if (Array.isArray(obj.samples) && obj.samples.length) {
    for (const sample of obj.samples) {
      const v = sample.value ?? sample.Value ?? sample.pixelValue ?? sample.PixelValue ?? sample.attributes?.value ?? sample.attributes?.Value;
      const n = asNumberFromUnknown(v);
      if (n !== null) return n;
    }
  }
  const direct = obj.value ?? obj.Value ?? obj.pixelValue ?? obj.PixelValue ?? obj.properties?.value ?? obj.catalogItems?.features?.[0]?.attributes?.value;
  const n = asNumberFromUnknown(direct);
  if (n !== null) return n;
  return extractLikelyPrecipValue(obj);
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
    pixelSize: "1000,1000",
    mapExtent: mapExtentParam(),
    imageDisplay: `${size.x},${size.y},96`,
    renderingRule: JSON.stringify(rainfallRenderingRule())
  });

  const response = await fetch(`${rainfallServiceUrl}/identify?${params.toString()}`);
  if (!response.ok) throw new Error("Rainfall identify failed");
  const data = await response.json();
  const raw = extractRawRasterValue(data);
  const inches = normalizePrecipInchesRaw(raw);
  return { inches, raw, source: "identify" };
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
    sampleDistance: "1000",
    outFields: "*",
    renderingRule: JSON.stringify(rainfallRenderingRule())
  });

  try {
    const sampleResponse = await fetch(`${rainfallServiceUrl}/getSamples?${getSamplesParams.toString()}`);
    if (sampleResponse.ok) {
      const sampleData = await sampleResponse.json();
      const raw = extractRawRasterValue(sampleData);
      const inches = normalizePrecipInchesRaw(raw);
      if (inches !== null) return { inches, raw, source: "getSamples" };
    }
  } catch (error) {
    console.warn("Rainfall getSamples failed; falling back to identify", error);
  }

  return await identifyRainfallAt(latlng);
}

const qpfProbeLayerOrder = [9, 8, 1, 2, 3, 10, 11, 7, 4, 5];
const qpfLayerNamesFinal = {
  1: "QPF 24 Hour Day 1",
  2: "QPF 24 Hour Day 2",
  3: "QPF 24 Hour Day 3",
  4: "QPF 48 Hour Day 4-5",
  5: "QPF 48 Hour Day 6-7",
  7: "QPF 6 Hours Day 1",
  8: "QPF 48 Hour Day 1-2",
  9: "QPF 72 Hour Day 1-3",
  10: "QPF 120 Hour Day 1-5",
  11: "QPF 168 Hour Day 1-7"
};

function extractQpfResultValue(result) {
  if (!result) return null;
  const attrs = result.attributes || result.properties || {};
  const keys = ["qpf", "QPF", "qpf_in", "QPF_IN", "INCHES", "inches", "AMOUNT", "amount", "VALUE", "value", "gridcode", "GRIDCODE", "label", "LABEL", "Contour", "contour"];
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null) {
      const n = asNumberFromUnknown(attrs[key]);
      if (n !== null) return n;
    }
  }
  return asNumberFromUnknown(result.value);
}

async function identifyQpfLayerAt(latlng, layerId) {
  const params = new URLSearchParams({
    f: "json",
    geometry: `${latlng.lng},${latlng.lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `visible:${layerId}`,
    tolerance: "8",
    mapExtent: qpfMapExtentParam4326(),
    imageDisplay: qpfImageDisplayParam(),
    returnGeometry: "false"
  });

  const url = `https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/identify?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`QPF identify failed for layer ${layerId}`);
  const data = await response.json();
  const results = data.results || [];
  const values = results.map(result => ({
    layerId,
    layerName: result.layerName || qpfLayerNamesFinal[layerId] || `QPF Layer ${layerId}`,
    value: extractQpfResultValue(result),
    attributes: result.attributes || result.properties || {}
  })).filter(item => item.value !== null && Number.isFinite(Number(item.value)) && Number(item.value) >= 0);
  return values;
}

async function identifyQpfAt(latlng) {
  const all = [];
  for (const layerId of qpfProbeLayerOrder) {
    try {
      const values = await identifyQpfLayerAt(latlng, layerId);
      all.push(...values);
    } catch (error) {
      console.warn("QPF probe layer failed", layerId, error);
    }
  }

  if (!all.length) return { value: null, layerName: "No QPF polygon at selected point", checkedLayers: qpfProbeLayerOrder.length };

  // Prefer the active displayed cumulative Day 1-3 layer when it returns a value;
  // otherwise show the highest value found among WPC QPF layers at that point.
  const preferred = all.find(item => item.layerId === 9) || all.sort((a, b) => Number(b.value) - Number(a.value))[0];
  return { value: Number(preferred.value), layerName: preferred.layerName, checkedLayers: qpfProbeLayerOrder.length, matches: all };
}

function pm25CategoryFromValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { label: "No data", range: "", color: "#ffffff" };
  if (n <= 12.0) return { label: "Good", range: "PM2.5 0.0–12.0 µg/m³", color: "#00e400" };
  if (n <= 35.4) return { label: "Moderate", range: "PM2.5 12.1–35.4 µg/m³", color: "#ffff00" };
  if (n <= 55.4) return { label: "Unhealthy for Sensitive Groups", range: "PM2.5 35.5–55.4 µg/m³", color: "#ff7e00" };
  if (n <= 150.4) return { label: "Unhealthy", range: "PM2.5 55.5–150.4 µg/m³", color: "#ff0000" };
  if (n <= 250.4) return { label: "Very Unhealthy", range: "PM2.5 150.5–250.4 µg/m³", color: "#8f3f97" };
  return { label: "Hazardous", range: "PM2.5 250.5+ µg/m³", color: "#7e0023" };
}

async function identifyAirQualityAt(latlng) {
  const point = L.CRS.EPSG3857.project(latlng);
  const size = map.getSize();
  const b = map.getBounds();
  const sw = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne = L.CRS.EPSG3857.project(b.getNorthEast());
  const params = new URLSearchParams({
    f: "json",
    geometry: `${point.x},${point.y}`,
    geometryType: "esriGeometryPoint",
    sr: "102100",
    returnGeometry: "false",
    returnCatalogItems: "false",
    pixelSize: "10000,10000",
    mapExtent: `${sw.x},${sw.y},${ne.x},${ne.y}`,
    imageDisplay: `${size.x},${size.y},96`
  });
  const response = await fetch(`https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_mpm25_hr01/ImageServer/identify?${params.toString()}`);
  if (!response.ok) throw new Error("Air quality identify failed");
  const data = await response.json();
  const raw = extractRawRasterValue(data);
  const value = raw === null ? null : Number(raw);
  return { value, category: pm25CategoryFromValue(value), raw };
}

function toggleAirQuality() {
  if (airQualityLayer) {
    map.removeLayer(airQualityLayer);
    airQualityLayer = null;
    detachAirQualityProbe();
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

  attachAirQualityProbe();
  setCheck("airQualityCheck", true);
  updateLegend("airQuality");
  updatePanel("Air Quality", "Air quality PM2.5 guidance layer turned on.<br>Tap/click or hover the map to show PM2.5 value and category wording.");
}

function showRadarProbeMarker(latlng, text, category) {
  if (radarHoverMarker) map.removeLayer(radarHoverMarker);
  radarHoverMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: "radar-probe-icon",
      html: `<div class="radar-dot" style="background:${category?.color || "#44ff44"}">R</div><div class="radar-value">${sanitizeForPanel(text)}</div>`,
      iconSize: [92, 48],
      iconAnchor: [46, 24]
    }),
    interactive: false
  }).addTo(map);
}

function toggleRadar() {
  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
    detachRadarProbe();
    setCheck("radarCheck", false);
    clearLegend("radar");
    updatePanel("Radar", "NOAA/NWS MRMS radar layer turned off.");
    return;
  }

  if (pastRadarLayer || radarFrames.length) turnOffPastRadar(false);

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

  attachRadarProbe();
  setCheck("radarCheck", true);
  setCheck("pastRadarCheck", false);
  updateLegend("radar");
  updatePanel("Radar", `NOAA/NWS MRMS radar layer on.<br>Tap/click or hover active radar returns for dBZ feedback when the source returns a value.<br>Updated: ${new Date().toLocaleTimeString()}`);
}

function airQualityKeyHtml() {
  return `
    ${keyRow("#00e400", "Good", "PM2.5 0.0–12.0")}
    ${keyRow("#ffff00", "Moderate", "12.1–35.4")}
    ${keyRow("#ff7e00", "Unhealthy for Sensitive Groups", "35.5–55.4")}
    ${keyRow("#ff0000", "Unhealthy", "55.5–150.4")}
    ${keyRow("#8f3f97", "Very Unhealthy", "150.5–250.4")}
    ${keyRow("#7e0023", "Hazardous", "250.5+")}
    ${keyNote("Values are PM2.5 µg/m³. Click/touch data uses the same wording as this key.")}
  `;
}

function surfaceKeyHtml() {
  return `
    ${keyRow("#ffffff", "Day 1/2/3 Highs and Lows", "Pressure centers")}
    ${keyLine("#1683ff", "Day 1/2/3 Fronts", "Cold / front lines")}
    ${keyLine("#ff3434", "Warm front", "Front type")}
    ${keyLine("#7c3aed", "Stationary / occluded front", "Front type")}
    ${keyLine("#8b5a2b", "Trough / dryline", "Boundary")}
    ${keyRow("#7dd3fc", "Rain/Thunderstorms", "WPC layer")}
    ${keyRow("#9ca3af", "Rain", "WPC layer")}
    ${keyRow("#d8b4fe", "Mixed Precipitation", "WPC layer")}
    ${keyRow("#dbeafe", "Snow", "WPC layer")}
    ${keyRow("#ef4444", "Severe Thunderstorms Possible", "Hatchet/outlined risk area")}
    ${keyRow("#22c55e", "Heavy Rain/Flash Flooding Possible", "Hatchet/outlined risk area")}
    ${keyRow("#f97316", "Critical Fire Weather Possible", "Hatchet/outlined risk area")}
    ${keyRow("#93c5fd", "Freezing Rain Possible", "Hatchet/outlined risk area")}
    ${keyRow("#e0f2fe", "Heavy Snow Possible", "Hatchet/outlined risk area")}
    ${keyNote("Matches the WPC National Forecast Chart service layer names for the selected Day 1, Day 2, or Day 3 group.")}
  `;
}

function legendHtml(type) {
  if (type === "radar") return radarKeyHtml("NOAA/NWS MRMS radar reflectivity. Click/touch may return dBZ feedback.");
  if (type === "pastRadar") return radarKeyHtml("RainViewer past radar playback; lower resolution than live MRMS.");
  if (type === "hrrr") return radarKeyHtml("HRRR simulated reflectivity forecast.");
  if (type === "qpf") return qpfKeyHtml();
  if (type === "spc") return spcKeyHtml();
  if (type === "wpc") return wpcKeyHtml();
  if (type === "alerts") return alertKeyHtml();
  if (type === "temp") return tempLegendHtml();
  if (type === "wind") return windKeyHtml();
  if (type === "rainfall") return rainfallKeyHtml();
  if (type === "airQuality") return airQualityKeyHtml();
  if (type === "surface") return surfaceKeyHtml();
  return "";
}

renderLegends();


/* ===== RBRTW FINAL OVERRIDE: QPE NORMALIZATION + AQI TEXT MARKER =====
   Fixes:
   - Air Quality marker label now shows category text (Good/Moderate/etc.), not just the number.
   - MRMS QPE point sample auto-normalizes suspicious 48/72 hour raw samples that are returned as mm-like values.
   - Probe cleanup is run before toggling probe-based layers so old clicks do not keep firing.
*/
function cleanupAllPointProbesExcept(exceptType = "") {
  if (exceptType !== "airQuality" && typeof detachAirQualityProbe === "function") detachAirQualityProbe();
  if (exceptType !== "radar" && typeof detachRadarProbe === "function") detachRadarProbe();
  if (exceptType !== "qpf" && typeof detachQpfProbe === "function") detachQpfProbe(false);
  if (exceptType !== "rainfall" && typeof detachRainfallProbe === "function") detachRainfallProbe(false);
}

function showAirQualityMarker(latlng, valueText, category) {
  if (airQualityHoverMarker) map.removeLayer(airQualityHoverMarker);
  const label = category?.label && category.label !== "No data" ? category.label : "No data";
  airQualityHoverMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: "airq-probe-icon",
      html: `<div class="airq-dot" style="background:${category?.color || "#ffffff"}">AQ</div><div class="airq-value">${sanitizeForPanel(label)}</div>`,
      iconSize: [138, 48],
      iconAnchor: [69, 24]
    }),
    interactive: false
  }).addTo(map);
}

const previousToggleAirQualityFinal = toggleAirQuality;
toggleAirQuality = function() {
  if (!airQualityLayer) cleanupAllPointProbesExcept("airQuality");
  previousToggleAirQualityFinal();
};

const previousToggleRainfallFinal = toggleRainfall72;
toggleRainfall72 = function() {
  if (!rainfallLayer) cleanupAllPointProbesExcept("rainfall");
  previousToggleRainfallFinal();
};

const previousToggleQpfFinal = toggleQpf;
toggleQpf = function() {
  if (!qpfLayer) cleanupAllPointProbesExcept("qpf");
  previousToggleQpfFinal();
};

const previousToggleRadarFinal = toggleRadar;
toggleRadar = function() {
  if (!radarLayer) cleanupAllPointProbesExcept("radar");
  previousToggleRadarFinal();
};

/* ===== RBRTW EMERGENCY STABILIZER: CLICK/TAP ONLY + DATA-CARD GATES + SATELLITE LABELS =====
   - No layer uses hover/mousemove for target data anymore.
   - One shared map click dispatcher chooses ONE enabled data-card source at a time.
   - Per-layer data-card checkboxes control whether a layer is allowed to write to the DATA card.
   - Radar data is OFF by default so alerts/SPC/WPC/etc. are not overwritten by weak radar point feedback.
   - Satellite basemap now includes roads/transportation and place labels.
*/

// Replace satellite basemap with imagery + roads/cities/reference labels.
basemaps.satellite = L.layerGroup([
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles © Esri"
  }),
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Roads © Esri"
  }),
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Labels © Esri"
  })
]);

const dataCardToggleIdsFinal = {
  radar: "dataRadarCheck",
  pastRadar: "dataPastRadarCheck",
  alerts: "dataAlertsCheck",
  qpf: "dataQpfCheck",
  spc: "dataSpcCheck",
  wpc: "dataWpcCheck",
  hrrr: "dataHrrrCheck",
  county: "dataCountyCheck",
  temp: "dataTempCheck",
  wind: "dataWindCheck",
  rainfall: "dataRainfallCheck",
  airQuality: "dataAirQualityCheck",
  surface: "dataSurfaceCheck"
};

let activeClickDataLayerFinal = "";
let pointProbeRunIdFinal = 0;

function dataCardEnabledFinal(type) {
  const id = dataCardToggleIdsFinal[type];
  const el = id ? document.getElementById(id) : null;
  if (!el) return true;
  return el.checked === true;
}

function setActiveClickDataLayerFinal(type) {
  activeClickDataLayerFinal = type || "";
}

function removeLayerSafeFinal(layer) {
  try {
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
  } catch (error) {}
}

function clearProbeMarkersFinal(keepType = "") {
  pointProbeRunIdFinal++;

  if (keepType !== "airQuality" && airQualityHoverMarker) {
    removeLayerSafeFinal(airQualityHoverMarker);
    airQualityHoverMarker = null;
  }
  if (keepType !== "radar" && radarHoverMarker) {
    removeLayerSafeFinal(radarHoverMarker);
    radarHoverMarker = null;
  }
  if (keepType !== "qpf") {
    if (qpfHoverMarker) removeLayerSafeFinal(qpfHoverMarker);
    qpfHoverMarker = null;
    if (qpfPermanentMarkers) qpfPermanentMarkers.clearLayers();
  }
  if (keepType !== "rainfall") {
    if (rainfallHoverMarker) removeLayerSafeFinal(rainfallHoverMarker);
    rainfallHoverMarker = null;
    if (rainfallMarker) removeLayerSafeFinal(rainfallMarker);
    rainfallMarker = null;
    if (rainfallPermanentMarkers) rainfallPermanentMarkers.clearLayers();
  }
}

function removeKnownMousemoveProbeHandlersFinal() {
  try { if (airQualityProbeHandler) map.off("mousemove", airQualityProbeHandler); } catch (error) {}
  try { if (radarProbeHandler) map.off("mousemove", radarProbeHandler); } catch (error) {}
  try { if (qpfProbeHandler) map.off("mousemove", qpfProbeHandler); } catch (error) {}
  try { if (rainfallProbeHandler) map.off("mousemove", rainfallProbeHandler); } catch (error) {}
}

// These attach functions intentionally do not add any mousemove behavior.
function attachAirQualityProbe() {
  detachAirQualityProbe();
  removeKnownMousemoveProbeHandlersFinal();
}
function attachRadarProbe() {
  detachRadarProbe();
  removeKnownMousemoveProbeHandlersFinal();
}
function attachQpfProbe() {
  detachQpfProbe(false);
  removeKnownMousemoveProbeHandlersFinal();
}
function attachRainfallProbe() {
  detachRainfallProbe(false);
  removeKnownMousemoveProbeHandlersFinal();
}

function detachAirQualityProbe() {
  if (airQualityProbeHandler) {
    try { map.off("click", airQualityProbeHandler); } catch (error) {}
    try { map.off("mousemove", airQualityProbeHandler); } catch (error) {}
    airQualityProbeHandler = null;
  }
  if (airQualityHoverMarker) {
    removeLayerSafeFinal(airQualityHoverMarker);
    airQualityHoverMarker = null;
  }
  pointProbeRunIdFinal++;
}
function detachRadarProbe() {
  if (radarProbeHandler) {
    try { map.off("click", radarProbeHandler); } catch (error) {}
    try { map.off("mousemove", radarProbeHandler); } catch (error) {}
    radarProbeHandler = null;
  }
  if (radarHoverMarker) {
    removeLayerSafeFinal(radarHoverMarker);
    radarHoverMarker = null;
  }
  pointProbeRunIdFinal++;
}
function detachQpfProbe(clearPermanent = true) {
  if (qpfProbeHandler) {
    try { map.off("click", qpfProbeHandler); } catch (error) {}
    try { map.off("mousemove", qpfProbeHandler); } catch (error) {}
    qpfProbeHandler = null;
  }
  if (qpfHoverMarker) {
    removeLayerSafeFinal(qpfHoverMarker);
    qpfHoverMarker = null;
  }
  if (clearPermanent && qpfPermanentMarkers) qpfPermanentMarkers.clearLayers();
  pointProbeRunIdFinal++;
}
function detachRainfallProbe(clearPermanent = true) {
  if (rainfallProbeHandler) {
    try { map.off("click", rainfallProbeHandler); } catch (error) {}
    try { map.off("mousemove", rainfallProbeHandler); } catch (error) {}
    rainfallProbeHandler = null;
  }
  if (rainfallHoverMarker) {
    removeLayerSafeFinal(rainfallHoverMarker);
    rainfallHoverMarker = null;
  }
  if (rainfallMarker) {
    removeLayerSafeFinal(rainfallMarker);
    rainfallMarker = null;
  }
  if (clearPermanent && rainfallPermanentMarkers) rainfallPermanentMarkers.clearLayers();
  pointProbeRunIdFinal++;
}

function targetLayerPriorityFinal() {
  const preferred = activeClickDataLayerFinal ? [activeClickDataLayerFinal] : [];
  const fallback = ["rainfall", "qpf", "airQuality", "radar"];
  return [...preferred, ...fallback.filter(type => !preferred.includes(type))];
}

async function runRainfallPointFinal(latlng, token) {
  if (!rainfallLayer || !dataCardEnabledFinal("rainfall")) return false;
  try {
    const result = await getRainfallSampleValue(latlng);
    if (token !== pointProbeRunIdFinal) return true;
    const raw = result?.raw ?? result?.inches ?? result;
    const inches = normalizePrecipInchesRaw(raw);
    const text = formatInches(inches);
    addRainfallPermanentMarker(latlng, text);
    const rawText = raw === null || raw === undefined ? "N/A" : sanitizeForPanel(raw);
    const normNote = Number(raw) > 8 ? `<br>Display was normalized so large raw samples do not show as unrealistic inch totals.` : "";
    updatePanel("Rainfall Total Point", `
      <strong>${rainfallLabel()}</strong><br><br>
      Estimated observed rainfall total at selected point: <strong>${text}</strong><br>
      Raw raster sample: ${rawText}${normNote}<br>
      Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
      Source: NOAA/NWS MRMS QPE Image Service<br>
      Note: MRMS QPE is radar-only estimated accumulation, not rainfall rate.
    `);
    return true;
  } catch (error) {
    if (token === pointProbeRunIdFinal) {
      addRainfallPermanentMarker(latlng, "No data");
      updatePanel("Rainfall Total Point", "No MRMS QPE value returned at the selected point.");
    }
    return true;
  }
}

async function runQpfPointFinal(latlng, token) {
  if (!qpfLayer || !dataCardEnabledFinal("qpf")) return false;
  try {
    const result = await identifyQpfAt(latlng);
    if (token !== pointProbeRunIdFinal) return true;
    const text = formatInches(result.value);
    addQpfPermanentMarker(latlng, text);
    const matchText = result.matches?.length
      ? `<br>Matched QPF layers at this point: ${result.matches.map(m => `${sanitizeForPanel(m.layerName)} ${formatInches(m.value)}`).join("; ")}`
      : "";
    updatePanel("QPF Forecast Point", `
      <strong>${sanitizeForPanel(result.layerName)}</strong><br><br>
      Forecast liquid precipitation at selected point: <strong>${text}</strong><br>
      Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
      Checked WPC QPF layers: Day 1, Day 2, Day 3, 48hr, 72hr, 120hr, 168hr, and 6hr Day 1.${matchText}<br>
      Source: WPC Quantitative Precipitation Forecast
    `);
    return true;
  } catch (error) {
    if (token === pointProbeRunIdFinal) {
      addQpfPermanentMarker(latlng, "No data");
      updatePanel("QPF Forecast Point", "No WPC QPF value returned at the selected point.");
    }
    return true;
  }
}

async function runAirQualityPointFinal(latlng, token) {
  if (!airQualityLayer || !dataCardEnabledFinal("airQuality")) return false;
  try {
    const result = await identifyAirQualityAt(latlng);
    if (token !== pointProbeRunIdFinal) return true;
    const valueText = result.value === null || Number.isNaN(result.value) ? "No data" : `${result.value.toFixed(1)} µg/m³`;
    showAirQualityMarker(latlng, valueText, result.category);
    updatePanel("Air Quality Point", `
      <strong>${sanitizeForPanel(result.category.label)}</strong><br><br>
      Category at selected point: <strong>${sanitizeForPanel(result.category.label)}</strong><br>
      PM2.5 guidance value: ${sanitizeForPanel(valueText)}<br>
      ${sanitizeForPanel(result.category.range)}<br>
      Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
      Source: NOAA/NWS Air Quality Guidance Image Service
    `);
    return true;
  } catch (error) {
    if (token === pointProbeRunIdFinal) {
      showAirQualityMarker(latlng, "No data", { label: "No data", color: "#ffffff" });
      updatePanel("Air Quality Point", "No PM2.5 value returned at the selected point.");
    }
    return true;
  }
}

if (!window.__RBRTW_CLICK_ONLY_DATA_DISPATCHER__) {
  window.__RBRTW_CLICK_ONLY_DATA_DISPATCHER__ = true;
  map.on("click", handleSharedMapDataClickFinal);
}

// Rebind hazard/polygon click behavior so alerts/SPC/WPC do not compete with raster point data.
function hazardDataTypeFromSourceFinal(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("nws")) return "alerts";
  if (s.includes("spc")) return "spc";
  if (s.includes("wpc")) return "wpc";
  return "alerts";
}

// Suppress station/feature updates when the layer's data-card checkbox is off.
const updatePanelCoreFinal = updatePanel;
updatePanel = function(title, html) {
  const t = String(title || "");
  if ((t.startsWith("Station:") || t.startsWith("Temperature:")) && !dataCardEnabledFinal("temp")) return;
  if (t.includes("Wind Observation") && !dataCardEnabledFinal("wind")) return;
  if (t.startsWith("SPC:") && !dataCardEnabledFinal("spc")) return;
  if (t.startsWith("WPC:") && !dataCardEnabledFinal("wpc")) return;
  if ((t.startsWith("NWS Alert") || t.startsWith("NWS Alert / Statement")) && !dataCardEnabledFinal("alerts")) return;
  if (t.startsWith("Radar Point") && !dataCardEnabledFinal("radar")) return;
  if (t.startsWith("QPF Forecast Point") && !dataCardEnabledFinal("qpf")) return;
  if (t.startsWith("Rainfall Total Point") && !dataCardEnabledFinal("rainfall")) return;
  if (t.startsWith("Air Quality Point") && !dataCardEnabledFinal("airQuality")) return;
  updatePanelCoreFinal(title, html);
};

// Wrap layer toggles to set which click/tap data source should win when multiple raster layers are on.
const toggleRadarClickOnlyFinal = toggleRadar;
toggleRadar = function() {
  const wasOn = !!radarLayer;
  if (!wasOn) clearProbeMarkersFinal("radar");
  toggleRadarClickOnlyFinal();
  if (radarLayer) setActiveClickDataLayerFinal("radar");
  else if (activeClickDataLayerFinal === "radar") setActiveClickDataLayerFinal("");
  removeKnownMousemoveProbeHandlersFinal();
};

const toggleQpfClickOnlyFinal = toggleQpf;
toggleQpf = function() {
  const wasOn = !!qpfLayer;
  if (!wasOn) clearProbeMarkersFinal("qpf");
  toggleQpfClickOnlyFinal();
  if (qpfLayer) setActiveClickDataLayerFinal("qpf");
  else if (activeClickDataLayerFinal === "qpf") setActiveClickDataLayerFinal("");
  removeKnownMousemoveProbeHandlersFinal();
};

const toggleRainfallClickOnlyFinal = toggleRainfall72;
toggleRainfall72 = function() {
  const wasOn = !!rainfallLayer;
  if (!wasOn) clearProbeMarkersFinal("rainfall");
  toggleRainfallClickOnlyFinal();
  if (rainfallLayer) setActiveClickDataLayerFinal("rainfall");
  else if (activeClickDataLayerFinal === "rainfall") setActiveClickDataLayerFinal("");
  removeKnownMousemoveProbeHandlersFinal();
};

const toggleAirQualityClickOnlyFinal = toggleAirQuality;
toggleAirQuality = function() {
  const wasOn = !!airQualityLayer;
  if (!wasOn) clearProbeMarkersFinal("airQuality");
  toggleAirQualityClickOnlyFinal();
  if (airQualityLayer) setActiveClickDataLayerFinal("airQuality");
  else if (activeClickDataLayerFinal === "airQuality") setActiveClickDataLayerFinal("");
  removeKnownMousemoveProbeHandlersFinal();
};

// Safer QPE normalizer: large raw samples from 48/72 hr are treated as mm-like values.
function normalizePrecipInchesRaw(rawValue) {
  const raw = asNumberFromUnknown(rawValue);
  if (raw === null || !Number.isFinite(raw) || raw < 0) return null;
  if ((rainfallPeriod === "48" || rainfallPeriod === "72") && raw > 8) return raw / 25.4;
  if (rainfallPeriod === "24" && raw > 12) return raw / 25.4;
  if (raw > 30) return null;
  return raw;
}

// Update wording on radar panel when toggled on by replacing the inherited hover wording.
const updateLegendAfterClickOnlyFinal = renderLegends;
renderLegends = function() {
  updateLegendAfterClickOnlyFinal();
};

removeKnownMousemoveProbeHandlersFinal();
renderLegends();


/* ===== RBRTW FINAL AUDIT LOCK: TRUE CLICK/TAP ONLY + CLEAN TOGGLE WORDING =====
   This block is intentionally last. It prevents target data-card probes from using
   hover/mousemove and cleans the user-facing layer-on messages so no layer says hover.
*/
(function enforceClickOnlyFinalAudit(){
  const blockedProbeEvents = new Set(["mousemove"]);
  const originalMapOn = map.on.bind(map);
  map.on = function(type, handler, context) {
    if (blockedProbeEvents.has(type) && (handler === airQualityProbeHandler || handler === radarProbeHandler || handler === qpfProbeHandler || handler === rainfallProbeHandler)) {
      return this;
    }
    return originalMapOn(type, handler, context);
  };

  function hardRemoveProbeMousemove() {
    try { if (airQualityProbeHandler) map.off("mousemove", airQualityProbeHandler); } catch (error) {}
    try { if (radarProbeHandler) map.off("mousemove", radarProbeHandler); } catch (error) {}
    try { if (qpfProbeHandler) map.off("mousemove", qpfProbeHandler); } catch (error) {}
    try { if (rainfallProbeHandler) map.off("mousemove", rainfallProbeHandler); } catch (error) {}
  }

  // Ensure attach functions never bind hover/mousemove. Shared dispatcher handles click/tap.
  attachAirQualityProbe = function() { detachAirQualityProbe(); hardRemoveProbeMousemove(); };
  attachRadarProbe = function() { detachRadarProbe(); hardRemoveProbeMousemove(); };
  attachQpfProbe = function() { detachQpfProbe(false); hardRemoveProbeMousemove(); };
  attachRainfallProbe = function() { detachRainfallProbe(false); hardRemoveProbeMousemove(); };

  const auditedToggleRadar = toggleRadar;
  toggleRadar = function() {
    const wasOn = !!radarLayer;
    auditedToggleRadar();
    hardRemoveProbeMousemove();
    if (!wasOn && radarLayer) {
      setActiveClickDataLayerFinal("radar");
      updatePanel("Radar", `NOAA/NWS MRMS radar layer is on.<br>Target data is click/tap only. Radar data-card feedback is off unless the Radar data-card checkbox is checked.`);
    }
  };

  const auditedToggleQpf = toggleQpf;
  toggleQpf = function() {
    const wasOn = !!qpfLayer;
    auditedToggleQpf();
    hardRemoveProbeMousemove();
    if (!wasOn && qpfLayer) {
      setActiveClickDataLayerFinal("qpf");
      updatePanel("Rainfall / QPF", `WPC QPF layer is on.<br>Target data is click/tap only. Click/tap inside a QPF area to write QPF data to the Data card when QPF data-card is enabled.`);
    }
  };

  const auditedToggleRainfall = toggleRainfall72;
  toggleRainfall72 = function() {
    const wasOn = !!rainfallLayer;
    auditedToggleRainfall();
    hardRemoveProbeMousemove();
    if (!wasOn && rainfallLayer) {
      setActiveClickDataLayerFinal("rainfall");
      updatePanel("Rainfall Totals / QPE", `${rainfallLabel()} MRMS QPE layer is on.<br>Target data is click/tap only. Click/tap inside a colored QPE area to write rainfall total data to the Data card when QPE data-card is enabled.`);
    }
  };

  const auditedToggleAirQuality = toggleAirQuality;
  toggleAirQuality = function() {
    const wasOn = !!airQualityLayer;
    auditedToggleAirQuality();
    hardRemoveProbeMousemove();
    if (!wasOn && airQualityLayer) {
      setActiveClickDataLayerFinal("airQuality");
      updatePanel("Air Quality", `Air Quality PM2.5 guidance layer is on.<br>Target data is click/tap only. Click/tap inside the shaded area to write the category and PM2.5 value to the Data card when Air Quality data-card is enabled.`);
    }
  };

  // Keep polygon hazard clicks from falling through to raster probes.
  const auditedBindHazardFeature = bindHazardFeature;
  bindHazardFeature = function(layer, source, feature, extra = {}) {
    auditedBindHazardFeature(layer, source, feature, extra);
    layer.on("click", e => {
      if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
    });
  };

  hardRemoveProbeMousemove();
})();


/* ===== RBRTW COUNTY LINES FINAL FIX =====
   This function was missing from the stacked patched file. It is intentionally last
   so the County Lines checkbox always has a real working handler.
*/
async function loadTexasCountyGeoJsonFinal() {
  const sources = [
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
  ];

  let lastError = null;
  for (const url of sources) {
    try {
      const response = await fetch(`${url}?cache=${Date.now()}`);
      if (!response.ok) throw new Error(`County source failed: ${response.status}`);
      const data = await response.json();
      const features = (data.features || []).filter(feature => {
        const id = String(feature.id || "");
        const fips = String(feature.properties?.GEO_ID || feature.properties?.COUNTYFP || feature.properties?.STATEFP || "");
        return id.startsWith("48") || fips.includes("US48") || feature.properties?.STATEFP === "48";
      });
      if (features.length) {
        return { type: "FeatureCollection", features };
      }
    } catch (error) {
      lastError = error;
      console.warn("County source failed", url, error);
    }
  }
  throw lastError || new Error("No Texas county features returned.");
}

function countyNameFinal(feature) {
  const p = feature?.properties || {};
  return p.NAME || p.name || p.NAMELSAD || p.COUNTY || p.COUNTY_NAME || "County";
}

function countyStyleFinal() {
  const opacity = Number(document.getElementById("countyOpacity")?.value || 0.35);
  return {
    color: "#111827",
    weight: 1.7,
    opacity,
    fillOpacity: 0,
    interactive: true
  };
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
    setCheck("countyCheck", true);
    updatePanel("County Lines", "Loading Texas county boundaries...");

    const texasCounties = await loadTexasCountyGeoJsonFinal();
    countyLayer = L.geoJSON(texasCounties, {
      style: countyStyleFinal,
      onEachFeature: function(feature, layer) {
        const name = countyNameFinal(feature);
        layer.bindTooltip(`${sanitizeForPanel(name)} County`, {
          sticky: true,
          direction: "top"
        });
        layer.on("click", e => {
          if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
          if (dataCardEnabledFinal && !dataCardEnabledFinal("county")) return;
          updatePanel("County Boundary", `${sanitizeForPanel(name)} County<br>Layer: Texas county boundary lines`);
        });
      }
    }).addTo(map);

    if (countyLayer.bringToFront) countyLayer.bringToFront();
    clearLegend("county");
    updatePanel("County Lines", `Texas county boundary layer turned on.<br>Counties loaded: ${texasCounties.features.length}<br>Opacity slider controls boundary visibility.`);
  } catch (error) {
    console.error(error);
    countyLayer = null;
    setCheck("countyCheck", false);
    updatePanel("County Lines", "Could not load Texas county lines. Check browser console/network access to the county GeoJSON source.");
  }
}

// Final opacity override so the County Lines slider works even after all prior setLayerOpacity patches.
const setLayerOpacityCountyFinal = setLayerOpacity;
setLayerOpacity = function(type) {
  if (type === "county" && countyLayer) {
    countyLayer.setStyle(countyStyleFinal());
    if (countyLayer.bringToFront) countyLayer.bringToFront();
    return;
  }
  setLayerOpacityCountyFinal(type);
};

// Keep county lines visible above satellite imagery/reference layers after changing basemaps.
const setBasemapCountyFinal = setBasemap;
setBasemap = function(type) {
  setBasemapCountyFinal(type);
  if (countyLayer && countyLayer.bringToFront) {
    setTimeout(() => countyLayer && countyLayer.bringToFront && countyLayer.bringToFront(), 150);
  }
};

// Make sure the checkbox starts from the real layer state after reload.
setCheck("countyCheck", !!countyLayer);


/* ===== RBRTW COMPREHENSIVE FEATURE AUDIT PATCH =====
   Added after full static review of the current project files.
   Fixes missing runtime functions, restores SPC/WPC/HRRR handlers, keeps all target
   data-card writes click/tap-only, adds surface/past-radar/HRRR click data behavior,
   and keeps county lines above satellite/reference layers.
*/

// Required unit helpers. They were referenced by station layers but were missing.
function cToF(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return (Number(value) * 9) / 5 + 32;
}

function mpsToMph(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) * 2.2369362921;
}

function safeSetCheckFinal(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function geoJsonAttrFinal(feature) {
  return feature?.properties || feature?.attributes || {};
}

function spcRiskColorFinal(feature) {
  const p = geoJsonAttrFinal(feature);
  const text = String(p.LABEL || p.label || p.CATEGORICAL || p.outlook || p.RISK || p.risk || p.dn || "").toLowerCase();
  const dn = Number(p.dn ?? p.DN ?? p.gridcode ?? p.GRIDCODE);
  if (text.includes("high") || dn === 8) return "#ee99ee";
  if (text.includes("moderate") || dn === 6) return "#e06666";
  if (text.includes("enhanced") || dn === 5) return "#ffa366";
  if (text.includes("slight") || dn === 4) return "#ffe066";
  if (text.includes("marginal") || dn === 3) return "#66a366";
  if (text.includes("thunder") || dn === 2) return "#c1e9c1";
  return "#c1e9c1";
}

function wpcRiskColorFinal(feature) {
  const p = geoJsonAttrFinal(feature);
  const text = String(p.LABEL || p.label || p.CATEGORY || p.category || p.RISK || p.risk || p.dn || "").toLowerCase();
  const dn = Number(p.dn ?? p.DN ?? p.gridcode ?? p.GRIDCODE);
  if (text.includes("high") || dn === 4) return "#ee99ee";
  if (text.includes("moderate") || dn === 3) return "#e06666";
  if (text.includes("slight") || dn === 2) return "#ffe066";
  if (text.includes("marginal") || dn === 1) return "#66a366";
  return "#66a366";
}

async function fetchArcGisGeoJsonFinal(url, layerId, params = {}) {
  const q = new URLSearchParams({
    f: "geojson",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    ...params
  });
  const response = await fetch(`${url}/${layerId}/query?${q.toString()}`);
  if (!response.ok) throw new Error(`ArcGIS query failed for layer ${layerId}`);
  return await response.json();
}

const spcOutlookServiceFinal = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer";

async function toggleSpc() {
  if (spcLayer) {
    map.removeLayer(spcLayer);
    spcLayer = null;
    safeSetCheckFinal("spcCheck", false);
    clearLegend("spc");
    updatePanel("SPC Outlook", "SPC outlook layer turned off.");
    return;
  }

  try {
    updatePanel("SPC Outlook", "Loading SPC outlook polygons...");
    const data = await fetchArcGisGeoJsonFinal(spcOutlookServiceFinal, 1);
    const features = (data.features || []).filter(f => f.geometry);
    spcLayer = L.geoJSON({ type: "FeatureCollection", features }, {
      style: feature => {
        const color = spcRiskColorFinal(feature);
        return {
          color,
          weight: 3,
          opacity: 0.95,
          fillColor: color,
          fillOpacity: Number(document.getElementById("spcOpacity")?.value || 0.35)
        };
      },
      onEachFeature: (feature, layer) => bindHazardFeature(layer, "SPC", feature)
    }).addTo(map);
    safeSetCheckFinal("spcCheck", true);
    updateLegend("spc");
    if (spcLayer.bringToFront) spcLayer.bringToFront();
    updatePanel("SPC Outlook", `SPC outlook layer turned on.<br>Polygons loaded: ${features.length}<br>Click/tap a polygon to write SPC details to the Data card when SPC data-card is enabled.`);
  } catch (error) {
    console.error(error);
    spcLayer = null;
    safeSetCheckFinal("spcCheck", false);
    updatePanel("SPC Outlook", "Could not load SPC outlook polygons.");
  }
}

const wpcOutlookServiceFinal = "https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer";
const wpcLayerIdsFinal = [0, 1, 2, 3, 4];

async function toggleWpc() {
  if (wpcLayer) {
    map.removeLayer(wpcLayer);
    wpcLayer = null;
    safeSetCheckFinal("wpcCheck", false);
    clearLegend("wpc");
    updatePanel("WPC Outlook", "WPC outlook layer turned off.");
    return;
  }

  try {
    updatePanel("WPC Outlook", "Loading WPC excessive-rainfall outlook polygons...");
    wpcLayer = L.layerGroup().addTo(map);
    let total = 0;
    for (const id of wpcLayerIdsFinal) {
      try {
        const data = await fetchArcGisGeoJsonFinal(wpcOutlookServiceFinal, id);
        const features = (data.features || []).filter(f => f.geometry);
        if (!features.length) continue;
        const layerGroup = L.geoJSON({ type: "FeatureCollection", features }, {
          style: feature => {
            const color = wpcRiskColorFinal(feature);
            return {
              color,
              weight: 3,
              opacity: 0.95,
              fillColor: color,
              fillOpacity: Number(document.getElementById("wpcOpacity")?.value || 0.6)
            };
          },
          onEachFeature: (feature, layer) => bindHazardFeature(layer, "WPC", feature, { layerName: `WPC layer ${id}` })
        });
        layerGroup.addTo(wpcLayer);
        total += features.length;
      } catch (layerError) {
        console.warn("WPC layer failed", id, layerError);
      }
    }
    safeSetCheckFinal("wpcCheck", true);
    updateLegend("wpc");
    if (wpcLayer.bringToFront) wpcLayer.bringToFront();
    updatePanel("WPC Outlook", `WPC excessive-rainfall outlook layer turned on.<br>Polygons loaded: ${total}<br>Click/tap a polygon to write WPC details to the Data card when WPC data-card is enabled.`);
  } catch (error) {
    console.error(error);
    if (wpcLayer) map.removeLayer(wpcLayer);
    wpcLayer = null;
    safeSetCheckFinal("wpcCheck", false);
    updatePanel("WPC Outlook", "Could not load WPC outlook polygons.");
  }
}

async function loadHrrrFramesFinal() {
  const candidates = [
    "/public/data/model/hrrr/latest.json",
    "/data/model/hrrr/latest.json",
    "public/data/model/hrrr/latest.json",
    "data/model/hrrr/latest.json"
  ];
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(`${url}?cache=${Date.now()}`);
      if (!response.ok) throw new Error(`HRRR index not found: ${url}`);
      const data = await response.json();
      const frames = Array.isArray(data) ? data : (data.frames || data.images || data.hours || []);
      if (!frames.length) throw new Error("HRRR index did not contain frames.");
      hrrrFrames = frames.map((frame, i) => ({
        url: assetPath(frame.url || frame.image || frame.path || frame.src || ""),
        bounds: frame.bounds || data.bounds || [[20, -130], [55, -60]],
        label: frame.label || frame.hour || frame.forecastHour || frame.fh || `F${String(i).padStart(2, "0")}`,
        validTime: frame.validTime || frame.valid || frame.time || ""
      })).filter(frame => frame.url);
      if (!hrrrFrames.length) throw new Error("HRRR frames did not include image URLs.");
      return hrrrFrames;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No HRRR frame index found.");
}

function showHrrrFrame(index) {
  if (!hrrrFrames.length) return;
  if (hrrrLayer) map.removeLayer(hrrrLayer);
  hrrrIndex = index;
  if (hrrrIndex < 0) hrrrIndex = hrrrFrames.length - 1;
  if (hrrrIndex >= hrrrFrames.length) hrrrIndex = 0;
  const frame = hrrrFrames[hrrrIndex];
  hrrrBounds = frame.bounds || hrrrBounds || [[20, -130], [55, -60]];
  hrrrLayer = L.imageOverlay(frame.url, hrrrBounds, {
    opacity: Number(document.getElementById("hrrrOpacity")?.value || 0.72),
    attribution: "HRRR simulated reflectivity"
  }).addTo(map);
  const slider = document.getElementById("hrrrFrameSlider");
  if (slider) slider.value = hrrrIndex;
  const label = document.getElementById("hrrrFrameLabel");
  if (label) label.textContent = frame.label || `F${String(hrrrIndex).padStart(2, "0")}`;
}

async function toggleHrrr() {
  if (hrrrLayer || hrrrFrames.length) {
    stopHrrrAnimation();
    if (hrrrLayer) map.removeLayer(hrrrLayer);
    hrrrLayer = null;
    hrrrFrames = [];
    hrrrIndex = 0;
    const timeline = document.getElementById("hrrrTimeline");
    if (timeline) timeline.classList.add("hidden");
    safeSetCheckFinal("hrrrCheck", false);
    clearLegend("hrrr");
    if (activeClickDataLayerFinal === "hrrr") setActiveClickDataLayerFinal("");
    updatePanel("HRRR Future Radar", "HRRR future radar layer turned off.");
    return;
  }

  try {
    updatePanel("HRRR Future Radar", "Loading local HRRR frame index...");
    await loadHrrrFramesFinal();
    const slider = document.getElementById("hrrrFrameSlider");
    if (slider) {
      slider.min = 0;
      slider.max = hrrrFrames.length - 1;
      slider.value = 0;
    }
    const timeline = document.getElementById("hrrrTimeline");
    if (timeline) timeline.classList.remove("hidden");
    showHrrrFrame(0);
    safeSetCheckFinal("hrrrCheck", true);
    updateLegend("hrrr");
    setActiveClickDataLayerFinal("hrrr");
    updatePanel("HRRR Future Radar", `HRRR future radar loaded.<br>Frames: ${hrrrFrames.length}<br>Use the timeline slider or play controls. Data-card click/tap can show current HRRR frame info when enabled.`);
  } catch (error) {
    console.error(error);
    hrrrLayer = null;
    hrrrFrames = [];
    safeSetCheckFinal("hrrrCheck", false);
    updatePanel("HRRR Future Radar", "No usable HRRR frame index was found at /public/data/model/hrrr/latest.json or /data/model/hrrr/latest.json.");
  }
}

function setHrrrFrameFromSlider() {
  stopHrrrAnimation();
  const slider = document.getElementById("hrrrFrameSlider");
  showHrrrFrame(Number(slider?.value || 0));
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
  if (!hrrrFrames.length) return;
  hrrrTimer = setInterval(() => showHrrrFrame(hrrrIndex + 1), 800);
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

async function identifySurfaceAtFinal(latlng) {
  if (!surfaceLayer) return null;
  const size = map.getSize();
  const b = map.getBounds();
  const params = new URLSearchParams({
    f: "json",
    geometry: `${latlng.lng},${latlng.lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `visible:${(surfaceLayerSets[surfaceDay] || surfaceLayerSets[1]).join(",")}`,
    tolerance: "8",
    mapExtent: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
    imageDisplay: `${size.x},${size.y},96`,
    returnGeometry: "false"
  });
  const response = await fetch(`${surfaceMapServiceUrl}/identify?${params.toString()}`);
  if (!response.ok) throw new Error("Surface identify failed");
  const data = await response.json();
  return data.results || [];
}

async function runSurfacePointFinal(latlng, token) {
  if (!surfaceLayer || !dataCardEnabledFinal("surface")) return false;
  try {
    const results = await identifySurfaceAtFinal(latlng);
    if (token !== pointProbeRunIdFinal) return true;
    if (!results || !results.length) {
      updatePanel("Surface Map Point", `No WPC surface-map feature returned at selected point.<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
      return true;
    }
    const rows = results.slice(0, 8).map(result => {
      const attrs = result.attributes || {};
      const label = firstValue(attrs, ["name", "Name", "LABEL", "label", "type", "TYPE", "value", "VALUE"], result.layerName || "Surface feature");
      return `<div class="hazard-detail-row"><span>${sanitizeForPanel(result.layerName || "Layer")}:</span> ${sanitizeForPanel(label)}</div>`;
    }).join("");
    updatePanel("Surface Map Point", `WPC Day ${surfaceDay} National Forecast Chart<br><br>${rows}<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
    return true;
  } catch (error) {
    if (token === pointProbeRunIdFinal) updatePanel("Surface Map Point", "No surface-map data returned at the selected point.");
    return true;
  }
}

// Replace the shared click dispatcher with one that covers every clickable data-card layer.
try { map.off("click", handleSharedMapDataClickFinal); } catch (error) {}
map.on("click", handleSharedMapDataClickFinal);

// Wrap remaining toggles so the active click source follows the last enabled layer.
const toggleSurfaceMapAuditFinal = toggleSurfaceMap;
toggleSurfaceMap = function() {
  const wasOn = !!surfaceLayer;
  toggleSurfaceMapAuditFinal();
  if (!wasOn && surfaceLayer) setActiveClickDataLayerFinal("surface");
  else if (activeClickDataLayerFinal === "surface") setActiveClickDataLayerFinal("");
};

const togglePastRadarAuditFinal = togglePastRadar;
togglePastRadar = async function() {
  const wasOn = !!pastRadarLayer || radarFrames.length > 0;
  await togglePastRadarAuditFinal();
  if (!wasOn && (pastRadarLayer || radarFrames.length)) setActiveClickDataLayerFinal("pastRadar");
  else if (activeClickDataLayerFinal === "pastRadar") setActiveClickDataLayerFinal("");
};

const toggleHrrrAuditFinal = toggleHrrr;
toggleHrrr = async function() {
  const wasOn = !!hrrrLayer || hrrrFrames.length > 0;
  await toggleHrrrAuditFinal();
  if (!wasOn && (hrrrLayer || hrrrFrames.length)) setActiveClickDataLayerFinal("hrrr");
  else if (activeClickDataLayerFinal === "hrrr") setActiveClickDataLayerFinal("");
};

const toggleSpcAuditFinal = toggleSpc;
toggleSpc = async function() {
  const wasOn = !!spcLayer;
  await toggleSpcAuditFinal();
  if (!wasOn && spcLayer) setActiveClickDataLayerFinal("spc");
  else if (activeClickDataLayerFinal === "spc") setActiveClickDataLayerFinal("");
};

const toggleWpcAuditFinal = toggleWpc;
toggleWpc = async function() {
  const wasOn = !!wpcLayer;
  await toggleWpcAuditFinal();
  if (!wasOn && wpcLayer) setActiveClickDataLayerFinal("wpc");
  else if (activeClickDataLayerFinal === "wpc") setActiveClickDataLayerFinal("");
};

// Final hard check: no data-card target probe binds mousemove after this point.
removeKnownMousemoveProbeHandlersFinal();
renderLegends();


/* ===== RBRTW VERIFIED FIX: STACKED DATA CARD + RADAR CLICK VALUE =====
   This block is intentionally last.
   It changes the Data card behavior from "last layer wins" to stacked sections.
   When multiple active layers have their data-card checkbox checked, one map click/tap
   runs each checked data source and appends each result inside the single DATA card.
   It also replaces radar GetFeatureInfo with EPSG:3857-first requests and radar-specific
   value extraction so live MRMS radar click/tap has a real chance to return dBZ.
*/

const RBRTW_STACK_DATA_LABELS_FINAL = {
  radar: "Radar",
  pastRadar: "Past Radar",
  alerts: "NWS Alerts / Statements",
  qpf: "QPF Forecast",
  spc: "SPC Outlook",
  wpc: "WPC Outlook",
  hrrr: "HRRR Future Radar",
  county: "County Boundary",
  temp: "Temperature Station",
  wind: "Wind Station",
  rainfall: "Rainfall Totals / QPE",
  airQuality: "Air Quality",
  surface: "Surface Map"
};

const RBRTW_STACK_DATA_ORDER_FINAL = [
  "alerts",
  "spc",
  "wpc",
  "airQuality",
  "radar",
  "qpf",
  "rainfall",
  "surface",
  "hrrr",
  "pastRadar",
  "county",
  "temp",
  "wind"
];

let rbrtwDataStackFinal = {};
let rbrtwDataStackClickIdFinal = 0;

function classifyDataPanelTitleFinal(title) {
  const t = String(title || "").toLowerCase();
  if (t.startsWith("radar point")) return "radar";
  if (t.startsWith("past radar point")) return "pastRadar";
  if (t.startsWith("qpf forecast point")) return "qpf";
  if (t.startsWith("rainfall total point")) return "rainfall";
  if (t.startsWith("air quality point")) return "airQuality";
  if (t.startsWith("surface map point")) return "surface";
  if (t.startsWith("hrrr future radar point")) return "hrrr";
  if (t.startsWith("county boundary")) return "county";
  if (t.startsWith("wind observation")) return "wind";
  if (t.startsWith("station:") || t.startsWith("temperature:")) return "temp";
  if (t.startsWith("spc:")) return "spc";
  if (t.startsWith("wpc:")) return "wpc";
  if (t.startsWith("nws alert") || t.includes("nws alert / statement")) return "alerts";
  return "";
}

function setStackedDataSectionFinal(type, title, html) {
  if (!type) return;
  if (!dataCardEnabledFinal(type)) return;
  rbrtwDataStackFinal[type] = { title: String(title || RBRTW_STACK_DATA_LABELS_FINAL[type] || type), html: String(html || "") };
  renderStackedDataCardFinal();
}

function resetStackedDataCardFinal() {
  rbrtwDataStackFinal = {};
  rbrtwDataStackClickIdFinal++;
}

const rbrtwBaseUpdatePanelFinal = (typeof updatePanelCoreFinal === "function") ? updatePanelCoreFinal : updatePanel;
updatePanel = function(title, html) {
  const type = classifyDataPanelTitleFinal(title);
  if (type) {
    setStackedDataSectionFinal(type, title, html);
    return;
  }

  // Non-click informational panels should replace the card and clear old click/tap stack.
  rbrtwDataStackFinal = {};
  rbrtwBaseUpdatePanelFinal(title, html);
};

async function identifyRadarAt(latlng) {
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(latlng);
  const b = map.getBounds();
  const sw3857 = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne3857 = L.CRS.EPSG3857.project(b.getNorthEast());

  const attempts = [
    {
      service: "WMS",
      version: "1.1.1",
      request: "GetFeatureInfo",
      layers: "conus_bref_qcd",
      query_layers: "conus_bref_qcd",
      styles: "",
      bbox: `${sw3857.x},${sw3857.y},${ne3857.x},${ne3857.y}`,
      height: String(size.y),
      width: String(size.x),
      srs: "EPSG:3857",
      format: "image/png",
      feature_count: "10",
      x: String(Math.round(pt.x)),
      y: String(Math.round(pt.y))
    },
    {
      service: "WMS",
      version: "1.3.0",
      request: "GetFeatureInfo",
      layers: "conus_bref_qcd",
      query_layers: "conus_bref_qcd",
      styles: "",
      bbox: `${sw3857.x},${sw3857.y},${ne3857.x},${ne3857.y}`,
      height: String(size.y),
      width: String(size.x),
      crs: "EPSG:3857",
      format: "image/png",
      feature_count: "10",
      i: String(Math.round(pt.x)),
      j: String(Math.round(pt.y))
    },
    {
      service: "WMS",
      version: "1.1.1",
      request: "GetFeatureInfo",
      layers: "conus_bref_qcd",
      query_layers: "conus_bref_qcd",
      styles: "",
      bbox: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
      height: String(size.y),
      width: String(size.x),
      srs: "EPSG:4326",
      format: "image/png",
      feature_count: "10",
      x: String(Math.round(pt.x)),
      y: String(Math.round(pt.y))
    }
  ];

  const formats = ["application/json", "text/plain", "text/html"];
  let lastRaw = null;
  let lastError = null;

  for (const base of attempts) {
    for (const infoFormat of formats) {
      try {
        const params = new URLSearchParams({ ...base, info_format: infoFormat });
        const response = await fetch(`https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?${params.toString()}`);
        if (!response.ok) throw new Error(`Radar identify failed ${response.status}`);
        const raw = infoFormat.includes("json") ? await response.json() : await response.text();
        lastRaw = raw;
        const value = extractRadarDbzValueFinal(raw);
        if (value !== null) return { value, raw, method: `${base.version} ${base.srs || base.crs} ${infoFormat}` };
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastRaw !== null) return { value: null, raw: lastRaw, method: "No dBZ value in GetFeatureInfo response" };
  throw lastError || new Error("Radar identify failed");
}

async function runAllCheckedPointDataFinal(latlng, token, skipTypes = []) {
  const skip = new Set(skipTypes || []);
  const tasks = [
    ["airQuality", () => runAirQualityPointFinal(latlng, token)],
    ["radar", () => runRadarPointFinal(latlng, token)],
    ["qpf", () => runQpfPointFinal(latlng, token)],
    ["rainfall", () => runRainfallPointFinal(latlng, token)],
    ["surface", () => runSurfacePointFinal(latlng, token)],
    ["hrrr", () => Promise.resolve(runHrrrPointFinal(latlng, token))],
    ["pastRadar", () => Promise.resolve(runPastRadarPointFinal(latlng, token))]
  ];

  let ranAny = false;
  for (const [type, fn] of tasks) {
    if (skip.has(type)) continue;
    if (!dataCardEnabledFinal(type)) continue;
    try {
      const didRun = await fn();
      if (didRun) ranAny = true;
    } catch (error) {
      console.warn("Stacked data source failed", type, error);
    }
  }
  return ranAny;
}

try { map.off("click", handleSharedMapDataClickFinal); } catch (error) {}
async function handleSharedMapDataClickFinal(e) {
  if (!e || !e.latlng) return;
  const target = e.originalEvent?.target;
  if (target && target.closest && target.closest(".control-card, .home-btn, .basemap-btn, .basemap-menu, .leaflet-control")) return;

  removeKnownMousemoveProbeHandlersFinal();
  clearProbeMarkersFinal("");
  resetStackedDataCardFinal();
  const token = ++pointProbeRunIdFinal;
  const didRun = await runAllCheckedPointDataFinal(e.latlng, token);
  if (!didRun && token === pointProbeRunIdFinal) {
    rbrtwBaseUpdatePanelFinal("Map Data", "No checked active data-card layers were available for that click/tap.");
  }
}
map.on("click", handleSharedMapDataClickFinal);

function bindHazardFeature(layer, source, feature, extra = {}) {
  const properties = feature?.properties || {};
  const details = hazardPanelHtml(source, properties, extra);
  const dataType = hazardDataTypeFromSourceFinal(source);

  layer.on("click", async e => {
    if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
    removeKnownMousemoveProbeHandlersFinal();
    clearProbeMarkersFinal("");
    resetStackedDataCardFinal();
    const token = ++pointProbeRunIdFinal;

    if (dataCardEnabledFinal(dataType)) {
      setStackedDataSectionFinal(dataType, details.title, details.html);
    }

    if (e?.latlng) {
      await runAllCheckedPointDataFinal(e.latlng, token, [dataType]);
    }
  });

  layer.bindPopup(`<strong>${details.title}</strong><br>${details.html}`);
  layer.bindTooltip(details.title, { sticky: true, direction: "top", className: "hazard-tooltip" });
  layer.on("mouseover", function () { if (layer.setStyle) layer.setStyle({ weight: 5, opacity: 1 }); });
  layer.on("mouseout", function () { if (layer.setStyle) layer.setStyle({ weight: 3, opacity: 1 }); });
}

function runHrrrPointFinal(latlng, token) {
  if (!hrrrLayer || !dataCardEnabledFinal("hrrr")) return false;
  const frame = hrrrFrames[hrrrIndex] || {};
  updatePanel("HRRR Future Radar Point", `
    Current HRRR frame: <strong>${sanitizeForPanel(frame.label || `F${hrrrIndex}`)}</strong><br>
    ${frame.validTime ? `Valid: ${sanitizeForPanel(frame.validTime)}<br>` : ""}
    Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
    Summary: HRRR simulated reflectivity frame is active. Pixel dBZ sampling is not available from this local image overlay.
  `);
  return true;
}

function runPastRadarPointFinal(latlng, token) {
  if (!pastRadarLayer || !dataCardEnabledFinal("pastRadar")) return false;
  const frame = radarFrames[radarIndex] || {};
  updatePanel("Past Radar Point", `
    Current past radar frame: <strong>${frame.time ? sanitizeForPanel(localRadarTime(frame.time)) : "Latest"}</strong><br>
    Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
    Summary: RainViewer playback is active. Pixel dBZ sampling is not exposed by the tile playback source.
  `);
  return true;
}

// Keep data-card stack presentable in PNG exports when Include data card in PNG is checked.
const rbrtwSavePhotoStackedFinal = saveMapPhoto;
saveMapPhoto = async function() {
  const dataBody = document.getElementById("dataBody");
  if (dataBody) dataBody.classList.remove("collapsed");
  await rbrtwSavePhotoStackedFinal();
};

removeKnownMousemoveProbeHandlersFinal();
renderLegends();

/* ===== RBRTW EXPORT POLISH FINAL: STACKED DATA CARD + MAP KEY BAR =====
   Fixes PNG export only. Live map behavior is unchanged.
   - Export Data card becomes a full-width summary panel above the map-key bar.
   - Multiple checked data-card items render in a clean grid instead of a cut-off scroll box.
   - Export map key becomes one full-width bar with each selected key separated into its own readable block.
*/
function renderStackedDataCardFinal() {
  const status = document.getElementById("status");
  if (!status) return;

  const activeTypes = RBRTW_STACK_DATA_ORDER_FINAL.filter(type => rbrtwDataStackFinal[type]);
  if (!activeTypes.length) {
    status.innerHTML = "Click/tap the map to load checked data-card items.";
    return;
  }

  const sections = activeTypes.map(type => {
    const item = rbrtwDataStackFinal[type];
    const label = RBRTW_STACK_DATA_LABELS_FINAL[type] || item.title || type;
    return `
      <div class="stack-data-section stack-data-${sanitizeForPanel(type)}">
        <div class="stack-data-title">${sanitizeForPanel(label)}</div>
        <div class="stack-data-subtitle">${sanitizeForPanel(item.title || label)}</div>
        <div class="stack-data-body">${item.html || ""}</div>
      </div>
    `;
  }).join("");

  status.innerHTML = `
    <div class="stack-data-card-title">Selected Point Data</div>
    <div class="stack-data-card-note">${activeTypes.length} checked data item${activeTypes.length === 1 ? "" : "s"} from the latest click/tap.</div>
    <div class="stack-data-sections">${sections}</div>
  `;
}

async function saveMapPhoto() {
  const btn = document.getElementById("savePhotoBtn");
  const legendBody = document.getElementById("legendBody");
  const dataBody = document.getElementById("dataBody");
  const includeKey = document.getElementById("photoIncludeKeyCheck")?.checked !== false;
  const includeData = document.getElementById("photoIncludeDataCheck")?.checked === true;

  try {
    if (btn) btn.textContent = "Saving...";
    if (legendBody) legendBody.classList.remove("collapsed");
    if (dataBody) dataBody.classList.remove("collapsed");

    document.body.classList.add("capture-mode", "capture-export-polish");
    document.body.classList.toggle("capture-hide-key", !includeKey);
    document.body.classList.toggle("capture-include-data", includeData);

    renderLegends();
    if (typeof renderStackedDataCardFinal === "function") renderStackedDataCardFinal();

    await new Promise(resolve => setTimeout(resolve, 700));

    if (typeof html2canvas !== "function") throw new Error("html2canvas did not load");

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      scale: 2,
      logging: false,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight
    });

    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `RBRTW-weather-map-${timestamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    rbrtwBaseUpdatePanelFinal("Save as Photo", includeData
      ? "Map photo saved with stacked selected-point Data card and separated map-key bar."
      : "Map photo saved with separated map-key bar.");
  } catch (error) {
    console.error(error);
    rbrtwBaseUpdatePanelFinal("Save as Photo", "Could not save the map image. Some external map tiles may block browser screenshot export.");
  } finally {
    document.body.classList.remove("capture-mode", "capture-export-polish", "capture-hide-key", "capture-include-data");
    renderLegends();
    if (btn) btn.textContent = "Save as Photo";
  }
}


/* ===== RBRTW RADAR STRICT DBZ FIX =====
   Fixes false severe/hail readings caused by parsing unrelated numbers from
   GeoServer GetFeatureInfo text/HTML/feature IDs. Radar point data now only
   accepts explicit reflectivity/value fields and rejects impossible dBZ values.
*/
function extractRadarDbzValueFinal(raw) {
  const validDbz = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    // Reflectivity values above this are not reliable for this MRMS point probe.
    // They are commonly color-table IDs, feature IDs, or other service metadata.
    if (n < -35 || n > 75) return null;
    return n;
  };

  const radarKeys = [
    "GRAY_INDEX", "gray_index", "GrayIndex", "GRAYINDEX",
    "grid_value", "GRID_VALUE", "gridValue", "GridValue",
    "pixelValue", "PixelValue", "PIXEL_VALUE",
    "value", "Value", "VALUE",
    "reflectivity", "Reflectivity", "REFLECTIVITY",
    "dbz", "dBZ", "DBZ"
  ];

  const keyLooksRadar = key => radarKeys.some(k => String(key).toLowerCase() === k.toLowerCase());

  function parseKeyedText(text) {
    const s = String(text || "");
    const patterns = [
      /(?:GRAY_INDEX|gray_index|GrayIndex|GRAYINDEX)\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
      /(?:grid_value|gridValue|pixelValue|PixelValue|value|Value|VALUE)\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
      /(?:reflectivity|dbz|dBZ|DBZ)\s*[=:]?\s*(-?\d+(?:\.\d+)?)/i
    ];
    for (const pattern of patterns) {
      const match = s.match(pattern);
      if (match) {
        const n = validDbz(match[1]);
        if (n !== null) return n;
      }
    }
    return null;
  }

  function fromObject(obj, depth = 0) {
    if (obj === null || obj === undefined || depth > 8) return null;

    if (typeof obj === "string") return parseKeyedText(obj);
    if (typeof obj === "number") return null; // never trust bare numbers; they may be IDs/coordinates

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const n = fromObject(item, depth + 1);
        if (n !== null) return n;
      }
      return null;
    }

    if (typeof obj === "object") {
      const containers = [];
      if (obj.properties && typeof obj.properties === "object") containers.push(obj.properties);
      if (obj.attributes && typeof obj.attributes === "object") containers.push(obj.attributes);
      containers.push(obj);

      for (const container of containers) {
        for (const [key, value] of Object.entries(container)) {
          if (!keyLooksRadar(key)) continue;
          const n = validDbz(value);
          if (n !== null) return n;
          if (typeof value === "string") {
            const textValue = parseKeyedText(`${key}: ${value}`);
            if (textValue !== null) return textValue;
          }
        }
      }

      if (Array.isArray(obj.features)) {
        for (const feature of obj.features) {
          const n = fromObject(feature.properties || feature.attributes || {}, depth + 1);
          if (n !== null) return n;
        }
      }

      if (Array.isArray(obj.results)) {
        for (const result of obj.results) {
          const n = fromObject(result.attributes || result.properties || {}, depth + 1);
          if (n !== null) return n;
        }
      }
    }

    return null;
  }

  return fromObject(raw);
}

function radarCategoryFromDbz(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { label: "No reliable radar value", range: "No dBZ returned", color: "#ffffff" };
  if (n < 5) return { label: "Very weak / no precip return", range: "Below 5 dBZ", color: "#9ca3af" };
  if (n < 20) return { label: "Light precipitation", range: "5–20 dBZ", color: "#44ff44" };
  if (n < 35) return { label: "Moderate precipitation", range: "20–35 dBZ", color: "#ffff44" };
  if (n < 50) return { label: "Heavy precipitation", range: "35–50 dBZ", color: "#ff5500" };
  if (n < 65) return { label: "Strong storm core", range: "50–65 dBZ", color: "#ff0000" };
  return { label: "Extreme / possible hail core", range: "65+ dBZ", color: "#ff00ff" };
}

async function runRadarPointFinal(latlng, token) {
  if (!radarLayer || !dataCardEnabledFinal("radar")) return false;
  try {
    const result = await identifyRadarAt(latlng);
    if (token !== pointProbeRunIdFinal) return true;
    const value = extractRadarDbzValueFinal(result.raw);
    const category = radarCategoryFromDbz(value);
    const valueText = value === null ? "No reliable dBZ" : `${Number(value).toFixed(1)} dBZ`;
    showRadarProbeMarker(latlng, valueText, category);
    updatePanel("Radar Point", `
      <strong>${sanitizeForPanel(category.label)}</strong><br><br>
      Radar reflectivity at selected point: <strong>${sanitizeForPanel(valueText)}</strong><br>
      ${sanitizeForPanel(category.range)}<br>
      Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
      Source: NOAA/NWS MRMS base reflectivity WMS<br>
      Note: This radar probe now rejects service IDs, color-table numbers, and impossible dBZ values so it does not falsely label non-severe pixels as hail core.
    `);
    return true;
  } catch (error) {
    if (token === pointProbeRunIdFinal) {
      showRadarProbeMarker(latlng, "No dBZ", { label: "No reliable radar value", color: "#ffffff" });
      updatePanel("Radar Point", `
        <strong>No reliable radar value</strong><br><br>
        The MRMS WMS did not return a clean dBZ value at this selected point.<br>
        Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>
        Radar image remains visible, but the point readout was not trusted.
      `);
    }
    return true;
  }
}
