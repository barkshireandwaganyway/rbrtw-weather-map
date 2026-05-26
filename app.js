'use strict';

const RBRTW_AREA = [29.46899, -98.78885];

const map = L.map('map', { zoomControl: false }).setView(RBRTW_AREA, 10);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Polygon click guard: prevents the map.on('click') handler from firing
// immediately after a GeoJSON polygon click and overwriting its data card.
let lastPolygonClickTime = 0;

const state = {
  baseLayer: null,
  rbrtwMarker: null,
  rbrtwCircle: null,
  radarLayer: null,
  pastRadarLayer: null,
  radarFrames: [],
  radarHost: '',
  radarIndex: 0,
  radarTimer: null,
  alertLayer: null,
  qpfLayer: null,
  qpfDay: 1,
  spcLayer: null,
  spcDay: 1,
  wpcLayer: null,
  wpcDay: 1,
  countyLayer: null,
  tempLayer: null,
  windLayer: null,
  rainfallLayer: null,
  rainfallPeriod: '24',
  airQualityLayer: null,
  surfaceLayer: null,
  surfaceDay: 1,
  hrrrLayer: null,
  hrrrFrames: [],
  hrrrIndex: 0,
  hrrrTimer: null,
  tempDisplayMode: 'temp',
  clickRunId: 0,
  dataStack: {},
  markers: {
    radar: null,
    qpf: L.layerGroup().addTo(map),
    rainfall: L.layerGroup().addTo(map),
    airQuality: null
  }
};

const basemaps = {
  standard: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    crossOrigin: true
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap & CARTO',
    crossOrigin: true
  }),
  satellite: L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri',
      crossOrigin: true
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Roads &copy; Esri',
      crossOrigin: true
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Labels &copy; Esri',
      crossOrigin: true
    })
  ])
};

const dataToggleIds = {
  radar: 'dataRadarCheck',
  pastRadar: 'dataPastRadarCheck',
  alerts: 'dataAlertsCheck',
  qpf: 'dataQpfCheck',
  spc: 'dataSpcCheck',
  wpc: 'dataWpcCheck',
  hrrr: 'dataHrrrCheck',
  county: 'dataCountyCheck',
  temp: 'dataTempCheck',
  wind: 'dataWindCheck',
  rainfall: 'dataRainfallCheck',
  airQuality: 'dataAirQualityCheck',
  surface: 'dataSurfaceCheck'
};

const stackLabels = {
  radar: 'Radar',
  pastRadar: 'Past Radar',
  alerts: 'NWS Alerts / Statements',
  qpf: 'QPF Forecast',
  spc: 'SPC Outlook',
  wpc: 'WPC Outlook',
  hrrr: 'HRRR Future Radar',
  county: 'County Boundary',
  temp: 'Temperature Station',
  wind: 'Wind Station',
  rainfall: 'Rainfall Totals / QPE',
  airQuality: 'Air Quality',
  surface: 'Surface Map'
};

const stackOrder = ['alerts', 'spc', 'wpc', 'airQuality', 'radar', 'qpf', 'rainfall', 'surface', 'hrrr', 'pastRadar', 'county', 'temp', 'wind'];
const legendTypes = new Set();

const rainfallServiceUrl = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer';
const rainfallRules = { '24': 'rft_24hr', '48': 'rft_48hr', '72': 'rft_72hr' };
const qpfServiceUrl = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';
const spcServiceUrl = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';
const wpcServiceUrl = 'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';
const surfaceMapServiceUrl = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer';
const surfaceLayerSets = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  2: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  3: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]
};

function $(id) { return document.getElementById(id); }
function checked(id) { const el = $(id); return !!el && el.checked === true; }
function setCheck(id, value) { const el = $(id); if (el) el.checked = !!value; }
function dataEnabled(type) { const id = dataToggleIds[type]; return id ? checked(id) : true; }

// Case-insensitive property lookup.
// ArcGIS/SPC/WPC services return UPPERCASE fields (LABEL, VALID, EXPIRE, ISSUE, DN).
function ciProp(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  const lk = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lk && v !== undefined && v !== null) return v;
  }
  return undefined;
}
function firstValueCI(obj, keys, fallback = '') {
  for (const key of keys) {
    const v = ciProp(obj, key);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return fallback;
}
function isLayerOn(type) {
  return {
    radar: !!state.radarLayer,
    pastRadar: !!state.pastRadarLayer,
    alerts: !!state.alertLayer,
    qpf: !!state.qpfLayer,
    spc: !!state.spcLayer,
    wpc: !!state.wpcLayer,
    hrrr: !!state.hrrrLayer,
    county: !!state.countyLayer,
    temp: !!state.tempLayer,
    wind: !!state.windLayer,
    rainfall: !!state.rainfallLayer,
    airQuality: !!state.airQualityLayer,
    surface: !!state.surfaceLayer
  }[type];
}

function sanitizeForPanel(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function asNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!match) return null;
  const nums = match.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : null;
}

function formatDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return String(value);
}

