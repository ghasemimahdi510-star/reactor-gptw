/* script.js */
// --- Configuration & Global State ---
const WEBSOCKET_URL = "ws://192.168.4.1/ws"; // CHANGE THIS to your ESP32 WebSocket server address
const DEMO_MODE = true; // Set to true to use simulated data if WS connection fails.

let ws;
let isConnected = false;
let currentReadouts = {
  temp: 0,
  ph: 0,
  do: 0,
  rpm: 0,
  level: 0,
  heater: false,
  aeration: false,
  agitator: false,
};

// --- DOM Element References ---
const app = document.getElementById('app');
const navLinks = document.querySelectorAll('nav a');
const pages = document.querySelectorAll('.page');

const tempVal = document.getElementById('tempVal');
const phVal = document.getElementById('phVal');
const rpmVal = document.getElementById('rpmVal');
const levelVal = document.getElementById('levelVal');
const doVal = document.getElementById('doVal');

const ledHeater = document.getElementById('led_heater');
const ledAeration = document.getElementById('led_aeration');
const ledAgitator = document.getElementById('led_agitator');
const flameGlow = document.getElementById('flame_glow');
const aggBlades = document.getElementById('agg_blades');
const tankFillRect = document.getElementById('tank_fill_rect');
const floatIndicator = document.getElementById('float_indicator');

const btnHeater = document.getElementById('btnHeater');
const btnAeration = document.getElementById('btnAeration');
const btnAgitator = document.getElementById('btnAgitator');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnEStop = document.getElementById('btnEStop');

const setTempInput = document.getElementById('setTempInput');
const setTempNumber = document.getElementById('setTempNumber');
const setPhInput = document.getElementById('setPhInput');
const setPhNumber = document.getElementById('setPhNumber');
const setRpmInput = document.getElementById('setRpmInput');
const setRpmNumber = document.getElementById('setRpmNumber');
const setDoInput = document.getElementById('setDoInput');
const setDoNumber = document.getElementById('setDoNumber');
const setDurationInput = document.getElementById('setDurationInput');
const btnApplyParams = document.getElementById('btnApplyParams');

const netStatus = document.getElementById('netStatus');
const netSSID = document.getElementById('netSSID');
const netIP = document.getElementById('netIP');
const netMAC = document.getElementById('netMAC');
const netLog = document.getElementById('net-log');

const confirmModal = document.getElementById('confirmModal');
const btnConfirmAction = document.getElementById('btnConfirmAction');
const btnCancelConfirm = document.getElementById('btnCancelConfirm');
const scanModal = document.getElementById('scanModal');
const btnScan = document.getElementById('btnScan');
const ssidInput = document.getElementById('ssidInput');
const passwordInput = document.getElementById('passwordInput');
const btnConnectScan = document.getElementById('btnConnectScan');
const btnCancelScan = document.getElementById('btnCancelScan');

// --- WebSocket & Communication ---
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  logToNetwork('Attempting to connect to WebSocket...');
  ws = new WebSocket(WEBSOCKET_URL);

  ws.onopen = () => {
    isConnected = true;
    logToNetwork('WebSocket connected!');
    netStatus.textContent = "Connected";
    netStatus.style.color = "var(--accent-green)";
    sendCommand({ cmd: "get", target: "status" });
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error("Failed to parse JSON:", e);
      logToNetwork(`Error parsing message: ${event.data}`);
    }
  };

  ws.onclose = () => {
    isConnected = false;
    logToNetwork('WebSocket disconnected. Reconnecting...');
    netStatus.textContent = "Disconnected";
    netStatus.style.color = "var(--accent-red)";
    if (!DEMO_MODE) {
      setTimeout(connectWebSocket, 5000);
    } else {
      startDemoMode();
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    logToNetwork(`WebSocket error: ${error.message || 'Unknown error'}`);
  };
}

function sendCommand(commandObject) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = JSON.stringify(commandObject);
    ws.send(message);
    logToNetwork(`Sent: ${message}`);
  } else {
    logToNetwork('Error: WebSocket not connected. Command not sent.');
    // Demo mode: simulate command effect
    if (DEMO_MODE) {
      handleDemoCommand(commandObject);
    }
  }
}

