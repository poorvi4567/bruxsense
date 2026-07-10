// ═══════════════════════════════════════════════════════
// PATIENT LOGIN LOGIC (FIRESTORE & RTDB HANDSHAKE)
// ═══════════════════════════════════════════════════════

(function() {
  window.handlePatientLogin = async function() {
    const usernameInput = document.getElementById('usernameInput');
    const emailInput = document.getElementById('emailInput');
    const loginBtn = document.getElementById('loginBtn');
    const loginOverlay = document.getElementById('loginOverlay');
    
    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    
    if (!username || !email) {
      alert("Please enter both the patient name and email.");
      return;
    }
    
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.5';
    loginBtn.textContent = 'Saving patient...';
    
    try {
      if (!window._fsdb) {
        throw new Error("Firebase is not initialized yet. Please wait a moment.");
      }
      
      const { collection, doc, setDoc, serverTimestamp } = window._fsAPI;
      const fsdb = window._fsdb;
      
      // Generate a Firestore reference with a unique, auto-generated ID
      const userDocRef = doc(collection(fsdb, 'users'));
      const patientId = userDocRef.id;
      
      // 1. Store/Register patient details in Firestore collection "users" matching the schema
      try {
        await setDoc(userDocRef, {
          name: username,
          email: email,
          device_id: "bruxpatch_v1",
          created_at: serverTimestamp(),
          settings: {
            biofeedback_enabled: true,
            detection_threshold_mvc: 0.2,
            notification_enabled: true
          }
        });
        console.log(`[Login] Patient registered in Firestore users collection with ID: ${patientId}`);
      } catch (fsErr) {
        console.warn("[Login] Firestore user registration failed/blocked by security rules:", fsErr.message);
        // Proceed anyway so local dashboard calibration & session monitoring can run
      }
      
      // 2. Write details to Realtime Database so current_session inherits patient context
      if (window.updatePatientInRTDB) {
        await window.updatePatientInRTDB(patientId, username);
        console.log(`[Login] Realtime Database updated with patient ID: ${patientId}`);
      }
      
      // 3. Reset calibration node in RTDB so stale 'complete' status
      //    from a previous session doesn't auto-skip calibration for a new user
      if (window._rtdb && window._USER_ID && window._rtdbAPI) {
        const { ref, set } = window._rtdbAPI;
        await set(ref(window._rtdb, `bruxsense/sessions/${window._USER_ID}/current_session/calibration`), null);
        console.log("[Login] Calibration node reset — wizard will require fresh calibration.");
      }
      
      // Save info locally in session window context
      window._PATIENT_ID = patientId;
      window._PATIENT_USERNAME = username;
      
      // Test mode requires BOTH: username contains "test" AND email is "test@example.com"
      const isTestUser = username.toLowerCase().includes('test') && email.toLowerCase() === 'test@example.com';
      if (isTestUser) {
        window._isSimulatedTestMode = true;
        console.log("[Test Mode] Automatically enabling simulated test mode (name contains 'test' + test email).");
      } else {
        window._isSimulatedTestMode = false;
      }
      
      // Show/hide bypass calibration button based on test mode
      const bypassBtn = document.getElementById('bypassCalibBtn');
      if (bypassBtn) {
        bypassBtn.style.display = isTestUser ? 'block' : 'none';
      }
      
      // 3. Fade out overlay and unlock the calibration screen
      loginOverlay.style.opacity = '0';
      setTimeout(() => {
        loginOverlay.style.display = 'none';
      }, 500);
      
    } catch (err) {
      console.error("[Login] Save failed:", err);
      alert("Error saving patient context: " + err.message);
      loginBtn.disabled = false;
      loginBtn.style.opacity = '1';
      loginBtn.textContent = 'Save & Proceed';
    }
  };

  // Enable the login button only after Firebase has successfully connected
  const oldReady = window.onFirebaseReady;
  window.onFirebaseReady = function() {
    if (oldReady) oldReady();
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.style.opacity = '1';
      loginBtn.textContent = 'Save & Proceed';
    }
  };
})();