function firstValue(properties, keys, fallback = '') {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function cToF(value) { const n = asNumber(value); return n === null ? null : (n * 9) / 5 + 32; }
function mpsToMph(value) { const n = asNumber(value); return n === null ? null : n * 2.2369362921; }
function metersToMiles(value) { const n = asNumber(value); return n === null ? null : n * 0.000621371; }
function metersToInches(value) { const n = asNumber(value); return n === null ? null : n * 39.3701; }
function metersToFeet(value) { const n = asNumber(value); return n === null ? null : n * 3.28084; }
function pascalToInHg(value) { const n = asNumber(value); return n === null ? null : n * 0.0002953; }
function formatMaybe(value, suffix = '', decimals = 0) { const n = asNumber(value); return n === null ? 'N/A' : `${n.toFixed(decimals)}${suffix}`; }
function formatInches(value) { const n = asNumber(value); if (n === null || n < 0) return 'No data'; if (n < 0.005) return 'Trace/0.00 in'; return `${n.toFixed(2)} in`; }
function rainfallLabel(period = state.rainfallPeriod) { return period === '24' ? 'Past 24 Hours' : period === '48' ? 'Past 48 Hours' : 'Past 72 Hours'; }
function localRadarTime(unixSeconds) { return new Date(unixSeconds * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

function updatePanel(title, html) {
  state.dataStack = {};
  const status = $('status');
  if (status) status.innerHTML = `<strong>${sanitizeForPanel(title)}</strong><br><br>${html}`;
}

function resetDataStack() {
  state.dataStack = {};
  state.clickRunId++;
}

function setStack(type, title, html, compact) {
  if (!type || !dataEnabled(type)) return;
  state.dataStack[type] = { title: String(title || stackLabels[type] || type), html: String(html || ''), compact: compact != null ? String(compact) : null };
  renderDataStack();
}
// setStackForce: always writes to DATA card regardless of the data toggle checkbox.
// Used for direct polygon clicks so clicking NWS/SPC/WPC always shows data.
function setStackForce(type, title, html, compact) {
  if (!type) return;
  state.dataStack[type] = { title: String(title || stackLabels[type] || type), html: String(html || ''), compact: compact != null ? String(compact) : null };
  renderDataStack();
}

function renderDataStack() {
  const status = $('status');
  if (!status) return;
  const types = stackOrder.filter(type => state.dataStack[type]);
  if (!types.length) {
    status.innerHTML = '<strong>Map Data</strong><br><br>Click/tap the map with an active data-card layer turned on.';
    return;
  }
  status.innerHTML = `
    <div class="stack-data-card-title">Map Click / Tap Data</div>
    <div class="stack-data-card-note">Showing checked active layer data for the selected point/polygon.</div>
    <div class="stack-data-sections">
      ${types.map(type => {
        const item = state.dataStack[type];
        return `<div class="stack-data-section stack-data-${type}">
          <div class="stack-data-title">${sanitizeForPanel(stackLabels[type] || type)}</div>
          <div class="stack-data-subtitle">${sanitizeForPanel(item.title)}</div>
          <div class="stack-data-body">${item.html}</div>
        </div>`;
      }).join('')}
    </div>`;
}

function dataRow(label, value) {
  if (value === null || value === undefined || value === '' || value === 'N/A') return '';
  return `<div class="data-row"><span>${sanitizeForPanel(label)}</span><span>${sanitizeForPanel(value)}</span></div>`;
}

function removeLayerSafe(layer) { try { if (layer && map.hasLayer(layer)) map.removeLayer(layer); } catch (_) {} }
function clearProbeMarkers() {
  removeLayerSafe(state.markers.radar); state.markers.radar = null;
  removeLayerSafe(state.markers.airQuality); state.markers.airQuality = null;
  if (state.markers.qpf) state.markers.qpf.clearLayers();
  if (state.markers.rainfall) state.markers.rainfall.clearLayers();
}

function toggleCard(id) { const el = $(id); if (el) el.classList.toggle('collapsed'); }

function setBasemap(type) {
  if (state.baseLayer) map.removeLayer(state.baseLayer);
  state.baseLayer = basemaps[type] || basemaps.standard;
  state.baseLayer.addTo(map);
  const menu = $('basemapMenu');
  if (menu) menu.classList.add('hidden');
  if (state.countyLayer?.bringToFront) setTimeout(() => state.countyLayer.bringToFront(), 100);
  updatePanel('Basemap', `${sanitizeForPanel(type.charAt(0).toUpperCase() + type.slice(1))} basemap selected.`);
}

function toggleBasemapMenu() { const menu = $('basemapMenu'); if (menu) menu.classList.toggle('hidden'); }

function showRbrtwCircle() {
  if (state.rbrtwCircle) return;
  state.rbrtwCircle = L.circle(RBRTW_AREA, { radius: 9000, color: '#ff3b3b', weight: 1, fillColor: '#ff3b3b', fillOpacity: 0.12 }).addTo(map);
}

function focusArea() {
  map.setView(RBRTW_AREA, 11);
  showRbrtwCircle();
  if (state.rbrtwMarker) state.rbrtwMarker.openTooltip();
}

function initRbrtwMarker() {
  state.rbrtwMarker = L.marker(RBRTW_AREA).addTo(map).bindTooltip('RBRTW AREA', { permanent: false, direction: 'top', className: 'hazard-tooltip' });
  showRbrtwCircle();
}

function getNwsPointData() {
  return fetch(`https://api.weather.gov/points/${RBRTW_AREA[0]},${RBRTW_AREA[1]}`, { headers: { Accept: 'application/geo+json' } })
    .then(response => { if (!response.ok) throw new Error('NWS point request failed'); return response.json(); });
}

async function loadNwsPointData() {
  try {
    const data = await getNwsPointData();
    updatePanel('RBRTW AREA', `Office: ${sanitizeForPanel(data.properties.cwa)}<br>Grid: ${sanitizeForPanel(data.properties.gridId)} ${sanitizeForPanel(data.properties.gridX)},${sanitizeForPanel(data.properties.gridY)}`);
  } catch (error) {
    updatePanel('Error', 'Could not load RBRTW AREA data.');
    console.error(error);
  }
}

async function loadCurrentConditions() {
  try {
    const point = await getNwsPointData();
    const stationList = await fetch(point.properties.observationStations).then(r => { if (!r.ok) throw new Error('Stations request failed'); return r.json(); });
    const stationUrl = `${stationList.features[0].id}/observations/latest`;
    const obs = await fetch(stationUrl).then(r => { if (!r.ok) throw new Error('Observation request failed'); return r.json(); });
    const p = obs.properties || {};
    const tempF = cToF(p.temperature?.value);
    const dewF = cToF(p.dewpoint?.value);
    const windMph = mpsToMph(p.windSpeed?.value);
    const gustMph = mpsToMph(p.windGust?.value);
    updatePanel('Current Conditions', `
      <div class="big-temp">${tempF === null ? 'N/A' : `${Math.round(tempF)}°F`}</div>
      ${sanitizeForPanel(p.textDescription || 'Current conditions')}<br><br>
      Dew Point: ${dewF === null ? 'N/A' : `${Math.round(dewF)}°F`}<br>
      Humidity: ${formatMaybe(p.relativeHumidity?.value, '%')}<br>
      Wind: ${windMph === null ? 'N/A' : `${Math.round(windMph)} mph`}<br>
      Wind Gust: ${gustMph === null ? 'N/A' : `${Math.round(gustMph)} mph`}<br>
      Updated: ${p.timestamp ? new Date(p.timestamp).toLocaleTimeString() : 'N/A'}
    `);
  } catch (error) {
    updatePanel('Current Conditions', 'Could not load current conditions.');
    console.error(error);
  }
}

async function loadForecast() {
  try {
    const point = await getNwsPointData();
    const data = await fetch(point.properties.forecast).then(r => { if (!r.ok) throw new Error('Forecast failed'); return r.json(); });
    updatePanel('Official NWS Forecast', (data.properties.periods || []).slice(0, 7).map(period => `
      <div style="margin-bottom:12px;"><strong>${sanitizeForPanel(period.name)}</strong><br>${sanitizeForPanel(period.temperature)}°${sanitizeForPanel(period.temperatureUnit)}<br>${sanitizeForPanel(period.shortForecast)}<br><small>${sanitizeForPanel(period.windSpeed)} ${sanitizeForPanel(period.windDirection)}</small></div>
    `).join(''));
  } catch (error) {
    updatePanel('Forecast', 'Could not load forecast.');
    console.error(error);
  }
}

async function loadHourlyForecast() {
  try {
    const point = await getNwsPointData();
    const data = await fetch(point.properties.forecastHourly).then(r => { if (!r.ok) throw new Error('Hourly forecast failed'); return r.json(); });
    updatePanel('Hourly NWS Forecast', (data.properties.periods || []).slice(0, 12).map(period => `
      <div style="margin-bottom:10px;"><strong>${new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' })}</strong> — ${sanitizeForPanel(period.temperature)}°${sanitizeForPanel(period.temperatureUnit)}, ${sanitizeForPanel(period.shortForecast)}</div>
    `).join(''));
  } catch (error) {
    updatePanel('Hourly Forecast', 'Could not load hourly forecast.');
    console.error(error);
  }
}

function updateLegend(type) { if (type !== 'county') legendTypes.add(type); renderLegends(); }
function clearLegend(type) { legendTypes.delete(type); renderLegends(); }

function keyRow(color, label, value = '') { return `<div class="mapkey-row"><span class="mapkey-swatch" style="background:${color}"></span><span class="mapkey-label">${label}</span><span class="mapkey-value">${value}</span></div>`; }
function keyLine(color, label, value = '') { return `<div class="mapkey-row"><span class="mapkey-line" style="border-color:${color}"></span><span class="mapkey-label">${label}</span><span class="mapkey-value">${value}</span></div>`; }
function keyNote(text) { return `<div class="mapkey-note">${sanitizeForPanel(text)}</div>`; }

function radarKeyHtml(sourceName) { return `${keyRow('#44ff44','Light','5–20 dBZ')}${keyRow('#ffff44','Moderate','20–35 dBZ')}${keyRow('#ff5500','Heavy','35–50 dBZ')}${keyRow('#ff0000','Strong','50–65 dBZ')}${keyRow('#ff00ff','Very intense','65–75 dBZ')}${keyRow('#ffffff','Extreme / possible hail core','75+ dBZ')}${keyNote(sourceName)}`; }
function qpfKeyHtml() { return `${keyRow('#d8f3dc','Very light','0.01–0.10 in')}${keyRow('#95d5b2','Light','0.10–0.25 in')}${keyRow('#52b788','Moderate','0.25–1.00 in')}${keyRow('#2d6a4f','Heavy','1.00–2.00 in')}${keyRow('#7209b7','Very heavy','2.00+ in')}`; }
function rainfallKeyHtml() { return `${keyRow('#e8f7ff','Trace','0.01–0.10 in')}${keyRow('#79c8ff','Light','0.10–0.50 in')}${keyRow('#0b72ff','Moderate','0.50–1.00 in')}${keyRow('#22c55e','Heavy','1.00–2.00 in')}${keyRow('#facc15','Very heavy','2.00–4.00 in')}${keyRow('#ef4444','Extreme','4.00+ in')}`; }
function spcKeyHtml() { return `${keyRow('#c1e9c1','General Thunder','Non-severe storms')}${keyRow('#66a366','Marginal','Level 1 of 5')}${keyRow('#ffe066','Slight','Level 2 of 5')}${keyRow('#ffa366','Enhanced','Level 3 of 5')}${keyRow('#e06666','Moderate','Level 4 of 5')}${keyRow('#ee99ee','High','Level 5 of 5')}`; }
function wpcKeyHtml() { return `${keyRow('#66a366','Marginal','At least 5%')}${keyRow('#ffe066','Slight','At least 15%')}${keyRow('#e06666','Moderate','At least 40%')}${keyRow('#ee99ee','High','At least 70%')}`; }
function alertKeyHtml() { return `${keyRow('#c026d3','Tornado','Warning/watch')}${keyRow('#facc15','Severe Thunderstorm','Warning/watch')}${keyRow('#16a34a','Flash Flood','Warning/watch')}${keyRow('#15803d','Flood','Warning/watch/advisory')}${keyRow('#ea580c','Heat','Watch/warning/advisory')}${keyRow('#60a5fa','Winter / Cold','Warning/advisory')}${keyRow('#dc2626','Other Alert','Active hazard')}`; }
function windKeyHtml() { return `${keyLine('#8fd3ff','Wind barb','Arrow points downwind')}${keyRow('#ffffff','Number','Wind speed mph')}`; }
function airQualityKeyHtml() { return `${keyRow('#00e400','Good','0.0–12.0')}${keyRow('#ffff00','Moderate','12.1–35.4')}${keyRow('#ff7e00','USG','35.5–55.4')}${keyRow('#ff0000','Unhealthy','55.5–150.4')}${keyRow('#8f3f97','Very Unhealthy','150.5–250.4')}${keyRow('#7e0023','Hazardous','250.5+')}`; }
function surfaceKeyHtml() { return `${keyRow('#ffffff','Highs / Lows','Pressure centers')}${keyLine('#1683ff','Cold Front','Boundary')}${keyLine('#ff3434','Warm Front','Boundary')}${keyLine('#7c3aed','Stationary Front','Boundary')}${keyLine('#9333ea','Occluded Front','Boundary')}${keyLine('#8b5a2b','Trough / Dryline','Boundary')}${keyRow('#7dd3fc','Rain / Thunderstorms','WPC area')}${keyRow('#fbbf24','Snow / Wintry Mix','WPC area')}${keyRow('#ef4444','Severe Possible','Hazard area')}${keyRow('#22c55e','Heavy Rain / Flood','Hazard area')}${keyRow('#f97316','Critical Fire Weather','Hazard area')}${keyRow('#93c5fd','Freezing Rain / Ice','Hazard area')}${keyRow('#e0f2fe','Heavy Snow','Hazard area')}${keyRow('#d8b4fe','Fog / Low Visibility','Hazard area')}`; }
function tempKeyHtml() {
  if (state.tempDisplayMode === 'heat') return `${keyRow('#facc15','Caution','80–89°F')}${keyRow('#f97316','Extreme Caution','90–102°F')}${keyRow('#dc2626','Danger','103–124°F')}${keyRow('#7f1d1d','Extreme Danger','125°F+')}`;
  if (state.tempDisplayMode === 'windchill') return `${keyRow('#2b1a78','Extreme cold','Below 0°F')}${keyRow('#4338ca','Very cold','0–14°F')}${keyRow('#2563eb','Cold','15–31°F')}${keyRow('#38bdf8','Chilly','32–50°F')}`;
  return `${keyRow('#4f8cff','Cold','Below 50°F')}${keyRow('#66d9ff','Cool','50–69°F')}${keyRow('#7bd88f','Mild','70–89°F')}${keyRow('#f5c542','Warm','90–99°F')}${keyRow('#ff3b3b','Hot','100°F+')}`;
}
function legendHtml(type) {
  return {
    radar: radarKeyHtml('NOAA/NWS MRMS reflectivity'),
    pastRadar: radarKeyHtml('RainViewer past radar playback'),
    hrrr: radarKeyHtml('HRRR simulated reflectivity'),
    qpf: qpfKeyHtml(),
    rainfall: rainfallKeyHtml(),
    spc: spcKeyHtml(),
    wpc: wpcKeyHtml(),
    alerts: alertKeyHtml(),
    temp: tempKeyHtml(),
    wind: windKeyHtml(),
    airQuality: airQualityKeyHtml(),
    surface: surfaceKeyHtml()
  }[type] || '';
}
function renderLegends() {
  const box = $('legendContent');
  if (!box) return;
  if (document.body.classList.contains('capture-hide-key')) { box.innerHTML = ''; return; }
  const active = [...legendTypes].filter(type => isLayerOn(type));
  if (!active.length) { box.innerHTML = document.body.classList.contains('capture-mode') ? '' : 'Turn on a layer to view its legend.'; return; }
  const titles = { radar: 'Radar Reflectivity', pastRadar: 'Past Radar', hrrr: 'HRRR Future Radar', qpf: 'WPC QPF Forecast', rainfall: 'Rainfall Totals / QPE', spc: 'SPC Outlook', wpc: 'WPC Excessive Rainfall', alerts: 'NWS Alerts', temp: state.tempDisplayMode === 'heat' ? 'Heat Index' : state.tempDisplayMode === 'windchill' ? 'Wind Chill' : 'Temperature', wind: 'Wind Barbs', airQuality: 'Air Quality', surface: 'Surface Map' };
  box.innerHTML = active.map(type => `<div class="legend-section export-key-section" data-key-type="${type}"><div class="legend-section-title export-key-title">${titles[type] || type}</div><div class="export-key-items">${legendHtml(type)}</div></div>`).join('');
}

function alertColorFromEvent(eventName = '') {
  const event = String(eventName).toLowerCase();
  if (event.includes('tornado')) return '#c026d3';
  if (event.includes('severe thunderstorm')) return '#facc15';
  if (event.includes('flash flood')) return '#16a34a';
  if (event.includes('flood')) return '#15803d';
  if (event.includes('winter') || event.includes('cold')) return '#60a5fa';
  if (event.includes('heat')) return '#ea580c';
  if (event.includes('fire')) return '#dc2626';
  if (event.includes('wind')) return '#a16207';
  if (event.includes('marine')) return '#0ea5e9';
  return '#dc2626';
}

function riskLabelFromDn(dn, source) {
  const n = Number(dn);
  if (source === 'WPC') return { 1: 'Marginal — at least 5% chance of flash flooding', 2: 'Slight — at least 15% chance of flash flooding', 3: 'Moderate — at least 40% chance of flash flooding', 4: 'High — at least 70% chance of flash flooding' }[n] || '';
  if (source === 'SPC') return { 2: 'Thunderstorm', 3: 'Marginal', 4: 'Slight', 5: 'Enhanced', 6: 'Moderate', 8: 'High' }[n] || '';
  return '';
}

// Plain-English explanations for SPC categorical risk levels.
// General wording only — no specific hazard claims without actual hazard-probability data.
function spcRiskExplanation(labelOrDn) {
  const s = String(labelOrDn || '').toLowerCase();
  const n = Number(labelOrDn);
  const disclaimer = 'Specific hazard types (wind, hail, tornadoes) vary by storm mode and location — check the SPC forecast discussion at spc.noaa.gov for details. This card reflects categorical outlook risk only, not a warning or watch.';
  if (s.includes('high') || n === 8)     return `HIGH (Level 5 of 5): A major severe weather outbreak is expected. This is a rare designation used only when high confidence exists in a widespread, significant event. ${disclaimer}`;
  if (s.includes('moderate') || n === 6) return `MODERATE (Level 4 of 5): Widespread severe thunderstorms are likely across the outlook area. ${disclaimer}`;
  if (s.includes('enhanced') || n === 5) return `ENHANCED (Level 3 of 5): Numerous severe thunderstorms are possible. An above-normal risk with well-organized storm potential. ${disclaimer}`;
  if (s.includes('slight') || n === 4)   return `SLIGHT (Level 2 of 5): Scattered severe thunderstorms are possible. ${disclaimer}`;
  if (s.includes('marginal') || n === 3) return `MARGINAL (Level 1 of 5): Isolated severe thunderstorms are possible. Hazards are limited in coverage or intensity. ${disclaimer}`;
  if (s.includes('thunder') || n === 2)  return `GENERAL THUNDER: Non-severe thunderstorms are the primary threat. May include lightning, gusty winds, and locally heavy rain. ${disclaimer}`;
  return '';
}
// WPC Excessive Rainfall Outlook explanations — focused on flash flooding probability.
function wpcRiskExplanation(labelOrDn) {
  const s = String(labelOrDn || '').toLowerCase();
  const n = Number(labelOrDn);
  if (s.includes('high') || n === 4)     return 'HIGH excessive rainfall risk (≥70% probability): Life-threatening flash flooding is likely. This is a very rare WPC designation for extreme rainfall events. Not a warning or watch — check NWS local offices for official warnings.';
  if (s.includes('moderate') || n === 3) return 'MODERATE excessive rainfall risk (≥40% probability): Flash flooding is a significant concern. Locally heavy rainfall is likely to produce flooding in susceptible areas.';
  if (s.includes('slight') || n === 2)   return 'SLIGHT excessive rainfall risk (≥15% probability): Flash flooding is possible, particularly in poor-drainage areas, urban zones, or where soils are already saturated.';
  if (s.includes('marginal') || n === 1) return 'MARGINAL excessive rainfall risk (≥5% probability): Isolated flash flooding is possible from brief, intense convective rainfall.';
  return '';
}

function hazardPanel(source, properties = {}, extra = {}) {
  // Case-insensitive lookup because ArcGIS/SPC/WPC return UPPERCASE keys
  const product = firstValueCI(properties, ['event','headline','LABEL2','label2','label','LABEL','product','outlook','VALID','valid','phenomena','name','title'], `${source} Hazard`);
  const riskRaw = firstValueCI(properties, ['LABEL2','label2','outlook','label','LABEL','risk','category','CATEGORY'], '');
  const dnVal   = ciProp(properties,'dn') ?? ciProp(properties,'DN') ?? ciProp(properties,'gridcode') ?? ciProp(properties,'GRIDCODE');
  const risk    = riskRaw || riskLabelFromDn(dnVal, source);
  const rows = [];
  if (extra.layerName) rows.push(['Layer', extra.layerName]);
  if (extra.dayLabel)  rows.push(['Forecast Day', extra.dayLabel]);
  // Always show Risk / Category — even when it equals the product title
  const displayRisk = risk || product;
  if (displayRisk) rows.push(['Risk / Category', displayRisk]);
  // Add plain-English "What this means" for SPC and WPC outlooks
  const isSpc = String(source).toLowerCase().includes('spc');
  const isWpc = String(source).toLowerCase().includes('wpc');
  if (isSpc) { const exp = spcRiskExplanation(displayRisk || dnVal); if (exp) rows.push(['What this means', exp]); }
  else if (isWpc) { const exp = wpcRiskExplanation(displayRisk || dnVal); if (exp) rows.push(['What this means', exp]); }
  ['severity','urgency','certainty'].forEach(k => { const v = ciProp(properties, k); if (v) rows.push([k[0].toUpperCase() + k.slice(1), String(v)]); });
  const area    = firstValueCI(properties, ['areaDesc','area','location','states'], '');
  if (area) rows.push(['Area', area]);
  const headline = firstValueCI(properties, ['headline','HEADLINE'], '');
  if (headline && headline !== product) rows.push(['Headline', headline]);
  const issued  = formatDateValue(firstValueCI(properties, ['ISSUE','issue','issue_time','sent','effective','onset'], ''));
  const valid   = formatDateValue(firstValueCI(properties, ['VALID','valid','valid_time','start_time'], ''));
  const expires = formatDateValue(firstValueCI(properties, ['EXPIRE','expire','expires','end_time','ends'], ''));
  if (issued)  rows.push(['Issued', issued]);
  if (valid)   rows.push(['Valid / Starts', valid]);
  if (expires) rows.push(['Expires / Ends', expires]);
  const desc = firstValueCI(properties, ['description','snippet','summary','discussion','text'], '');
  if (desc)  rows.push(['Details', desc.length > 600 ? desc.slice(0,600) + '…' : desc]);
  if (ciProp(properties,'instruction')) rows.push(['Action', String(ciProp(properties,'instruction')).slice(0,400)]);
  const html = rows.map(([l,v]) => `<div class="hazard-detail-row"><span>${sanitizeForPanel(l)}:</span> ${sanitizeForPanel(v)}</div>`).join('') || 'No detailed properties were returned for this polygon.';
  // Compact version for PNG export
  const cParts = [];
  if (displayRisk) cParts.push(`<strong>${sanitizeForPanel(displayRisk)}</strong>`);
  if (valid)   cParts.push(`Valid: ${sanitizeForPanel(valid)}`);
  if (expires) cParts.push(`Expires: ${sanitizeForPanel(expires)}`);
  if (headline && headline !== product && headline.length < 120) cParts.push(sanitizeForPanel(headline));
  else if (area && !headline) cParts.push(sanitizeForPanel(area.slice(0,80)));
  const compact = cParts.join('<br>') || 'See DATA card for details.';
  return { title: `${source}: ${sanitizeForPanel(product)}`, html, compact };
}

function hazardTypeFromSource(source) {
  const s = String(source).toLowerCase();
  if (s.includes('spc')) return 'spc';
  if (s.includes('wpc')) return 'wpc';
  return 'alerts';
}

function bindHazardFeature(layer, source, feature, extra = {}) {
  const details = hazardPanel(source, feature?.properties || {}, extra);
  const type = hazardTypeFromSource(source);
  if (layer.unbindPopup) layer.unbindPopup();
  layer.bindTooltip(details.title, { sticky: true, direction: 'top', className: 'hazard-tooltip' });
  layer.on('click', async event => {
    lastPolygonClickTime = Date.now(); // guard against map.on('click') overwrite
    if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
    clearProbeMarkers();
    resetDataStack();
    const locNote = event?.latlng ? `<br><small>Location: ${event.latlng.lat.toFixed(4)}, ${event.latlng.lng.toFixed(4)}</small>` : '';
    // setStackForce: always populates DATA regardless of small data-card checkbox
    setStackForce(type, details.title, details.html + locNote, details.compact);
    if (event?.latlng) await runAllCheckedPointData(event.latlng, [type]);
  });
  layer.on('mouseover', () => { if (layer.setStyle) layer.setStyle({ weight: 5, opacity: 1 }); });
  layer.on('mouseout',  () => { if (layer.setStyle) layer.setStyle({ weight: 3, opacity: 1 }); });
}

async function toggleAlerts() {
  if (state.alertLayer) { removeLayerSafe(state.alertLayer); state.alertLayer = null; setCheck('alertsCheck', false); clearLegend('alerts'); updatePanel('NWS Alerts / Statements', 'Alert and statement layer turned off.'); return; }
  try {
    updatePanel('NWS Alerts / Statements', 'Loading active Texas NWS alert polygons...');
    const data = await fetch('https://api.weather.gov/alerts/active?area=TX', { headers: { Accept: 'application/geo+json' } }).then(r => { if (!r.ok) throw new Error('Alerts request failed'); return r.json(); });
    const features = (data.features || []).filter(f => f.geometry);
    state.alertLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
      style: feature => { const color = alertColorFromEvent(feature.properties?.event || ''); return { color, weight: 3, opacity: 0.95, fillColor: color, fillOpacity: 0.2 }; },
      onEachFeature: (feature, layer) => bindHazardFeature(layer, 'NWS Alert / Statement', feature)
    }).addTo(map);
    setCheck('alertsCheck', true); updateLegend('alerts');
    updatePanel('Active NWS Alerts / Statements', `Polygon products loaded: ${features.length}<br>Click/tap a polygon to write details to the DATA card.`);
  } catch (error) { console.error(error); setCheck('alertsCheck', false); updatePanel('NWS Alerts / Statements', 'Could not load alerts/statements.'); }
}

function spcRiskColor(feature) {
  const p = feature?.properties || {};
  const text = String(p.LABEL || p.label || p.CATEGORICAL || p.outlook || p.RISK || p.risk || '').toLowerCase();
  const dn = Number(p.dn ?? p.DN ?? p.gridcode ?? p.GRIDCODE);
  if (text.includes('high') || dn === 8) return '#ee99ee';
  if (text.includes('moderate') || dn === 6) return '#e06666';
  if (text.includes('enhanced') || dn === 5) return '#ffa366';
  if (text.includes('slight') || dn === 4) return '#ffe066';
  if (text.includes('marginal') || dn === 3) return '#66a366';
  return '#c1e9c1';
}
function wpcRiskColor(feature) {
  const p = feature?.properties || {};
  const text = String(p.LABEL || p.label || p.CATEGORY || p.category || p.RISK || p.risk || '').toLowerCase();
  const dn = Number(p.dn ?? p.DN ?? p.gridcode ?? p.GRIDCODE);
  if (text.includes('high') || dn === 4) return '#ee99ee';
  if (text.includes('moderate') || dn === 3) return '#e06666';
  if (text.includes('slight') || dn === 2) return '#ffe066';
  return '#66a366';
}
async function fetchArcGisGeoJson(url, layerId, params = {}) {
  const q = new URLSearchParams({ f: 'geojson', where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', ...params });
  const response = await fetch(`${url}/${layerId}/query?${q}`);
  if (!response.ok) throw new Error(`ArcGIS query failed for layer ${layerId}`);
  return response.json();
}
// SPC Day picker — layer IDs: 1=Day1 categorical, 2=Day2 categorical, 3=Day3 any thunder
const spcDayLayerIds = { 1: 1, 2: 2, 3: 3 };
function setSpcChecks(day) { setCheck('spcDay1Check', day === 1); setCheck('spcDay2Check', day === 2); setCheck('spcDay3Check', day === 3); }
function setSpcDay(day) {
  state.spcDay = Number(day) || 1;
  setSpcChecks(state.spcDay);
  $('spcDayToggles')?.classList.remove('hidden');
  if (!state.spcLayer) return;
  // Reload layer for new day
  removeLayerSafe(state.spcLayer); state.spcLayer = null;
  _loadSpcLayer();
}
async function _loadSpcLayer() {
  const layerId = spcDayLayerIds[state.spcDay] || 1;
  const data = await fetchArcGisGeoJson(spcServiceUrl, layerId);
  const features = (data.features || []).filter(f => f.geometry);
  state.spcLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: f => { const color = spcRiskColor(f); return { color, weight: 3, opacity: 0.98, fillColor: color, fillOpacity: Number($('spcOpacity')?.value || 0.35) }; },
    onEachFeature: (feature, layer) => bindHazardFeature(layer, 'SPC', feature, { dayLabel: `Day ${state.spcDay} Convective Outlook` })
  }).addTo(map);
  setCheck('spcCheck', true); updateLegend('spc');
  updatePanel('SPC Outlook', `SPC Day ${state.spcDay} Convective Outlook loaded.<br>Polygons: ${features.length}.<br>Click a highlighted polygon to see risk details in the DATA card.`);
}
async function toggleSpc() {
  if (state.spcLayer) {
    removeLayerSafe(state.spcLayer); state.spcLayer = null; setCheck('spcCheck', false); clearLegend('spc');
    $('spcDayToggles')?.classList.add('hidden');
    updatePanel('SPC Outlook', 'SPC outlook layer turned off.'); return;
  }
  try {
    $('spcDayToggles')?.classList.remove('hidden');
    setSpcChecks(state.spcDay);
    updatePanel('SPC Outlook', `Loading SPC Day ${state.spcDay} outlook polygons…`);
    await _loadSpcLayer();
  } catch (error) { console.error(error); if (state.spcLayer) { removeLayerSafe(state.spcLayer); state.spcLayer = null; } setCheck('spcCheck', false); $('spcDayToggles')?.classList.add('hidden'); updatePanel('SPC Outlook', 'Could not load SPC outlook polygons.'); }
}
// WPC Day picker — WPC Excessive Rainfall Outlook layer sets per day
const wpcDayLayerSets = { 1: [0, 1], 2: [2, 3], 3: [4, 5] };
function setWpcChecks(day) { setCheck('wpcDay1Check', day === 1); setCheck('wpcDay2Check', day === 2); setCheck('wpcDay3Check', day === 3); }
function setWpcDay(day) {
  state.wpcDay = Number(day) || 1;
  setWpcChecks(state.wpcDay);
  $('wpcDayToggles')?.classList.remove('hidden');
  if (!state.wpcLayer) return;
  removeLayerSafe(state.wpcLayer); state.wpcLayer = null;
  _loadWpcLayer();
}
async function _loadWpcLayer() {
  state.wpcLayer = L.layerGroup().addTo(map);
  let total = 0;
  const layerIds = wpcDayLayerSets[state.wpcDay] || [0, 1];
  for (const id of layerIds) {
    try {
      const data = await fetchArcGisGeoJson(wpcServiceUrl, id);
      const features = (data.features || []).filter(f => f.geometry);
      if (!features.length) continue;
      L.geoJSON({ type: 'FeatureCollection', features }, {
        style: f => { const color = wpcRiskColor(f); return { color, weight: 3, opacity: 0.98, fillColor: color, fillOpacity: Number($('wpcOpacity')?.value || 0.6) }; },
        onEachFeature: (feature, layer) => bindHazardFeature(layer, 'WPC', feature, { dayLabel: `Day ${state.wpcDay} Excessive Rainfall Outlook` })
      }).addTo(state.wpcLayer);
      total += features.length;
    } catch (layerError) { console.warn('WPC layer failed', id, layerError); }
  }
  setCheck('wpcCheck', true); updateLegend('wpc');
  updatePanel('WPC Outlook', `WPC Day ${state.wpcDay} Excessive Rainfall Outlook loaded.<br>Polygons: ${total}.<br>Click a highlighted polygon to see risk details in the DATA card.`);
}
async function toggleWpc() {
  if (state.wpcLayer) {
    removeLayerSafe(state.wpcLayer); state.wpcLayer = null; setCheck('wpcCheck', false); clearLegend('wpc');
    $('wpcDayToggles')?.classList.add('hidden');
    updatePanel('WPC Outlook', 'WPC outlook layer turned off.'); return;
  }
  try {
    $('wpcDayToggles')?.classList.remove('hidden');
    setWpcChecks(state.wpcDay);
    updatePanel('WPC Outlook', `Loading WPC Day ${state.wpcDay} excessive-rainfall outlook…`);
    await _loadWpcLayer();
  } catch (error) { console.error(error); removeLayerSafe(state.wpcLayer); state.wpcLayer = null; setCheck('wpcCheck', false); $('wpcDayToggles')?.classList.add('hidden'); updatePanel('WPC Outlook', 'Could not load WPC outlook polygons.'); }
}

function setLayerOpacity(type) {
  const value = Number($(`${type}Opacity`)?.value || 0.65);
  if (type === 'radar') { if (state.radarLayer) state.radarLayer.setOpacity(value); if (state.pastRadarLayer) state.pastRadarLayer.setOpacity(value); }
  if (type === 'qpf' && state.qpfLayer) {
    // QPF is now a GeoJSON layer — must use setStyle, not setOpacity
    state.qpfLayer.setStyle(f => {
      const v = extractQpfValue({ attributes: f.properties, properties: f.properties });
      const s = qpfStyle(v);
      if (!s) return { fillOpacity: 0, weight: 0 };
      return { fillColor: s.fill, color: s.stroke, fillOpacity: value, weight: 1, opacity: 0.9 };
    });
  }
  if (type === 'spc' && state.spcLayer) state.spcLayer.setStyle({ fillOpacity: value, opacity: 0.98 });
  if (type === 'wpc' && state.wpcLayer) state.wpcLayer.eachLayer(layer => layer.setStyle && layer.setStyle({ fillOpacity: value, opacity: 0.98 }));
  if (type === 'county' && state.countyLayer) state.countyLayer.setStyle(countyStyle());
  if (type === 'hrrr' && state.hrrrLayer) state.hrrrLayer.setOpacity(value);
  if (type === 'wind' && state.windLayer) state.windLayer.eachLayer(layer => { const el = layer.getElement?.(); if (el) el.style.setProperty('--wind-opacity', value); });
  if (type === 'rainfall' && state.rainfallLayer) state.rainfallLayer.setOpacity(value);
  if (type === 'airQuality' && state.airQualityLayer) state.airQualityLayer.setOpacity(value);
  if (type === 'surface' && state.surfaceLayer) state.surfaceLayer.setOpacity(value);
}

function toggleRadar() {
  if (state.radarLayer) { removeLayerSafe(state.radarLayer); state.radarLayer = null; setCheck('radarCheck', false); clearLegend('radar'); updatePanel('Radar', 'NOAA/NWS MRMS radar layer turned off.'); return; }
  if (state.pastRadarLayer || state.radarFrames.length) turnOffPastRadar(false);
  state.radarLayer = L.tileLayer.wms('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows', {
    layers: 'conus_bref_qcd', format: 'image/png', transparent: true, opacity: Number($('radarOpacity')?.value || 0.7), attribution: 'NOAA/NWS/NCEP MRMS Radar', crossOrigin: true
  }).addTo(map);
  setCheck('radarCheck', true); setCheck('pastRadarCheck', false); updateLegend('radar');
  updatePanel('Radar', `NOAA/NWS MRMS radar layer is on.<br>Target data is click/tap only. Radar values are strictly filtered to avoid false hail/severe text.`);
}

async function loadRadarFrames() {
  const data = await fetch(`https://api.rainviewer.com/public/weather-maps.json?cache=${Date.now()}`).then(r => { if (!r.ok) throw new Error('Past radar timeline request failed'); return r.json(); });
  state.radarHost = data.host; state.radarFrames = data?.radar?.past || []; state.radarIndex = state.radarFrames.length - 1;
  if (!state.radarFrames.length) throw new Error('No past radar frames returned.');
  const slider = $('radarFrameSlider'); if (slider) { slider.max = state.radarFrames.length - 1; slider.value = state.radarIndex; }
}
function showRadarFrame(index) {
  if (!state.radarFrames.length || !state.radarHost) return;
  if (state.pastRadarLayer) map.removeLayer(state.pastRadarLayer);
  state.radarIndex = (index + state.radarFrames.length) % state.radarFrames.length;
  const frame = state.radarFrames[state.radarIndex];
  state.pastRadarLayer = L.tileLayer(`${state.radarHost}${frame.path}/256/{z}/{x}/{y}/2/0_0.png`, { opacity: Number($('radarOpacity')?.value || 0.7), tileSize: 256, maxZoom: 19, maxNativeZoom: 7, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', attribution: 'Past Radar: RainViewer', crossOrigin: true }).addTo(map);
  const slider = $('radarFrameSlider'); if (slider) slider.value = state.radarIndex;
  const label = $('radarFrameLabel'); if (label) label.textContent = localRadarTime(frame.time);
}
function turnOffPastRadar(message = true) {
  stopRadarAnimation(); removeLayerSafe(state.pastRadarLayer); state.pastRadarLayer = null; state.radarFrames = []; state.radarHost = '';
  $('radarTimeline')?.classList.add('hidden'); setCheck('pastRadarCheck', false); clearLegend('pastRadar'); if (message) updatePanel('Past Radar', 'Past radar playback turned off.');
}
async function togglePastRadar() {
  if (state.pastRadarLayer || state.radarFrames.length) { turnOffPastRadar(true); return; }
  try {
    removeLayerSafe(state.radarLayer); state.radarLayer = null; setCheck('radarCheck', false); clearLegend('radar');
    await loadRadarFrames(); $('radarTimeline')?.classList.remove('hidden'); showRadarFrame(state.radarIndex); setCheck('pastRadarCheck', true); updateLegend('pastRadar');
    updatePanel('Past Radar Playback', `Past radar timeline loaded.<br>Frames: ${state.radarFrames.length}<br>Current frame: ${localRadarTime(state.radarFrames[state.radarIndex].time)}.`);
  } catch (error) { console.error(error); setCheck('pastRadarCheck', false); updatePanel('Past Radar', 'Could not load past radar timeline.'); }
}
function setRadarFrameFromSlider() { stopRadarAnimation(); showRadarFrame(Number($('radarFrameSlider')?.value || 0)); }
function nextRadarFrame() { showRadarFrame(state.radarIndex + 1); }
function previousRadarFrame() { showRadarFrame(state.radarIndex - 1); }
function toggleRadarAnimation() { if (state.radarTimer) { stopRadarAnimation(); return; } if (!state.radarFrames.length) return; state.radarTimer = setInterval(() => showRadarFrame(state.radarIndex + 1), 700); if ($('radarPlayBtn')) $('radarPlayBtn').textContent = 'Pause'; if ($('radarLoopText')) $('radarLoopText').textContent = 'Loop playing'; }
function stopRadarAnimation() { if (state.radarTimer) clearInterval(state.radarTimer); state.radarTimer = null; if ($('radarPlayBtn')) $('radarPlayBtn').textContent = 'Play'; if ($('radarLoopText')) $('radarLoopText').textContent = 'Loop paused'; }

function extractRadarDbzValue(raw) {
  const valid = value => {
    const n = Number(value);
    return Number.isFinite(n) && n >= -35 && n <= 80 ? n : null;
  };
  const strongKeys = ['GRAY_INDEX','gray_index','grid_value','GRID_VALUE','pixelValue','PixelValue','value','Value','VALUE','reflectivity','Reflectivity','dbz','dBZ','DBZ','Band1','BAND1','PALETTE_INDEX','palette_index'];
  function parseKnownText(text) {
    const s = String(text || '');
    for (const key of strongKeys) {
      const re = new RegExp(`${key}\\s*(?:=|:|</th>\\s*<td>|</td>\\s*<td>)\\s*[^-0-9]*(-?\\d+(?:\\.\\d+)?)`, 'i');
      const m = s.match(re);
      if (m) {
        const n = valid(m[1]);
        if (n !== null) return n;
      }
    }
    const labelDbz = s.match(/(-?\d+(?:\.\d+)?)\s*(?:dBZ|dbz)/i);
    if (labelDbz) return valid(labelDbz[1]);
    return null;
  }
  function walk(obj, depth = 0) {
    if (obj === null || obj === undefined || depth > 8) return null;
    if (typeof obj === 'string') return parseKnownText(obj);
    if (typeof obj === 'number') return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const n = walk(item, depth + 1);
        if (n !== null) return n;
      }
      return null;
    }
    if (typeof obj === 'object') {
      for (const container of [obj.properties, obj.attributes, obj].filter(Boolean)) {
        for (const [k, v] of Object.entries(container)) {
          if (!strongKeys.some(key => key.toLowerCase() === String(k).toLowerCase())) continue;
          const n = valid(v);
          if (n !== null) return n;
          const tn = parseKnownText(v);
          if (tn !== null) return tn;
        }
      }
      for (const v of Object.values(obj)) {
        const n = walk(v, depth + 1);
        if (n !== null) return n;
      }
    }
    return null;
  }
  return walk(raw);
}
function radarCategory(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { label: 'No dBZ value', color: '#ffffff' };
  if (n >= 75) return { label: 'Extreme / possible hail core', color: '#ffffff' };
  if (n >= 65) return { label: 'Very intense', color: '#ff00ff' };
  if (n >= 50) return { label: 'Strong', color: '#ff0000' };
  if (n >= 35) return { label: 'Heavy', color: '#ff5500' };
  if (n >= 20) return { label: 'Moderate', color: '#ffff44' };
  return { label: 'Light', color: '#44ff44' };
}
function radarCategoryMeaning(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('extreme')) return 'Extreme reflectivity can indicate a very intense storm core and possible hail, but it does not confirm hail at the ground.';
  if (key.includes('very intense')) return 'Very intense reflectivity suggests a strong storm core with heavy rain and possibly small hail aloft.';
  if (key.includes('strong')) return 'Strong reflectivity usually means a storm core with very heavy rain, frequent lightning, and stronger storm potential.';
  if (key.includes('heavy')) return 'Heavy reflectivity usually means heavy rain is likely at or near the selected point.';
  if (key.includes('moderate')) return 'Moderate reflectivity usually means steady rain or a developing shower/storm.';
  if (key.includes('light')) return 'Light reflectivity usually means light rain, drizzle, or a weak shower.';
  return 'No clear radar category was found at the selected point.';
}
function radarEstimateFromPixelColor(r, g, b, a) {
  if (!Number.isFinite(a) || a < 18) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 35) return null;

  // White / near-white is the top of the RBRTW radar key.
  // Treat it as extreme reflectivity / possible hail core, not confirmed hail.
  if (r >= 230 && g >= 230 && b >= 230) {
    return { value: 78, label: 'Extreme / possible hail core', color: '#ffffff', rgb: [255, 255, 255], distance: 0 };
  }

  // Ignore gray basemap/label pixels; radar returns should have a meaningful color bias.
  if (max - min < 10) return null;

  const palette = [
    { value: 12, label: 'Light', color: '#44ff44', rgb: [68, 255, 68] },
    { value: 18, label: 'Light', color: '#66d9ff', rgb: [102, 217, 255] },
    { value: 27, label: 'Moderate', color: '#ffff44', rgb: [255, 255, 68] },
    { value: 42, label: 'Heavy', color: '#ff5500', rgb: [255, 85, 0] },
    { value: 57, label: 'Strong', color: '#ff0000', rgb: [255, 0, 0] },
    { value: 70, label: 'Very intense', color: '#ff00ff', rgb: [255, 0, 255] },
    { value: 75, label: 'Very intense', color: '#8b00ff', rgb: [139, 0, 255] }
  ];
  let best = null;
  for (const item of palette) {
    const d = Math.hypot(r - item.rgb[0], g - item.rgb[1], b - item.rgb[2]);
    if (!best || d < best.distance) best = { ...item, distance: d };
  }
  if (!best || best.distance > 210) return null;
  return best;
}

