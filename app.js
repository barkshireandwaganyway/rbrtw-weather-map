const RBRTW_AREA = [29.46899, -98.78885];

const map = L.map("map", {
  zoomControl: true
}).setView(RBRTW_AREA, 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let radarLayer = null;
let alertLayer = null;
let qpfLayer = null;
let spcLayer = null;
let wpcLayer = null;

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
  document.getElementById("status").innerHTML = `
    <strong>${title}</strong>
    <br><br>
    ${html}
  `;
}

function setCheck(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
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

    updatePanel("RBRTW AREA", `
      Office: ${data.properties.cwa}<br>
      Grid: ${data.properties.gridId} ${data.properties.gridX},${data.properties.gridY}
    `);
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
      opacity: 0.7,
      attribution: "NOAA/NWS/NCEP MRMS Radar"
    }
  ).addTo(map);

  setCheck("radarCheck", true);
  updatePanel("Radar", "NOAA MRMS composite radar layer turned on.");
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
    const response = await fetch(
      `https://api.weather.gov/alerts/active?point=${RBRTW_AREA[0]},${RBRTW_AREA[1]}`,
      { headers: { Accept: "application/geo+json" } }
    );

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
        layer.bindPopup(`
          <strong>${p.event}</strong><br>
          Severity: ${p.severity}<br>
          ${p.headline || ""}
        `);
      }
    }).addTo(map);

    setCheck("alertsCheck", true);

    const alertList = data.features.map(feature => {
      const p = feature.properties;
      return `
        <div style="margin-bottom:10px;">
          <strong>${p.event}</strong><br>
          <small>${p.areaDesc}</small>
        </div>
      `;
    }).join("");

    updatePanel("Active NWS Alerts", alertList || "No active alerts for RBRTW AREA.");
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
    opacity: 0.65
  }).addTo(map);

  setCheck("qpfCheck", true);
  updatePanel("Rainfall / QPF", "WPC 72-hour precipitation forecast layer turned on.");
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
    const url =
      "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query" +
      "?where=1%3D1&outFields=*&returnGeometry=true&f=geojson";

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
          fillOpacity: 0.32
        };
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        layer.bindPopup(`
          <strong>SPC Day 1 Outlook</strong><br>
          Risk: ${p.label || p.label2 || "Outlook Area"}<br>
          Valid: ${p.valid || "N/A"}<br>
          Expires: ${p.expire || "N/A"}
        `);
      }
    }).addTo(map);

    setCheck("spcCheck", true);
    updatePanel("SPC Outlook", "SPC Day 1 categorical outlook layer turned on.");
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
    opacity: 0.6
  }).addTo(map);

  setCheck("wpcCheck", true);
  updatePanel("WPC Outlook", "WPC precipitation hazard / excessive rainfall outlook layer turned on.");
}

function toggleHrrr() {
  setCheck("hrrrCheck", false);

  updatePanel("HRRR Future Radar", `
    HRRR future radar needs the GRIB2 processing backend.
    <br><br>
    This will be added in the next build step using NOAA/NCEP model data, Python, and generated map tiles.
  `);
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
        — ${period.temperature}°${period.temperatureUnit},
        ${period.shortForecast}
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
