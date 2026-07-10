// ═══════════════════════════════════════════════════════
// CALIBRATION WIZARD LOGIC
// ═══════════════════════════════════════════════════════

(function() {
  const overlay = document.getElementById('calibrationOverlay');
  const startBtn = document.getElementById('startCalibBtn');
  const timerVal = document.getElementById('timerVal');
  const progressPath = document.getElementById('timerProgress');
  const instructionBox = document.getElementById('instructionBox');
  
  const stepItems = [
    document.getElementById('stepRelax'),
    document.getElementById('stepClench'),
    document.getElementById('stepGrind')
  ];

  const INSTRUCTIONS = {
    waiting: "Welcome to BruxSense calibration. Press start and prepare to follow the instructions.",
    midpoint: "Determining hardware signal midpoint... Please remain quiet and relaxed.",
    relax: "Phase 1: STAY RELAXED. Do not chew, swallow, or speak.",
    clench: "Phase 2: CLENCH YOUR JAW! Bite down firmly and hold.",
    grind: "Phase 3: GRIND YOUR TEETH! Move your jaw side-to-side continuously."
  };

  // Triggered when user clicks "Start"
  window.startCalibration = function() {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.5';
    startBtn.textContent = 'Initializing...';
    
    if (window.startCalibrationInFirebase) {
      window.startCalibrationInFirebase();
    } else {
      console.error("Firebase calibration hook not available.");
      alert("Database offline or connecting... please try again in a moment.");
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
      startBtn.textContent = 'Start Calibration';
    }
  };

  // Called reactively by Firebase listener
  window.updateCalibrationFromFirebase = function(data) {
    if (!data) return;
    const status = data.status || 'waiting';
    const timer = data.timer ?? 0;
    const progress = data.progress ?? 0;

    console.log(`[Calibration] Status: ${status}, Timer: ${timer}, Progress: ${progress}%`);

    // 1. Text Instruction
    instructionBox.textContent = INSTRUCTIONS[status] || "Calibrating...";

    // 2. Timer Circle update (Perimeter is 377)
    timerVal.textContent = timer > 0 ? timer : '—';
    const offset = 377 - (progress / 100) * 377;
    progressPath.style.strokeDashoffset = offset;

    // 3. Stepper steps update
    if (status === 'relax') {
      setActiveStep(0);
      progressPath.style.stroke = 'var(--accent-emg)';
    } else if (status === 'clench') {
      setActiveStep(1);
      progressPath.style.stroke = 'var(--accent-warn)';
    } else if (status === 'grind') {
      setActiveStep(2);
      progressPath.style.stroke = 'var(--accent-motion)';
    } else if (status === 'waiting') {
      startBtn.style.display = 'block';
      setActiveStep(-1);
    } else if (status === 'midpoint') {
      startBtn.style.display = 'none';
      setActiveStep(-1);
    } else if (status === 'complete') {
      setActiveStep(3); // Mark all completed
      timerVal.textContent = '✓';
      instructionBox.textContent = "Calibration Successful! Opening Session Config...";
      progressPath.style.stroke = 'var(--accent-emg)';
      progressPath.style.strokeDashoffset = 0;
      
      // Unlock Session Duration Setup
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.style.display = 'none';
          
          const durationOverlay = document.getElementById('durationOverlay');
          if (durationOverlay) {
            durationOverlay.style.display = 'flex';
            setTimeout(() => {
              durationOverlay.style.opacity = '1';
            }, 50);
          }
        }, 500);
      }, 1500);
    }
  };

  function setActiveStep(activeIndex) {
    stepItems.forEach((item, idx) => {
      if (!item) return;
      item.classList.remove('active', 'completed');
      if (idx === activeIndex) {
        item.classList.add('active');
      } else if (idx < activeIndex) {
        item.classList.add('completed');
      }
    });
  }

  window.bypassCalibration = function() {
    // Safety: refuse bypass unless login confirmed test mode
    if (!window._isSimulatedTestMode) {
      console.warn("[Calibration] Bypass denied — not in test mode.");
      alert("Calibration bypass is only available in Test Mode.\nUse a patient name containing 'test' and email 'test@example.com'.");
      return;
    }
    console.log("[Test Mode] Bypassing calibration wizard...");
    
    // Write baseline calibration to RTDB so metadata is present
    if (window._rtdb && window._USER_ID) {
      const rtdb = window._rtdb;
      const { ref, set } = window._rtdbAPI;
      const USER_ID = window._USER_ID;
      
      set(ref(rtdb, `bruxsense/sessions/${USER_ID}/current_session/calibration`), {
        status: "complete",
        emg_baseline: 0.05,
        emg_peak: 0.80,
        emg_threshold: 0.25,
        mag_noise_floor: 1.0,
        mag_active_grind: 10.0,
        progress: 100,
        timer: 0
      }).catch(err => console.warn("[Test Mode] Bypassing calibration failed to write to RTDB:", err));
    }
    
    // Hide calibration overlay and trigger duration setup overlay transition
    const calibrationOverlay = document.getElementById('calibrationOverlay');
    if (calibrationOverlay) {
      calibrationOverlay.style.opacity = '0';
      setTimeout(() => {
        calibrationOverlay.style.display = 'none';
        
        const durationOverlay = document.getElementById('durationOverlay');
        if (durationOverlay) {
          durationOverlay.style.display = 'flex';
          setTimeout(() => {
            durationOverlay.style.opacity = '1';
          }, 50);
        }
      }, 500);
    }
  };
})();