async function estimateRadarFromRenderedPixel(latlng) {
  const delta = 0.035;
  const bbox = `${latlng.lng - delta},${latlng.lat - delta},${latlng.lng + delta},${latlng.lat + delta}`;
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: 'conus_bref_qcd',
    styles: '',
    bbox,
    width: '5',
    height: '5',
    srs: 'EPSG:4326',
    format: 'image/png',
    transparent: 'true'
  });
  const url = `https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?${params.toString()}`;
  try {
    const blob = await fetch(url, { mode: 'cors' }).then(r => { if (!r.ok) throw new Error('radar pixel fallback failed'); return r.blob(); });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let best = null;
    for (let i = 0; i < data.length; i += 4) {
      const est = radarEstimateFromPixelColor(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (!est) continue;
      if (!best || est.value > best.value) best = est;
    }
    if (!best) return null;
    return {
      value: best.value,
      method: 'Rendered radar color fallback',
      estimated: true,
      estimatedLabel: best.label,
      estimatedColor: best.color
    };
  } catch (error) {
    console.warn('Radar rendered-pixel fallback failed', error);
    return null;
  }
}

async function identifyRadarAt(latlng) {
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(latlng);
  const b = map.getBounds();
  const sw3857 = L.CRS.EPSG3857.project(b.getSouthWest());
  const ne3857 = L.CRS.EPSG3857.project(b.getNorthEast());
  const attempts = [
    { version: '1.1.1', crsKey: 'srs', crs: 'EPSG:3857', bbox: `${sw3857.x},${sw3857.y},${ne3857.x},${ne3857.y}`, xKey: 'x', yKey: 'y', x: Math.round(pt.x), y: Math.round(pt.y) },
    { version: '1.1.1', crsKey: 'srs', crs: 'EPSG:4326', bbox: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, xKey: 'x', yKey: 'y', x: Math.round(pt.x), y: Math.round(pt.y) },
    { version: '1.3.0', crsKey: 'crs', crs: 'EPSG:3857', bbox: `${sw3857.x},${sw3857.y},${ne3857.x},${ne3857.y}`, xKey: 'i', yKey: 'j', x: Math.round(pt.x), y: Math.round(pt.y) },
    { version: '1.3.0', crsKey: 'crs', crs: 'EPSG:4326', bbox: `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`, xKey: 'i', yKey: 'j', x: Math.round(pt.x), y: Math.round(pt.y) }
  ];
  const layerNames = ['conus_bref_qcd', 'conus:conus_bref_qcd'];
  const formats = ['application/json', 'text/plain', 'text/html'];

  for (const layerName of layerNames) {
    for (const a of attempts) {
      for (const info_format of formats) {
        const params = new URLSearchParams({
          service: 'WMS',
          version: a.version,
          request: 'GetFeatureInfo',
          layers: layerName,
          query_layers: layerName,
          styles: '',
          bbox: a.bbox,
          height: String(size.y),
          width: String(size.x),
          format: 'image/png',
          transparent: 'true',
          feature_count: '10',
          info_format
        });
        params.set(a.crsKey, a.crs);
        params.set(a.xKey, String(a.x));
        params.set(a.yKey, String(a.y));
        try {
          const res = await fetch(`https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?${params.toString()}`);
          if (!res.ok) continue;
          const raw = info_format.includes('json') ? await res.json() : await res.text();
          const value = extractRadarDbzValue(raw);
          if (value !== null) return { value, raw, method: `${layerName} ${a.version} ${a.crs} ${info_format}`, estimated: false };
        } catch (_) {}
      }
    }
  }

  const estimated = await estimateRadarFromRenderedPixel(latlng);
  if (estimated) return estimated;
  return { value: null, method: 'No trusted dBZ value returned', estimated: false };
}
async function runRadarPoint(latlng) {
  if (!state.radarLayer || !dataEnabled('radar')) return false;
  const result = await identifyRadarAt(latlng);
  const value = result.value;
  const cat = result.estimated && result.estimatedLabel
    ? { label: result.estimatedLabel, color: result.estimatedColor || '#44ff44' }
    : radarCategory(value);
  const text = value === null
    ? 'Radar return selected'
    : result.estimated
      ? `${cat.label} return`
      : `${value.toFixed(1)} dBZ`;
  removeLayerSafe(state.markers.radar);
  state.markers.radar = L.marker(latlng, {
    icon: L.divIcon({
      className: 'radar-probe-icon',
      html: `<div class="radar-dot" style="background:${cat.color}">R</div><div class="radar-value">${sanitizeForPanel(text)}</div>`,
      iconSize: [124, 48],
      iconAnchor: [62, 24]
    }),
    interactive: false
  }).addTo(map);
  const explanation = radarCategoryMeaning(cat.label);
  setStack('radar', 'Radar Point', `Category: <strong>${sanitizeForPanel(cat.label)}</strong><br><br>${sanitizeForPanel(explanation)}`, `Category: <strong>${sanitizeForPanel(cat.label)}</strong>`);
  return true;
}
function runPastRadarPoint(latlng) {
  if (!state.pastRadarLayer || !dataEnabled('pastRadar')) return false;
  const frame = state.radarFrames[state.radarIndex] || {};
  setStack('pastRadar', 'Past Radar Point', `Frame: <strong>${frame.time ? sanitizeForPanel(localRadarTime(frame.time)) : 'Latest'}</strong><br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>RainViewer playback tiles do not expose pixel dBZ sampling.`);
  return true;
}

