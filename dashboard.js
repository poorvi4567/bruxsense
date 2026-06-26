// ═══════════════════════════════════════════════════════
// LIVE MONITORING DASHBOARD LOGIC
// ═══════════════════════════════════════════════════════

(function() {
  const MAX_POINTS = 60;
  let lastTotalEvents = -1;
  let isCurrentlyGrinding = false;

  const liveData = {
    labels: Array(MAX_POINTS).fill(''),
    emg:    Array(MAX_POINTS).fill(null),
    hr:     Array(MAX_POINTS).fill(null),
    grind:  Array(MAX_POINTS).fill(null),
    events: Array(MAX_POINTS).fill(0)
  };

  // Setup global Chart.js defaults
  Chart.defaults.color           = '#c8cdd8';
  Chart.defaults.font.family     = "'DM Mono', monospace";
  Chart.defaults.borderColor     = '#2a3040';
  const gridColor = 'rgba(255,255,255,0.05)';

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
      y: { grid: { color: gridColor }, position: 'right' }
    },
    elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } }
  };

  // Instantiating the Charts
  const emgChart = new Chart(document.getElementById('emgChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: liveData.labels,
      datasets: [{
        data: liveData.emg, borderColor: '#00d4aa',
        backgroundColor: 'rgba(0,212,170,0.1)',
        borderWidth: 2, fill: true, tension: 0.3,
        segment: {
          borderColor:     ctx => liveData.events[ctx.p0DataIndex] ? '#ff3333' : '#00d4aa',
          backgroundColor: ctx => liveData.events[ctx.p0DataIndex]
            ? 'rgba(255,51,51,0.2)' : 'rgba(0,212,170,0.1)'
        }
      }]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, min: 0 } } }
  });

  const hrChart = new Chart(document.getElementById('hrChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: liveData.labels,
      datasets: [{
        data: liveData.hr, borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255,107,107,0.1)',
        borderWidth: 2, fill: true, tension: 0.4
      }]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, min: 40, max: 120 } } }
  });

  const motionChart = new Chart(document.getElementById('motionChart').getContext('2d'), {
    type: 'line',
    data: {
      labels: liveData.labels,
      datasets: [{
        data: liveData.grind, borderColor: '#7c6bff',
        backgroundColor: 'rgba(124,107,255,0.1)',
        borderWidth: 2, fill: true, tension: 0.2
      }]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, min: 0 } } }
  });

  // Expose updates to global scope
  window.updateDashboardFromFirebase = function(data) {
    const now = new Date();
    const ts  = `${String(now.getHours()).padStart(2,'0')}:`
               +`${String(now.getMinutes()).padStart(2,'0')}:`
               +`${String(now.getSeconds()).padStart(2,'0')}`;

    const emg       = parseFloat(data.emg_rms)     || 0;
    const hr        = parseInt(data.hr_bpm)         || 0;
    const grind     = parseInt(data.grind_score)
                      || parseInt(data.grinding_score) || 0;
    const isClench  = parseInt(data.event_flag)     === 1;
    const isGrind   = grind >= 8;
    const isEvent   = isClench || isGrind;
    const evType    = data.event_type               || 'unknown';
    const totalEvts = parseInt(data.total_events)   || 0;

    // Buffer shifting
    liveData.labels.push(ts);
    liveData.emg.push(emg);
    liveData.hr.push(hr > 0 ? hr : null);
    liveData.grind.push(grind);
    liveData.events.push(isEvent ? 1 : 0);
    if (liveData.labels.length > MAX_POINTS) {
      ['labels','emg','hr','grind','events'].forEach(k => liveData[k].shift());
    }

    // Chart redraws
    emgChart.update(); 
    hrChart.update(); 
    motionChart.update();

    // KPIs updates
    document.getElementById('kpiEmg').textContent  = emg.toFixed(3);
    document.getElementById('kpiEmg').style.color  = isEvent ? 'var(--accent-alert)' : 'var(--text-primary)';
    document.getElementById('kpiHr').textContent   = hr > 0 ? hr : '--';
    document.getElementById('kpiGrind').textContent= grind;
    document.getElementById('kpiEvents').textContent = totalEvts;

    // Signal flash animations
    ['pulseEmg','pulseHr','pulseGrind'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.opacity = '1';
        setTimeout(() => el.style.opacity = '0.2', 500);
      }
    });

    document.getElementById('liveBadge').innerHTML =
      `<div class="live-dot"></div> LIVE · ${ts}`;
    document.getElementById('sessionInfo').textContent = 'Receiving data...';

    // Logging active events
    if (lastTotalEvents === -1) lastTotalEvents = totalEvts;
    let shouldLog = false, logType = evType;
    if (totalEvts > lastTotalEvents) { shouldLog = true; lastTotalEvents = totalEvts; }
    if (isGrind && !isCurrentlyGrinding) { shouldLog = true; logType = 'grinding'; }
    isCurrentlyGrinding = isGrind;
    if (shouldLog) addLiveEvent(ts, logType, emg, hr, grind);

    const banner = document.getElementById('alertBanner');
    if (isEvent) {
      banner.classList.add('active');
      banner.textContent = isGrind && isClench
        ? '⚠️ CLENCHING & GRINDING DETECTED ⚠️'
        : isGrind ? '⚠️ GRINDING DETECTED ⚠️'
        : `⚠️ ${evType.toUpperCase()} BRUXISM DETECTED ⚠️`;
    } else {
      banner.classList.remove('active');
    }
  };

  function addLiveEvent(time, type, emg, hr, grind) {
    const logEl   = document.getElementById('eventLog');
    const empty   = logEl.querySelector('.empty-log');
    if (empty) empty.remove();
    const item    = document.createElement('div');
    item.className = `event-item ${type}`;
    const details  = type === 'grinding'
      ? `Grind Score: ${grind} | HR: ${hr > 0 ? hr + ' BPM' : '--'}`
      : `Peak RMS: ${emg.toFixed(3)}V | HR: ${hr > 0 ? hr + ' BPM' : '--'}`;
    item.innerHTML =
      `<div class="event-time">${time}</div>
       <div class="event-details">
         <div class="event-type">${type} event</div>
         <div class="event-stats">${details}</div>
       </div>`;
    logEl.insertBefore(item, logEl.firstChild);
    if (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
  }
})();
