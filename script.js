/* ---------------------------
  script.js - SPA logic, WebSocket hooks, demo mode
  Comments indicate where to adapt for ESP32 specifics
  --------------------------- */

// -------------------------
// Configuration & thresholds
// -------------------------
const WS_URL_DEFAULT = "ws://192.168.4.1:81/"; // <-- change to your ESP32 WebSocket URL
const AUTO_CONNECT = false; // set true if you want auto connect
const SAMPLE_INTERVAL_MS = 1000; // used by demo generator when websocket not connected

// Safety thresholds (editable)
const THRESHOLDS = {
  temp: {min: 20.0, max: 45.0},
  ph: {min: 5.5, max: 8.5},
  do: {min: 20, max: 120},
  rpm: {min: 0, max: 2000},
  level: {min: 5, max: 100}
};

// -------------------------
// Global state
// -------------------------
let ws = null;
let wsConnected = false;
let demoMode = true;
let demoTimer = null;
let muted = false;
let activeDatasets = ['temp', 'ph'];
let mainChartTimeWindow = 30; // in minutes

// Buffer for charting (store objects {t:timestamp, temp, ph, do, rpm, level})
const dataBuffer = [];
const MAX_BUFFER_POINTS = 60 * 60 * 1.2; // about 1 hour at ~1s resolution

// DOM references (cached)
const dom = {
  tempVal: document.getElementById('tempVal'),
  phVal: document.getElementById('phVal'),
  rpmVal: document.getElementById('rpmVal'),
  levelVal: document.getElementById('levelVal'),
  doVal: document.getElementById('doVal'),
  modeVal: document.getElementById('modeVal'),
  agg_blades: document.getElementById('agg_blades'),
  tank_fill_mask_rect: document.getElementById('tank_fill_mask_rect'),
  led_heater: document.getElementById('led_heater'),
  led_aeration: document.getElementById('led_aeration'),
  led_agitator: document.getElementById('led_agitator'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnHeater: document.getElementById('btnHeater'),
  btnAeration: document.getElementById('btnAeration'),
  btnAgitator: document.getElementById('btnAgitator'),
  btnEStop: document.getElementById('btnEStop'),
  connectBtn: document.getElementById('connectBtn'),
  muteBtn: document.getElementById('muteBtn'),
  netStatus: document.getElementById('netStatus'),
  netLogs: document.getElementById('netLogs'),
  netLogsNetwork: document.getElementById('netLogsNetwork'),
  miniChart: document.getElementById('miniChart'),
  mainChart: document.getElementById('mainChart'),
  buildDate: document.getElementById('buildDate'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalBody: document.getElementById('modalBody'),
  modalConfirm: document.getElementById('modalConfirm'),
  modalCancel: document.getElementById('modalCancel'),
  // param inputs
  setTempInput: document.getElementById('setTempInput'),
  setPhInput: document.getElementById('setPhInput'),
  setRpmInput: document.getElementById('setRpmInput'),
  setDurationInput: document.getElementById('setDurationInput'),
  setDoInput: document.getElementById('setDoInput'),
  btnApplyParams: document.querySelectorAll('#btnApplyParams'),
  // Param page inputs
  setTempInput_p: document.getElementById('setTempInput_p'),
  setTempInput_num: document.getElementById('setTempInput_num'),
  setPhInput_p: document.getElementById('setPhInput_p'),
  setPhInput_num: document.getElementById('setPhInput_num'),
  setRpmInput_p: document.getElementById('setRpmInput_p'),
  setRpmInput_num: document.getElementById('setRpmInput_num'),
  setDurationInput_p: document.getElementById('setDurationInput_p'),
  setDoInput_p: document.getElementById('setDoInput_p'),
  setDoInput_num: document.getElementById('setDoInput_num'),
  btnApplyParams_p: document.getElementById('btnApplyParams_p'),
  exportCsvBtn: document.getElementById('exportCsv'),
  miniWindowSpan: document.getElementById('miniWindow'),
};

// Set build date
dom.buildDate.textContent = new Date().toLocaleDateString();

// -------------------------
// Utility helpers
// -------------------------
function logNet(msg){
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  dom.netLogs.innerText = line + "\n" + dom.netLogs.innerText;
  dom.netLogsNetwork.innerText = line + "\n" + dom.netLogsNetwork.innerText;
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// audio beep
function beep(duration=0.06, freq=800){
  if(muted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.0001;
    o.start(0);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    setTimeout(()=>{ o.stop(); ctx.close(); }, duration*1000 + 50);
  } catch(e){ /* audio not available */ }
}

// -------------------------
// WebSocket functions
// -------------------------
function connectWebSocket(url) {
  if(ws && wsConnected){ logNet("Already connected"); return; }
  try {
    logNet(`Connecting to ${url}...`);
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      wsConnected = true;
      demoMode = false;
      dom.netStatus.textContent = 'connected';
      dom.connectBtn.innerText = '⟳ Connected';
      logNet('WebSocket opened.');
      // stop demo
      stopDemo();
    });
    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleWsMessage(msg);
      } catch(e){
        logNet('Invalid WS message: ' + evt.data);
      }
    });
    ws.addEventListener('close', () => {
      wsConnected = false;
      dom.netStatus.textContent = 'disconnected';
      dom.connectBtn.innerText = '⟳ Connect';
      logNet('WebSocket closed.');
      // fallback to demo generator
      startDemo();
    });
    ws.addEventListener('error', (err) => {
      logNet('WebSocket error.');
      console.error(err);
    });
  } catch(e){
    logNet('Failed to connect: ' + e.message);
  }
}