// QPF Day picker — WPC QPF MapServer layer IDs per day
const qpfDayLayerIds = { 1: 1, 2: 2, 3: 3 }; // 1=24hr Day1, 2=24hr Day2, 3=24hr Day3
const qpfDayNames   = { 1: 'QPF 24-Hour Day 1', 2: 'QPF 24-Hour Day 2', 3: 'QPF 24-Hour Day 3' };
function setQpfChecks(day) { setCheck('qpfDay1Check', day === 1); setCheck('qpfDay2Check', day === 2); setCheck('qpfDay3Check', day === 3); }

// Color scale matches qpfKeyHtml() exactly so map and legend are always in sync
function qpfStyle(inchesVal) {
  const v = asNumber(inchesVal);
  if (v === null || v < 0.01) return null; // no fill for no-data or 0
  let fill, stroke;
  if (v >= 2.0)  { fill = '#7209b7'; stroke = '#5c0899'; } // Very heavy
  else if (v >= 1.0) { fill = '#2d6a4f'; stroke = '#1e4d38'; } // Heavy
  else if (v >= 0.25){ fill = '#52b788'; stroke = '#3d9e6f'; } // Moderate
  else if (v >= 0.10){ fill = '#95d5b2'; stroke = '#74c29a'; } // Light
  else               { fill = '#d8f3dc'; stroke = '#b5dcba'; } // Very light
  return { fill, stroke };
}