function handleWsMessage(data) {
  // Update state with new data
  Object.assign(currentReadouts, data);

  // Update UI readouts
  tempVal.textContent = data.temp !== undefined ? data.temp.toFixed(1) : '--';
  phVal.textContent = data.ph !== undefined ? data.ph.toFixed(2) : '--';
  rpmVal.textContent = data.rpm !== undefined ? data.rpm : '--';
  levelVal.textContent = data.level !== undefined ? data.level : '--';
  doVal.textContent = data.do !== undefined ? data.do : '--';

  // Update SVG animations & indicators
  updateSvgAnimations(data);

  // Update control button states
  updateControlButtons(data);

  // Update Chart
  if (bioreactorChart) {
    updateChart(data);
  }

  // Update network info if provided
  if (data.netInfo) {
    netSSID.textContent = data.netInfo.ssid || '--';
    netIP.textContent = data.netInfo.ip || '--';
    netMAC.textContent = data.netInfo.mac || '--';
  }
}

// --- UI Logic & Animations ---
function updateSvgAnimations(data) {
  // Update liquid level
  if (data.level !== undefined) {
    const rectHeight = (data.level / 100) * 320; // 320px is the tank rect height
    const rectY = 380 - rectHeight; // 380px is tank bottom
    tankFillRect.setAttribute('y', rectY);
    tankFillRect.setAttribute('height', rectHeight);

    // Update float indicator
    const floatY = 320 - (data.level / 100) * 260; // 260px is the indicator tube height
    floatIndicator.setAttribute('cy', floatY);
  }

  // Animate agitator blades
  if (data.agitator) {
    aggBlades.classList.add('rotating');
  } else {
    aggBlades.classList.remove('rotating');
  }

  // Update LED and glow effects
  toggleLed(ledHeater, data.heater);
  toggleLed(ledAeration, data.aeration);
  toggleLed(ledAgitator, data.agitator);
  
  if (data.heater) {
    flameGlow.classList.add('active');
  } else {
    flameGlow.classList.remove('active');
  }
}

function updateControlButtons(data) {
  toggleButtonState(btnHeater, data.heater);
  toggleButtonState(btnAeration, data.aeration);
  toggleButtonState(btnAgitator, data.agitator);
  
  // Logic for Start/Stop button
  const anyOn = data.heater || data.aeration || data.agitator;
  btnStart.classList.toggle('toggle-on', anyOn);
  btnStop.classList.toggle('toggle-on', !anyOn);
}

function toggleLed(ledElement, state) {
  if (state) {
    ledElement.classList.remove('led-off');
    ledElement.classList.add('led-green');
  } else {
    ledElement.classList.remove('led-green');
    ledElement.classList.add('led-off');
  }
}

function toggleButtonState(button, state) {
  button.classList.toggle('toggle-on', state);
  button.setAttribute('aria-pressed', state);
}