function sendCommand(obj){
  const msg = JSON.stringify(obj);
  if(wsConnected && ws){
    ws.send(msg);
    logNet('Sent: ' + msg);
  } else {
    logNet('WS not connected. (Simulating send) -> ' + msg);
    // You might implement a queued send or HTTP fallback here.
  }
}

// Expected incoming JSON shape:
// { "temp":37.21, "ph":7.12, "do":92, "rpm":300, "level":65, "heater":true, "aeration":false, "agitator":true }
function handleWsMessage(msg){
  // Validate presence of keys
  const now = Date.now();
  const record = {
    t: now,
    temp: (typeof msg.temp === 'number') ? msg.temp : null,
    ph: (typeof msg.ph === 'number') ? msg.ph : null,
    do: (typeof msg.do === 'number') ? msg.do : null,
    rpm: (typeof msg.rpm === 'number') ? msg.rpm : null,
    level: (typeof msg.level === 'number') ? msg.level : null,
    heater: !!msg.heater,
    aeration: !!msg.aeration,
    agitator: !!msg.agitator
  };

  // Update UI fields
  if(record.temp !== null){
    dom.tempVal.textContent = record.temp.toFixed(1);
  }
  if(record.ph !== null){
    dom.phVal.textContent = record.ph.toFixed(2);
  }
  if(record.rpm !== null){
    dom.rpmVal.textContent = Math.round(record.rpm);
  }
  if(record.level !== null){
    dom.levelVal.textContent = Math.round(record.level);
  }
  if(record.do !== null){
    dom.doVal.textContent = Math.round(record.do);
  }

  // LEDs and toggles
  setToggleVisual(dom.btnHeater, record.heater);
  setToggleVisual(dom.btnAeration, record.aeration);
  setToggleVisual(dom.btnAgitator, record.agitator);

  setLed('led_heater', record.heater ? 'green' : null);
  setLed('led_aeration', record.aeration ? 'green' : null);
  setLed('led_agitator', record.agitator ? 'green' : null);

  // Agitator rotation class
  if(record.agitator){
    dom.agg_blades.classList.add('rotate');
    // speed mapping: rpm to animation speed
    const rpm = record.rpm || 300;
    const period = clamp(60 / (rpm / 60 || 1), 0.1, 2.0); // crude mapping
    dom.agg_blades.style.animationDuration = period + 's';
  } else {
    dom.agg_blades.classList.remove('rotate');
    dom.agg_blades.style.animationDuration = '';
  }

  // Liquid level: animate mask rect y according to percentage
  if(record.level !== null){
    // Tank mask rect coordinates: x=220, y=260, height=180 (in SVG viewBox units)
    const minY = 260;
    const height = 180;
    const pct = clamp(record.level, 0, 100) / 100;
    const newY = minY + (1 - pct) * height;
    document.getElementById('tank_fill_mask_rect').setAttribute('y', newY.toString());
    document.getElementById('tank_fill_mask_rect').setAttribute('height', (height * pct).toString());
    // Move float bulb for visual
    const fb = document.getElementById('float_bulb');
    if(fb) fb.setAttribute('cy', (140 - (pct * 120)).toString());
  }

  // Append to chart buffer
  dataBuffer.push(record);
  // keep buffer size bounded
  while(dataBuffer.length > MAX_BUFFER_POINTS) dataBuffer.shift();

  updateCharts(record);

  // Mode display
  dom.modeVal.textContent = record.heater || record.aeration || record.agitator ? 'Running' : 'Idle';

  // Safety check & alarm modal
  checkSafety(record);
}

