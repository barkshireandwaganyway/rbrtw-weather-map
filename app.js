const RBRTW_AREA = [29.46899, -98.78885];

const map = L.map("map", {
  zoomControl: false
}).setView(RBRTW_AREA, 10);

L.control.zoom({
  position: "bottomleft"
}).addTo(map);

let baseLayer = null;
let radarLayer = null;
let alertLayer = null;
let qpfLayer = null;
let spcLayer = null;
let wpcLayer = null;
let countyLayer = null;

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

function setCheck(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function assetPath(path) {
  if (!path) return "";
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

function updateLegend(type) {
  const box = document.getElementById("legendContent");

  const legends = {
    radar: `
      <div class="legend-row"><span class="legend-swatch" style="background:#44ff44"></span>Light precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffff44"></span>Moderate precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff4444"></span>Heavy precip</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ff44ff"></span>Very heavy / hail core</div>
    `,
    hrrr: `
      <div class="legend-row"><span class="legend-swatch" style="background:linear-gradient(90deg,#00cc33,#ffff00,#ff5500,#ff0000,#ff00ff)"></span>Simulated reflectivity</div>
      <div class="legend-row">5 / 20 / 35 / 50 / 65+ dBZ</div>
    `,
    county: `
      <div class="legend-row"><span class="legend-swatch" style="background:#ffffff"></span>County boundary lines</div>
    `,
    qpf: `
      <div class="legend-row"><span class="legend-swatch" style="background:#b7e4c7"></span>Light rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#52b788"></span>Moderate rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#2d6a4f"></span>Heavy rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#7209b7"></span>Extreme rainfall</div>
    `,
    spc: `
      <div class="legend-row"><span class="legend-swatch" style="background:#c1e9c1"></span>General Thunder</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#66a366"></span>Marginal</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffe066"></span>Slight</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffa366"></span>Enhanced</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e06666"></span>Moderate</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ee99ee"></span>High</div>
    `,
    wpc: `
      <div class="legend-row"><span class="legend-swatch" style="background:#66a366"></span>Marginal Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ffe066"></span>Slight Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#e06666"></span>Moderate Excessive Rainfall</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#ee99ee"></span>High Excessive Rainfall</div>
    `,
    alerts: `
      <div class="legend-row"><span class="legend-swatch" style="background:#ff0033"></span>Active NWS Alert Polygon</div>
    `
  };

  box.innerHTML = legends[type] || "Turn on a layer to view its legend.";
}

function setLayerOpacity(type) {
  if (type === "radar" && radarLayer) {
    radarLayer.setOpacity(Number(document.getElementById("radarOpacity").value));
  }

  if (type === "qpf" && qpfLayer) {
    qpfLayer.setOpacity(Number(document.getElementById("qpfOpacity").value));
  }

  if (type === "spc" && spcLayer) {
    spcLayer.setStyle({
      fillOpacity: Number(document.getElementById("spcOpacity").value)
    });
  }

  if (type === "wpc" && wpcLayer) {
    wpcLayer.setOpacity(Number(document.getElementById("wpcOpacity").value));
  }

  if (type === "hrrr" && hrrrLayer) {
    hrrrLayer.setOpacity(Number(document.getElementById("hrrrOpacity").value));
  }

  if (type === "county" && countyLayer) {
    countyLayer.setStyle({
      opacity: Number(document.getElementById("countyOpacity").value),
      fillOpacity: 0
    });
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

function toggleRadar() {
  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
    setCheck("radarCheck", false);
    updatePanel("Radar", "Radar layer turned off.");
    return;
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
  updateLegend("radar");
  updatePanel("Radar", `Radar layer on.<br>Updated: ${new Date().toLocaleTimeString()}`);
}

async function toggleAlerts() {
  if (alertLayer) {
    map.removeLayer(alertLayer);
    alertLayer = null;
    setCheck("alertsCheck", false);
    updatePanel("NWS Alerts", "Alert layer turned off.");
    return;
  }

  try {
    const response = await fetch(`https://api.weather.gov/alerts/active?point=${RBRTW_AREA[0]},${RBRTW_AREA[1]}`);
    if (!response.ok) throw new Error("Alerts request failed");

    const data = await response.json();

    alertLayer = L.geoJSON(data, {
      style: {
        color: "#ff0033",
        weight: 2,
        fillColor: "#ff0033",
        fillOpacity: 0.2
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        layer.bindPopup(`<strong>${p.event}</strong><br>${p.headline || ""}`);
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
          color,
          fillColor: color,
          weight: 2,
          fillOpacity: Number(document.getElementById("spcOpacity").value)
        };
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        layer.bindPopup(`<strong>SPC Outlook</strong><br>Risk: ${p.label || p.label2 || "Outlook Area"}`);
      }
    }).addTo(map);

    setCheck("spcCheck", true);
    updateLegend("spc");
    updatePanel("SPC Outlook", `SPC outlook layer on.<br>Updated: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setCheck("spcCheck", false);
    updatePanel("SPC Outlook", "Could not load SPC outlook.");
    console.error(error);
  }
}

function toggleWpc() {
  if (wpcLayer) {
    map.removeLayer(wpcLayer);
    wpcLayer = null;
    setCheck("wpcCheck", false);
    updatePanel("WPC Outlook", "WPC outlook layer turned off.");
    return;
  }

  wpcLayer = L.esri.dynamicMapLayer({
    url: "https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer",
    opacity: Number(document.getElementById("wpcOpacity").value)
  }).addTo(map);

  setCheck("wpcCheck", true);
  updateLegend("wpc");
  updatePanel("WPC Outlook", `WPC precipitation hazard layer on.<br>Updated: ${new Date().toLocaleTimeString()}`);
}

async function toggleCountyLines() {
  if (countyLayer) {
    map.removeLayer(countyLayer);
    countyLayer = null;
    setCheck("countyCheck", false);
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
        color: "#0b7a2a",
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

function refreshActiveLayers() {
  const radarWasOn = !!radarLayer;
  const alertsWasOn = !!alertLayer;
  const qpfWasOn = !!qpfLayer;
  const spcWasOn = !!spcLayer;
  const wpcWasOn = !!wpcLayer;
  const countyWasOn = !!countyLayer;
  const hrrrWasOn = !!hrrrLayer;

  if (radarWasOn) toggleRadar();
  if (alertsWasOn) toggleAlerts();
  if (qpfWasOn) toggleQpf();
  if (spcWasOn) toggleSpc();
  if (wpcWasOn) toggleWpc();
  if (countyWasOn) toggleCountyLines();
  if (hrrrWasOn) toggleHrrr();

  setTimeout(() => {
    if (radarWasOn) toggleRadar();
    if (alertsWasOn) toggleAlerts();
    if (qpfWasOn) toggleQpf();
    if (spcWasOn) toggleSpc();
    if (wpcWasOn) toggleWpc();
    if (countyWasOn) toggleCountyLines();
    if (hrrrWasOn) toggleHrrr();
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