// --- Event Listeners ---
function setupEventListeners() {
  // Navigation
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPageId = e.target.getAttribute('href').substring(1);
      
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById(targetPageId).classList.add('active');
      
      navLinks.forEach(l => l.removeAttribute('aria-current'));
      e.target.setAttribute('aria-current', 'page');
      
      // Update browser history for back/forward
      window.history.pushState({ page: targetPageId }, '', `#${targetPageId}`);
    });
  });
  window.addEventListener('popstate', (e) => {
    const page = e.state ? e.state.page : 'home';
    document.getElementById(page).classList.add('active');
  });

  // Home Page Controls
  btnHeater.addEventListener('click', () => {
    const isHeating = !btnHeater.classList.contains('toggle-on');
    sendCommand({ cmd: "set", target: "heater", value: isHeating });
  });
  btnAeration.addEventListener('click', () => {
    const isAerating = !btnAeration.classList.contains('toggle-on');
    sendCommand({ cmd: "set", target: "aeration", value: isAerating });
  });
  btnAgitator.addEventListener('click', () => {
    const isAgitating = !btnAgitator.classList.contains('toggle-on');
    sendCommand({ cmd: "set", target: "agitator", value: isAgitating });
  });
  btnStart.addEventListener('click', () => {
    sendCommand({ cmd: "set", target: "all", value: true });
  });
  btnStop.addEventListener('click', () => {
    sendCommand({ cmd: "set", target: "all", value: false });
  });
  btnEStop.addEventListener('click', () => {
    if (confirm("WARNING: Emergency Stop will halt all processes immediately. Are you sure?")) {
        sendCommand({ cmd: "emergency", action: "stop" });
        // Also update UI to a safe state
        currentReadouts = { ...currentReadouts, heater: false, aeration: false, agitator: false };
        updateSvgAnimations(currentReadouts);
        updateControlButtons(currentReadouts);
    }
  });

  // Parameters Page
  setTempInput.addEventListener('input', (e) => setTempNumber.value = e.target.value);
  setTempNumber.addEventListener('input', (e) => setTempInput.value = e.target.value);
  setPhInput.addEventListener('input', (e) => setPhNumber.value = e.target.value);
  setPhNumber.addEventListener('input', (e) => setPhInput.value = e.target.value);
  setRpmInput.addEventListener('input', (e) => setRpmNumber.value = e.target.value);
  setRpmNumber.addEventListener('input', (e) => setRpmInput.value = e.target.value);
  setDoInput.addEventListener('input', (e) => setDoNumber.value = e.target.value);
  setDoNumber.addEventListener('input', (e) => setDoInput.value = e.target.value);

  btnApplyParams.addEventListener('click', (e) => {
    e.preventDefault();
    showModal(confirmModal, () => {
      const params = {
        temp: parseFloat(setTempNumber.value),
        ph: parseFloat(setPhNumber.value),
        rpm: parseInt(setRpmNumber.value),
        do: parseInt(setDoNumber.value),
        duration: setDurationInput.value,
      };
      if (validateParams(params)) {
        sendCommand({ cmd: "set", target: "params", value: params });
        hideModal(confirmModal);
      } else {
        alert("Please check your parameter values. Ensure they are within valid ranges.");
      }
    });
  });

  // Modals
  function showModal(modal, onConfirm) {
    modal.classList.add('active');
    modal.focus();
    const confirmBtn = modal.querySelector('.confirm');
    const cancelBtn = modal.querySelector('.cancel');
    
    // Clear old listeners to prevent multiple triggers
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));

    const newConfirmBtn = modal.querySelector('.confirm');
    const newCancelBtn = modal.querySelector('.cancel');
    
    newConfirmBtn.addEventListener('click', onConfirm);
    newCancelBtn.addEventListener('click', () => hideModal(modal));
    
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideModal(modal);
    });
  }

  function hideModal(modal) {
    modal.classList.remove('active');
  }

  btnScan.addEventListener('click', () => {
    showModal(scanModal, () => {
        const ssid = ssidInput.value;
        const password = passwordInput.value;
        if (ssid) {
          sendCommand({ cmd: "net", action: "connect", ssid, pwd: password });
          hideModal(scanModal);
        } else {
          alert("SSID cannot be empty.");
        }
    });
  });

  // Graphs Page
  document.querySelectorAll('.graph-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      toggleChartDataset(btn.dataset.dataset);
    });
  });

  document.getElementById('time-window-select').addEventListener('change', (e) => {
    const minutes = parseInt(e.target.value);
    // This is for future implementation. It would require the server to provide historical data.
    console.log(`Setting time window to ${minutes} minutes.`);
  });
  
  document.getElementById('exportCSV').addEventListener('click', exportChartData);
}

// --- Chart.js Logic ---
const chartColors = {
  temp: 'rgb(255, 99, 132)',
  ph: 'rgb(54, 162, 235)',
  do: 'rgb(75, 192, 192)',
  rpm: 'rgb(255, 205, 86)'
};

const dataHistory = {
  temp: [],
  ph: [],
  do: [],
  rpm: [],
  labels: []
};

let bioreactorChart;

function setupChart() {
  const ctx = document.getElementById('bioreactorChart').getContext('2d');
  bioreactorChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataHistory.labels,
      datasets: [
        {
          label: 'Temperature (°C)',
          data: dataHistory.temp,
          borderColor: chartColors.temp,
          yAxisID: 'yTemp',
          tension: 0.2,
          hidden: false
        },
        {
          label: 'pH',
          data: dataHistory.ph,
          borderColor: chartColors.ph,
          yAxisID: 'yPh',
          tension: 0.2,
          hidden: false
        },
        {
          label: 'DO (%)',
          data: dataHistory.do,
          borderColor: chartColors.do,
          yAxisID: 'yDo',
          tension: 0.2,
          hidden: false
        },
        {
          label: 'RPM',
          data: dataHistory.rpm,
          borderColor: chartColors.rpm,
          yAxisID: 'yRpm',
          tension: 0.2,
          hidden: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: 'var(--accent-green)' }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'second' },
          title: { display: true, text: 'Time', color: 'var(--accent-green)' },
          ticks: { color: 'var(--accent-green)' },
          grid: { color: '#333' }
        },
        yTemp: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Temp (°C)', color: 'var(--accent-green)' },
          ticks: { color: chartColors.temp },
          grid: { color: '#333' }
        },
        yPh: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'pH', color: 'var(--accent-green)' },
          ticks: { color: chartColors.ph },
          grid: { drawOnChartArea: false }
        },
        yDo: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'DO (%)', color: 'var(--accent-green)' },
          ticks: { color: chartColors.do },
          grid: { drawOnChartArea: false }
        },
        yRpm: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'RPM', color: 'var(--accent-green)' },
          ticks: { color: chartColors.rpm },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function updateChart(data) {
  const now = Date.now();
  dataHistory.labels.push(now);
  dataHistory.temp.push(data.temp);
  dataHistory.ph.push(data.ph);
  dataHistory.do.push(data.do);
  dataHistory.rpm.push(data.rpm);

  // Keep data window limited (e.g., last 30 minutes)
  const maxDataPoints = 1800; // 30 minutes * 60 seconds/min
  if (dataHistory.labels.length > maxDataPoints) {
    for (const key in dataHistory) {
      if (Array.isArray(dataHistory[key])) {
        dataHistory[key].shift();
      }
    }
  }

  bioreactorChart.update('none');
}