function setToggleVisual(button, on){
  if(on){
    button.classList.add('on');
    button.setAttribute('aria-checked','true');
  } else {
    button.classList.remove('on');
    button.setAttribute('aria-checked','false');
  }
}

function setLed(id, state){
  const el = document.getElementById(id);
  if(!el) return;
  el.className = 'led';
  if(state === 'green') el.classList.add('green');
  else if(state === 'red') el.classList.add('red');
  else if(state === 'yellow') el.classList.add('yellow');
}

// -------------------------
// Safety checks
// -------------------------
function checkSafety(record){
  if(!record) return;
  const alarms = [];

  if(record.temp !== null && (record.temp < THRESHOLDS.temp.min || record.temp > THRESHOLDS.temp.max)){
    alarms.push(`Temperature out of range: ${record.temp.toFixed(1)} °C`);
  }
  if(record.ph !== null && (record.ph < THRESHOLDS.ph.min || record.ph > THRESHOLDS.ph.max)){
    alarms.push(`pH out of range: ${record.ph.toFixed(2)}`);
  }
  if(record.do !== null && (record.do < THRESHOLDS.do.min || record.do > THRESHOLDS.do.max)){
    alarms.push(`DO out of range: ${record.do}`);
  }
  if(record.level !== null && (record.level < THRESHOLDS.level.min)){
    alarms.push(`Liquid level critically low: ${record.level}%`);
  }

  if(alarms.length){
    showAlarmModal(alarms.join('\n'));
    // optional: send alert via WebSocket
    sendCommand({cmd:'alarm', value:alarms});
    beep(0.12, 600);
  }
}

function showAlarmModal(message){
  dom.modalBody.innerText = message;
  openModal(()=>{ /* on confirm closure */ }, 'Acknowledge', message);
}

// -------------------------
// Demo data generator
// -------------------------
function startDemo(){
  if(demoTimer) return;
  demoMode = true;
  logNet('Starting demo mode...');
  let t = 37.0, ph = 7.2, do_ = 85, rpm = 300, lvl = 65;
  demoTimer = setInterval(()=>{
    // small random walk
    t = clamp(t + (Math.random()-0.5)*0.2, 35, 40);
    ph = clamp(ph + (Math.random()-0.5)*0.02, 6.5, 7.5);
    do_ = clamp(do_ + (Math.random()-0.5)*1.2, 50, 100);
    rpm = clamp(rpm + (Math.random()-0.5)*4, 100, 500);
    lvl = clamp(lvl + (Math.random()-0.5)*0.2, 5, 100);

    const msg = { temp: parseFloat(t.toFixed(2)), ph: parseFloat(ph.toFixed(2)), do: Math.round(do_), rpm: Math.round(rpm), level: Math.round(lvl), heater: t>36.5, aeration: do_ < 80, agitator: true };
    handleWsMessage(msg);
  }, SAMPLE_INTERVAL_MS);
}

function stopDemo(){
  if(demoTimer){ clearInterval(demoTimer); demoTimer = null; demoMode = false; logNet('Demo stopped.'); }
}

// -------------------------
// E-STOP
// -------------------------
function doEmergencyStop(){
  // UI safe/off
  setToggleVisual(dom.btnHeater, false);
  setToggleVisual(dom.btnAeration, false);
  setToggleVisual(dom.btnAgitator, false);
  setLed('led_heater', null);
  setLed('led_aeration', null);
  setLed('led_agitator', null);
  dom.modeVal.textContent = 'EMERGENCY STOP';
  dom.agg_blades.classList.remove('rotate');
  // send command
  sendCommand({cmd:'emergency', action:'stop'});
  logNet('E-STOP triggered!');
  beep(0.4, 220);
}

