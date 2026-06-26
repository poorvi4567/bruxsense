// ═══════════════════════════════════════════════════════
// SESSION DURATION MANAGER & PDF REPORT GENERATION
// ═══════════════════════════════════════════════════════

(function() {
  let selectedDurationSec = 120; // Default: 2 minutes
  let countdownInterval = null;

  // Preset Selection
  window.selectPreset = function(seconds, element) {
    selectedDurationSec = seconds;
    
    // Update active button state
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    if (element) element.classList.add('active');
    
    // Clear custom fields
    document.getElementById('customMinInput').value = '';
    document.getElementById('customHrInput').value = '';
  };

  // Custom Duration Handler
  window.clearPresets = function() {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    
    const mins = parseFloat(document.getElementById('customMinInput').value) || 0;
    const hrs = parseFloat(document.getElementById('customHrInput').value) || 0;
    selectedDurationSec = (mins * 60) + (hrs * 3600);
  };

  // Start Session
  window.startMonitoringSession = async function() {
    const startBtn = document.getElementById('startSessionBtn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';
    
    if (selectedDurationSec <= 0) {
      alert("Please select a preset or enter a custom session duration.");
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
      
      // Clear previous logs in RTDB for a fresh recording session
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/readings`), null);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/events`), null);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/live_data`), null);
      
      // Clear dashboard UI event list
      const eventLog = document.getElementById('eventLog');
      if (eventLog) {
        eventLog.innerHTML = '<div class="empty-log">No events detected yet...</div>';
      }
      
      // Write metadata
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/session_duration_sec`), selectedDurationSec);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/session_start_epoch`), startEpoch);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/session_end_epoch`), endEpoch);
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'recording');
      
      console.log(`[Session] Started session: duration=${selectedDurationSec}s`);
      
      // Hide duration overlay
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
      console.error("[Session] Start failed:", err);
      alert("Error starting session: " + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'Start Session';
    }
  };

  // Stop Session
  window.stopMonitoringSession = async function() {
    if (!confirm("Are you sure you want to stop the monitoring session early? a report will be generated for the elapsed time.")) {
      return;
    }
    
    try {
      const rtdb = window._rtdb;
      const { ref, set } = window._rtdbAPI;
      const USER_ID = window._USER_ID;
      
      await set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'completed');
      console.log("[Session] Session stopped manually.");
    } catch (err) {
      console.error("[Session] Stop failed:", err);
    }
  };

  // Live Countdown & State Listener
  window.setupSessionStatusListener = function() {
    const rtdb = window._rtdb;
    const { ref, onValue } = window._rtdbAPI;
    const USER_ID = window._USER_ID;
    
    if (!rtdb) return;
    
    const metadataRef = ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata`);
    onValue(metadataRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      
      const status = data.status || 'waiting_duration';
      const startEpoch = data.session_start_epoch || 0;
      const endEpoch = data.session_end_epoch || 0;
      
      // Update session info header element
      const infoEl = document.getElementById('sessionInfo');
      if (infoEl) {
        infoEl.innerHTML = `Patient ID: ${data.patient_id || 'PATIENT_01'}<br>Patient Name: ${data.patient_name || 'Anonymous'}<br>Status: <span style="font-weight:bold; color:var(--accent-emg);">${status.toUpperCase()}</span>`;
      }
      
      if (status === 'recording') {
        // Show timer bar
        const timerBar = document.getElementById('activeTimerBar');
        if (timerBar) timerBar.style.display = 'flex';
        
        // Start live countdown
        startCountdown(startEpoch, endEpoch);
      } else {
        // Hide timer bar
        const timerBar = document.getElementById('activeTimerBar');
        if (timerBar) timerBar.style.display = 'none';
        
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        
        if (status === 'completed') {
          if (!window._reportGenerating) {
            window._reportGenerating = true;
            generateClinicalPDF(data)
              .then(() => {
                window._reportGenerating = false;
                // Transition metadata status back to waiting_duration
                const { set } = window._rtdbAPI;
                set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/metadata/status`), 'waiting_duration');
              })
              .catch(err => {
                console.error("[Report] Generation failed:", err);
                window._reportGenerating = false;
              });
          }
        }
      }
    });
  };

  function startCountdown(startEpoch, endEpoch) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const timerDisplay = document.getElementById('sessionTimerDisplay');
    const timerBar = document.getElementById('activeTimerBar');
    const totalDuration = endEpoch - startEpoch;
    
    function update() {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const timeLeft = endEpoch - nowEpoch;
      
      if (timeLeft <= 0) {
        if (timerDisplay) timerDisplay.textContent = "00:00:00";
        if (timerBar) timerBar.style.setProperty('--timer-width', '0%');
        clearInterval(countdownInterval);
        return;
      }
      
      const hrs = Math.floor(timeLeft / 3600);
      const mins = Math.floor((timeLeft % 3600) / 60);
      const secs = timeLeft % 60;
      
      if (timerDisplay) {
        timerDisplay.textContent = 
          `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      }
      
      const percentage = (timeLeft / totalDuration) * 100;
      if (timerBar) {
        timerBar.style.setProperty('--timer-width', `${percentage}%`);
      }
    }
    
    update();
    countdownInterval = setInterval(update, 1000);
  }

  // jsPDF Clinical Report Generator
  async function generateClinicalPDF(metaData) {
    console.log("[Report] Generating PDF Clinical Report...");
    
    const rtdb = window._rtdb;
    const { ref, get } = window._rtdbAPI;
    const USER_ID = window._USER_ID;
    
    // 1. Fetch readings & events from RTDB
    let readings = [];
    let events = [];
    
    try {
      const readingsSnap = await get(ref(rtdb, `bruxsense/sessions/${USER_ID}/readings`));
      if (readingsSnap.exists()) {
        readingsSnap.forEach(snap => {
          readings.push(snap.val());
        });
      }
      
      const eventsSnap = await get(ref(rtdb, `bruxsense/sessions/${USER_ID}/events`));
      if (eventsSnap.exists()) {
        eventsSnap.forEach(snap => {
          events.push(snap.val());
        });
      }
    } catch (err) {
      console.warn("[Report] Could not fetch RTDB readings/events:", err);
    }
    
    // 2. Compute aggregate metrics
    const patientName = metaData.patient_name || 'Anonymous';
    const patientId = metaData.patient_id || 'PATIENT_01';
    const deviceId = metaData.device_id || 'bruxpatch_v1';
    
    const calib = metaData.calibration || {};
    const emgBaseline = calib.emg_baseline ?? 0;
    const emgPeak = calib.emg_peak ?? 0;
    const emgThreshold = calib.emg_threshold ?? 0;
    const magNoiseFloor = calib.mag_noise_floor ?? 0;
    const magActiveGrind = calib.mag_active_grind ?? 0;
    
    const startEpoch = metaData.session_start_epoch || 0;
    const endEpoch = metaData.session_end_epoch || 0;
    const actualEndEpoch = Math.min(Math.floor(Date.now() / 1000), endEpoch);
    const durationSeconds = actualEndEpoch - startEpoch;
    
    // Format epochs to printable times
    const startStr = startEpoch > 0 ? new Date(startEpoch * 1000).toLocaleString() : 'N/A';
    const endStr = new Date(actualEndEpoch * 1000).toLocaleString();
    
    const durationMin = (durationSeconds / 60).toFixed(1);
    
    let maxEmgRecord = 0;
    let avgHr = 0;
    let hrCount = 0;
    let hrSum = 0;
    
    readings.forEach(r => {
      if (r.emg_peak > maxEmgRecord) maxEmgRecord = r.emg_peak;
      if (r.hr_bpm > 0) {
        hrSum += r.hr_bpm;
        hrCount++;
      }
    });
    
    avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
    
    const totalEvents = events.length;
    let phasicCount = events.filter(e => e.type === 'phasic').length;
    let tonicCount = events.filter(e => e.type === 'tonic').length;
    let grindingEvents = events.filter(e => e.type === 'grinding').length;
    let clenchCount = totalEvents - (phasicCount + tonicCount + grindingEvents);
    if (clenchCount < 0) clenchCount = 0;
    
    // Classify overall session severity
    let severity = "None";
    let severityGrade = 0;
    if (totalEvents > 30) { severity = "Severe"; severityGrade = 3; }
    else if (totalEvents > 15) { severity = "Moderate"; severityGrade = 2; }
    else if (totalEvents > 4) { severity = "Mild"; severityGrade = 1; }
    
    // Save report to Firestore before downloading, to store long term trials
    try {
      const fsdb = window._fsdb;
      const { doc, setDoc, collection, serverTimestamp } = window._fsAPI;
      if (fsdb) {
        const sessionRef = doc(collection(fsdb, 'sessions'));
        await setDoc(sessionRef, {
          userId: USER_ID,
          patient_id: patientId,
          patient_name: patientName,
          device_id: deviceId,
          date: new Date().toLocaleDateString('en-GB'),
          created_at: serverTimestamp(),
          duration_hours: durationSeconds / 3600,
          total_events: totalEvents,
          severity_grade: severityGrade,
          severity_label: severity,
          calibration: {
            emg_baseline: emgBaseline,
            emg_peak: emgPeak,
            emg_threshold: emgThreshold,
            mag_noise_floor: magNoiseFloor,
            mag_active_grind: magActiveGrind
          },
          statistics: {
            max_emg_v: maxEmgRecord,
            avg_hr_bpm: avgHr,
            phasic_events: phasicCount,
            tonic_events: tonicCount,
            grinding_episodes: grindingEvents
          }
        });
        
        // Pushing individual readings to readings subcollection in Firestore
        for (const r of readings) {
          const readingDocRef = doc(collection(fsdb, 'sessions', sessionRef.id, 'readings'));
          const rDate = r.timestamp_epoch ? new Date(r.timestamp_epoch * 1000) : new Date();
          await setDoc(readingDocRef, {
            timestamp: rDate,
            timestamp_epoch: r.timestamp_epoch || 0,
            emg_val: r.emg_rms || 0,
            emg_peak: r.emg_peak || 0,
            hr_bpm: r.hr_bpm || 0,
            mag_x: r.mag_x || 0,
            mag_y: r.mag_y || 0,
            mag_z: r.mag_z || 0,
            event_duration_ms: r.event_duration_ms || 0
          });
        }

        // Pushing individual events to events subcollection in Firestore
        for (const e of events) {
          const eventDocRef = doc(collection(fsdb, 'sessions', sessionRef.id, 'events'));
          const eDate = e.timestamp_epoch ? new Date(e.timestamp_epoch * 1000) : new Date();
          const duration = e.duration_ms || 0;
          const eEndDate = new Date(eDate.getTime() + duration);
          await setDoc(eventDocRef, {
            start_time: eDate,
            end_time: eEndDate,
            timestamp_epoch: e.timestamp_epoch || 0,
            duration_ms: duration,
            peak_rms: e.peak_rms || 0,
            hr_at_event: e.hr_at_event || 0,
            type: e.type || 'clench'
          });
        }
        
        console.log("[Report] Session report and subcollections written to Firestore collection 'sessions'");
      }
    } catch (fsErr) {
      console.warn("[Report] Could not write report to Firestore:", fsErr);
    }
    
    // 3. Construct jsPDF instance
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });
    
    let yPos = 0;
    
    // Draw Header Banner
    doc.setFillColor(18, 21, 28); // Slate black
    doc.rect(0, 0, 210, 36, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('BruxSense™ Clinical Report', 15, 17);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(154, 160, 178);
    doc.text('AUTOMATED DIAGNOSTICS & BIOFEEDBACK ANALYSIS', 15, 24);
    
    doc.setTextColor(0, 212, 170); // Accent EMG Teal
    doc.setFont('Helvetica', 'bold');
    doc.text(`DEVICE STATUS: COMPLETED`, 15, 30);
    
    // Date & Time right aligned
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    const datePrinted = new Date().toLocaleString();
    doc.text(`Generated: ${datePrinted}`, 145, 16);
    doc.text(`Hardware Ref: ${deviceId}`, 145, 22);
    
    yPos = 48;
    
    // PATIENT INFORMATION CARD (Left Column)
    doc.setFillColor(26, 30, 40); // Dark box surface
    doc.rect(15, yPos, 88, 38, 'F');
    doc.setStrokeColor(42, 48, 64);
    doc.rect(15, yPos, 88, 38, 'S');
    
    doc.setTextColor(0, 212, 170);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('PATIENT DEMOGRAPHICS', 20, yPos + 6);
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Patient ID:    ${patientId}`, 20, yPos + 14);
    doc.text(`Patient Name:  ${patientName}`, 20, yPos + 20);
    doc.text(`Session Start: ${startStr.split(',')[0]}`, 20, yPos + 26);
    doc.text(`Session End:   ${endStr.split(',')[0]}`, 20, yPos + 32);
    
    // CALIBRATION METRICS CARD (Right Column)
    doc.setFillColor(26, 30, 40);
    doc.rect(107, yPos, 88, 38, 'F');
    doc.rect(107, yPos, 88, 38, 'S');
    
    doc.setTextColor(0, 212, 170);
    doc.setFont('Helvetica', 'bold');
    doc.text('CALIBRATION PARAMETERS', 112, yPos + 6);
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'normal');
    doc.text(`EMG Baseline:    ${emgBaseline.toFixed(3)} V`, 112, yPos + 14);
    doc.text(`EMG Peak (MVC):  ${emgPeak.toFixed(3)} V`, 112, yPos + 20);
    doc.text(`EMG Threshold:   ${emgThreshold.toFixed(3)} V`, 112, yPos + 26);
    doc.text(`Grind Threshold: ${magActiveGrind.toFixed(2)} mG`, 112, yPos + 32);
    
    yPos += 48;
    
    // DIAGNOSTIC SUMMARY (Highlight Numbers)
    doc.setTextColor(30, 41, 59); // Dark blue gray for text
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('SESSION DIAGNOSTIC SUMMARY', 15, yPos);
    
    yPos += 4;
    
    // Highlight boxes (Total Events, Severity, Avg HR, Max EMG)
    const cardW = 42;
    const cardH = 22;
    const cardGap = 4;
    
    const summaries = [
      { label: "TOTAL EVENTS", val: totalEvents, color: [255, 170, 0] }, // Warn orange
      { label: "SEVERITY", val: severity.toUpperCase(), color: severity === 'Severe' ? [255, 51, 51] : [0, 212, 170] },
      { label: "AVG HEART RATE", val: `${avgHr} BPM`, color: [255, 107, 107] },
      { label: "MAX EMG RMS", val: `${maxEmgRecord.toFixed(3)} V`, color: [124, 107, 255] }
    ];
    
    summaries.forEach((card, idx) => {
      const cX = 15 + idx * (cardW + cardGap);
      doc.setFillColor(248, 250, 252); // Off white
      doc.rect(cX, yPos, cardW, cardH, 'F');
      doc.setStrokeColor(226, 232, 240);
      doc.rect(cX, yPos, cardW, cardH, 'S');
      
      // Top accent bar
      doc.setFillColor(card.color[0], card.color[1], card.color[2]);
      doc.rect(cX, yPos, cardW, 2, 'F');
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(card.label, cX + 4, yPos + 7);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text(String(card.val), cX + 4, yPos + 15);
    });
    
    yPos += 32;
    
    // BREAKDOWN METRICS Table style
    doc.setTextColor(30, 41, 59);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('EVENT CLASSIFICATION BREAKDOWN', 15, yPos);
    
    yPos += 4;
    
    // Table content
    const stats = [
      { name: "Phasic Bruxism Episodes (Short clenches, 0.25s - 2s)", count: phasicCount },
      { name: "Tonic Bruxism Episodes (Sustained clenches, > 2s)", count: tonicCount },
      { name: "Grinding Episodes (Side-to-side friction activity)", count: grindingEvents },
      { name: "General Jaw Clenching Incidents", count: clenchCount },
      { name: "Total Recorded Bruxism Activity Events", count: totalEvents }
    ];
    
    doc.setStrokeColor(226, 232, 240);
    doc.setFillColor(15, 23, 42); // slate header
    doc.rect(15, yPos, 180, 7, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Classification / Event Category', 18, yPos + 5);
    doc.text('Detected Incidents', 160, yPos + 5);
    
    yPos += 7;
    
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    
    stats.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos, 180, 7, 'F');
      }
      doc.line(15, yPos + 7, 195, yPos + 7);
      
      if (i === 4) doc.setFont('Helvetica', 'bold'); // Total bold
      doc.text(row.name, 18, yPos + 5);
      doc.text(String(row.count), 160, yPos + 5);
      yPos += 7;
    });
    
    yPos += 12;
    
    // DETAILED EVENT CHRONOLOGY LOG
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text('DETAILED EVENT CHRONOLOGY', 15, yPos);
    
    yPos += 4;
    
    // Event Log table headers
    doc.setFillColor(15, 23, 42);
    doc.rect(15, yPos, 180, 7, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Time', 18, yPos + 5);
    doc.text('Type', 55, yPos + 5);
    doc.text('Duration (ms)', 85, yPos + 5);
    doc.text('Peak RMS (V)', 120, yPos + 5);
    doc.text('Heart Rate', 155, yPos + 5);
    
    yPos += 7;
    
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    
    if (events.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(15, yPos, 180, 10, 'F');
      doc.text('No active bruxism events logged during this session.', 20, yPos + 6);
      yPos += 10;
    } else {
      events.forEach((evt, idx) => {
        // Handle pagination if table spans beyond the page height
        if (yPos > 265) {
          doc.addPage();
          
          // Header bar again on new page
          doc.setFillColor(18, 21, 28);
          doc.rect(0, 0, 210, 20, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(12);
          doc.text('BruxSense™ Detailed Event Log (Contd.)', 15, 13);
          
          yPos = 30;
          
          doc.setFillColor(15, 23, 42);
          doc.rect(15, yPos, 180, 7, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.text('Time', 18, yPos + 5);
          doc.text('Type', 55, yPos + 5);
          doc.text('Duration (ms)', 85, yPos + 5);
          doc.text('Peak RMS (V)', 120, yPos + 5);
          doc.text('Heart Rate', 155, yPos + 5);
          yPos += 7;
        }
        
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(15, yPos, 180, 7, 'F');
        }
        doc.line(15, yPos + 7, 195, yPos + 7);
        
        // Print columns
        const timeStr = evt.timestamp_iso ? evt.timestamp_iso.split('T')[1].split('+')[0] : 'N/A';
        doc.text(timeStr, 18, yPos + 5);
        doc.text(String(evt.type).toUpperCase(), 55, yPos + 5);
        doc.text(String(evt.duration_ms ?? 0), 85, yPos + 5);
        doc.text(evt.peak_rms ? evt.peak_rms.toFixed(3) : '--', 120, yPos + 5);
        
        const hrVal = evt.hr_at_event ?? 0;
        doc.text(hrVal > 0 ? `${hrVal} BPM` : '--', 155, yPos + 5);
        
        yPos += 7;
      });
    }
    
    // Add page footer with verification note
    if (yPos > 240) {
      doc.addPage();
      yPos = 30;
    } else {
      yPos = 250;
    }
    
    // Verification lines & clinician signature block
    doc.line(15, yPos, 195, yPos);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('CLINICAL STUDY NOTES & DISCLAIMERS:', 15, yPos + 5);
    doc.text('This data is generated by the BruxSense wearables diagnostic device for research and trial monitoring only.', 15, yPos + 9);
    doc.text('Assessments should be correlated with clinical polysomnography examinations for official diagnostics.', 15, yPos + 13);
    
    // Signature lines
    doc.setFont('Helvetica', 'bold');
    doc.text('Clinician Signature:', 125, yPos + 22);
    doc.line(125, yPos + 30, 185, yPos + 30);
    
    doc.text('Trial Investigator:', 15, yPos + 22);
    doc.line(15, yPos + 30, 75, yPos + 30);
    
    // Save/Download PDF
    const filename = `BruxSense_Report_${patientId}_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);
    console.log(`[Report] PDF successfully generated and saved: ${filename}`);
  }

  // Self initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window._rtdb) window.setupSessionStatusListener();
      else {
        // Fallback waiting for Firebase setup hook
        const oldOnFirebaseReady = window.onFirebaseReady;
        window.onFirebaseReady = function() {
          if (oldOnFirebaseReady) oldOnFirebaseReady();
          window.setupSessionStatusListener();
        };
      }
    });
  } else {
    if (window._rtdb) window.setupSessionStatusListener();
    else {
      const oldOnFirebaseReady = window.onFirebaseReady;
      window.onFirebaseReady = function() {
        if (oldOnFirebaseReady) oldOnFirebaseReady();
        window.setupSessionStatusListener();
      };
    }
  }
})();