async function _loadQpfGeoJson() {
  const layerId  = qpfDayLayerIds[state.qpfDay] || 1;
  const dayName  = qpfDayNames[state.qpfDay] || `QPF Day ${state.qpfDay}`;
  const opacity  = Number($('qpfOpacity')?.value || 0.65);
  let features   = [];
  let usedLayer  = layerId;
  try {
    const data = await fetchArcGisGeoJson(qpfServiceUrl, layerId);
    features = (data.features || []).filter(f => f.geometry);
  } catch (_) {}
  // If the day-specific layer is empty or fails, try the 72-hr combined layer
  if (!features.length && layerId !== 9) {
    try {
      const data = await fetchArcGisGeoJson(qpfServiceUrl, 9);
      features = (data.features || []).filter(f => f.geometry);
      usedLayer = 9;
    } catch (_) {}
  }
  if (!features.length) {
    updatePanel('Rainfall / QPF', `WPC ${dayName} loaded but no polygon data is available for this period.<br>Try again later or select a different day.`);
    return;
  }
  state.qpfLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: f => {
      const val = extractQpfValue({ attributes: f.properties, properties: f.properties });
      const s   = qpfStyle(val);
      if (!s) return { fillOpacity: 0, weight: 0, color: 'transparent' };
      return { color: s.stroke, weight: 1, opacity: 0.9, fillColor: s.fill, fillOpacity: opacity };
    },
    onEachFeature: (feature, layer) => {
      const val   = extractQpfValue({ attributes: feature.properties, properties: feature.properties });
      const text  = formatInches(val);
      const dn    = usedLayer;
      const lName = qpfNames[dn] || dayName;
      layer.bindTooltip(`${dayName}: ${text}`, { sticky: true, direction: 'top' });
      layer.on('click', e => {
        lastPolygonClickTime = Date.now();
        if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        clearProbeMarkers();
        resetDataStack();
        addMarkerToGroup(state.markers.qpf, e.latlng, text, 'qpf');
        const compact = `${dayName}: <strong>${text}</strong>`;
        const fallNote = usedLayer !== layerId ? `<br><em>Showing combined QPF layer (${sanitizeForPanel(qpfNames[9] || 'Layer 9')}) — selected day had no data.</em>` : '';
        setStackForce('qpf', 'QPF Forecast Point',
          `Selected: <strong>${sanitizeForPanel(dayName)}</strong><br>Product: <strong>${sanitizeForPanel(lName)}</strong><br>Forecast precipitation: <strong>${text}</strong>${fallNote}<br>Location: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`,
          compact);
      });
    }
  }).addTo(map);
}

async function setQpfDay(day) {
  state.qpfDay = Number(day) || 1;
  setQpfChecks(state.qpfDay);
  $('qpfDayToggles')?.classList.remove('hidden');
  if (!state.qpfLayer) return;
  removeLayerSafe(state.qpfLayer); state.qpfLayer = null;
  if (state.markers.qpf) state.markers.qpf.clearLayers();
  updatePanel('Rainfall / QPF', `Loading WPC ${qpfDayNames[state.qpfDay] || 'QPF Day ' + state.qpfDay}…`);
  await _loadQpfGeoJson();
  updateLegend('qpf');
  updatePanel('Rainfall / QPF', `WPC ${qpfDayNames[state.qpfDay] || 'QPF Day ' + state.qpfDay} is on.<br>Click/tap a colored polygon to write data to the DATA card.`);
}

async function toggleQpf() {
  if (state.qpfLayer) {
    removeLayerSafe(state.qpfLayer); state.qpfLayer = null; setCheck('qpfCheck', false); clearLegend('qpf');
    $('qpfDayToggles')?.classList.add('hidden');
    if (state.markers.qpf) state.markers.qpf.clearLayers();
    updatePanel('Rainfall / QPF', 'QPF layer turned off.'); return;
  }
  try {
    $('qpfDayToggles')?.classList.remove('hidden');
    setQpfChecks(state.qpfDay);
    updatePanel('Rainfall / QPF', `Loading WPC ${qpfDayNames[state.qpfDay] || 'QPF Day ' + state.qpfDay}…`);
    await _loadQpfGeoJson();
    if (!state.qpfLayer) return; // load failed with no features
    setCheck('qpfCheck', true); updateLegend('qpf');
    updatePanel('Rainfall / QPF', `WPC ${qpfDayNames[state.qpfDay] || 'QPF Day ' + state.qpfDay} is on.<br>Click/tap a colored polygon to write data to the DATA card.`);
  } catch (error) {
    console.error(error); removeLayerSafe(state.qpfLayer); state.qpfLayer = null;
    setCheck('qpfCheck', false); $('qpfDayToggles')?.classList.add('hidden');
    updatePanel('Rainfall / QPF', 'Could not load WPC QPF layer.');
  }
}
const qpfLayerOrder = [9, 8, 1, 2, 3, 10, 11, 7, 4, 5];
const qpfNames = { 1: 'QPF 24 Hour Day 1', 2: 'QPF 24 Hour Day 2', 3: 'QPF 24 Hour Day 3', 4: 'QPF 48 Hour Day 4-5', 5: 'QPF 48 Hour Day 6-7', 7: 'QPF 6 Hours Day 1', 8: 'QPF 48 Hour Day 1-2', 9: 'QPF 72 Hour Day 1-3', 10: 'QPF 120 Hour Day 1-5', 11: 'QPF 168 Hour Day 1-7' };
function qpfMapExtentParam4326() { const b = map.getBounds(); return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`; }
function imageDisplayParam() { const s = map.getSize(); return `${s.x},${s.y},96`; }
function extractQpfValue(result) { const attrs = result?.attributes || result?.properties || {}; for (const key of ['qpf','QPF','qpf_in','QPF_IN','INCHES','inches','AMOUNT','amount','VALUE','value','gridcode','GRIDCODE','label','LABEL','Contour','contour']) { const n = asNumber(attrs[key]); if (n !== null) return n; } return asNumber(result?.value); }
async function identifyQpfLayerAt(latlng, layerId) {
  const params = new URLSearchParams({ f: 'json', geometry: `${latlng.lng},${latlng.lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: `visible:${layerId}`, tolerance: '8', mapExtent: qpfMapExtentParam4326(), imageDisplay: imageDisplayParam(), returnGeometry: 'false' });
  const data = await fetch(`${qpfServiceUrl}/identify?${params}`).then(r => { if (!r.ok) throw new Error('QPF identify failed'); return r.json(); });
  return (data.results || []).map(result => ({ layerId, layerName: result.layerName || qpfNames[layerId] || `QPF Layer ${layerId}`, value: extractQpfValue(result) })).filter(item => item.value !== null && Number.isFinite(item.value) && item.value >= 0);
}
async function identifyQpfAt(latlng) {
  const all = [];
  for (const id of qpfLayerOrder) { try { all.push(...await identifyQpfLayerAt(latlng, id)); } catch (_) {} }
  if (!all.length) return { value: null, layerName: 'No QPF polygon at selected point', matches: [] };
  const preferred = all.find(item => item.layerId === 9) || all.sort((a, b) => b.value - a.value)[0];
  return { value: preferred.value, layerName: preferred.layerName, matches: all };
}
function addMarkerToGroup(group, latlng, text, type) {
  L.marker(latlng, { icon: L.divIcon({ className: type === 'qpf' ? 'qpf-probe-icon' : 'rain-probe-icon', html: `<div class="${type === 'qpf' ? 'qpf-plus' : 'qpe-plus'}">+</div><div class="${type === 'qpf' ? 'qpf-value' : 'qpe-value'}">${sanitizeForPanel(text)}</div>`, iconSize: [92, 48], iconAnchor: [46, 24] }), interactive: false }).addTo(group);
}
async function runQpfPoint(latlng) {
  if (!state.qpfLayer || !dataEnabled('qpf')) return false;
  const layerId = qpfDayLayerIds[state.qpfDay] || 9;
  const all = [];
  try { all.push(...await identifyQpfLayerAt(latlng, layerId)); } catch (_) {}
  // If day-specific layer returned nothing, also try the combined 72hr layer
  if (!all.length) { try { all.push(...await identifyQpfLayerAt(latlng, 9)); } catch (_) {} }
  const result = all.length
    ? { value: all.sort((a,b)=>b.value-a.value)[0].value, layerName: all[0].layerName, matches: all }
    : { value: null, layerName: qpfDayNames[state.qpfDay] || 'No QPF polygon at selected point', matches: [] };
  const text = formatInches(result.value);
  addMarkerToGroup(state.markers.qpf, latlng, text, 'qpf');
  const compact = `${qpfDayNames[state.qpfDay] || 'QPF Day '+state.qpfDay}: <strong>${text}</strong>`;
  const matchText = result.matches?.length > 1 ? `<br>Also matched: ${result.matches.slice(1).map(m=>`${sanitizeForPanel(m.layerName)} ${formatInches(m.value)}`).join('; ')}` : '';
  setStack('qpf', 'QPF Forecast Point', `<strong>${sanitizeForPanel(result.layerName)}</strong><br>Forecast precipitation: <strong>${text}</strong><br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}${matchText}`, compact);
  return true;
}

function rainfallRenderingRule(period = state.rainfallPeriod) { return { rasterFunction: rainfallRules[period] || 'rft_24hr' }; }
function createRainfallLayer(period = state.rainfallPeriod) { return L.esri.imageMapLayer({ url: rainfallServiceUrl, opacity: Number($('rainfallOpacity')?.value || 0.68), renderingRule: rainfallRenderingRule(period), useCors: false, attribution: 'NOAA/NWS MRMS QPE' }); }
function setRainfallPeriod(period) { state.rainfallPeriod = period; ['24','48','72'].forEach(p => setCheck(p === '24' ? 'rain24Check' : p === '48' ? 'rain48Check' : 'rain72SubCheck', p === period)); if (state.rainfallLayer) { map.removeLayer(state.rainfallLayer); state.rainfallLayer = createRainfallLayer(period).addTo(map); updateLegend('rainfall'); updatePanel('Rainfall Totals / QPE', `${rainfallLabel()} MRMS QPE is on.`); } }
function toggleRainfall72() {
  if (state.rainfallLayer) { removeLayerSafe(state.rainfallLayer); state.rainfallLayer = null; $('rainfallSubToggles')?.classList.add('hidden'); setCheck('rain72Check', false); clearLegend('rainfall'); updatePanel('Rainfall Totals / QPE', 'Rainfall totals layer turned off.'); return; }
  state.rainfallPeriod = '24'; setRainfallPeriod('24'); state.rainfallLayer = createRainfallLayer().addTo(map); $('rainfallSubToggles')?.classList.remove('hidden'); setCheck('rain72Check', true); updateLegend('rainfall'); updatePanel('Rainfall Totals / QPE', `${rainfallLabel()} MRMS QPE layer is on.<br>Click/tap to write point data to the DATA card.`);
}
function mapExtent3857() { const b = map.getBounds(); const sw = L.CRS.EPSG3857.project(b.getSouthWest()); const ne = L.CRS.EPSG3857.project(b.getNorthEast()); return `${sw.x},${sw.y},${ne.x},${ne.y}`; }
function normalizePrecipInches(rawValue) { const raw = asNumber(rawValue); if (raw === null || raw < 0) return null; if ((state.rainfallPeriod === '48' || state.rainfallPeriod === '72') && raw > 8) return raw / 25.4; if (state.rainfallPeriod === '24' && raw > 12) return raw / 25.4; if (raw > 30) return null; return raw; }
function extractRawRasterValue(obj) { if (!obj) return null; if (Array.isArray(obj.samples)) { for (const s of obj.samples) { const n = asNumber(s.value ?? s.Value ?? s.pixelValue ?? s.PixelValue ?? s.attributes?.value); if (n !== null) return n; } } const direct = obj.value ?? obj.Value ?? obj.pixelValue ?? obj.PixelValue ?? obj.properties?.value; const n = asNumber(direct); if (n !== null) return n; if (Array.isArray(obj.results)) { for (const r of obj.results) { const rn = asNumber(r.value ?? r.attributes?.value ?? r.attributes?.PixelValue); if (rn !== null) return rn; } } return null; }
async function sampleRainfallAt(latlng, sourceLabel = 'selected point') {
  const p = L.CRS.EPSG3857.project(latlng);
  const params = new URLSearchParams({ f: 'json', geometry: `${p.x},${p.y}`, geometryType: 'esriGeometryPoint', inSR: '102100', returnGeometry: 'false', returnFirstValueOnly: 'true', sampleDistance: '1500', outFields: '*', renderingRule: JSON.stringify(rainfallRenderingRule()) });
  try {
    const data = await fetch(`${rainfallServiceUrl}/getSamples?${params}`).then(r => { if (!r.ok) throw new Error('getSamples failed'); return r.json(); });
    const raw = extractRawRasterValue(data);
    return { raw, inches: normalizePrecipInches(raw), source: `getSamples ${sourceLabel}` };
  } catch (_) {
    const size = map.getSize();
    const idParams = new URLSearchParams({ f: 'json', geometry: `${p.x},${p.y}`, geometryType: 'esriGeometryPoint', sr: '102100', returnGeometry: 'false', returnCatalogItems: 'false', pixelSize: '1000,1000', mapExtent: mapExtent3857(), imageDisplay: `${size.x},${size.y},96`, renderingRule: JSON.stringify(rainfallRenderingRule()) });
    const data = await fetch(`${rainfallServiceUrl}/identify?${idParams}`).then(r => { if (!r.ok) throw new Error('identify failed'); return r.json(); });
    const raw = extractRawRasterValue(data);
    return { raw, inches: normalizePrecipInches(raw), source: `identify ${sourceLabel}` };
  }
}
async function identifyRainfallAt(latlng) {
  // Sample the exact clicked point first
  const exact = await sampleRainfallAt(latlng, 'exact point');
  // Always also check 4 nearby points (~2.5km offset) because MRMS raster resolution
  // (~1km grid) can make a single clicked pixel under-represent the surrounding event.
  const offset = 0.022;
  const nearbyPts = [
    L.latLng(latlng.lat + offset, latlng.lng),
    L.latLng(latlng.lat - offset, latlng.lng),
    L.latLng(latlng.lat, latlng.lng + offset),
    L.latLng(latlng.lat, latlng.lng - offset)
  ];
  const samples = [exact];
  for (const pt of nearbyPts) {
    try { samples.push(await sampleRainfallAt(pt, 'nearby')); } catch (_) {}
  }
  const valid = samples.filter(s => asNumber(s.inches) !== null && Number(s.inches) >= 0);
  if (!valid.length) return { ...exact, usedNearby: false, exactPointInches: asNumber(exact.inches) };
  const best = valid.sort((a, b) => Number(b.inches) - Number(a.inches))[0];
  const exactIn = asNumber(exact.inches) ?? 0;
  const bestIn  = Number(best.inches) ?? 0;
  if (best !== exact && bestIn > exactIn + 0.15) {
    return { ...best, usedNearby: true, exactPointInches: exactIn };
  }
  return { ...exact, usedNearby: false, exactPointInches: exactIn };
}
async function runRainfallPoint(latlng) {
  if (!state.rainfallLayer || !dataEnabled('rainfall')) return false;
  const result = await identifyRainfallAt(latlng);
  const text = formatInches(result.inches);
  addMarkerToGroup(state.markers.rainfall, latlng, text, 'rainfall');
  const rawMm = asNumber(result.raw);
  const unitNote = rawMm !== null && rawMm > 25 ? `<br>Raw raster: ${rawMm.toFixed(1)} mm → converted to inches.` : (rawMm !== null ? `<br>Raw sample: ${rawMm.toFixed(2)}` : '');
  const srcNote = result.usedNearby
    ? `<br><strong>Nearby area max used</strong> (exact point: ${formatInches(result.exactPointInches)}).<br>MRMS raster can under-sample a single pixel edge.`
    : '<br>Sampled from exact clicked point.';
  const compact = `${rainfallLabel()}: <strong>${text}</strong>${result.usedNearby ? ' (area max)' : ''}`;
  setStack('rainfall', 'Rainfall Total Point',
    `<strong>${rainfallLabel()}</strong><br>MRMS QPE estimated total: <strong>${text}</strong>${unitNote}${srcNote}<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>Source: NOAA/NWS MRMS QPE (${sanitizeForPanel(result.source || 'sample')}).`,
    compact);
  return true;
}