// -------------------------
// Modal helpers
// -------------------------
let _modalConfirmCb = null;
function openModal(confirmCb, title="Confirm", body="Are you sure?"){
  dom.modalBackdrop.style.display = 'flex';
  dom.modalBackdrop.setAttribute('aria-hidden','false');
  document.getElementById('modalTitle').innerText = title;
  dom.modalBody.innerText = body;
  _modalConfirmCb = confirmCb || null;
}
function closeModal(){
  dom.modalBackdrop.style.display = 'none';
  dom.modalBackdrop.setAttribute('aria-hidden','true');
  _modalConfirmCb = null;
}
dom.modalConfirm.addEventListener('click', ()=>{
  if(_modalConfirmCb) _modalConfirmCb();
  closeModal();
});
dom.modalCancel.addEventListener('click', ()=> closeModal());

// -------------------------
// Charts (Chart.js)
// -------------------------
// Create mini chart
const miniChart = new Chart(dom.miniChart.getContext('2d'), {
  type: 'line',
  data: {
    datasets: [
      { label: 'Temp (°C)', data: [], borderColor: '#6CF5A8', tension:0.2, parsing: {xAxisKey: 't', yAxisKey:'temp'}, hidden: false },
      { label: 'pH', data: [], borderColor: '#FFC857', tension:0.2, parsing: {xAxisKey: 't', yAxisKey:'ph'}, hidden: false },
      { label: 'RPM', data: [], borderColor: '#7EC0FF', tension:0.2, parsing: {xAxisKey: 't', yAxisKey:'rpm'}, hidden: true },
      { label: 'DO (%)', data: [], borderColor: '#FF6B6B', tension:0.2, parsing: {xAxisKey: 't', yAxisKey:'do'}, hidden: true }
    ]
  },
  options: {
    animation:false,
    scales: {
      x: { type: 'time', time: { unit: 'second' }, ticks: { display: false } },
      y: { display:true }
    },
    plugins: { legend: { display: false } }
  }
});

// Main chart with multiple datasets
const mainChart = new Chart(dom.mainChart.getContext('2d'), {
  type: 'line',
  data: {
    datasets: [
      { label: 'Temp (°C)', data: [], borderColor: '#6CF5A8', parsing: {xAxisKey: 't', yAxisKey:'temp'}, tension:0.25, stepped:false, yAxisID:'y1' },
      { label: 'pH', data: [], borderColor: '#FFC857', parsing: {xAxisKey: 't', yAxisKey:'ph'}, tension:0.25, yAxisID:'y1' },
      { label: 'RPM', data: [], borderColor: '#7EC0FF', parsing: {xAxisKey: 't', yAxisKey:'rpm'}, tension:0.25, yAxisID:'y2' },
      { label: 'DO (%)', data: [], borderColor: '#FF6B6B', parsing: {xAxisKey: 't', yAxisKey:'do'}, tension:0.25, yAxisID:'y2' }
    ]
  },
  options: {
    animation:false,
    maintainAspectRatio:false,
    scales: {
      x: {
        type: 'time',
        time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
        ticks: { autoSkip: true },
      },
      y1: {
        position: 'left',
        title: { display: true, text: 'Temp / pH' },
        ticks: { color: 'white' },
        grid: { color: 'rgba(255,255,255,0.08)' }
      },
      y2: {
        position: 'right',
        title: { display: true, text: 'RPM / DO (%)' },
        grid: { drawOnChartArea: false, color: 'rgba(255,255,255,0.08)' },
        ticks: { color: 'white' },
        beginAtZero: true
      }
    },
    plugins: { legend: { display: true } }
  }
});

