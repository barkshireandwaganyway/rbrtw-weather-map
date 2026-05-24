const map = L.map("map").setView([29.4241, -98.4936], 8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const locations = {
  sanAntonio: {
    name: "San Antonio",
    coords: [29.4241, -98.4936],
    zoom: 9
  },
  bexar: {
    name: "Bexar County",
    coords: [29.4241, -98.4936],
    zoom: 9
  },
  medina: {
    name: "Medina County",
    coords: [29.3558, -99.1107],
    zoom: 9
  },
  atascosa: {
    name: "Atascosa County",
    coords: [28.8936, -98.5273],
    zoom: 9
  }
};

function focusCounty(county) {
  const selected = locations[county];

  if (!selected) return;

  map.setView(selected.coords, selected.zoom);

  L.popup()
    .setLatLng(selected.coords)
    .setContent(`<strong>${selected.name}</strong><br>RBRTW focus area`)
    .openOn(map);
}

const marker = L.marker([29.4241, -98.4936])
  .addTo(map)
  .bindPopup("<strong>San Antonio / EWX Focus Area</strong><br>RBRTW weather command center.")
  .openPopup();

async function loadNwsPointData() {
  const status = document.getElementById("status");

  try {
    const response = await fetch("https://api.weather.gov/points/29.4241,-98.4936", {
      headers: {
        "Accept": "application/geo+json"
      }
    });

    if (!response.ok) {
      throw new Error("NWS request failed");
    }

    const data = await response.json();

    const office = data.properties.cwa;
    const gridId = data.properties.gridId;
    const gridX = data.properties.gridX;
    const gridY = data.properties.gridY;
    const forecastUrl = data.properties.forecast;
    const hourlyUrl = data.properties.forecastHourly;

    status.innerHTML = `
      <strong>Office:</strong> ${office}<br>
      <strong>Grid:</strong> ${gridId} ${gridX},${gridY}<br>
      <strong>Forecast:</strong><br>
      <small>${forecastUrl}</small><br><br>
      <strong>Hourly:</strong><br>
      <small>${hourlyUrl}</small>
    `;
  } catch (error) {
    status.textContent = "Could not load NWS data. Check connection or try again.";
    console.error(error);
  }
}

loadNwsPointData();