function pm25Category(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return { label: 'No data', range: '', color: '#ffffff' }; if (n <= 12) return { label: 'Good', range: 'PM2.5 0.0–12.0 µg/m³', color: '#00e400' }; if (n <= 35.4) return { label: 'Moderate', range: 'PM2.5 12.1–35.4 µg/m³', color: '#ffff00' }; if (n <= 55.4) return { label: 'Unhealthy for Sensitive Groups', range: 'PM2.5 35.5–55.4 µg/m³', color: '#ff7e00' }; if (n <= 150.4) return { label: 'Unhealthy', range: 'PM2.5 55.5–150.4 µg/m³', color: '#ff0000' }; if (n <= 250.4) return { label: 'Very Unhealthy', range: 'PM2.5 150.5–250.4 µg/m³', color: '#8f3f97' }; return { label: 'Hazardous', range: 'PM2.5 250.5+ µg/m³', color: '#7e0023' }; }
function toggleAirQuality() {
  if (state.airQualityLayer) { removeLayerSafe(state.airQualityLayer); state.airQualityLayer = null; setCheck('airQualityCheck', false); clearLegend('airQuality'); updatePanel('Air Quality', 'Air quality layer turned off.'); return; }
  state.airQualityLayer = L.esri.imageMapLayer({ url: 'https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_mpm25_hr01/ImageServer', opacity: Number($('airQualityOpacity')?.value || 0.62), useCors: false, attribution: 'NOAA/NWS Air Quality Guidance' }).addTo(map);
  setCheck('airQualityCheck', true); updateLegend('airQuality'); updatePanel('Air Quality', 'Air Quality PM2.5 guidance layer is on.<br>Click/tap to write category and value to the DATA card.');
}
async function identifyAirQualityAt(latlng) {
  const p = L.CRS.EPSG3857.project(latlng); const size = map.getSize();
  const params = new URLSearchParams({ f: 'json', geometry: `${p.x},${p.y}`, geometryType: 'esriGeometryPoint', sr: '102100', returnGeometry: 'false', returnCatalogItems: 'false', pixelSize: '10000,10000', mapExtent: mapExtent3857(), imageDisplay: `${size.x},${size.y},96` });
  const data = await fetch(`https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_mpm25_hr01/ImageServer/identify?${params}`).then(r => { if (!r.ok) throw new Error('Air quality identify failed'); return r.json(); });
  const raw = extractRawRasterValue(data); const value = raw === null ? null : Number(raw); return { value, category: pm25Category(value), raw };
}
async function runAirQualityPoint(latlng) {
  if (!state.airQualityLayer || !dataEnabled('airQuality')) return false;
  const result = await identifyAirQualityAt(latlng);
  removeLayerSafe(state.markers.airQuality);
  state.markers.airQuality = L.marker(latlng, { icon: L.divIcon({ className: 'airq-probe-icon', html: `<div class="airq-dot" style="background:${result.category.color}">AQ</div><div class="airq-value">${sanitizeForPanel(result.category.label)}</div>`, iconSize: [138, 48], iconAnchor: [69, 24] }), interactive: false }).addTo(map);
  const valueText = result.value === null || Number.isNaN(result.value) ? 'No data' : `${result.value.toFixed(1)} µg/m³`;
  setStack('airQuality', 'Air Quality Point',
    `Category: <strong>${sanitizeForPanel(result.category.label)}</strong><br>PM2.5 value: ${sanitizeForPanel(valueText)}<br>${sanitizeForPanel(result.category.range)}<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}.`,
    `AQ: <strong>${sanitizeForPanel(result.category.label)}</strong> — ${sanitizeForPanel(valueText)}`);
  return true;
}

function heatIndexF(tempF, humidity) { if (tempF === null || humidity === null || tempF < 80 || humidity < 40) return null; const T = tempF, R = humidity; return -42.379 + 2.04901523*T + 10.14333127*R - 0.22475541*T*R - 0.00683783*T*T - 0.05481717*R*R + 0.00122874*T*T*R + 0.00085282*T*R*R - 0.00000199*T*T*R*R; }
function windChillF(tempF, windMph) { if (tempF === null || windMph === null || tempF > 50 || windMph <= 3) return null; return 35.74 + 0.6215*tempF - 35.75*Math.pow(windMph, 0.16) + 0.4275*tempF*Math.pow(windMph, 0.16); }
function tempClass(value, mode = state.tempDisplayMode) { const n = Number(value); if (!Number.isFinite(n)) return 'temp-mild'; if (mode === 'heat') return n >= 125 ? 'temp-extreme-heat' : n >= 103 ? 'temp-danger-heat' : n >= 90 ? 'temp-caution-heat' : 'temp-hot'; if (mode === 'windchill') return n <= 0 ? 'temp-extreme-cold' : n <= 32 ? 'temp-windchill' : 'temp-cool'; return n >= 100 ? 'temp-hot' : n >= 90 ? 'temp-warm' : n >= 70 ? 'temp-mild' : n >= 50 ? 'temp-cool' : 'temp-cold'; }
function buildStationHtml(station, obs, calculated) {
  const p = obs.properties || {}; const stationId = station.properties?.stationIdentifier || station.id.split('/').pop(); const stationName = station.properties?.name || stationId;
  const dewF = cToF(p.dewpoint?.value); const humidity = asNumber(p.relativeHumidity?.value); const windMph = mpsToMph(p.windSpeed?.value); const gustMph = mpsToMph(p.windGust?.value);
  const cloudLayers = Array.isArray(p.cloudLayers) ? p.cloudLayers.map(layer => `${layer.amount || 'Cloud'}${layer.base?.value ? ` @ ${Math.round(metersToFeet(layer.base.value))} ft` : ''}`).join(', ') : '';
  return `<div class="big-temp">${Math.round(calculated.tempF)}°F</div>${sanitizeForPanel(p.textDescription || 'Latest observation')}<br>${dataRow('Station', stationName)}${dataRow('Station ID', stationId)}${dataRow('Temperature', `${Math.round(calculated.tempF)}°F`)}${dataRow('Dew Point', dewF === null ? '' : `${Math.round(dewF)}°F`)}${dataRow('Humidity', humidity === null ? '' : `${Math.round(humidity)}%`)}${dataRow('Heat Index', calculated.heatIndex !== null ? `${Math.round(calculated.heatIndex)}°F` : '')}${dataRow('Wind Chill', calculated.windChill !== null ? `${Math.round(calculated.windChill)}°F` : '')}<div class="data-section-title">Wind</div>${dataRow('Wind Speed', windMph === null ? '' : `${Math.round(windMph)} mph`)}${dataRow('Wind Gust', gustMph === null ? '' : `${Math.round(gustMph)} mph`)}${dataRow('Wind Direction', p.windDirection?.value !== null && p.windDirection?.value !== undefined ? `${Math.round(p.windDirection.value)}°` : '')}<div class="data-section-title">Pressure / Visibility</div>${dataRow('Pressure', formatMaybe(p.barometricPressure?.value ? pascalToInHg(p.barometricPressure.value) : null, ' inHg', 2))}${dataRow('Sea Level Pressure', formatMaybe(p.seaLevelPressure?.value ? pascalToInHg(p.seaLevelPressure.value) : null, ' inHg', 2))}${dataRow('Visibility', formatMaybe(metersToMiles(p.visibility?.value), ' mi', 1))}${dataRow('Elevation', formatMaybe(metersToFeet(station.properties?.elevation?.value), ' ft'))}<div class="data-section-title">Rain / Clouds</div>${dataRow('Precip 1 Hour', formatMaybe(metersToInches(p.precipitationLastHour?.value), ' in', 2))}${dataRow('Precip 3 Hours', formatMaybe(metersToInches(p.precipitationLast3Hours?.value), ' in', 2))}${dataRow('Precip 6 Hours', formatMaybe(metersToInches(p.precipitationLast6Hours?.value), ' in', 2))}${dataRow('Cloud Layers', cloudLayers)}<div class="data-section-title">Observation</div>${dataRow('Updated', p.timestamp ? new Date(p.timestamp).toLocaleString() : '')}`;
}
function buildTempCompactHtml(stationName, stationId, obsProps, calculated, windMph, gustMph, dewF, humidity) {
  // obsProps = obs.properties object (or {})
  const lines = [`<strong>${sanitizeForPanel(stationName || stationId)}</strong>`];
  lines.push(`Temp: ${Math.round(calculated.tempF)}°F`);
  if (dewF !== null && dewF !== undefined) lines.push(`Dew Pt: ${Math.round(dewF)}°F`);
  if (humidity !== null && humidity !== undefined) lines.push(`Humidity: ${Math.round(humidity)}%`);
  if (calculated.heatIndex !== null && calculated.heatIndex !== undefined) lines.push(`Heat Index: ${Math.round(calculated.heatIndex)}°F`);
  if (calculated.windChill !== null && calculated.windChill !== undefined) lines.push(`Wind Chill: ${Math.round(calculated.windChill)}°F`);
  if (windMph !== null && windMph !== undefined) {
    let ws = `Wind: ${Math.round(windMph)} mph`;
    if (gustMph !== null && gustMph !== undefined) ws += ` / Gust: ${Math.round(gustMph)} mph`;
    lines.push(ws);
  }
  if (obsProps && obsProps.timestamp) lines.push(`Updated: ${new Date(obsProps.timestamp).toLocaleTimeString()}`);
  return lines.join('<br>');
}
function setTempMode(mode) { state.tempDisplayMode = mode || 'temp'; setCheck('tempModeTempCheck', state.tempDisplayMode === 'temp'); setCheck('tempModeHeatCheck', state.tempDisplayMode === 'heat'); setCheck('tempModeWindCheck', state.tempDisplayMode === 'windchill'); if (state.tempLayer) { map.removeLayer(state.tempLayer); state.tempLayer = null; setCheck('tempCheck', false); toggleTemperatures(); } renderLegends(); }
async function toggleTemperatures() {
  if (state.tempLayer) { removeLayerSafe(state.tempLayer); state.tempLayer = null; $('tempSubToggles')?.classList.add('hidden'); setCheck('tempCheck', false); clearLegend('temp'); updatePanel('Temperatures', 'Temperature layer turned off.'); return; }
  try {
    state.tempLayer = L.layerGroup().addTo(map); $('tempSubToggles')?.classList.remove('hidden');
    const point = await getNwsPointData(); const stationsData = await fetch(point.properties.observationStations).then(r => { if (!r.ok) throw new Error('Stations failed'); return r.json(); });
    const results = await Promise.allSettled((stationsData.features || []).slice(0, 22).map(async station => ({ station, obs: await fetch(`${station.id}/observations/latest`).then(r => { if (!r.ok) throw new Error('Obs failed'); return r.json(); }) })));
    let plotted = 0;
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { station, obs } = result.value;
      const coords = station.geometry?.coordinates;
      const p = obs.properties || {};
      if (!coords) continue;
      const tempF = cToF(p.temperature?.value);
      if (tempF === null) continue;
      // Compute all derived values in loop scope so they are available for compact HTML
      const dewF     = cToF(p.dewpoint?.value);
      const humidity = asNumber(p.relativeHumidity?.value);
      const windMph  = mpsToMph(p.windSpeed?.value);
      const gustMph  = mpsToMph(p.windGust?.value);
      const hi = p.heatIndex?.value !== null && p.heatIndex?.value !== undefined ? cToF(p.heatIndex.value) : heatIndexF(tempF, humidity);
      const wc = p.windChill?.value !== null && p.windChill?.value !== undefined ? cToF(p.windChill.value) : windChillF(tempF, windMph);
      let display = tempF, labelType = 'Temp', mode = 'temp';
      if (state.tempDisplayMode === 'heat' && hi !== null)      { display = hi; labelType = 'Heat Index'; mode = 'heat'; }
      if (state.tempDisplayMode === 'windchill' && wc !== null) { display = wc; labelType = 'Wind Chill'; mode = 'windchill'; }
      const stationId   = station.properties?.stationIdentifier || station.id.split('/').pop();
      const stationName = station.properties?.name || stationId;
      const html    = buildStationHtml(station, obs, { tempF, heatIndex: hi, windChill: wc });
      const compact = buildTempCompactHtml(stationName, stationId, p, { tempF, heatIndex: hi, windChill: wc }, windMph, gustMph, dewF, humidity);
      L.marker([coords[1], coords[0]], { icon: L.divIcon({ className: 'temp-div-icon', html: `<div class="temp-badge ${tempClass(display, mode)}">${Math.round(display)}°</div>`, iconSize: [44, 28], iconAnchor: [22, 14] }) })
        .bindTooltip(`${stationId}: ${labelType} ${Math.round(display)}°F`, { sticky: true })
        .on('click', e => { if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); resetDataStack(); setStack('temp', `Station: ${stationId}`, html, compact); })
        .addTo(state.tempLayer);
      plotted++;
    }
    setCheck('tempCheck', true); setCheck('tempModeTempCheck', state.tempDisplayMode === 'temp'); setCheck('tempModeHeatCheck', state.tempDisplayMode === 'heat'); setCheck('tempModeWindCheck', state.tempDisplayMode === 'windchill'); updateLegend('temp'); updatePanel('Temperatures', `Current station markers loaded.<br>Stations plotted: ${plotted}.<br>Click a station for all available observation data.`);
  } catch (error) { console.error(error); removeLayerSafe(state.tempLayer); state.tempLayer = null; setCheck('tempCheck', false); updatePanel('Temperatures', 'Could not load temperature stations.'); }
}
async function toggleWindLayer() {
  if (state.windLayer) { removeLayerSafe(state.windLayer); state.windLayer = null; setCheck('windCheck', false); clearLegend('wind'); updatePanel('Wind Barbs', 'Wind barb layer turned off.'); return; }
  try {
    state.windLayer = L.layerGroup().addTo(map); const point = await getNwsPointData(); const stationsData = await fetch(point.properties.observationStations).then(r => { if (!r.ok) throw new Error('Stations failed'); return r.json(); });
    const results = await Promise.allSettled((stationsData.features || []).slice(0, 18).map(async station => ({ station, obs: await fetch(`${station.id}/observations/latest`).then(r => { if (!r.ok) throw new Error('Obs failed'); return r.json(); }) })));
    let plotted = 0; const opacity = Number($('windOpacity')?.value || 0.55);
    for (const result of results) {
      if (result.status !== 'fulfilled') continue; const { station, obs } = result.value; const coords = station.geometry?.coordinates; const p = obs.properties || {}; if (!coords) continue;
      const windMph = mpsToMph(p.windSpeed?.value); const windDir = asNumber(p.windDirection?.value); if (windMph === null || windDir === null) continue; const toward = (windDir + 180) % 360; const stationId = station.properties?.stationIdentifier || station.id.split('/').pop();
      const html = `Station: ${sanitizeForPanel(stationId)}<br>Wind Speed: ${Math.round(windMph)} mph<br>Wind Direction: ${Math.round(windDir)}° from<br>Moving Toward: ${Math.round(toward)}°<br>${p.timestamp ? `Updated: ${new Date(p.timestamp).toLocaleTimeString()}` : ''}`;
      L.marker([coords[1], coords[0]], { icon: L.divIcon({ className: 'wind-div-icon', html: `<div class="wind-barb" style="transform: rotate(${toward}deg); --wind-opacity:${opacity};"></div><div class="wind-label">${Math.round(windMph)}</div>`, iconSize: [42, 48], iconAnchor: [21, 24] }) })
        .bindTooltip(`${stationId}: ${Math.round(windMph)} mph`, { sticky: true })
        .on('click', e => { if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); resetDataStack(); setStack('wind', 'Wind Observation', html); })
        .addTo(state.windLayer);
      plotted++;
    }
    setCheck('windCheck', true); updateLegend('wind'); updatePanel('Wind Barbs', `Wind barb layer loaded.<br>Stations plotted: ${plotted}.<br>Arrow points where the wind is moving.`);
  } catch (error) { console.error(error); removeLayerSafe(state.windLayer); state.windLayer = null; setCheck('windCheck', false); updatePanel('Wind Barbs', 'Could not load wind barbs.'); }
}

