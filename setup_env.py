import os

def main():
    env_path = '.env'
    if not os.path.exists(env_path):
        print(f"Error: {env_path} file not found. Please copy .env.example to .env and configure details.")
        return

    # Parse .env
    env_vars = {}
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            env_vars[key] = val

    # 1. Generate env.js for frontend
    env_js_content = f"""// AUTO-GENERATED FILE. DO NOT EDIT OR COMMIT TO GIT.
window.ENV = {{
  FIREBASE_API_KEY: "{env_vars.get('FIREBASE_API_KEY', '')}",
  FIREBASE_AUTH_DOMAIN: "{env_vars.get('FIREBASE_AUTH_DOMAIN', '')}",
  FIREBASE_DATABASE_URL: "{env_vars.get('FIREBASE_DATABASE_URL', '')}",
  FIREBASE_PROJECT_ID: "{env_vars.get('FIREBASE_PROJECT_ID', '')}",
  FIREBASE_STORAGE_BUCKET: "{env_vars.get('FIREBASE_STORAGE_BUCKET', '')}",
  FIREBASE_MESSAGING_SENDER_ID: "{env_vars.get('FIREBASE_MESSAGING_SENDER_ID', '')}",
  FIREBASE_APP_ID: "{env_vars.get('FIREBASE_APP_ID', '')}",
  FIREBASE_EMAIL: "{env_vars.get('FIREBASE_EMAIL', '')}",
  FIREBASE_PASSWORD: "{env_vars.get('FIREBASE_PASSWORD', '')}",
  FIREBASE_USER_ID: "{env_vars.get('FIREBASE_USER_ID', '')}"
}};
"""
    with open('env.js', 'w') as f:
        f.write(env_js_content)
    print("Successfully generated env.js for the frontend dashboard.")

    # 2. Generate arduino_secrets.h for local firmware compilation
    secrets_h_content = f"""// AUTO-GENERATED FILE. DO NOT EDIT OR COMMIT TO GIT.
#ifndef ARDUINO_SECRETS_H
#define ARDUINO_SECRETS_H

#define SECRET_SSID "{env_vars.get('WIFI_SSID', '')}"
#define SECRET_PASSWORD "{env_vars.get('WIFI_PASSWORD', '')}"
#define SECRET_DATABASE_URL "{env_vars.get('FIREBASE_DATABASE_URL', '')}"
#define SECRET_DATABASE_SECRET "{env_vars.get('DATABASE_SECRET', '')}"
#define SECRET_USER_UID "{env_vars.get('FIREBASE_USER_ID', '')}"

#endif
"""
    with open('arduino_secrets.h', 'w') as f:
        f.write(secrets_h_content)
    print("Successfully generated arduino_secrets.h for the ESP32 firmware.")

if __name__ == '__main__':
    main()
