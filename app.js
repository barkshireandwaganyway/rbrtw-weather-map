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
  const body = document.getElementById(id);
  body.classList.toggle("collapsed");
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
  const checkbox = document.getElementById("radarCheck");

  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
    if (checkbox) checkbox.checked = false;
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

  if (checkbox) checkbox.checked = true;
}

async function toggleAlerts() {
  const checkbox = document.getElementById("alertsCheck");

  if (alertLayer) {
    map.removeLayer(alertLayer);
    alertLayer = null;
    if (checkbox) checkbox.checked = false;
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

    if (checkbox) checkbox.checked = true;

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
    if (checkbox) checkbox.checked = false;
    updatePanel("NWS Alerts", "Could not load alerts.");
    console.error(error);
  }
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