async function loadTexasCountyGeoJson() {
  const data = await fetch(`https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json?cache=${Date.now()}`).then(r => { if (!r.ok) throw new Error('County source failed'); return r.json(); });
  const features = (data.features || []).filter(f => String(f.id || '').startsWith('48') || f.properties?.STATEFP === '48');
  return { type: 'FeatureCollection', features };
}
function countyName(feature) { const p = feature?.properties || {}; return p.NAME || p.name || p.NAMELSAD || p.COUNTY || p.COUNTY_NAME || 'County'; }
function countyStyle() { return { color: '#ffffff', weight: 1.5, opacity: Number($('countyOpacity')?.value || 0.25), fillOpacity: 0, interactive: true }; }
async function toggleCountyLines() {
  if (state.countyLayer) { removeLayerSafe(state.countyLayer); state.countyLayer = null; setCheck('countyCheck', false); clearLegend('county'); updatePanel('County Lines', 'County line layer turned off.'); return; }
  try {
    updatePanel('County Lines', 'Loading Texas county boundaries...'); const data = await loadTexasCountyGeoJson();
    state.countyLayer = L.geoJSON(data, {
      // L.canvas() renderer prevents SVG-transform/html2canvas mismatch
      // that makes county lines appear at wrong positions in exported PNGs.
      renderer: L.canvas(),
      style: countyStyle,
      onEachFeature: (feature, layer) => {
        const name = countyName(feature);
        layer.bindTooltip(`${sanitizeForPanel(name)} County`, { sticky: true, direction: 'top' });
        layer.on('click', e => { if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); resetDataStack(); setStack('county', 'County Boundary', `${sanitizeForPanel(name)} County<br>Layer: Texas county boundary lines`); });
      }
    }).addTo(map);
    state.countyLayer.bringToFront?.(); setCheck('countyCheck', true); updatePanel('County Lines', `Texas county boundary layer turned on.<br>Counties loaded: ${data.features.length}.`);
  } catch (error) { console.error(error); setCheck('countyCheck', false); updatePanel('County Lines', 'Could not load Texas county lines.'); }
}

function setSurfaceChecks(day) { setCheck('surfaceDay1Check', day === 1); setCheck('surfaceDay2Check', day === 2); setCheck('surfaceDay3Check', day === 3); }

// Cache discovered day→layerIds mapping from service metadata
let _surfaceLayerGroups = null;

async function discoverSurfaceLayerGroups() {
  if (_surfaceLayerGroups !== null) return _surfaceLayerGroups;
  try {
    const meta = await fetch(`${surfaceMapServiceUrl}?f=json`).then(r => { if (!r.ok) throw new Error(); return r.json(); });
    const layers = meta.layers || [];
    const childrenOf = {};
    for (const l of layers) { const pid = l.parentLayerId ?? -1; if (!childrenOf[pid]) childrenOf[pid] = []; childrenOf[pid].push(l); }
    function leafIds(parentId) { const out = []; for (const l of (childrenOf[parentId] || [])) { if (l.type === 'Group Layer') out.push(...leafIds(l.id)); else out.push(l.id); } return out; }
    const groups = { 1: [], 2: [], 3: [] };
    let matched = false;
    for (const layer of layers) {
      if (layer.type !== 'Group Layer') continue;
      const n = String(layer.name || '').toLowerCase().replace(/[_\-]/g, ' ');
      let day = 0;
      if (/\bday\s*1\b|\btoday\b|\bperiod\s*1\b/.test(n))     day = 1;
      else if (/\bday\s*2\b|\btomorrow\b|\bperiod\s*2\b/.test(n)) day = 2;
      else if (/\bday\s*3\b|\bperiod\s*3\b/.test(n))              day = 3;
      if (!day) continue;
      const ids = leafIds(layer.id);
      if (ids.length) { groups[day] = ids; matched = true; }
    }
    _surfaceLayerGroups = matched ? groups : surfaceLayerSets;
  } catch (_) { _surfaceLayerGroups = surfaceLayerSets; }
  return _surfaceLayerGroups;
}

function createSurfaceLayer(layerIds) {
  const opts = { url: surfaceMapServiceUrl, opacity: Number($('surfaceOpacity')?.value || 0.78) };
  if (layerIds && layerIds.length) opts.layers = layerIds;
  return L.esri.dynamicMapLayer(opts);
}

async function setSurfaceDay(day) {
  state.surfaceDay = Number(day) || 1;
  setSurfaceChecks(state.surfaceDay);
  $('surfaceSubToggles')?.classList.remove('hidden');
  if (!state.surfaceLayer) return;
  const groups = _surfaceLayerGroups || await discoverSurfaceLayerGroups();
  const dayIds = groups[state.surfaceDay] || [];
  map.removeLayer(state.surfaceLayer);
  state.surfaceLayer = createSurfaceLayer(dayIds).addTo(map);
  updateLegend('surface');
  updatePanel('Surface Map', `WPC Day ${state.surfaceDay} surface map is on.`);
}

