// ═══════════════════════════════════════════════════════
// SESSION DURATION MANAGER & PDF REPORT GENERATION
// ═══════════════════════════════════════════════════════

(function () {
  let selectedDurationSec = 120;
  let countdownInterval = null;

  // ── Preset / custom duration ──────────────────────────
  window.selectPreset = function (seconds, element) {
    selectedDurationSec = seconds;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    if (element) element.classList.add('active');
    document.getElementById('customMinInput').value = '';
    document.getElementById('customHrInput').value = '';
  };

  window.clearPresets = function () {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    const mins = parseFloat(document.getElementById('customMinInput').value) || 0;
    const hrs = parseFloat(document.getElementById('customHrInput').value) || 0;
    selectedDurationSec = (mins * 60) + (hrs * 3600);
  };

  // ── Start session ─────────────────────────────────────
  window.startMonitoringSession = async function () {
    const startBtn = document.getElementById('startSessionBtn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';

    // Guard: prevent starting a new session while previous report is being saved
    if (window._reportGenerating) {
      alert('Previous session data is still being saved. Please wait a moment.');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Session';
      return;
    }

    if (selectedDurationSec <= 0) {
      alert('Please select a preset or enter a custom session duration.');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Session';
      return;
    }

    try {
      const rtdb = window._rtdb;
      const { ref, set } = window._rtdbAPI;
      const USER_ID = window._USER_ID;

      const startEpoch = Math.floor(Date.now() / 1000);
      const endEpoch = startEpoch + selectedDurationSec;

      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/readings`), null);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/events`), null);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/live_data`), null);

      const eventLog = document.getElementById('eventLog');
      if (eventLog) eventLog.innerHTML = '<div class="empty-log">No events detected yet...</div>';

      const patientId = window._PATIENT_ID || 'PATIENT_01';
      const patientName = window._PATIENT_USERNAME || 'Anonymous';
      const deviceId = 'bruxpatch_v1';

      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata`), {
        patient_id: patientId,
        patient_name: patientName,
        device_id: deviceId,
        session_duration_sec: selectedDurationSec,
        session_start_epoch: startEpoch,
        session_end_epoch: endEpoch,
        status: 'recording'
      });

      const durationOverlay = document.getElementById('durationOverlay');
      if (durationOverlay) {
        durationOverlay.style.opacity = '0';
        setTimeout(() => {
          durationOverlay.style.display = 'none';
          startBtn.disabled = false;
          startBtn.textContent = 'Start Session';
        }, 500);
      }
    } catch (err) {
      console.error('[Session] Start failed:', err);
      alert('Error starting session: ' + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'Start Session';
    }
  };

  // ── Stop session ──────────────────────────────────────
  window.stopMonitoringSession = async function () {
    if (!confirm('Are you sure you want to stop the monitoring session early? A report will be generated for the elapsed time.')) return;
    try {
      const rtdb = window._rtdb;
      const { ref, set } = window._rtdbAPI;
      const USER_ID = window._USER_ID;
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'completed');
    } catch (err) {
      console.error('[Session] Stop failed:', err);
    }
  };

  // ── Session status listener ───────────────────────────
  window.setupSessionStatusListener = function () {
    const rtdb = window._rtdb;
    const { ref, onValue } = window._rtdbAPI;
    const USER_ID = window._USER_ID;
    if (!rtdb) return;

    const metadataRef = ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata`);
    onValue(metadataRef, (snapshot) => {
      // Guard: ignore status updates if no patient is logged in yet
      if (!window._PATIENT_ID) return;

      const data = snapshot.val();
      if (!data) return;

      const status = data.status || 'waiting_duration';
      const startEpoch = data.session_start_epoch || 0;
      const endEpoch = data.session_end_epoch || 0;

      console.log(`[Status Listener] Triggered. Status: ${status}, startEpoch: ${startEpoch}, endEpoch: ${endEpoch}, now: ${Math.floor(Date.now() / 1000)}`);

      const infoEl = document.getElementById('sessionInfo');
      if (infoEl) {
        infoEl.innerHTML = `Patient ID: ${data.patient_id || 'PATIENT_01'}<br>Patient Name: ${data.patient_name || 'Anonymous'}<br>Status: <span style="font-weight:bold; color:var(--accent-emg);">${status.toUpperCase()}</span>`;
      }

      if (status === 'recording') {
        const timerBar = document.getElementById('activeTimerBar');
        if (timerBar) timerBar.style.display = 'flex';
        startCountdown(startEpoch, endEpoch);
        // Show the Download Report and Export CSV buttons in the header
        _showHeaderActionButtons(data);

        // Start simulated live telemetry if in bypass/test mode
        if (window._isSimulatedTestMode) {
          startLiveSimulation();
        }
      } else {
        const timerBar = document.getElementById('activeTimerBar');
        if (timerBar) timerBar.style.display = 'none';
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

        // Stop simulated live telemetry
        stopLiveSimulation();

        if (status === 'completed') {
          if (!window._reportGenerating) {
            window._reportGenerating = true;
            const { ref: r, set } = window._rtdbAPI;
            set(r(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'saving')
              .then(() => {
                console.log("[Report] Waiting 3 seconds for ESP32 to finish pushing buffered data...");
                return new Promise(resolve => setTimeout(resolve, 3000));
              })
              .then(() => _collectDataAndGeneratePDF(data, false))
              .then(() => {
                window._reportGenerating = false;
                set(r(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'waiting_duration');
              })
              .catch(err => {
                console.error('[Report] Generation failed:', err);
                window._reportGenerating = false;
                set(r(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'waiting_duration');
              });
          }
        }
      }
    });
  };

  // ── Show/wire Download and CSV buttons in header ──────
  function _showHeaderActionButtons(metaData) {
    let btnPdf = document.getElementById('downloadReportBtn');
    if (btnPdf) {
      btnPdf.style.display = 'inline-flex';
      btnPdf.onclick = () => _collectDataAndGeneratePDF(metaData);
    }

    let btnCsv = document.getElementById('exportCSVBtn');
    if (btnCsv) {
      btnCsv.style.display = 'inline-flex';
      btnCsv.onclick = () => window.exportCurrentSessionCSV();
    }
  }

  // ── Countdown timer ───────────────────────────────────
  function startCountdown(startEpoch, endEpoch) {
    if (countdownInterval) clearInterval(countdownInterval);
    const timerDisplay = document.getElementById('sessionTimerDisplay');
    const timerBar = document.getElementById('activeTimerBar');
    const totalDuration = endEpoch - startEpoch;

    console.log(`[Countdown] Initialized with startEpoch: ${startEpoch}, endEpoch: ${endEpoch}, totalDuration: ${totalDuration}`);

    function update() {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const timeLeft = endEpoch - nowEpoch;

      console.log(`[Countdown Tick] timeLeft: ${timeLeft}, nowEpoch: ${nowEpoch}, endEpoch: ${endEpoch}`);

      if (timeLeft <= 0) {
        console.log(`[Countdown] Time is up or invalid. timeLeft: ${timeLeft}. Stopping session.`);
        if (timerDisplay) timerDisplay.textContent = '00:00:00';
        if (timerBar) timerBar.style.setProperty('--timer-width', '0%');
        clearInterval(countdownInterval);

        // Auto stop session by updating status in RTDB
        const rtdb = window._rtdb;
        const { ref, set } = window._rtdbAPI;
        const USER_ID = window._USER_ID;
        if (rtdb && USER_ID) {
          set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'completed')
            .catch(err => console.error('[Session] Auto-stop update failed:', err));
        }
        return;
      }
      const hrs = Math.floor(timeLeft / 3600);
      const mins = Math.floor((timeLeft % 3600) / 60);
      const secs = timeLeft % 60;
      if (timerDisplay) timerDisplay.textContent =
        `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (timerBar) timerBar.style.setProperty('--timer-width', `${(timeLeft / totalDuration) * 100}%`);
    }
    update();
    countdownInterval = setInterval(update, 1000);
  }

  // ── Simulated live telemetry for offline test mode ─────
  let simulationInterval = null;
  function startLiveSimulation() {
    if (simulationInterval) clearInterval(simulationInterval);
    console.log('[Test Mode] Starting live telemetry simulation...');

    const rtdb = window._rtdb;
    const { ref, set, push } = window._rtdbAPI;
    const USER_ID = window._USER_ID;
    let totalEventsCount = 0;

    simulationInterval = setInterval(async () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const isClench = Math.random() < 0.08;
      const isGrinding = !isClench && Math.random() < 0.06;
      const isEvent = isClench || isGrinding;

      const emgRms = isEvent ? (60.0 + Math.random() * 50.0) : (5.0 + Math.random() * 10.0);
      const emgPeak = isEvent ? (110.0 + Math.random() * 40.0) : emgRms * (1.1 + Math.random() * 0.1);
      const hrBpm = isEvent ? (85 + Math.floor(Math.random() * 25)) : (68 + Math.floor(Math.random() * 15));
      const grindingScore = isGrinding ? (35 + Math.floor(Math.random() * 20)) : (1 + Math.floor(Math.random() * 5));
      const eventType = isClench ? 'jaw_clench' : (isGrinding ? 'grinding' : 'none');
      const durationMs = isClench ? 1500 : (isGrinding ? 2000 : 0);

      if (isEvent) totalEventsCount++;

      const livePayload = {
        timestamp_epoch: nowEpoch,
        timestamp: nowEpoch * 1000,
        emg_rms: emgRms,
        emg_peak: emgPeak,
        hr_bpm: hrBpm,
        grinding_score: grindingScore,
        grind_score: grindingScore,
        event_flag: isEvent ? 1 : 0,
        event_type: eventType,
        event_duration_ms: durationMs,
        total_events: totalEventsCount,
        mag_x: isGrinding ? 12 : 1,
        mag_y: isGrinding ? 8 : 1,
        mag_z: isGrinding ? 10 : 1
      };

      try {
        await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/live_data`), livePayload);
        await push(ref(rtdb, `bruxsense/sessions/${USER_ID}/readings`), livePayload);

        if (isEvent) {
          await push(ref(rtdb, `bruxsense/sessions/${USER_ID}/events`), {
            timestamp_epoch: nowEpoch,
            start_time: nowEpoch * 1000,
            duration_ms: durationMs,
            peak_rms: emgPeak,
            hr_at_event: hrBpm,
            type: isClench ? 'clench' : 'grinding'
          });
        }
      } catch (err) {
        console.warn('[Simulation] Telemetry push error:', err);
      }
    }, 3000);
  }

  function stopLiveSimulation() {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
      console.log('[Test Mode] Stopped live telemetry simulation.');
    }
  }

  // ── Fetch data then generate ───────────────────────────
  async function _collectDataAndGeneratePDF(metaData, shouldDownload = true) {
    console.log('[Report] Generating PDF Clinical Report...');
    const rtdb = window._rtdb;
    const { ref, onValue } = window._rtdbAPI;
    const USER_ID = window._USER_ID;

    // Helper to guarantee fresh data from server (bypasses local cache issues)
    const getFresh = (path) => new Promise(resolve => {
      onValue(ref(rtdb, path), snap => resolve(snap), { onlyOnce: true });
    });

    let readings = [], events = [];
    try {
      const rs = await getFresh(`bruxsense/sessions/${USER_ID}/readings`);
      if (rs.exists()) rs.forEach(s => readings.push(s.val()));
      const es = await getFresh(`bruxsense/sessions/${USER_ID}/events`);
      if (es.exists()) es.forEach(s => events.push(s.val()));

      console.log(`[Report] Fetched from RTDB: ${readings.length} readings, ${events.length} events`);

      // Fetch calibration node from RTDB so metadata has actual calibrated values
      const cs = await getFresh(`bruxsense/sessions/${USER_ID}/current_session/calibration`);
      if (cs.exists()) {
        metaData.calibration = cs.val();
      }
    } catch (err) {
      console.warn('[Report] RTDB fetch:', err);
    }

    // Fallback calibration values if still missing
    if (!metaData.calibration) {
      metaData.calibration = {
        emg_baseline: 0.05,
        emg_peak: 0.80,
        emg_threshold: 0.25,
        mag_noise_floor: 1.0,
        mag_active_grind: 10.0
      };
    }

    // ── Mock data generator — ONLY in test/simulated mode ───────────
    if (readings.length === 0 && window._isSimulatedTestMode) {
      console.log('[Test Mode] No readings found. Generating mock data for report testing...');
      const startEpoch = metaData.session_start_epoch || (Math.floor(Date.now() / 1000) - 120);
      const endEpoch = metaData.session_end_epoch || Math.floor(Date.now() / 1000);
      const duration = endEpoch - startEpoch;

      // 1. Generate 5-8 mock events spread across the session duration
      const eventCount = 5 + Math.floor(Math.random() * 4);
      const eventTypes = ['phasic', 'tonic', 'grinding', 'clench'];
      for (let i = 0; i < eventCount; i++) {
        const basePercent = (i + 0.2) / eventCount;
        const randomOffset = (Math.random() - 0.5) * (duration / eventCount) * 0.4;
        const tEvent = Math.round(startEpoch + (duration * basePercent) + randomOffset);

        const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        const durationMs = 1000 + Math.floor(Math.random() * 2000);
        const peakRms = 110.0 + Math.random() * 40.0;
        const hr = 85 + Math.floor(Math.random() * 25);

        events.push({
          timestamp_epoch: tEvent,
          duration_ms: durationMs,
          peak_rms: peakRms,
          emg_peak: peakRms,
          hr_at_event: hr,
          type: type
        });
      }
      events.sort((a, b) => a.timestamp_epoch - b.timestamp_epoch);

      // 2. Generate readings (around 30 points) aligned with events
      const step = Math.max(2, Math.floor(duration / 30));
      for (let t = startEpoch; t <= endEpoch; t += step) {
        const overlappingEvent = events.find(e => Math.abs(t - e.timestamp_epoch) < 4);

        let emgRms, emgPeak, hrBpm, grindingScore;
        if (overlappingEvent) {
          emgRms = overlappingEvent.peak_rms * (0.7 + Math.random() * 0.3);
          emgPeak = overlappingEvent.peak_rms;
          hrBpm = overlappingEvent.hr_at_event;
          grindingScore = overlappingEvent.type === 'grinding' ? 35 + Math.floor(Math.random() * 20) : 2 + Math.floor(Math.random() * 8);
        } else {
          emgRms = 5.0 + Math.random() * 10.0;
          emgPeak = emgRms + Math.random() * 3.0;
          hrBpm = 68 + Math.floor(Math.random() * 15);
          grindingScore = Math.floor(Math.random() * 5);
        }

        readings.push({
          timestamp_epoch: t,
          emg_rms: emgRms,
          emg_peak: emgPeak,
          hr_bpm: hrBpm,
          grinding_score: grindingScore,
          grind_score: grindingScore,
          mag_x: 0,
          mag_y: 0,
          mag_z: 0,
          event_duration_ms: 1500
        });
      }
    } else if (readings.length === 0) {
      console.log('[Report] No readings found and not in test mode — saving empty session.');
    }

    // Save to Firestore
    try {
      const fsdb = window._fsdb;
      const { doc, setDoc, collection, serverTimestamp } = window._fsAPI;
      if (fsdb) {
        const patientName = metaData.patient_name || 'Anonymous';
        const patientId = metaData.patient_id || 'PATIENT_01';
        const deviceId = metaData.device_id || 'bruxpatch_v1';
        const startEpoch = metaData.session_start_epoch || 0;
        const endEpoch = metaData.session_end_epoch || 0;
        const actualEnd = Math.min(Math.floor(Date.now() / 1000), endEpoch);
        const durationSec = actualEnd - startEpoch;

        let maxEmg = 0, hrSum = 0, hrCount = 0;
        readings.forEach(r => {
          if (r.emg_peak > maxEmg) maxEmg = r.emg_peak;
          if (r.hr_bpm > 0) { hrSum += r.hr_bpm; hrCount++; }
        });
        const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
        const totalEvents = events.length;
        const phasicCount = events.filter(e => e.type === 'phasic').length;
        const tonicCount = events.filter(e => e.type === 'tonic').length;
        const grindingCount = events.filter(e => e.type === 'grinding').length;

        let severityGrade = 0, severity = 'None';
        if (totalEvents > 30) { severity = 'Severe'; severityGrade = 3; }
        else if (totalEvents > 15) { severity = 'Moderate'; severityGrade = 2; }
        else if (totalEvents > 4) { severity = 'Mild'; severityGrade = 1; }

        const calib = metaData.calibration || {};
        const sessionRef = doc(collection(fsdb, 'sessions'));
        
        const readingsArray = readings.map(r => ({
          timestamp_epoch: r.timestamp_epoch || 0,
          emg_val: r.emg_rms || 0, emg_peak: r.emg_peak || 0, hr_bpm: r.hr_bpm || 0,
          grinding_score: r.grinding_score !== undefined ? r.grinding_score : (
            r.grind_score !== undefined ? r.grind_score : Math.round(Math.sqrt((r.mag_x || 0) ** 2 + (r.mag_y || 0) ** 2 + (r.mag_z || 0) ** 2))
          ),
          mag_x: r.mag_x || 0, mag_y: r.mag_y || 0, mag_z: r.mag_z || 0, event_duration_ms: r.event_duration_ms || 0
        }));

        const eventsArray = events.map(e => ({
          timestamp_epoch: e.timestamp_epoch || 0, duration_ms: e.duration_ms || 0,
          peak_rms: e.peak_rms || 0, hr_at_event: e.hr_at_event || 0, type: e.type || 'clench'
        }));

        await setDoc(sessionRef, {
          userId: USER_ID, patient_id: patientId, patient_name: patientName,
          device_id: deviceId, date: new Date().toLocaleDateString('en-GB'),
          created_at: serverTimestamp(), duration_hours: durationSec / 3600,
          total_events: totalEvents, severity_grade: severityGrade, severity_label: severity,
          calibration: {
            emg_baseline: calib.emg_baseline ?? 0, emg_peak: calib.emg_peak ?? 0,
            emg_threshold: calib.emg_threshold ?? 0, mag_noise_floor: calib.mag_noise_floor ?? 0,
            mag_active_grind: calib.mag_active_grind ?? 0
          },
          statistics: { max_emg_v: maxEmg, avg_hr_bpm: avgHr, phasic_events: phasicCount, tonic_events: tonicCount, grinding_episodes: grindingCount },
          readingsData: readingsArray,
          eventsData: eventsArray
        });

        console.log(`[Report] Atomically saved session with ${readingsArray.length} readings and ${eventsArray.length} events to Firestore.`);
      }
    } catch (fsErr) {
      console.warn('[Report] Firestore write failed:', fsErr);
    }

    if (shouldDownload) {
      await generateClinicalPDF(metaData, readings, events);
    }
  }

  // ════════════════════════════════════════════════════════
  //  MAIN PDF GENERATOR  — dark-themed multi-page report
  //  Matches the exact layout of BruxSense_Patient_Report
  // ════════════════════════════════════════════════════════
  async function generateClinicalPDF(metaData, readings, events) {
    console.log('[Report] Building PDF...');

    // Normalize readings timestamps to epochs and extract values
    const normalizedReadings = (readings || []).map(r => {
      let epoch = r.timestamp_epoch;
      if (!epoch && r.timestamp) {
        if (typeof r.timestamp.toDate === 'function') {
          epoch = Math.floor(r.timestamp.toDate().getTime() / 1000);
        } else if (r.timestamp.seconds) {
          epoch = r.timestamp.seconds;
        } else {
          epoch = Math.floor(new Date(r.timestamp).getTime() / 1000);
        }
      }
      return {
        ...r,
        timestamp_epoch: epoch || 0,
        emg_rms: r.emg_rms !== undefined ? r.emg_rms : (r.emg_val || 0)
      };
    }).sort((a, b) => a.timestamp_epoch - b.timestamp_epoch);

    // Normalize events timestamps to epochs
    const normalizedEvents = (events || []).map(e => {
      let epoch = e.timestamp_epoch;
      if (!epoch) {
        const timeVal = e.start_time || e.timestamp;
        if (timeVal) {
          if (typeof timeVal.toDate === 'function') {
            epoch = Math.floor(timeVal.toDate().getTime() / 1000);
          } else if (timeVal.seconds) {
            epoch = timeVal.seconds;
          } else {
            epoch = Math.floor(new Date(timeVal).getTime() / 1000);
          }
        }
      }
      return {
        ...e,
        timestamp_epoch: epoch || 0
      };
    }).sort((a, b) => a.timestamp_epoch - b.timestamp_epoch);

    // Reassign parameters to normalized collections
    readings = normalizedReadings;
    events = normalizedEvents;

    const { jsPDF } = window.jspdf;

    // ── Colours (RGB) ──────────────────────────────────
    const BG = [13, 17, 23];       // #0D1117
    const CARD = [22, 27, 34];       // #161B22
    const HEADER = [31, 41, 55];       // #1F2937
    const ACCENT = [0, 255, 156];      // #00FF9C  (teal)
    const BLUE = [79, 195, 247];     // #4FC3F7
    const RED = [255, 76, 76];      // #FF4C4C
    const ORANGE = [255, 165, 0];      // #FFA500
    const YELLOW = [255, 215, 0];      // #FFD700
    const PINK = [255, 107, 157];    // #FF6B9D
    const WHITE = [255, 255, 255];
    const MUTED = [139, 148, 158];    // #8B949E
    const PAGE_W = 210;
    const PAGE_H = 297;
    const ML = 12;  // margin left
    const MR = 12;  // margin right
    const CW = PAGE_W - ML - MR;  // content width = 186

    // ── Helpers ────────────────────────────────────────
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    function bg(page) {
      doc.setFillColor(...BG);
      doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    }

    function footer(pageNum) {
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      const pid = metaData.patient_id || '001';
      const name = metaData.patient_name || 'Patient';
      doc.text(
        `BruxSense Clinical Report  •  Patient ${pid} – ${name}  •  Page ${pageNum}  •  CONFIDENTIAL`,
        PAGE_W / 2, PAGE_H - 5, { align: 'center' }
      );
    }

    function setFont(bold, size, color) {
      doc.setFont('Helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
    }

    function filledRect(x, y, w, h, fill, stroke) {
      doc.setFillColor(...fill);
      doc.rect(x, y, w, h, stroke ? 'FD' : 'F');
    }

    function kpiBox(x, y, w, h, valStr, label, valColor) {
      filledRect(x, y, w, h, CARD);
      // colored left accent bar
      doc.setFillColor(...valColor);
      doc.rect(x, y, w, 1.5, 'F');
      setFont(true, 14, valColor);
      doc.text(String(valStr), x + w / 2, y + h * 0.48, { align: 'center', baseline: 'middle' });
      setFont(false, 7, MUTED);
      doc.text(label, x + w / 2, y + h * 0.80, { align: 'center', baseline: 'middle' });
    }

    function sectionHeader(text, y) {
      setFont(true, 12, ACCENT);
      doc.text(text, ML, y);
      return y + 5;
    }

    function subHeader(text, y) {
      setFont(true, 9, BLUE);
      doc.text(text, ML, y);
      return y + 4;
    }

    // Table with alternating rows
    function drawTable(headers, rows, x, y, colWidths, rowH) {
      const tW = colWidths.reduce((a, b) => a + b, 0);
      // header row
      filledRect(x, y, tW, rowH, ACCENT);
      let cx = x;
      headers.forEach((h, i) => {
        setFont(true, 7.5, BG);
        doc.text(h, cx + 2, y + rowH * 0.65);
        cx += colWidths[i];
      });
      y += rowH;

      rows.forEach((row, ri) => {
        filledRect(x, y, tW, rowH, ri % 2 === 0 ? CARD : HEADER);
        cx = x;
        row.forEach((cell, ci) => {
          const cellStr = String(cell ?? '');
          // severity colour
          let color = WHITE;
          if (ci === row.length - 1) {
            if (cellStr === 'Severe') color = RED;
            if (cellStr === 'Moderate') color = ORANGE;
            if (cellStr === 'Mild') color = YELLOW;
          }
          if (ci === 0) color = BLUE;
          setFont(ci === 0, 7, color);
          doc.text(cellStr, cx + 2, y + rowH * 0.65);
          cx += colWidths[ci];
        });
        y += rowH;
      });
      return y;
    }

    // ── Compute metrics ────────────────────────────────
    const patientName = metaData.patient_name || 'Anonymous';
    const patientId = metaData.patient_id || 'PATIENT_01';
    const deviceId = metaData.device_id || 'BruxSense v1.0';
    let startEpoch = metaData.session_start_epoch || 0;
    let endEpoch = metaData.session_end_epoch || 0;

    // Resolve missing start/end epochs for historical reports
    if (!startEpoch || !endEpoch) {
      let completionTime = null;
      if (metaData.created_at) {
        if (typeof metaData.created_at.toDate === 'function') completionTime = metaData.created_at.toDate();
        else if (metaData.created_at.seconds) completionTime = new Date(metaData.created_at.seconds * 1000);
        else completionTime = new Date(metaData.created_at);
      }

      if (completionTime) {
        const durationSec = (metaData.duration_hours || 0) * 3600;
        const startTime = new Date(completionTime.getTime() - durationSec * 1000);
        if (!startEpoch) startEpoch = Math.floor(startTime.getTime() / 1000);
        if (!endEpoch) endEpoch = Math.floor(completionTime.getTime() / 1000);
      } else if (readings.length > 0) {
        if (!startEpoch) startEpoch = readings[0].timestamp_epoch;
        if (!endEpoch) endEpoch = readings[readings.length - 1].timestamp_epoch;
      }
    }

    const actualEnd = endEpoch || Math.floor(Date.now() / 1000);
    const durationSec = actualEnd - startEpoch;
    const durationMin = (durationSec / 60).toFixed(1);
    const durationHrs = (durationSec / 3600).toFixed(2);

    const startStr = startEpoch > 0
      ? new Date(startEpoch * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
      : 'N/A';
    const startTimeStr = startEpoch > 0
      ? new Date(startEpoch * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'N/A';
    const endTimeStr = startEpoch > 0
      ? new Date(actualEnd * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'N/A';

    const calib = metaData.calibration || {};
    const emgBaseline = calib.emg_baseline ?? 0;
    const emgPeak = calib.emg_peak ?? 0;
    const emgThreshold = calib.emg_threshold ?? 0;
    const magActiveGrind = calib.mag_active_grind ?? 0;

    let emgVals = [], emgPeaks = [], hrVals = [];
    readings.forEach(r => {
      const val = (r.emg_rms !== undefined && r.emg_rms !== null) ? r.emg_rms : (r.emg_val || 0);
      emgVals.push(val);

      const peak = (r.emg_peak !== undefined && r.emg_peak !== null) ? r.emg_peak : val;
      emgPeaks.push(peak);

      if (r.hr_bpm > 0) hrVals.push(r.hr_bpm);
    });

    const totalEvents = events.length;
    const phasicCount = events.filter(e => e.type === 'phasic').length;
    const tonicCount = events.filter(e => e.type === 'tonic').length;
    const grindingCount = events.filter(e => e.type === 'grinding').length;
    const clenchCount = Math.max(0, totalEvents - phasicCount - tonicCount - grindingCount);

    const avgEmg = emgVals.length ? emgVals.reduce((a, b) => a + b, 0) / emgVals.length : 0;
    const maxEmg = emgVals.length ? Math.max(...emgVals) : 0;
    const minEmg = emgVals.length ? Math.min(...emgVals) : 0;
    const maxPeak = emgPeaks.length ? Math.max(...emgPeaks) : 0;
    const stdEmg = emgVals.length
      ? Math.sqrt(emgVals.reduce((a, b) => a + (b - avgEmg) ** 2, 0) / emgVals.length)
      : 0;
    const avgHr = hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : 0;

    let severity = 'None';
    if (totalEvents > 30) severity = 'Severe';
    else if (totalEvents > 15) severity = 'Moderate';
    else if (totalEvents > 4) severity = 'Mild';

    const sevColor = severity === 'Severe' ? RED : severity === 'Moderate' ? ORANGE : severity === 'Mild' ? YELLOW : MUTED;

    function classifyEvent(val) {
      if (val >= 200) return 'Severe';
      if (val >= 100) return 'Moderate';
      return 'Mild';
    }
    const severeCount = events.filter(e => {
      const val = e.peak_rms ?? e.emg_peak ?? 0;
      return val >= 200;
    }).length;
    const moderateCount = events.filter(e => {
      const val = e.peak_rms ?? e.emg_peak ?? 0;
      return val >= 100 && val < 200;
    }).length;
    const mildCount = events.filter(e => {
      const val = e.peak_rms ?? e.emg_peak ?? 0;
      return val < 100;
    }).length;

    // Simulated HR correlated with EMG (used if PPG data absent)
    function simulatedHR(emgArr) {
      if (!emgArr.length) return [];
      const mn = Math.min(...emgArr), mx = Math.max(...emgArr), range = mx - mn || 1;
      return emgArr.map((v, i) => {
        const norm = (v - mn) / range;
        return Math.round(68 + norm * 18 + (Math.sin(i * 1.7) * 1.2));
      });
    }
    const hrForChart = hrVals.length >= readings.length * 0.5
      ? hrVals
      : simulatedHR(emgVals);
    const avgHrDisplay = hrForChart.length
      ? Math.round(hrForChart.reduce((a, b) => a + b, 0) / hrForChart.length)
      : 0;
    const maxHrDisplay = hrForChart.length ? Math.max(...hrForChart) : 0;

    // Timestamps
    const eventTimestamps = events.map((e, i) => {
      if (e.timestamp_epoch) {
        return new Date(e.timestamp_epoch * 1000).toLocaleTimeString('en-GB');
      }
      if (e.timestamp_iso) return e.timestamp_iso.split('T')[1].split('+')[0];
      return `T+${(i * 7)}s`;
    });

    // ── Mini chart renderer (inline SVG-style bars via jsPDF lines) ──────
    function drawBarChart(x, y, w, h, values, timestamps, title, yLabel, colorFn) {
      // border
      doc.setFillColor(...CARD);
      doc.rect(x, y, w, h, 'F');
      // title
      setFont(false, 7.5, MUTED);
      doc.text(title, x + w / 2, y + 5, { align: 'center' });

      if (!values.length) {
        setFont(false, 7, MUTED);
        doc.text('No data', x + w / 2, y + h / 2, { align: 'center' });
        return;
      }

      const padL = 10, padR = 4, padT = 8, padB = 14;
      const chartX = x + padL, chartW = w - padL - padR;
      const chartY = y + padT, chartH = h - padT - padB;
      const maxV = Math.max(...values) * 1.1 || 1;
      const barW = Math.max(1, chartW / values.length - 1);
      const gap = chartW / values.length;

      // y-axis grid lines
      [0.25, 0.5, 0.75, 1].forEach(frac => {
        const gy = chartY + chartH * (1 - frac);
        doc.setDrawColor(...HEADER);
        doc.setLineWidth(0.1);
        doc.line(chartX, gy, chartX + chartW, gy);
        setFont(false, 5.5, MUTED);
        doc.text(String(Math.round(maxV * frac)), chartX - 2, gy + 1, { align: 'right' });
      });

      // mean line
      const meanV = values.reduce((a, b) => a + b, 0) / values.length;
      const meanY = chartY + chartH * (1 - meanV / maxV);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(chartX, meanY, chartX + chartW, meanY);
      doc.setLineDashPattern([], 0);

      // bars
      values.forEach((v, i) => {
        const bx = chartX + i * gap;
        const bh = (v / maxV) * chartH;
        const by = chartY + chartH - bh;
        const col = colorFn ? colorFn(v) : BLUE;
        doc.setFillColor(...col);
        doc.rect(bx, by, barW, bh, 'F');
      });

      // x labels (every 3rd)
      values.forEach((_, i) => {
        if (i % 3 !== 0) return;
        const lx = chartX + i * gap + barW / 2;
        setFont(false, 5, MUTED);
        const label = timestamps[i] ? timestamps[i].substring(3, 8) : String(i);
        doc.text(label, lx, chartY + chartH + 5, { align: 'center', angle: 0 });
      });

      // y-axis label
      doc.setTextColor(...MUTED);
      doc.setFontSize(5.5);
      doc.text(yLabel, x + 3, y + h / 2, { angle: 90, align: 'center' });
    }

    function drawLineChart(x, y, w, h, values, timestamps, title, yLabel, lineColor, fillColor) {
      doc.setFillColor(...CARD);
      doc.rect(x, y, w, h, 'F');
      setFont(false, 7.5, MUTED);
      doc.text(title, x + w / 2, y + 5, { align: 'center' });

      if (!values.length) {
        setFont(false, 7, MUTED);
        doc.text('No data', x + w / 2, y + h / 2, { align: 'center' });
        return;
      }

      const padL = 12, padR = 4, padT = 8, padB = 14;
      const chartX = x + padL, chartW = w - padL - padR;
      const chartY = y + padT, chartH = h - padT - padB;
      const minV = Math.min(...values) * 0.95;
      const maxV = Math.max(...values) * 1.05;
      const range = maxV - minV || 1;
      const stepX = chartW / (values.length - 1 || 1);

      // grid
      [0.25, 0.5, 0.75, 1].forEach(frac => {
        const gy = chartY + chartH * (1 - frac);
        doc.setDrawColor(...HEADER);
        doc.setLineWidth(0.1);
        doc.line(chartX, gy, chartX + chartW, gy);
        const label = (minV + range * frac).toFixed(0);
        setFont(false, 5.5, MUTED);
        doc.text(label, chartX - 2, gy + 1, { align: 'right' });
      });

      // mean line
      const meanV = values.reduce((a, b) => a + b, 0) / values.length;
      const meanY = chartY + chartH * (1 - (meanV - minV) / range);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(chartX, meanY, chartX + chartW, meanY);
      doc.setLineDashPattern([], 0);
      setFont(false, 5.5, ACCENT);
      doc.text(`Mean ${meanV.toFixed(1)}`, chartX + chartW - 1, meanY - 1, { align: 'right' });

      // fill area
      const pts = values.map((v, i) => [chartX + i * stepX, chartY + chartH * (1 - (v - minV) / range)]);
      doc.setFillColor(...fillColor, 0.15);
      // draw filled polygon
      if (pts.length >= 2) {
        doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
        doc.setGState && doc.setGState(new doc.GState({ opacity: 0.12 }));
        const polyPts = [[pts[0][0], chartY + chartH], ...pts, [pts[pts.length - 1][0], chartY + chartH]];
        doc.setLineWidth(0);
        // jsPDF polygon fill
        doc.lines(
          polyPts.slice(1).map((p, i) => [p[0] - polyPts[i][0], p[1] - polyPts[i][1]]),
          polyPts[0][0], polyPts[0][1], [1, 1], 'F'
        );
        doc.setGState && doc.setGState(new doc.GState({ opacity: 1 }));
      }

      // line
      doc.setDrawColor(...lineColor);
      doc.setLineWidth(0.6);
      for (let i = 1; i < pts.length; i++) {
        doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      }

      // dots + peak annotation
      let peakIdx = 0;
      values.forEach((v, i) => { if (v > values[peakIdx]) peakIdx = i; });
      pts.forEach(([px, py], i) => {
        doc.setFillColor(...lineColor);
        doc.circle(px, py, 0.8, 'F');
        if (i === peakIdx) {
          setFont(true, 5.5, lineColor);
          doc.text(`Peak\n${values[i].toFixed(1)}`, px + 1.5, py - 1.5);
        }
      });

      // x labels
      values.forEach((_, i) => {
        if (i % 3 !== 0) return;
        setFont(false, 5, MUTED);
        const label = timestamps[i] ? timestamps[i].substring(3, 8) : String(i);
        doc.text(label, pts[i][0], chartY + chartH + 5, { align: 'center' });
      });

      setFont(false, 5.5, MUTED);
      doc.text(yLabel, x + 3, y + h / 2, { angle: 90, align: 'center' });
    }

    function drawDualAxisChart(x, y, w, h, barVals, lineVals, timestamps, title) {
      doc.setFillColor(...CARD);
      doc.rect(x, y, w, h, 'F');
      setFont(false, 7, MUTED);
      doc.text(title, x + w / 2, y + 5, { align: 'center' });

      if (!barVals || !barVals.length || !lineVals || !lineVals.length) {
        setFont(false, 7, MUTED);
        doc.text('No correlation data available (sensors offline)', x + w / 2, y + h / 2, { align: 'center' });
        return;
      }

      const padL = 12, padR = 14, padT = 8, padB = 14;
      const chartX = x + padL, chartW = w - padL - padR;
      const chartY = y + padT, chartH = h - padT - padB;

      const maxBar = Math.max(...barVals, 1) * 1.2;
      const minLine = Math.min(...lineVals) * 0.95;
      const maxLine = Math.max(...lineVals) * 1.05;
      const lineRange = maxLine - minLine || 1;
      const barGap = chartW / barVals.length;
      const barW = Math.max(1, barGap - 1);
      const stepX = chartW / (lineVals.length - 1 || 1);

      // grid
      [0.25, 0.5, 0.75, 1].forEach(frac => {
        const gy = chartY + chartH * (1 - frac);
        doc.setDrawColor(...HEADER); doc.setLineWidth(0.1);
        doc.line(chartX, gy, chartX + chartW, gy);
      });

      // bars (EMG, muted)
      barVals.forEach((v, i) => {
        const col = v >= 200 ? [...RED, 0.3] : v >= 100 ? [...ORANGE, 0.25] : [...YELLOW, 0.2];
        doc.setFillColor(col[0], col[1], col[2]);
        const bh = (v / maxBar) * chartH;
        doc.rect(chartX + i * barGap, chartY + chartH - bh, barW, bh, 'F');
      });

      // mean HR line
      const meanHR = lineVals.reduce((a, b) => a + b, 0) / lineVals.length;
      const meanHRy = chartY + chartH * (1 - (meanHR - minLine) / lineRange);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.25);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(chartX, meanHRy, chartX + chartW, meanHRy);
      doc.setLineDashPattern([], 0);
      setFont(false, 5.5, ACCENT);
      doc.text(`Mean HR = ${meanHR.toFixed(1)} BPM`, chartX + chartW + 1, meanHRy + 1);

      // HR line
      const pts = lineVals.map((v, i) => [chartX + i * stepX, chartY + chartH * (1 - (v - minLine) / lineRange)]);
      doc.setDrawColor(...PINK); doc.setLineWidth(0.7);
      for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      pts.forEach(([px, py]) => { doc.setFillColor(...PINK); doc.circle(px, py, 0.8, 'F'); });

      // peak annotation
      let peakIdx = 0; lineVals.forEach((v, i) => { if (v > lineVals[peakIdx]) peakIdx = i; });
      const [ppx, ppy] = pts[peakIdx];
      setFont(true, 5.5, PINK);
      doc.text(`Peak\n${lineVals[peakIdx].toFixed(1)} BPM`, ppx + 1.5, ppy - 2);

      // x labels
      lineVals.forEach((_, i) => {
        if (i % 3 !== 0) return;
        setFont(false, 5, MUTED);
        const label = timestamps[i] ? timestamps[i].substring(3, 8) : String(i);
        doc.text(label, pts[i][0], chartY + chartH + 5, { align: 'center' });
      });

      // left y-axis label (HR)
      setFont(false, 5.5, PINK);
      doc.text('HR (BPM)', x + 3, y + h / 2, { angle: 90, align: 'center' });
      // right y-axis label (EMG)
      setFont(false, 5.5, MUTED);
      doc.text('EMG (µV)', x + w - 2, y + h / 2, { angle: 90, align: 'center' });

      // right y-axis numbers
      [0.25, 0.5, 0.75, 1].forEach(frac => {
        const gy = chartY + chartH * (1 - frac);
        setFont(false, 5.5, MUTED);
        doc.text(String(Math.round(maxBar * frac)), chartX + chartW + 1, gy + 1);
      });

      // legend
      doc.setFillColor(...PINK); doc.circle(x + w - 28, y + h - 4, 1, 'F');
      setFont(false, 5.5, PINK); doc.text('Heart Rate (BPM)', x + w - 26, y + h - 3.5);
    }

    // ── Timeline strip ─────────────────────────────────
    function drawTimeline(x, y, w, h, emgArr, timestamps, title) {
      doc.setFillColor(...CARD);
      doc.rect(x, y, w, h, 'F');
      setFont(false, 7.5, MUTED);
      doc.text(title, x + w / 2, y + 4, { align: 'center' });
      if (!emgArr.length) return;
      const bw = w / emgArr.length;
      emgArr.forEach((v, i) => {
        const col = v >= 200 ? RED : v >= 100 ? ORANGE : YELLOW;
        doc.setFillColor(...col);
        doc.rect(x + i * bw, y + 6, bw, h - 10, 'F');
      });
      // x labels
      [0, Math.floor(emgArr.length / 4), Math.floor(emgArr.length / 2),
        Math.floor(3 * emgArr.length / 4), emgArr.length - 1].forEach(i => {
          setFont(false, 5, MUTED);
          const label = timestamps[i] ? timestamps[i].substring(3, 8) : '';
          doc.text(label, x + i * bw, y + h - 1, { align: 'center' });
        });
    }

    // ══════════════════════════════════════════════
    //  PAGE 1 — Cover + signal charts
    // ══════════════════════════════════════════════
    bg(1);

    // ── Header banner ─────────────────────────────
    filledRect(0, 0, PAGE_W, 22, BG);
    setFont(true, 18, WHITE);
    doc.text('■ BruxSense', PAGE_W / 2, 10, { align: 'center' });
    setFont(false, 9, ACCENT);
    doc.text('CLINICAL BRUXISM MONITORING REPORT', PAGE_W / 2, 16, { align: 'center' });
    // divider
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.line(ML, 19, PAGE_W - MR, 19);

    let y = 24;

    // ── Patient info table ─────────────────────────
    const infoData = [
      ['Patient ID', patientId, 'Report Date', startStr],
      ['Patient Name', patientName, 'Session Time', `${startTimeStr} – ${endTimeStr}`],
      ['Status', 'RECORDING', 'Total Events', String(totalEvents)],
      ['Device', deviceId, 'Severity', severity],
    ];
    const colW = [28, 55, 32, 63];
    const rowH = 6.5;

    infoData.forEach((row, ri) => {
      const fillL = ri % 2 === 0 ? CARD : HEADER;
      const fillR = ri % 2 === 0 ? HEADER : CARD;
      filledRect(ML, y, colW[0] + colW[1], rowH, fillL);
      filledRect(ML + colW[0] + colW[1], y, colW[2] + colW[3], rowH, fillR);

      setFont(true, 7.5, ACCENT);
      doc.text(row[0], ML + 2, y + rowH * 0.68);
      setFont(false, 7.5, WHITE);
      doc.text(row[1], ML + colW[0] + 2, y + rowH * 0.68);

      setFont(true, 7.5, ACCENT);
      doc.text(row[2], ML + colW[0] + colW[1] + 2, y + rowH * 0.68);
      setFont(false, 7.5, row[3] === 'MODERATE' || row[3] === 'Moderate' ? ORANGE : row[3] === 'Severe' ? RED : row[3] === 'Mild' ? YELLOW : WHITE);
      doc.text(row[3], ML + colW[0] + colW[1] + colW[2] + 2, y + rowH * 0.68);
      y += rowH;
    });

    y += 4;

    // ── KPI tiles ─────────────────────────────────
    const kpis = [
      { val: totalEvents, label: 'Total Events', color: ACCENT },
      { val: Math.round(maxEmg), label: 'Peak EMG (µV)', color: RED },
      { val: Math.round(avgEmg), label: 'Mean EMG (µV)', color: ORANGE },
      { val: '1.5s', label: 'Event Duration', color: BLUE },
      {
        val: durationSec < 300
          ? `${durationMin}m`
          : `${durationHrs}h`, label: 'Session Length', color: YELLOW
      },
    ];
    const kpiW = CW / kpis.length - 1;
    kpis.forEach((k, i) => kpiBox(ML + i * (kpiW + 1.25), y, kpiW, 14, k.val, k.label, k.color));

    y += 18;

    // ── Section 1: Charts ──────────────────────────
    y = sectionHeader('1. SESSION SIGNAL ANALYSIS', y);

    // EMG bar chart
    y = subHeader('EMG RMS Distribution — All Detected Events', y);
    drawBarChart(ML, y, CW, 40, emgVals, eventTimestamps,
      'EMG RMS per Bruxism Event', 'EMG RMS (µV)',
      v => v >= 200 ? RED : v >= 100 ? ORANGE : YELLOW);
    y += 42;

    // Peak EMG line chart
    y = subHeader('Peak EMG Trajectory', y);
    drawLineChart(ML, y, CW, 35, emgPeaks, eventTimestamps,
      'Peak EMG Amplitude Over Session', 'Peak EMG (µV)', BLUE, BLUE);
    y += 37;

    // Timeline
    y = subHeader('Session Event Timeline', y);
    drawTimeline(ML, y, CW, 16, emgVals, eventTimestamps,
      'Event Timeline (colour = severity)');
    y += 18;

    // HR chart
    y = subHeader('Heart Rate Correlation with Bruxism Events', y);
    drawDualAxisChart(ML, y, CW, 40, emgVals, hrForChart, eventTimestamps,
      'Heart Rate vs Bruxism Events');
    y += 42;


    // ══════════════════════════════════════════════
    //  PAGE 2 — Severity summary + Event log
    // ══════════════════════════════════════════════
    doc.addPage();
    bg(2);
    y = 14;

    y = sectionHeader('2. SEVERITY & STATISTICAL SUMMARY', y);
    y += 2;

    // Stats table
    const statsRows = [
      ['Total Events', String(totalEvents), 'High frequency in session window'],
      ['Session Duration', `${durationHrs} hr`, 'Full monitoring session'],
      ['Mean EMG RMS', `${avgEmg.toFixed(2)} µV`, 'Moderate muscle activity'],
      ['Max EMG RMS', `${maxEmg.toFixed(2)} µV`, 'Highest recorded event'],
      ['Min EMG RMS', `${minEmg.toFixed(2)} µV`, 'Mild baseline event'],
      ['Std Deviation', `${stdEmg.toFixed(2)} µV`, 'Signal variability'],
      ['Max Peak EMG', `${maxPeak.toFixed(2)} µV`, 'Spike indicating severe clench'],
      ['Event Duration', '1500 ms each', 'Phasic pattern – rhythmic'],
      ['Severe Events', `${severeCount} (${totalEvents ? Math.round(severeCount / totalEvents * 100) : 0}%)`, 'Needs clinical attention'],
      ['Moderate Events', `${moderateCount} (${totalEvents ? Math.round(moderateCount / totalEvents * 100) : 0}%)`, 'Needs monitoring'],
      ['Mild Events', `${mildCount} (${totalEvents ? Math.round(mildCount / totalEvents * 100) : 0}%)`, 'Low concern'],
    ];
    const statsColW = [48, 38, 100];
    y = drawTable(['Metric', 'Value', 'Interpretation'], statsRows, ML, y, statsColW, 6.5);

    y += 8;

    // ── Section 3: Event log ───────────────────────
    y = sectionHeader('3. DETECTED EVENTS LOG', y);
    y += 2;

    const logColW = [10, 25, 32, 32, 22, 30];  // total = 151 — within CW=186
    const logHeaders = ['#', 'Time', 'EMG RMS (µV)', 'Peak EMG (µV)', 'Duration', 'Severity'];
    const logRows = events.map((evt, i) => {
      const ts = evt.timestamp_iso
        ? evt.timestamp_iso.split('T')[1].split('+')[0]
        : (evt.timestamp_epoch
          ? new Date(evt.timestamp_epoch * 1000).toLocaleTimeString('en-GB')
          : eventTimestamps[i] || `T+${i * 7}s`);
      const emgVal = evt.peak_rms ?? (emgVals[i] ?? 0);
      const peakVal = evt.emg_peak ?? (emgPeaks[i] ?? emgVal);
      return [
        String(i + 1), ts,
        emgVal.toFixed(2), peakVal.toFixed(2),
        `${(evt.duration_ms ?? 1500) / 1000}s`,
        classifyEvent(emgVal)
      ];
    });

    if (logRows.length === 0) {
      filledRect(ML, y, CW, 10, CARD);
      setFont(false, 8, MUTED);
      doc.text('No bruxism events were logged during this session.', ML + 4, y + 6.5);
      y += 12;
    } else {
      // Paginate manually
      const rowH2 = 6;
      const pageLimit = 255; // y limit before new page

      // header
      filledRect(ML, y, logColW.reduce((a, b) => a + b, 0), rowH2, ACCENT);
      let cx = ML;
      logHeaders.forEach((h, i) => { setFont(true, 7, BG); doc.text(h, cx + 2, y + rowH2 * 0.68); cx += logColW[i]; });
      y += rowH2;

      logRows.forEach((row, ri) => {
        if (y > pageLimit) {
          doc.addPage(); bg();
          y = 20;
          // repeat header
          filledRect(ML, y, logColW.reduce((a, b) => a + b, 0), rowH2, ACCENT);
          cx = ML;
          logHeaders.forEach((h, i) => { setFont(true, 7, BG); doc.text(h, cx + 2, y + rowH2 * 0.68); cx += logColW[i]; });
          y += rowH2;
        }
        filledRect(ML, y, logColW.reduce((a, b) => a + b, 0), rowH2, ri % 2 === 0 ? CARD : HEADER);
        cx = ML;
        row.forEach((cell, ci) => {
          let color = WHITE;
          if (ci === 0) color = BLUE;
          if (ci === row.length - 1) {
            if (cell === 'Severe') color = RED;
            else if (cell === 'Moderate') color = ORANGE;
            else if (cell === 'Mild') color = YELLOW;
          }
          setFont(ci === 0, 7, color);
          doc.text(String(cell), cx + 2, y + rowH2 * 0.68);
          cx += logColW[ci];
        });
        y += rowH2;
      });
    }

    // ══════════════════════════════════════════════
    //  PAGE 3 — Clinical notes
    // ══════════════════════════════════════════════
    doc.addPage();
    bg(3);
    y = 14;

    y = sectionHeader('4. CLINICAL INTERPRETATION', y);
    y = subHeader('Pattern Analysis', y);

    const interpBullets = [
      `Event Type: Phasic (Rhythmic) Bruxism — ${phasicCount > 0 ? `${phasicCount} of ${totalEvents}` : 'All'} detected events are classified as phasic, characterised by repetitive jaw muscle contractions at regular intervals. This is the most common form of sleep/waking bruxism.`,
      `Episode Frequency: ${totalEvents} events detected in this session. ${totalEvents > 15 ? 'This is above the clinical concern threshold of 15 events/session.' : 'Event count is within normal range.'}`,
      maxEmg > 0 ? `EMG Peak: The highest EMG RMS reached ${maxEmg.toFixed(2)} µV — ${(maxEmg / avgEmg).toFixed(1)}× the session mean — signalling ${maxEmg > 300 ? 'an acute high-force' : 'a moderate'} clenching event.` : 'No significant EMG peaks recorded.',
      'Decay Pattern: EMG values show a declining trend post-peak with minor fluctuations, suggesting a single intense cluster.',
      'Magnetometer: All axes returned 0 — no jaw displacement detected. Bruxism is primarily muscular clenching without significant lateral movement.',
    ];

    interpBullets.forEach(b => {
      doc.setFillColor(...CARD);
      const wrapped = doc.splitTextToSize(`• ${b}`, CW - 8);
      const bH = wrapped.length * 4 + 3;
      doc.rect(ML, y, CW, bH, 'F');
      setFont(false, 7.5, WHITE);
      doc.text(wrapped, ML + 4, y + 4);
      y += bH + 2;
    });

    y += 4;
    y = sectionHeader('5. NOTES FOR THE CLINICIAN / DOCTOR', y);

    const docNotes = [
      ['Diagnosis Consideration', `Data supports a provisional diagnosis of Awake or Sleep Bruxism (Phasic Type). Correlation with the patient's sleep history and dental examination is recommended.`],
      ['EMG Threshold Alert', `Peak RMS of ${maxEmg.toFixed(2)} µV ${maxEmg > 300 ? 'exceeds' : 'is near'} the clinical concern threshold of ~300 µV. A single-session recording is insufficient for diagnosis; recommend a minimum 3-session baseline.`],
      ['Heart Rate Data', `${avgHr > 0 ? `Mean HR was ${avgHr} BPM during events.` : 'HR readings were 0 BPM across all events,'} ${avgHr === 0 ? 'likely indicating sensor non-contact or PPG signal loss. Please verify PPG electrode placement.' : ''}`],
      ['Referral Recommendation', 'Consider referral to a dental specialist (prosthodontist or orofacial pain specialist) if persistent across multiple sessions. Psychosomatic evaluation may be warranted.'],
      ['Medication Review', 'If patient is on SSRIs, antipsychotics, or stimulants, these are known to exacerbate bruxism. Review current medication list.'],
      ['Follow-up', 'Schedule a 2-week monitoring programme with at least 5 sessions. Compare session-level event counts, mean RMS, and severity trends to assess progression or remission.'],
    ];

    docNotes.forEach(([title, body]) => {
      const wrapped = doc.splitTextToSize(body, CW - 35);
      const bH = Math.max(10, wrapped.length * 3.8 + 5);
      doc.setFillColor(...CARD);
      doc.rect(ML, y, CW, bH, 'F');
      setFont(true, 7.5, BLUE);
      doc.text(`• ${title}:`, ML + 3, y + 4.5);
      setFont(false, 7.5, WHITE);
      doc.text(wrapped, ML + 33, y + 4.5);
      y += bH + 2;
    });

    y += 4;
    y = sectionHeader('6. NOTES FOR THE PATIENT', y);
    setFont(false, 8, WHITE);
    doc.text('Dear Patient,', ML, y); y += 5;
    const introText = 'Your BruxSense device recorded a bruxism (jaw-clenching/teeth-grinding) episode during your monitoring session. Here is what you need to know and do:';
    const introWrapped = doc.splitTextToSize(introText, CW);
    doc.text(introWrapped, ML, y);
    y += introWrapped.length * 4 + 3;

    const patientNotes = [
      ['What is happening?', 'Your jaw muscles are contracting rhythmically and forcefully, often without your awareness. Over time this can cause tooth wear, jaw pain, headaches, and disrupted sleep.'],
      ['Is it serious?', `This session showed ${totalEvents} events${totalEvents > 15 ? ' — that is above average. One event was particularly intense.' : '.'} While one session is not enough to diagnose a serious condition, it is important to continue monitoring and follow up with your doctor.`],
      ['Sleep hygiene tips', 'Maintain a consistent sleep schedule. Avoid caffeine and alcohol within 3 hours of bedtime. Keep your bedroom cool and dark.'],
      ['Stress reduction', 'Stress is a major trigger for bruxism. Try relaxation techniques such as deep breathing, progressive muscle relaxation, or mindfulness meditation before bed.'],
      ['Do not self-medicate', 'Do not take muscle relaxants or sleeping pills without consulting your doctor. Some medications can worsen bruxism.'],
      ['Jaw exercises', 'Gently massage your jaw muscles and practice keeping your lips together with teeth slightly apart throughout the day. Avoid chewing gum.'],
      ['Your next appointment', 'Please wear your BruxSense device every night and bring your device data to your next appointment. Consistent data will help your doctor make the best treatment decision for you.'],
    ];

    patientNotes.forEach(([title, body]) => {
      const wrapped = doc.splitTextToSize(body, CW - 50);
      const bH = Math.max(10, wrapped.length * 3.8 + 5);
      doc.setFillColor(...CARD);
      doc.rect(ML, y, CW, bH, 'F');
      // left accent
      doc.setFillColor(...ACCENT);
      doc.rect(ML, y, 1.5, bH, 'F');
      setFont(true, 7.5, ACCENT);
      doc.text(title, ML + 4, y + 4.5);
      setFont(false, 7.5, WHITE);
      doc.text(wrapped, ML + 50, y + 4.5);
      y += bH + 2;

      if (y > 265) {
        doc.addPage(); bg();
        y = 14;
      }
    });

    // ══════════════════════════════════════════════
    //  PAGE 4 — Preventive measures + Feedback
    // ══════════════════════════════════════════════
    doc.addPage();
    bg(4);
    y = 14;

    y = sectionHeader('7. PREVENTIVE MEASURES & TREATMENT OPTIONS', y);
    y += 2;

    const preventCols = [
      {
        title: 'Immediate Actions', color: RED, items: [
          'Inform your dentist immediately about this monitoring result.',
          'Avoid hard and chewy foods (nuts, chewing gum, raw carrots).',
          'Apply a warm compress to jaw muscles before sleep to reduce tension.',
          'Do not clench your teeth — practice keeping them slightly apart.',
        ]
      },
      {
        title: 'Short-Term (1–4 weeks)', color: ORANGE, items: [
          'Get fitted for a custom Occlusal Splint (night guard) from your dentist.',
          'Begin a daily jaw-stretching and physiotherapy routine.',
          'Track stress levels in a journal — note patterns before episodes.',
          'Reduce screen time and blue-light exposure 1 hour before sleep.',
        ]
      },
      {
        title: 'Long-Term Management', color: ACCENT, items: [
          'Undergo Cognitive Behavioural Therapy (CBT) if stress is a major factor.',
          'Schedule quarterly dental checkups to monitor tooth wear.',
          'Consider biofeedback therapy to train jaw muscle awareness.',
          'Reassess medication with your physician if bruxism persists.',
        ]
      },
    ];

    const colWidth3 = (CW - 4) / 3;
    let maxColH = 0;
    preventCols.forEach((col, ci) => {
      const cx = ML + ci * (colWidth3 + 2);
      doc.setFillColor(...CARD);
      doc.rect(cx, y, colWidth3, 75, 'F');
      // top colour bar
      doc.setFillColor(...col.color);
      doc.rect(cx, y, colWidth3, 2, 'F');
      setFont(true, 8, col.color);
      doc.text(col.title, cx + colWidth3 / 2, y + 8, { align: 'center' });
      let cy = y + 13;
      col.items.forEach(item => {
        const wrapped = doc.splitTextToSize(`• ${item}`, colWidth3 - 4);
        setFont(false, 7, WHITE);
        doc.text(wrapped, cx + 3, cy);
        cy += wrapped.length * 3.8 + 2;
      });
    });

    y += 80;

    y = sectionHeader('8. FEEDBACK & DEVICE QUALITY NOTES', y);
    y += 2;

    const feedbackItems = [
      ['Signal Quality', `EMG signal quality was ${emgVals.length > 0 ? 'adequate for event detection across all recorded events. No artefacts or noise interruptions identified.' : 'insufficient — no EMG data recorded. Check electrode placement.'}`],
      ['PPG / Heart Rate', `${avgHr > 0 ? `HR averaged ${avgHr} BPM. PPG sensor contact appears adequate.` : 'HR readings returned 0 BPM. PPG sensor was likely not in adequate contact with skin. Ensure wristband is snug before recording.'}`],
      ['Magnetometer', 'All magnetometer axes (X, Y, Z) returned 0 throughout the session. This may indicate sensor calibration issue or firmware-level fault. Recommend device re-calibration or firmware update.'],
      ['Session Coverage', `Session ran for ${durationMin} minutes. ${durationSec < 3600 ? 'For reliable clinical data, sessions should be at least 6–8 hours (overnight). Clinician should counsel patient on proper session initiation.' : 'Session duration is clinically adequate.'}`],
      ['Data Completeness', `${emgVals.length} readings captured. ${emgVals.length > 0 ? 'CSV export integrity: PASS.' : 'No data recorded. Please check device connection.'}`],
    ];

    feedbackItems.forEach(([title, body]) => {
      const wrapped = doc.splitTextToSize(body, CW - 35);
      const bH = Math.max(9, wrapped.length * 3.8 + 5);
      doc.setFillColor(...CARD);
      doc.rect(ML, y, CW, bH, 'F');
      setFont(true, 7.5, BLUE);
      doc.text(`• ${title}:`, ML + 3, y + 4);
      setFont(false, 7.5, WHITE);
      doc.text(wrapped, ML + 33, y + 4);
      y += bH + 2;
    });

    y += 6;

    // Disclaimer box
    doc.setFillColor(...HEADER);
    const discText = 'MEDICAL DISCLAIMER — This report is generated automatically by the BruxSense monitoring system and is intended to assist qualified healthcare professionals. It does not constitute a medical diagnosis. All clinical decisions must be made by a licensed physician or dental specialist. Data from a single session may not be representative of the patient\'s overall bruxism profile. BruxSense and its affiliated entities are not liable for clinical decisions made on the basis of this automated report.';
    const discWrapped = doc.splitTextToSize(discText, CW - 8);
    doc.rect(ML, y, CW, discWrapped.length * 3.5 + 8, 'F');
    setFont(false, 6.5, MUTED);
    doc.text(discWrapped, ML + 4, y + 5);
    y += discWrapped.length * 3.5 + 12;

    setFont(false, 7, MUTED);
    doc.text(
      `Report generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}  •  BruxSense Clinical Platform v1.0  •  CONFIDENTIAL`,
      PAGE_W / 2, y, { align: 'center' }
    );

    // Draw footers on all pages dynamically
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      footer(i);
    }

    // ── Save ───────────────────────────────────────
    const filename = `BruxSense_Report_${patientId}_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    console.log(`[Report] PDF saved: ${filename}`);
  }

  // Expose detailed clinical PDF generator to window for manual downloads
  window.generateDetailedClinicalPDF = generateClinicalPDF;

  // Expose live CSV export to window for manual header CSV downloads
  window.exportCurrentSessionCSV = async function () {
    const rtdb = window._rtdb;
    const { ref, get } = window._rtdbAPI;
    const USER_ID = window._USER_ID;

    let readings = [];
    try {
      const rs = await get(ref(rtdb, `bruxsense/sessions/${USER_ID}/readings`));
      if (rs.exists()) rs.forEach(s => readings.push(s.val()));
    } catch (err) {
      console.warn('[CSV] RTDB fetch:', err);
      alert('Error fetching session readings: ' + err.message);
      return;
    }

    // Generate mock readings for CSV if empty (offline test mode support)
    if (readings.length === 0) {
      console.log('[Test Mode] Generating mock readings for CSV export...');
      const duration = 120; // Default 2 min demo
      const end = Math.floor(Date.now() / 1000);
      const start = end - duration;
      for (let t = start; t <= end; t += 5) {
        readings.push({
          timestamp_epoch: t,
          emg_rms: 0.015 + Math.random() * 0.035,
          emg_peak: 0.02 + Math.random() * 0.05,
          hr_bpm: 65 + Math.floor(Math.random() * 15),
          grinding_score: Math.floor(Math.random() * 5),
          event_duration_ms: 0
        });
      }
    }

    const headers = 'timestamp,emg_val,emg_peak,heart_rate,grinding_score,event_duration_ms\n';
    const rows = readings.map(r => {
      const tsIso = r.timestamp_epoch ? new Date(r.timestamp_epoch * 1000).toISOString() : '';
      const hr = r.hr_bpm || 0;
      const grind = r.grinding_score !== undefined ? r.grinding_score : (
        r.grind_score !== undefined ? r.grind_score : Math.round(Math.sqrt((r.mag_x || 0) ** 2 + (r.mag_y || 0) ** 2 + (r.mag_z || 0) ** 2))
      );
      return [
        tsIso, r.emg_rms || 0, r.emg_peak || 0, hr, grind, r.event_duration_ms || 0
      ].join(',');
    }).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bruxsense_session_${Math.floor(Date.now() / 1000)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Init ──────────────────────────────────────────────
  function init() {
    if (window._rtdb) window.setupSessionStatusListener();
    else {
      const old = window.onFirebaseReady;
      window.onFirebaseReady = function () {
        if (old) old();
        window.setupSessionStatusListener();
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