function toggleChartDataset(datasetName) {
  const dataset = bioreactorChart.data.datasets.find(d => d.label.toLowerCase().includes(datasetName));
  if (dataset) {
    dataset.hidden = !dataset.hidden;
    bioreactorChart.update();
  }
}

function exportChartData() {
  const csvRows = ['Time,Temperature,pH,DO,RPM'];
  for (let i = 0; i < dataHistory.labels.length; i++) {
    const time = new Date(dataHistory.labels[i]).toISOString();
    const row = [time, dataHistory.temp[i], dataHistory.ph[i], dataHistory.do[i], dataHistory.rpm[i]].join(',');
    csvRows.push(row);
  }
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'bioreactor_data.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- Utility Functions ---
function logToNetwork(message) {
  const now = new Date().toLocaleTimeString();
  netLog.textContent = `[${now}] ${message}\n${netLog.textContent}`;
  // Limit log size
  const lines = netLog.textContent.split('\n');
  if (lines.length > 20) {
    netLog.textContent = lines.slice(0, 20).join('\n');
  }
}

function validateParams(params) {
  const { temp, ph, rpm, do: dissolvedOxygen, duration } = params;
  if (isNaN(temp) || temp < 20 || temp > 45) return false;
  if (isNaN(ph) || ph < 4 || ph > 10) return false;
  if (isNaN(rpm) || rpm < 0 || rpm > 1000) return false;
  if (isNaN(dissolvedOxygen) || dissolvedOxygen < 0 || dissolvedOxygen > 100) return false;
  if (!duration.match(/^[0-9]{2}:[0-9]{2}$/)) return false;
  return true;
}

// --- Demo Mode Simulation ---
let demoInterval;
function startDemoMode() {
  logToNetwork('DEMO MODE: WebSocket disconnected. Simulating data...');
  if (demoInterval) clearInterval(demoInterval);
  demoInterval = setInterval(() => {
    const randomFactor = (Math.random() - 0.5) * 0.5; // Small random variation
    
    currentReadouts.temp = Math.max(30, Math.min(40, currentReadouts.temp + randomFactor));
    currentReadouts.ph = Math.max(6, Math.min(8, currentReadouts.ph + randomFactor * 0.1));
    currentReadouts.do = Math.max(50, Math.min(100, currentReadouts.do + randomFactor * 2));
    currentReadouts.rpm = currentReadouts.agitator ? 300 + randomFactor * 50 : 0;
    currentReadouts.level = Math.max(20, Math.min(95, currentReadouts.level + randomFactor * 0.5));
    
    // Simulate initial data on first run
    if (currentReadouts.temp === 0) {
      currentReadouts = {
        temp: 37.21, ph: 7.12, do: 92, rpm: 300, level: 65,
        heater: true, aeration: false, agitator: true
      };
    }

    handleWsMessage(currentReadouts);
  }, 1000); // Update every second
}

function handleDemoCommand(command) {
    if (command.cmd === "set") {
        if (command.target === "heater") currentReadouts.heater = command.value;
        if (command.target === "aeration") currentReadouts.aeration = command.value;
        if (command.target === "agitator") currentReadouts.agitator = command.value;
        if (command.target === "all") {
            currentReadouts.heater = command.value;
            currentReadouts.aeration = command.value;
            currentReadouts.agitator = command.value;
        }
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupChart();
  connectWebSocket();
  
  // Handle initial page load with hash
  const initialPageId = window.location.hash.substring(1) || 'home';
  const initialPage = document.getElementById(initialPageId);
  if (initialPage) {
    pages.forEach(p => p.classList.remove('active'));
    initialPage.classList.add('active');
    const navLink = document.getElementById(`nav-${initialPageId}`);
    if (navLink) navLink.setAttribute('aria-current', 'page');
  }
});