function updateCharts(record){
  if(!record) return;

  // push into Chart.js datasets
  const pt = { x: record.t, y: record.temp };
  const pp = { x: record.t, y: record.ph };
  const pr = { x: record.t, y: record.rpm };
  const pd = { x: record.t, y: record.do };

  // push small preview
  miniChart.data.datasets.forEach(ds => {
    ds.data.push({x: record.t, y: record[ds.label.split(' ')[0].toLowerCase()]});
    // Keep a fixed number of points
    while(ds.data.length > 60) ds.data.shift();
  });
  miniChart.update('none');

  // main chart
  mainChart.data.datasets[0].data.push(pt);
  mainChart.data.datasets[1].data.push(pp);
  mainChart.data.datasets[2].data.push(pr);
  mainChart.data.datasets[3].data.push(pd);

  // trim points older than window
  const maxAge = 1000 * 60 * mainChartTimeWindow;
  const cutoff = Date.now() - maxAge;
  for(const ds of mainChart.data.datasets){
    while(ds.data.length && ds.data[0].x < cutoff) ds.data.shift();
  }
  mainChart.update('none');
}

// Toggle datasets on mini chart
document.getElementById('toggleTemp').addEventListener('click', () => toggleMiniChartDataset('temp'));
document.getElementById('togglePh').addEventListener('click', () => toggleMiniChartDataset('ph'));
document.getElementById('toggleRpm').addEventListener('click', () => toggleMiniChartDataset('rpm'));
document.getElementById('toggleDo').addEventListener('click', () => toggleMiniChartDataset('do'));

function toggleMiniChartDataset(datasetKey) {
    const datasetLabels = {
        'temp': 'Temp (°C)',
        'ph': 'pH',
        'rpm': 'RPM',
        'do': 'DO (%)'
    };
    const dataset = miniChart.data.datasets.find(ds => ds.label.includes(datasetLabels[datasetKey]));
    if (dataset) {
        dataset.hidden = !dataset.hidden;
        miniChart.update();
    }
}


// Export CSV from dataBuffer
function exportCsv(){
  let csv = "timestamp,temp,ph,do,rpm,level\n";
  for(const r of dataBuffer){
    csv += `${new Date(r.t).toISOString()},${r.temp ?? ''},${r.ph ?? ''},${r.do ?? ''},${r.rpm ?? ''},${r.level ?? ''}\n`;
  }
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'bioreactor_data.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------
// Routing (hash based)
// -------------------------
const routes = ['home','parameters','graphs','network','about'];
function setActiveRoute(route){
  routes.forEach(r => {
    const page = document.getElementById('page-' + r);
    const nav = document.getElementById('nav-' + r);
    if(!page || !nav) return;
    if(r === route){
      page.classList.add('active');
      nav.classList.add('active');
    } else {
      page.classList.remove('active');
      nav.classList.remove('active');
    }
  });
}
function onHashChange(){
  const hash = location.hash || '#/home';
  const route = hash.split('/')[1] || 'home';
  if(routes.includes(route)) setActiveRoute(route);
  else setActiveRoute('home');
}
window.addEventListener('hashchange', onHashChange);
onHashChange();

// nav link keyboard support
document.querySelectorAll('nav.topnav a').forEach(a=>{
  a.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' ') { a.click(); }});
});

// -------------------------
// UI Event handlers
// -------------------------
dom.btnStart.addEventListener('click', ()=>{
  sendCommand({cmd:'set', target:'run', value:true});
  dom.modeVal.textContent = 'Running';
  dom.btnStart.setAttribute('aria-pressed','true');
  beep(0.04, 1200);
});

dom.btnStop.addEventListener('click', ()=>{
  sendCommand({cmd:'set', target:'run', value:false});
  dom.modeVal.textContent = 'Stopped';
  dom.btnStart.setAttribute('aria-pressed','false');
  beep(0.04, 500);
});

dom.btnHeater.addEventListener('click', ()=>{
  const on = dom.btnHeater.classList.toggle('on');
  dom.btnHeater.setAttribute('aria-checked', on ? 'true' : 'false');
  setLed('led_heater', on ? 'green' : null);
  sendCommand({cmd:'set', target:'heater', value:on});
  beep(0.02, 900);
});

dom.btnAeration.addEventListener('click', ()=>{
  const on = dom.btnAeration.classList.toggle('on');
  dom.btnAeration.setAttribute('aria-checked', on ? 'true' : 'false');
  setLed('led_aeration', on ? 'green' : null);
  sendCommand({cmd:'set', target:'aeration', value:on});
  beep(0.02, 880);
});

