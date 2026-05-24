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

const locations = {
  bexar: { name: "Bexar County", coords: [29.4241, -98.4936], zoom: 9 },
  medina: { name: "Medina County", coords: [29.3558, -99.1107], zoom: 9 },
  atascosa: { name: "Atascosa County", coords: [28.8936, -98.5273], zoom: 9 }
};

L.marker(RBRTW_AREA)
  .addTo(map)
  .bindPopup("<strong>RBRTW AREA</strong>")
  .openPopup();

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  panel.classList.toggle("hidden");
}

function focusArea() {
  map.setView(RBRTW_AREA, 11);

  L.popup()
    .setLatLng(RBRTW_AREA)
    .setContent("<strong>RBRTW AREA</strong>")
    .openOn(map);
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

  status.innerHTML = `
    <strong>${title}</strong><br><br>
    ${html}
  `;
}

async function getNwsPointData() {
  const response = await fetch(
    `https://api.weather.gov/points/${RBRTW_AREA[0]},${RBRTW_AREA[1]}`,
    {
      headers: {
        Accept: "application/geo+json"
      }
    }
  );

  if (!response.ok) {
    throw new Error("NWS point request failed");
  }

  return await response.json();
}

async function loadNwsPointData() {
  try {
    const data = await getNwsPointData();

    updatePanel("NWS Point Data", `
      <strong>Area:</strong> RBRTW AREA<br>
      <strong>Office:</strong> ${data.properties.cwa}<br>
      <strong>Grid:</strong> ${data.properties.gridId} ${data.properties.gridX},${data.properties.gridY}<br>
      <strong>Forecast URL:</strong><br>
      <small>${data.properties.forecast}</small>
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
    updatePanel("Radar Overlay", "Radar overlay turned off.");
    return;
  }

  radarLayer = L.tileLayer.wms(
    "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows",
    {
      layers: "conus_bref_qcd",
      format: "image/png",
      transparent: true,
      opacity: 0.65,
      attribution: "NOAA/NWS/NCEP MRMS Radar"
    }
  ).addTo(map);

  updatePanel("Radar Overlay", "NOAA MRMS composite radar layer is turned on.");
}

async function loadAlerts() {
  try {
    if (alertLayer) {
      map.removeLayer(alertLayer);
      alertLayer = null;
      updatePanel("NWS Alerts", "Alert layer turned off.");
      return;
    }

    const response = await fetch(
      `https://api.weather.gov/alerts/active?point=${RBRTW_AREA[0]},${RBRTW_AREA[1]}`,
      {
        headers: {
          Accept: "application/geo+json"
        }
      }
    );

    if (!response.ok) {
      throw new Error("Alerts request failed");
    }

    const data = await response.json();

    alertLayer = L.geoJSON(data, {
      style: {
        color: "#ff0033",
        weight: 2,
        fillColor: "#ff0033",
        fillOpacity: 0.18
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;

        layer.bindPopup(`
          <strong>${p.event}</strong><br>
          <strong>Severity:</strong> ${p.severity}<br>
          <strong>Area:</strong> ${p.areaDesc}<br><br>
          ${p.headline || ""}
        `);
      }
    }).addTo(map);

    const alertList = data.features.slice(0, 5).map(feature => {
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
    updatePanel("NWS Alerts", "Could not load alerts.");
    console.error(error);
  }
}

async function loadForecast() {
  try {
    const point = await getNwsPointData();
    const response = await fetch(point.properties.forecast);

    if (!response.ok) {
      throw new Error("Forecast request failed");
    }

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

    if (!response.ok) {
      throw new Error("Hourly forecast request failed");
    }

    const data = await response.json();

    const hourlyHtml = data.properties.periods.slice(0, 12).map(period => `
      <div style="margin-bottom:10px;">
        <strong>${new Date(period.startTime).toLocaleTimeString([], {
          hour: "numeric"
        })}</strong>
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

    if (!stationsResponse.ok) {
      throw new Error("Observation station request failed");
    }

    const stationsData = await stationsResponse.json();

    if (!stationsData.features || stationsData.features.length === 0) {
      throw new Error("No observation stations found.");
    }

    const stationUrl = `${stationsData.features[0].id}/observations/latest`;
    const obsResponse = await fetch(stationUrl);

    if (!obsResponse.ok) {
      throw new Error("Observation request failed");
    }

    const obsData = await obsResponse.json();
    const p = obsData.properties;

    const tempC = p.temperature.value;
    const dewC = p.dewpoint.value;
    const windMps = p.windSpeed.value;
    const gustMps = p.windGust.value;
    const pressurePa = p.barometricPressure.value;

    const tempF = tempC !== null ? Math.round((tempC * 9) / 5 + 32) : "N/A";
    const dewF = dewC !== null ? Math.round((dewC * 9) / 5 + 32) : "N/A";
    const windMph = windMps !== null ? Math.round(windMps * 2.23694) : "N/A";
    const gustMph = gustMps !== null ? Math.round(gustMps * 2.23694) : "N/A";
    const pressureInHg = pressurePa !== null ? (pressurePa * 0.0002953).toFixed(2) : "N/A";

    updatePanel("Current Conditions", `
      <strong>Area:</strong> RBRTW AREA<br>
      <strong>Temperature:</strong> ${tempF}°F<br>
      <strong>Dew Point:</strong> ${dewF}°F<br>
      <strong>Wind:</strong> ${windMph} mph<br>
      <strong>Wind Gust:</strong> ${gustMph} mph<br>
      <strong>Pressure:</strong> ${pressureInHg} inHg<br>
      <strong>Description:</strong> ${p.textDescription || "N/A"}<br>
      <strong>Updated:</strong> ${new Date(p.timestamp).toLocaleString()}
    `);
  } catch (error) {
    updatePanel("Current Conditions", "Could not load current conditions.");
    console.error(error);
  }
}

loadNwsPointData();
