// ═══════════════════════════════════════════════════════
// SESSION HISTORY LOGIC (FIRESTORE)
// ═══════════════════════════════════════════════════════

(function() {
  const GRADE_LABELS = ['None', 'Mild', 'Moderate', 'Severe'];
  const gridColor = 'rgba(255,255,255,0.05)';
  
  let detailEmgChart  = null;
  let detailHrChart   = null;

  function parseDateStr(str) {
    if (!str) return 0;
    const parts = str.split('/');
    if (parts.length !== 3) return 0;
    return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
  }

  function getSessionTimestamp(s) {
    if (s.created_at) {
      if (typeof s.created_at.toDate === 'function') {
        return s.created_at.toDate().getTime();
      }
      if (s.created_at.seconds) {
        return s.created_at.seconds * 1000;
      }
    }
    return parseDateStr(s.date);
  }

  function formatSessionStart(s, sessionId) {
    let dateStr = s.date || sessionId;
    let timeObj = null;
    if (s.created_at) {
      if (typeof s.created_at.toDate === 'function') {
        timeObj = s.created_at.toDate();
      } else if (s.created_at.seconds) {
        timeObj = new Date(s.created_at.seconds * 1000);
      }
    }

    if (timeObj) {
      const durationMs = (s.duration_hours || 0) * 3600 * 1000;
      const startTime = new Date(timeObj.getTime() - durationMs);
      
      const day = String(startTime.getDate()).padStart(2, '0');
      const month = String(startTime.getMonth() + 1).padStart(2, '0');
      const year = startTime.getFullYear();
      const hours = String(startTime.getHours()).padStart(2, '0');
      const minutes = String(startTime.getMinutes()).padStart(2, '0');
      dateStr = `${day}/${month}/${year} · ${hours}:${minutes}`;
    }
    return dateStr;
  }

  // Expose to global scope for nav callbacks
  window.loadSessionList = async function() {
    const listEl = document.getElementById('sessionList');
    listEl.innerHTML = '<div class="loading-sessions">Loading sessions...</div>';

    if (!window._fsdb) {
      listEl.innerHTML = '<div class="no-sessions">Firebase not ready yet. Try again.</div>';
      return;
    }

    const { collection, query, where, orderBy, getDocs, limit } = window._fsAPI;
    const fsdb = window._fsdb;

    let snap = null;
    try {
      // Primary query: sessions by userId ordered by created_at desc
      const q = query(
        collection(fsdb, 'sessions'),
        where('userId', '==', window._USER_ID),
        orderBy('created_at', 'desc'),
        limit(30)
      );
      snap = await getDocs(q);
    } catch (err) {
      console.warn('Primary Firestore query failed (index might be missing), falling back to client-side sort:', err);
      // Fallback: try without orderBy (index may not exist yet)
      try {
        const q2 = query(
          collection(fsdb, 'sessions'),
          where('userId', '==', window._USER_ID)
        );
        snap = await getDocs(q2);
      } catch (err2) {
        listEl.innerHTML = `<div class="no-sessions">Error loading sessions.<br>
          <small style="color:var(--text-muted)">${err2.message}</small></div>`;
        return;
      }
    }

    if (!snap || snap.empty) {
      listEl.innerHTML = '<div class="no-sessions">No past sessions found.<br><br>'
        + 'Sessions are saved automatically after each monitoring session '
        + 'via the Cloud Function.</div>';
      return;
    }

    const docs = [];
    snap.forEach(docSnap => {
      docs.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Client-side sort guarantees perfect chronological descending order
    docs.sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a));

    listEl.innerHTML = '';
    docs.forEach(s => {
      renderSessionItem(listEl, s.id, s);
    });
  };

  function renderSessionItem(container, sessionId, s) {
    const displayDate = formatSessionStart(s, sessionId);
    const grade  = s.severity_grade ?? 0;
    const label  = s.severity_label || GRADE_LABELS[grade] || 'None';
    const events = s.total_events   ?? '—';
    const dur    = s.duration_hours ? s.duration_hours.toFixed(1) + 'h' : '—';
    const item   = document.createElement('div');
    item.className = 'session-item';
    item.dataset.sessionId = sessionId;
    item.innerHTML =
      `<div class="session-date">${displayDate}</div>
       <div class="session-meta">${events} events · ${dur}</div>
       <span class="session-grade grade-${grade}">${label}</span>`;
    item.addEventListener('click', () => {
      document.querySelectorAll('.session-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      loadSessionDetail(sessionId, s);
    });
    container.appendChild(item);
  }

  async function loadSessionDetail(sessionId, summary) {
    const placeholder = document.getElementById('detailPlaceholder');
    const content     = document.getElementById('detailContent');
    placeholder.style.display = 'none';
    content.classList.remove('visible');
    content.innerHTML = '<div style="padding:40px;color:var(--text-muted);text-align:center">Loading session data...</div>';
    content.classList.add('visible');

    const { collection, query, orderBy, getDocs, limit } = window._fsAPI;
    const fsdb = window._fsdb;

    // Load up to 200 readings for charts
    let readings = [];
    try {
      const rq = query(
        collection(fsdb, 'sessions', sessionId, 'readings'),
        orderBy('timestamp_epoch', 'asc'),
        limit(200)
      );
      const rsnap = await getDocs(rq);
      rsnap.forEach(d => readings.push(d.data()));
    } catch (e) {
      // Fallback without orderBy
      try {
        const rq2 = query(
          collection(fsdb, 'sessions', sessionId, 'readings'),
          limit(200)
        );
        const rsnap2 = await getDocs(rq2);
        rsnap2.forEach(d => readings.push(d.data()));
        readings.sort((a, b) => (a.timestamp_epoch || 0) - (b.timestamp_epoch || 0));
      } catch (e2) { console.warn('Could not load readings:', e2.message); }
    }

    // Load events
    let events = [];
    try {
      const eq = query(
        collection(fsdb, 'sessions', sessionId, 'events'),
        orderBy('timestamp_epoch', 'asc'),
        limit(100)
      );
      const esnap = await getDocs(eq);
      esnap.forEach(d => events.push(d.data()));
    } catch (e) {
      try {
        const eq2 = query(
          collection(fsdb, 'sessions', sessionId, 'events'),
          limit(100)
        );
        const esnap2 = await getDocs(eq2);
        esnap2.forEach(d => events.push(d.data()));
        events.sort((a, b) => (a.timestamp_epoch || 0) - (b.timestamp_epoch || 0));
      } catch (e2) { console.warn('Could not load events:', e2.message); }
    }

    renderSessionDetail(sessionId, summary, readings, events);
  }

  function renderSessionDetail(sessionId, s, readings, events) {
    const displayDate = formatSessionStart(s, sessionId);
    const content   = document.getElementById('detailContent');
    const grade     = s.severity_grade ?? 0;
    const gradeLabel= s.severity_label || GRADE_LABELS[grade] || 'None';
    const gradeColor= ['var(--accent-emg)','var(--accent-mild)',
                       'var(--accent-mod)','var(--accent-sev)'][grade] || 'var(--accent-emg)';

    // Build chart data from readings
    const chartLabels = readings.map(r => {
      if (r.timestamp && typeof r.timestamp.toDate === 'function') {
        const d = r.timestamp.toDate();
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      }
      return '';
    });
    const emgVals  = readings.map(r => parseFloat(r.emg_val)  || 0);
    const hrVals   = readings.map(r => parseFloat(r.hr_bpm || r.heart_rate) || null);
    const emgColors = readings.map(r =>
      parseInt(r.event_duration_ms) > 0 ? 'rgba(255,51,51,0.85)' : 'rgba(0,212,170,0.5)');

    // Events table rows
    const evRows = events.length === 0
      ? `<tr><td colspan="5" class="no-events-msg">No events logged for this session.</td></tr>`
      : events.map(ev => {
          const typeClass = ev.type === 'phasic' ? 'type-phasic'
                          : ev.type === 'tonic'  ? 'type-tonic' : 'type-clench';
          let ts = '—';
          if (ev.start_time && typeof ev.start_time.toDate === 'function') {
            const d = ev.start_time.toDate();
            ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
          }
          const dur  = ev.duration_ms   ? (ev.duration_ms / 1000).toFixed(1) + 's' : '—';
          const rms  = ev.peak_rms      ? parseFloat(ev.peak_rms).toFixed(3) + 'V' : '—';
          const hr   = ev.hr_at_event   ? Math.round(ev.hr_at_event) + ' BPM' : '—';
          return `<tr>
            <td>${ts}</td>
            <td><span class="type-badge ${typeClass}">${ev.type || 'clench'}</span></td>
            <td>${dur}</td><td>${rms}</td><td>${hr}</td>
          </tr>`;
        }).join('');

    content.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-title">${displayDate}</div>
          <div class="detail-subtitle">${s.patient_id || 'patient_01'} &nbsp;·&nbsp;
            ${s.device_id || 'bruxpatch_v1'} &nbsp;·&nbsp;
            <span style="color:${gradeColor};font-weight:600">${gradeLabel}</span>
          </div>
        </div>
      </div>

      <div class="detail-kpi-row">
        <div class="detail-kpi">
          <div class="detail-kpi-label">Total Events</div>
          <div class="detail-kpi-value" style="color:var(--accent-warn)">${s.total_events ?? readings.filter(r=>r.event_duration_ms > 0).length}</div>
          <div class="detail-kpi-unit">detections</div>
        </div>
        <div class="detail-kpi">
          <div class="detail-kpi-label">Severity</div>
          <div class="detail-kpi-value" style="color:${gradeColor}">${gradeLabel}</div>
          <div class="detail-kpi-unit">Level</div>
        </div>
      </div>

      <div class="detail-chart-row">
        <div class="detail-chart-box">
          <div class="detail-chart-label">EMG RMS — Full Session</div>
          <div class="detail-chart-wrap"><canvas id="detailEmgCanvas"></canvas></div>
        </div>
        <div class="detail-chart-box">
          <div class="detail-chart-label">Heart Rate — Full Session</div>
          <div class="detail-chart-wrap"><canvas id="detailHrCanvas"></canvas></div>
        </div>
      </div>

      <div class="events-table-wrap">
        <div class="events-table-title">Detected Events (${events.length})</div>
        <table>
          <thead><tr>
            <th>Time</th><th>Type</th><th>Duration</th>
            <th>Peak RMS</th><th>HR</th>
          </tr></thead>
          <tbody>${evRows}</tbody>
        </table>
      </div>`;

    // Destroy previous charts
    if (detailEmgChart)  { detailEmgChart.destroy();  detailEmgChart  = null; }
    if (detailHrChart)   { detailHrChart.destroy();   detailHrChart   = null; }

    // EMG detail chart
    if (chartLabels.length > 0) {
      detailEmgChart = new Chart(
        document.getElementById('detailEmgCanvas').getContext('2d'), {
          type: 'bar',
          data: {
            labels: chartLabels,
            datasets: [{ data: emgVals, backgroundColor: emgColors, borderWidth: 0 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
              y: { grid: { color: gridColor }, min: 0, position: 'right',
                   title: { display: true, text: 'RMS (V)', color: '#9aa0b2' } }
            }
          }
        });

      detailHrChart = new Chart(
        document.getElementById('detailHrCanvas').getContext('2d'), {
          type: 'line',
          data: {
            labels: chartLabels,
            datasets: [{
              data: hrVals, borderColor: '#ff6b6b',
              backgroundColor: 'rgba(255,107,107,0.1)',
              borderWidth: 1.5, fill: true, tension: 0.4,
              pointRadius: 3, pointHitRadius: 10, spanGaps: true
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
              y: { grid: { color: gridColor }, min: 40, position: 'right',
                   title: { display: true, text: 'BPM', color: '#9aa0b2' } }
            }
          }
        });
    }

    // Store readings for CSV export
    window._currentReadings = readings;
    window._currentEvents   = events;
    window._currentSummary  = s;
    window._currentSessionId = sessionId;

    // Show header action buttons and wire to this selected past session
    const btnPdf = document.getElementById('downloadReportBtn');
    if (btnPdf) {
      btnPdf.style.display = 'inline-flex';
      btnPdf.onclick = () => {
        if (window.generateDetailedClinicalPDF) {
          window.generateDetailedClinicalPDF(s, readings, events);
        }
      };
    }

    const btnCsv = document.getElementById('exportCSVBtn');
    if (btnCsv) {
      btnCsv.style.display = 'inline-flex';
      btnCsv.onclick = () => {
        window.exportCSV(sessionId);
      };
    }
  }

  // Expose CSV export to global scope
  window.exportCSV = function(sessionId) {
    const readings = window._currentReadings || [];
    if (readings.length === 0) { alert('No readings data to export.'); return; }

    const headers = 'timestamp,emg_val,emg_peak,heart_rate,grinding_score,event_duration_ms\n';
    const rows = readings.map(r => {
      const tsIso = (r.timestamp && typeof r.timestamp.toDate === 'function')
        ? r.timestamp.toDate().toISOString()
        : (r.timestamp_epoch ? new Date(r.timestamp_epoch * 1000).toISOString() : '');
      const hr = r.hr_bpm || r.heart_rate || 0;
      const grind = r.grinding_score !== undefined ? r.grinding_score : (
        r.grind_score !== undefined ? r.grind_score : Math.round(Math.sqrt((r.mag_x||0)**2 + (r.mag_y||0)**2 + (r.mag_z||0)**2))
      );
      const emgVal = r.emg_val !== undefined ? r.emg_val : (r.emg_rms || 0);

      return [
        tsIso, emgVal, r.emg_peak || 0, hr, grind, r.event_duration_ms || 0
      ].join(',');
    }).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bruxsense_${sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Expose PDF export to global scope
  window.exportPDF = function() {
    const s = window._currentSummary;
    const readings = window._currentReadings || [];
    const events = window._currentEvents || [];

    if (!s) { alert('No session summary data to export.'); return; }

    // Route to premium detailed PDF report generator if loaded
    if (window.generateDetailedClinicalPDF) {
      window.generateDetailedClinicalPDF(s, readings, events);
      return;
    }

    console.warn("[Report] Detailed clinical report generator not loaded. Falling back to basic layout.");

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
    doc.text(`SESSION STATUS: COMPLETED`, 15, 30);
    
    // Date & Time right aligned
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    const datePrinted = new Date().toLocaleString();
    doc.text(`Generated: ${datePrinted}`, 145, 16);
    doc.text(`Hardware Ref: ${s.device_id || 'bruxpatch_v1'}`, 145, 22);
    
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
    doc.text(`Patient ID:    ${s.patient_id || 'N/A'}`, 20, yPos + 14);
    doc.text(`Patient Name:  ${s.patient_name || 'N/A'}`, 20, yPos + 20);
    doc.text(`Session Date:  ${s.date || 'N/A'}`, 20, yPos + 26);
    doc.text(`Duration:      ${s.duration_hours ? s.duration_hours.toFixed(2) + ' hours' : 'N/A'}`, 20, yPos + 32);
    
    // CALIBRATION METRICS CARD (Right Column)
    const cal = s.calibration || {};
    doc.setFillColor(26, 30, 40);
    doc.rect(107, yPos, 88, 38, 'F');
    doc.rect(107, yPos, 88, 38, 'S');
    
    doc.setTextColor(0, 212, 170);
    doc.setFont('Helvetica', 'bold');
    doc.text('CALIBRATION PARAMETERS', 112, yPos + 6);
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('Helvetica', 'normal');
    doc.text(`EMG Baseline:    ${cal.emg_baseline ? cal.emg_baseline.toFixed(3) + ' V' : '—'}`, 112, yPos + 14);
    doc.text(`EMG Peak (MVC):  ${cal.emg_peak ? cal.emg_peak.toFixed(3) + ' V' : '—'}`, 112, yPos + 20);
    doc.text(`EMG Threshold:   ${cal.emg_threshold ? cal.emg_threshold.toFixed(3) + ' V' : '—'}`, 112, yPos + 26);
    doc.text(`Grind Threshold: ${cal.mag_active_grind ? cal.mag_active_grind.toFixed(2) + ' mG' : '—'}`, 112, yPos + 32);
    
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
    
    const totalEvents = s.total_events ?? readings.filter(r=>r.event_duration_ms > 0).length;
    const grade = s.severity_grade ?? 0;
    const severity = s.severity_label || GRADE_LABELS[grade] || 'None';
    const statsObj = s.statistics || {};
    const avgHr = statsObj.avg_hr_bpm || 0;
    const maxEmgRecord = statsObj.max_emg_v || 0;
    
    const summaries = [
      { label: "TOTAL EVENTS", val: totalEvents, color: [255, 170, 0] }, // Warn orange
      { label: "SEVERITY", val: severity.toUpperCase(), color: severity === 'Severe' ? [255, 51, 51] : [0, 212, 170] },
      { label: "AVG HEART RATE", val: avgHr > 0 ? `${avgHr} BPM` : '--', color: [255, 107, 107] },
      { label: "MAX EMG RMS", val: maxEmgRecord > 0 ? `${maxEmgRecord.toFixed(3)} V` : '--', color: [124, 107, 255] }
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
    const statsList = [
      { name: "Phasic Bruxism Episodes (Short clenches, 0.25s - 2s)", count: statsObj.phasic_events ?? events.filter(e => e.type === 'phasic').length },
      { name: "Tonic Bruxism Episodes (Sustained clenches, > 2s)", count: statsObj.tonic_events ?? events.filter(e => e.type === 'tonic').length },
      { name: "Grinding Episodes (Side-to-side friction activity)", count: statsObj.grinding_episodes ?? events.filter(e => e.type === 'grinding').length },
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
    
    statsList.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos, 180, 7, 'F');
      }
      doc.line(15, yPos + 7, 195, yPos + 7);
      
      if (i === 3) doc.setFont('Helvetica', 'bold'); // Total bold
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
        let timeStr = 'N/A';
        if (evt.start_time) {
          if (typeof evt.start_time.toDate === 'function') {
            const d = evt.start_time.toDate();
            timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
          } else if (evt.timestamp_iso) {
            timeStr = evt.timestamp_iso.split('T')[1].split('+')[0];
          }
        } else if (evt.timestamp && typeof evt.timestamp.toDate === 'function') {
          const d = evt.timestamp.toDate();
          timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        }
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
    const filename = `BruxSense_History_Report_${s.patient_id || 'patient'}_${s.date ? s.date.replace(/\//g, '-') : 'session'}.pdf`;
    doc.save(filename);
  };
})();
