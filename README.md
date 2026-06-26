# BruxSense — Clinical Sleep Monitoring Web Portal

BruxSense is an integrated sleep monitoring and biofeedback system designed to detect, log, and analyze nocturnal bruxism (teeth grinding and jaw clenching). This repository contains the client-side clinical trial web portal, which visualizes live and historical patient telemetry retrieved from Firebase.

---

## 📂 Codebase Structure

The version-controlled files in this repository focus entirely on the frontend clinical web app:

*   **`bruxism_dashboard_final.html`**: The main entry point for the portal. It coordinates the user interface, routing, and links all sub-modules.
*   **`style.css`**: The core styling system, providing a clean dark theme, layouts, glassmorphism UI components, and animations.
*   **`login.js`**: Patient login portal logic. Captures patient details (Name, Email), auto-generates a unique patient document ID using Firestore, and synchronizes the session context across Firestore and the Realtime Database.
*   **`calibration.js`**: Calibration Wizard. Runs the step-by-step relaxed baseline and Maximum Voluntary Contraction (MVC) routines to calibrate thresholds for the patient.
*   **`dashboard.js`**: Real-time sleep monitor. Visualizes live telemetry (EMG RMS, Heart Rate, Spo2, Jaw Motion vectors) and clinical severity.
*   **`history.js`**: Historical session browser. Allows clinical trial administrators to browse past recorded nights, overlay metrics, and inspect trends.
*   **`report.js`**: Report generation panel. Exposes options to export clinical reports as PDFs using `jsPDF`.
*   **`setup_env.py`**: A local Python pre-build script that reads a private `.env` file and outputs the necessary configuration scripts.

## 🔍 Web Portal Features & Architecture (`bruxism_dashboard_final.html`)

The clinical trial portal operates as a single-page application (SPA) structured around a high-performance modular Javascript architecture:

1.  **Firebase Integration & Security (`env.js`):**
    *   Securely connects to Firebase Authentication, Firestore Database, and Realtime Database using keys generated dynamically by `setup_env.py`.
    *   Authenticates clinical trial credentials on-load to authorize access to database listeners.
2.  **Interactive Modules:**
    *   **Patient Access System (`login.js`):** Registers trial patients using Name and Email. Firestore auto-generates a unique clinical ID client-side, which is written to Firestore and synchronized to the Realtime Database active session state.
    *   **Calibration Control (`calibration.js`):** An interactive step-by-step wizard that guides patients through relaxed-state baseline measurements and Maximum Voluntary Contraction (MVC) clenches to calibrate their sensors.
    *   **Real-time Dashboard (`dashboard.js`):** Subscribes to Firebase RTDB live updates, calculating real-time clinical parameters (Euclidean jaw motion vectors, cumulative clench workload, and heart rate elevation alerts) and plotting metrics dynamically via Chart.js.
    *   **Historical Session Browser (`history.js`):** Queries historical sleep logs from Firestore, rendering comparative timelines, sleep efficiency indicators, and trend graphs.
    *   **PDF Reporting Engine (`report.js`):** Compiles and formatting clinical report cards, allowing investigators to download PDF summaries.

---

## 🛠️ Installation & Setup

To run the dashboard locally, follow these steps:

### 1. Configure Secrets
Copy the template configuration file to a new `.env` file:
```bash
cp .env.example .env
```
Open `.env` and fill in your Firebase project keys, admin user credentials, and local credentials.

### 2. Generate Local Configs
Run the setup utility to generate the web-loader scripts (`env.js` and firmware header `arduino_secrets.h`):
```bash
python3 setup_env.py
```

### 3. Run a Local Server
Because the app uses ES modules, browsers block local loading via direct file opening (`file://`). You must serve the folder using a local HTTP server:

*   **Using VS Code:** Right-click `bruxism_dashboard_final.html` and choose **Open with Live Server**.
*   **Using Python:**
    ```bash
    python3 -m http.server 8000
    ```
    Then navigate to `http://localhost:8000/bruxism_dashboard_final.html` in your browser.