async function toggleSurfaceMap() {
  $('surfaceSubToggles')?.classList.remove('hidden');
  if (state.surfaceLayer) {
    removeLayerSafe(state.surfaceLayer); state.surfaceLayer = null;
    setCheck('surfaceCheck', false); clearLegend('surface');
    updatePanel('Surface Map', 'Surface map layer turned off. Day 1 / Day 2 / Day 3 options remain for next time.'); return;
  }
  if (![1, 2, 3].includes(Number(state.surfaceDay))) state.surfaceDay = 1;
  setSurfaceChecks(state.surfaceDay);
  updatePanel('Surface Map', 'Loading WPC National Forecast Chart…');
  const groups = await discoverSurfaceLayerGroups();
  const dayIds = groups[state.surfaceDay] || [];
  state.surfaceLayer = createSurfaceLayer(dayIds).addTo(map);
  setCheck('surfaceCheck', true); updateLegend('surface');
  const note = dayIds.length ? `Day ${state.surfaceDay} — ${dayIds.length} sub-layers` : 'using service defaults';
  updatePanel('Surface Map', `WPC National Forecast Chart is on (${note}).<br>Click/tap visible features (fronts, highs, lows, weather areas) to write details to the DATA card.`);
}
async function identifySurfaceAt(latlng) {
  const size = map.getSize(); const b = map.getBounds();
  const baseParams = {
    f: 'json', geometry: `${latlng.lng},${latlng.lat}`,
    geometryType: 'esriGeometryPoint', sr: '4326',
    tolerance: '14',
    mapExtent: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
    imageDisplay: `${size.x},${size.y},96`,
    returnGeometry: 'false', outFields: '*'
  };
  // Try selected-day layers first, then fall back to 'all'
  const groups = _surfaceLayerGroups || surfaceLayerSets;
  const dayIds = groups[state.surfaceDay] || [];
  if (dayIds.length) {
    try {
      const params = new URLSearchParams({ ...baseParams, layers: `visible:${dayIds.join(',')}` });
      const data = await fetch(`${surfaceMapServiceUrl}/identify?${params}`).then(r => { if (!r.ok) throw new Error(); return r.json(); });
      if ((data.results || []).length) return { results: data.results, usedFallback: false };
    } catch (_) {}
  }
  // Fallback: all layers
  try {
    const params = new URLSearchParams({ ...baseParams, layers: 'all' });
    const data = await fetch(`${surfaceMapServiceUrl}/identify?${params}`).then(r => { if (!r.ok) throw new Error('Surface identify failed'); return r.json(); });
    return { results: data.results || [], usedFallback: true };
  } catch (_) { return { results: [], usedFallback: false }; }
}
async function runSurfacePoint(latlng) {
  if (!state.surfaceLayer) return false;
  // setStackForce — surface map clicks always populate DATA card regardless of data-card sub-checkbox
  const { results, usedFallback } = await identifySurfaceAt(latlng);
  if (!results.length) {
    setStackForce('surface', 'Surface Map Point',
      `Day ${state.surfaceDay} selected.<br>No WPC surface feature found at this point.<br>Try clicking directly on a visible front line, high/low symbol, or hatched weather area.<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
    return true;
  }
  const rows = results.slice(0, 10).map(result => {
    const attrs    = result.attributes || {};
    const label    = firstValueCI(attrs, ['name','Name','LABEL','label','featureType','FeatureType','type','TYPE','value','VALUE'], result.layerName || 'Surface feature');
    const validStr = firstValueCI(attrs, ['VALID','valid','validTime','expire','EXPIRE'], '');
    const validNote = validStr ? ` — ${sanitizeForPanel(formatDateValue(validStr))}` : '';
    return `<div class="hazard-detail-row"><span>${sanitizeForPanel(result.layerName || 'Layer')}:</span> ${sanitizeForPanel(label)}${validNote}</div>`;
  }).join('');
  const fallbackNote = usedFallback ? `<br><em>Day ${state.surfaceDay} layers returned no result — showing all-layer fallback.</em>` : '';
  const compact = results.slice(0, 3).map(r => {
    const a = r.attributes || {};
    return sanitizeForPanel(`${r.layerName || ''}: ${firstValueCI(a, ['name','LABEL','label','type','TYPE'], r.layerName || 'Feature')}`);
  }).join('<br>');
  setStackForce('surface', 'Surface Map Point',
    `WPC Day ${state.surfaceDay} National Forecast Chart${fallbackNote}<br>${rows}<br>Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`,
    compact || `Day ${state.surfaceDay} surface feature`);
  return true;
}

function normalizeHrrrBounds(bounds) {
  if (!bounds) return [[20, -130], [55, -60]];
  if (Array.isArray(bounds)) return bounds;
  if (bounds.south !== undefined && bounds.west !== undefined && bounds.north !== undefined && bounds.east !== undefined) {
    return [[Number(bounds.south), Number(bounds.west)], [Number(bounds.north), Number(bounds.east)]];
  }
  return [[20, -130], [55, -60]];
}
function normalizeHrrrAssetPath(path, indexUrl = '') {
  if (!path) return '';
  let p = String(path).trim();
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
  p = p.replace(/^\.\//, '').replace(/^\//, '');
  if (p.startsWith('public/data/')) return `/data/${p.replace(/^public\/data\//, '')}`;
  if (p.startsWith('data/')) return `/${p}`;
  return `/${p}`;
}

function hrrrCandidateUrls(rawPath) {
  if (!rawPath) return [];
  let p = String(rawPath).trim().replace(/^\.\//, '').replace(/^\//, '');
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return [p];
  const list = [];
  const add = value => { if (value && !list.includes(value)) list.push(value); };
  if (p.startsWith('public/data/')) {
    add(`/data/${p.replace(/^public\/data\//, '')}`);
    add(`/${p}`);
  } else if (p.startsWith('data/')) {
    add(`/${p}`);
    add(`/public/${p}`);
  } else {
    add(`/${p}`);
    add(`/data/model/hrrr/${p.split('/').pop()}`);
    add(`/public/data/model/hrrr/${p.split('/').pop()}`);
  }
  return list;
}
async function loadHrrrFrames() {
  const paths = ['/data/model/hrrr/latest.json', '/public/data/model/hrrr/latest.json', 'data/model/hrrr/latest.json', 'public/data/model/hrrr/latest.json'];
  let lastError = null;
  for (const url of paths) {
    try {
      const data = await fetch(`${url}?cache=${Date.now()}`).then(r => { if (!r.ok) throw new Error(`HRRR index not found at ${url}`); return r.json(); });
      const frames = Array.isArray(data) ? data : (data.frames || data.images || data.hours || []);
      state.hrrrFrames = frames.map((frame, i) => {
        const rawPath = frame.file || frame.url || frame.image || frame.path || frame.src || '';
        const candidates = hrrrCandidateUrls(rawPath);
        return {
          url: candidates[0] || normalizeHrrrAssetPath(rawPath, url),
          candidates,
          bounds: normalizeHrrrBounds(frame.bounds || data.bounds),
          label: frame.label || (frame.hour !== undefined ? `F${String(frame.hour).padStart(2, '0')}` : '') || frame.forecastHour || frame.fh || `F${String(i + 1).padStart(2, '0')}`,
          validTime: frame.validTime || frame.valid || frame.time || ''
        };
      }).filter(f => f.url || (f.candidates && f.candidates.length));
      if (state.hrrrFrames.length) return;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('No HRRR frame index found');
}
function showHrrrFrame(index) {
  if (!state.hrrrFrames.length) return;
  removeLayerSafe(state.hrrrLayer);
  state.hrrrIndex = (index + state.hrrrFrames.length) % state.hrrrFrames.length;
  const frame = state.hrrrFrames[state.hrrrIndex];
  const candidates = frame.candidates && frame.candidates.length ? frame.candidates.slice() : [frame.url];
  let candidateIndex = 0;
  const useCandidate = () => {
    const url = candidates[candidateIndex] || frame.url;
    state.hrrrLayer = L.imageOverlay(url, frame.bounds, {
      opacity: Number($('hrrrOpacity')?.value || 0.72),
      attribution: 'HRRR simulated reflectivity',
      interactive: false,
      crossOrigin: true
    }).addTo(map);
    state.hrrrLayer.once('error', () => {
      removeLayerSafe(state.hrrrLayer);
      candidateIndex += 1;
      if (candidateIndex < candidates.length) {
        useCandidate();
      } else {
        console.warn('HRRR image failed for all candidate paths', candidates);
        setCheck('hrrrCheck', true);
        updatePanel('HRRR Future Radar', `HRRR frame index loaded, but the image for ${sanitizeForPanel(frame.label)} did not load.<br>Checked: ${candidates.map(sanitizeForPanel).join('<br>')}`);
      }
    });
    state.hrrrLayer.once('load', () => {
      frame.url = url;
      setCheck('hrrrCheck', true);
      updateLegend('hrrr');
    });
  };
  useCandidate();
  if ($('hrrrFrameSlider')) $('hrrrFrameSlider').value = state.hrrrIndex;
  if ($('hrrrFrameLabel')) $('hrrrFrameLabel').textContent = frame.label;
}
async function toggleHrrr() {
  if (state.hrrrLayer || state.hrrrFrames.length) { stopHrrrAnimation(); removeLayerSafe(state.hrrrLayer); state.hrrrLayer = null; state.hrrrFrames = []; $('hrrrTimeline')?.classList.add('hidden'); setCheck('hrrrCheck', false); clearLegend('hrrr'); updatePanel('HRRR Future Radar', 'HRRR future radar layer turned off.'); return; }
  try {
    updatePanel('HRRR Future Radar', 'Loading local HRRR frame index...'); await loadHrrrFrames(); const slider = $('hrrrFrameSlider'); if (slider) { slider.min = 0; slider.max = state.hrrrFrames.length - 1; slider.value = 0; } $('hrrrTimeline')?.classList.remove('hidden'); showHrrrFrame(0); setCheck('hrrrCheck', true); updateLegend('hrrr'); updatePanel('HRRR Future Radar', `HRRR future radar loaded.<br>Frames: ${state.hrrrFrames.length}.`);
  } catch (error) { console.error(error); state.hrrrLayer = null; state.hrrrFrames = []; setCheck('hrrrCheck', false); updatePanel('HRRR Future Radar', 'No usable HRRR frame index was found. Deploy /data/model/hrrr/latest.json and frame images first.'); }
}
function setHrrrFrameFromSlider() { stopHrrrAnimation(); showHrrrFrame(Number($('hrrrFrameSlider')?.value || 0)); }
function nextHrrrFrame() { showHrrrFrame(state.hrrrIndex + 1); }
function previousHrrrFrame() { showHrrrFrame(state.hrrrIndex - 1); }
function toggleHrrrAnimation() { if (state.hrrrTimer) { stopHrrrAnimation(); return; } if (!state.hrrrFrames.length) return; state.hrrrTimer = setInterval(() => showHrrrFrame(state.hrrrIndex + 1), 800); if ($('hrrrPlayBtn')) $('hrrrPlayBtn').textContent = 'Pause'; if ($('hrrrLoopText')) $('hrrrLoopText').textContent = 'Loop playing'; }
function stopHrrrAnimation() { if (state.hrrrTimer) clearInterval(state.hrrrTimer); state.hrrrTimer = null; if ($('hrrrPlayBtn')) $('hrrrPlayBtn').textContent = 'Play'; if ($('hrrrLoopText')) $('hrrrLoopText').textContent = 'Loop paused'; }
function runHrrrPoint(latlng) { if (!state.hrrrLayer || !dataEnabled('hrrr')) return false; const frame = state.hrrrFrames[state.hrrrIndex] || {}; setStack('hrrr', 'HRRR Future Radar Point', `Current HRRR frame: <strong>${sanitizeForPanel(frame.label || `F${state.hrrrIndex}`)}</strong><br>${frame.validTime ? `Valid: ${sanitizeForPanel(frame.validTime)}<br>` : ''}Location: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}<br>Pixel dBZ sampling is not available from this local image overlay.`); return true; }

async function runAllCheckedPointData(latlng, skipTypes = []) {
  const skip = new Set(skipTypes || []); let ran = false;
  const tasks = [ ['airQuality', runAirQualityPoint], ['radar', runRadarPoint], ['qpf', runQpfPoint], ['rainfall', runRainfallPoint], ['surface', runSurfacePoint], ['hrrr', runHrrrPoint], ['pastRadar', runPastRadarPoint] ];
  for (const [type, fn] of tasks) { if (skip.has(type) || !dataEnabled(type)) continue; try { const did = await fn(latlng); if (did) ran = true; } catch (error) { console.warn(`${type} point data failed`, error); setStack(type, `${stackLabels[type]} Point`, `No data returned at this point.`); ran = true; } }
  return ran;
}
map.on('click', async event => {
  // Guard: if a polygon (NWS/SPC/WPC) was just clicked, its DOM event also bubbles
  // to the map. Without this guard the map click would immediately reset the data card.
  if (Date.now() - lastPolygonClickTime < 600) return;
  const target = event.originalEvent?.target;
  if (target?.closest?.('.control-card, .home-btn, .basemap-btn, .basemap-menu, .leaflet-control')) return;
  clearProbeMarkers(); resetDataStack(); const didRun = await runAllCheckedPointData(event.latlng, []);
  if (!didRun) updatePanel('Map Data', 'No checked active data-card layers were available for that click/tap.');
});

async function refreshActiveLayers() {
  const active = ['radar','pastRadar','alerts','qpf','spc','wpc','county','hrrr','temp','wind','rainfall','airQuality','surface'].filter(isLayerOn);
  for (const type of active) { if (type === 'radar') toggleRadar(); if (type === 'pastRadar') turnOffPastRadar(false); if (type === 'alerts') await toggleAlerts(); if (type === 'qpf') toggleQpf(); if (type === 'spc') await toggleSpc(); if (type === 'wpc') await toggleWpc(); if (type === 'county') await toggleCountyLines(); if (type === 'hrrr') await toggleHrrr(); if (type === 'temp') await toggleTemperatures(); if (type === 'wind') await toggleWindLayer(); if (type === 'rainfall') toggleRainfall72(); if (type === 'airQuality') toggleAirQuality(); if (type === 'surface') toggleSurfaceMap(); }
  setTimeout(() => { active.forEach(type => { if (type === 'radar') toggleRadar(); if (type === 'pastRadar') togglePastRadar(); if (type === 'alerts') toggleAlerts(); if (type === 'qpf') toggleQpf(); if (type === 'spc') toggleSpc(); if (type === 'wpc') toggleWpc(); if (type === 'county') toggleCountyLines(); if (type === 'hrrr') toggleHrrr(); if (type === 'temp') toggleTemperatures(); if (type === 'wind') toggleWindLayer(); if (type === 'rainfall') toggleRainfall72(); if (type === 'airQuality') toggleAirQuality(); if (type === 'surface') toggleSurfaceMap(); }); }, 500);
  updatePanel('Refresh', `Refreshing active layers...<br>${new Date().toLocaleTimeString()}`);
}

// buildExportDataHtml: generates condensed DATA card HTML for PNG export.
// Uses per-type compact HTML from state.dataStack when available; falls back
// to stripping the full HTML so important info stays at the top.
function buildExportDataHtml() {
  const types = stackOrder.filter(t => state.dataStack[t]);
  if (!types.length) return '<em style="font-size:11px;opacity:0.7;">No map click data.</em>';
  return `<div class="stack-data-card-title" style="font-size:12px;margin-bottom:4px;">MAP CLICK DATA</div>` +
    types.map(type => {
      const item = state.dataStack[type];
      const body = item.compact != null ? item.compact : stripToExportCompact(item.html, type);
      return `<div class="stack-data-section stack-data-${type}" style="margin:3px 0;padding:5px 8px;">
        <div class="stack-data-title" style="font-size:9.5px;">${sanitizeForPanel(stackLabels[type] || type)}</div>
        <div class="stack-data-subtitle" style="font-size:9.5px;margin-bottom:2px;">${sanitizeForPanel(item.title)}</div>
        <div class="stack-data-body" style="font-size:10px;line-height:1.22;">${body}</div>
      </div>`;
    }).join('');
}
function stripToExportCompact(html, type) {
  if (!html) return '';
  let s = html
    .replace(/<div class="big-temp"[^>]*>.*?<\/div>/gi, '')
    .replace(/<div class="data-section-title">.*?<\/div>/gi, '')
    .replace(/(<br\s*\/?>){3,}/gi, '<br>');
  if (type === 'temp') {
    // Keep up through wind, drop Pressure/Visibility/Clouds/Observation
    const cutAt = s.toLowerCase().indexOf('pressure');
    if (cutAt > 80) s = s.slice(0, cutAt);
  }
  if (['alerts','spc','wpc'].includes(type)) {
    // Drop long description text to headline-only
    const cutAt = s.indexOf('Details:');
    if (cutAt > 50) s = s.slice(0, cutAt) + '<em>…see live DATA card</em>';
  }
  return s.trim().slice(0, 700);
}

async function saveMapPhoto() {
  const button = $('savePhotoBtn');
  const hasVisibleData = !!document.querySelector('#status .stack-data-section') || /Map Click\s*\/\s*Tap Data/i.test($('status')?.textContent || '');
  const includeKey = checked('photoIncludeKeyCheck');
  const includeData = checked('photoIncludeDataCheck') || hasVisibleData;
  let exportDataCard = null;
  try {
    if (button) { button.disabled = true; button.textContent = 'Saving...'; }
    const dataBody = $('dataBody');
    if (dataBody) dataBody.classList.remove('collapsed');

    if (includeData) {
      // Build condensed export HTML from the data stack (not raw live DOM)
      const exportHtml = buildExportDataHtml();
      exportDataCard = document.createElement('section');
      exportDataCard.id = 'exportDataCard';
      exportDataCard.className = 'export-data-card';
      exportDataCard.setAttribute('data-export-card', 'true');
      exportDataCard.innerHTML = `<div class="export-data-header">DATA</div><div class="export-data-body">${exportHtml}</div>`;
      Object.assign(exportDataCard.style, {
        display: 'block',
        position: 'fixed',
        zIndex: '2147483000',
        top: 'auto',
        left: '18px',
        right: 'auto',
        bottom: '92px',
        width: 'min(420px, calc(100vw - 36px))',
        maxHeight: '28vh',
        overflow: 'hidden',
        background: 'rgba(7,17,31,0.988)',
        color: '#ffffff',
        border: '1px solid rgba(255,255,255,0.30)',
        borderRadius: '8px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.58)',
        boxSizing: 'border-box'
      });
      document.body.appendChild(exportDataCard);
    }

    document.body.classList.add('capture-mode', 'capture-export-polish');
    document.body.classList.toggle('capture-hide-key', !includeKey);
    document.body.classList.toggle('capture-include-data', includeData);
    document.body.classList.toggle('capture-use-export-data', includeData);
    map.closePopup();
    renderLegends();
    map.invalidateSize(false);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#07111f',
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollX: 0,
      scrollY: 0,
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      ignoreElements: el => el?.classList?.contains('leaflet-tooltip') || el?.classList?.contains('leaflet-popup')
    });
    const link = document.createElement('a');
    link.download = `RBRTW_weather_map_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    console.error(error);
    alert('Photo export failed. This is usually caused by a browser blocking an outside map tile/layer during screenshot export.');
  } finally {
    if (exportDataCard) exportDataCard.remove();
    document.body.classList.remove('capture-mode', 'capture-export-polish', 'capture-hide-key', 'capture-include-data', 'capture-use-export-data');
    renderLegends();
    if (button) { button.disabled = false; button.textContent = 'Save as Photo'; }
  }
}
document.addEventListener('click', event => {
  const menu = $('basemapMenu'); const button = document.querySelector('.basemap-btn');
  if (!menu || !button || menu.classList.contains('hidden')) return;
  if (menu.contains(event.target) || button.contains(event.target)) return;
  menu.classList.add('hidden');
});

setBasemap('standard');
initRbrtwMarker();
loadNwsPointData();
renderLegends();