dom.btnAgitator.addEventListener('click', ()=>{
  const on = dom.btnAgitator.classList.toggle('on');
  dom.btnAgitator.setAttribute('aria-checked', on ? 'true' : 'false');
  setLed('led_agitator', on ? 'green' : null);
  if(on) dom.agg_blades.classList.add('rotate'); else dom.agg_blades.classList.remove('rotate');
  sendCommand({cmd:'set', target:'agitator', value:on});
  beep(0.02, 760);
});

dom.btnEStop.addEventListener('click', ()=>{
  openModal(()=>{ doEmergencyStop(); }, 'Emergency STOP', 'Trigger emergency stop? This will attempt to shut down actuators immediately.');
});

// Connect button
dom.connectBtn.addEventListener('click', ()=>{
  if(wsConnected){ ws && ws.close(); return; }
  // ask for URL optionally
  const url = prompt('WebSocket URL', WS_URL_DEFAULT) || WS_URL_DEFAULT;
  connectWebSocket(url);
});

// Mute
dom.muteBtn.addEventListener('click', ()=>{
  muted = !muted;
  dom.muteBtn.innerText = muted ? '🔇' : '🔊';
  dom.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
});

// Apply params: there may be two buttons in DOM using same id; handle both
document.querySelectorAll('#btnApplyParams, #btnApplyParams_p').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    // Collect inputs from Home quick controls OR Parameters page
    const setTemp = parseFloat(dom.setTempInput.value || dom.setTempInput_num.value);
    const setPh = parseFloat(dom.setPhInput.value || dom.setPhInput_num.value);
    const setRpm = parseInt(dom.setRpmInput.value || dom.setRpmInput_num.value);
    const setDo = parseInt(dom.setDoInput.value || dom.setDoInput_num.value);
    const duration = dom.setDurationInput.value || dom.setDurationInput_p.value;

    // validate ranges (client-side)
    const errors = [];
    if(isNaN(setTemp) || setTemp < 20 || setTemp > 80) errors.push('Temperature must be 20-80 °C.');
    if(isNaN(setPh) || setPh < 3.0 || setPh > 10.0) errors.push('pH must be 3.0-10.0.');
    if(isNaN(setRpm) || setRpm < 0 || setRpm > 2000) errors.push('RPM must be 0-2000.');
    if(!/^\d{2}:\d{2}$/.test(duration)) errors.push('Duration must be in HH:MM format.');
    if(isNaN(setDo) || setDo < 0 || setDo > 100) errors.push('DO must be 0-100%.');

    if(errors.length){
      openModal(()=>{}, 'Validation error', errors.join('\n'));
      return;
    }
    openModal(()=>{ sendCommand({cmd:'set', target:'params', value:{temp:setTemp, ph:setPh, rpm:setRpm, do:setDo, duration:duration}}); }, 'Apply Parameters', `Apply parameters?\nTemp:${setTemp}°C, pH:${setPh}, RPM:${setRpm}, DO:${setDo}%, Duration:${duration}`);
  });
});

// Parameter page sync between range and number inputs
function syncRange(range, num){
  if(range && num){
    range.addEventListener('input', ()=>{ num.value = range.value; });
    num.addEventListener('input', ()=>{ range.value = num.value; });
  }
}
syncRange(dom.setTempInput_p, dom.setTempInput_num);
syncRange(dom.setPhInput_p, dom.setPhInput_num);
syncRange(dom.setRpmInput_p, dom.setRpmInput_num);
syncRange(dom.setDoInput_p, dom.setDoInput_num);


// Graphs page time window buttons
document.querySelectorAll('.time-window-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    mainChartTimeWindow = parseInt(e.target.dataset.window);
    // update chart display
    mainChart.options.scales.x.time.unit = mainChartTimeWindow < 60 ? 'minute' : 'hour';
    mainChart.options.scales.x.time.unitStepSize = mainChartTimeWindow < 60 ? 1 : Math.round(mainChartTimeWindow/4);
    mainChart.update();
  });
});

// Other button handlers
dom.exportCsvBtn.addEventListener('click', exportCsv);
document.getElementById('btnPreviewChart').addEventListener('click', ()=>{
  window.location.hash = '#/graphs';
});

// Initial state setup
if(AUTO_CONNECT) {
  connectWebSocket(WS_URL_DEFAULT);
} else {
  startDemo();
}
