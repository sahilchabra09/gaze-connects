#include <Arduino.h>
#include "I2Cdev.h"
#include "MPU6050_6Axis_MotionApps20.h"
#include "Wire.h"
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <PubSubClient.h>
#include <LittleFS.h>

// ─── PIN ──────────────────────────────────────────
#define LED_PIN 2  // active LOW (built-in LED on ESP8266)

// ─── AP CONFIG ────────────────────────────────────
const char* AP_SSID     = "EyeTracker-Setup";
const char* AP_PASS     = "12345678";
const char* MQTT_BROKER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;

// ─── GLOBALS ──────────────────────────────────────
ESP8266WebServer  configServer(80);
WiFiClient        wifiClient;
PubSubClient      mqtt(wifiClient);
MPU6050           mpu;

// DMP
bool     dmpReady  = false;
uint8_t  devStatus;
uint16_t packetSize;
uint8_t  fifoBuffer[64];
Quaternion  q;
VectorFloat gravity;
float       ypr[3];

String savedSSID, savedPassword, savedIdentity, savedBackendUrl;
String mqttClientId, mqttCmdTopic, mqttGyroTopic;
bool   configMode = false;
bool   mqttReady  = false;
bool   configServerInitialized = false;

// ─── LED HELPERS ──────────────────────────────────
void ledOn()  { digitalWrite(LED_PIN, LOW); }
void ledOff() { digitalWrite(LED_PIN, HIGH); }
void blinkLed(unsigned long delayMs, unsigned long durationMs) {
  unsigned long start = millis();
  unsigned long totalDuration = durationMs;
  while (millis() - start < totalDuration) {
    ledOn();  delay(delayMs);
    ledOff(); delay(delayMs);
  }
}

String escapeJsonString(const String& input) {
  String output;
  output.reserve(input.length() + 8);
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    switch (c) {
      case '\\': output += "\\\\"; break;
      case '"': output += "\\\""; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default: output += c; break;
    }
  }
  return output;
}

bool extractJsonStringField(const String& json, const char* key, String& valueOut) {
  valueOut = "";

  String needle = String("\"") + key + "\"";
  int keyIndex = json.indexOf(needle);
  if (keyIndex < 0) return false;

  int colonIndex = json.indexOf(':', keyIndex + needle.length());
  if (colonIndex < 0) return false;

  int firstQuoteIndex = json.indexOf('"', colonIndex + 1);
  if (firstQuoteIndex < 0) return false;

  String value;
  value.reserve(32);
  bool escape = false;
  for (size_t i = static_cast<size_t>(firstQuoteIndex + 1); i < json.length(); ++i) {
    char c = json[i];
    if (escape) {
      switch (c) {
        case 'n': value += '\n'; break;
        case 'r': value += '\r'; break;
        case 't': value += '\t'; break;
        case '"': value += '"'; break;
        case '\\': value += '\\'; break;
        default: value += c; break;
      }
      escape = false;
      continue;
    }
    if (c == '\\') {
      escape = true;
      continue;
    }
    if (c == '"') {
      valueOut = value;
      return true;
    }
    value += c;
  }

  return false;
}

String escapeJsString(const String& input) {
  String output;
  output.reserve(input.length() + 8);
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    switch (c) {
      case '\\': output += "\\\\"; break;
      case '"': output += "\\\""; break;
      case '\n': output += "\\n"; break;
      case '\r': output += "\\r"; break;
      case '\t': output += "\\t"; break;
      default: output += c; break;
    }
  }
  return output;
}

void indicateFallbackIdentityInUse() {
  // 60s signal: 2s ON / 2s OFF means old identity is being reused.
  Serial.println("→ Using previous identity. LED pattern: 2s ON / 2s OFF for 60s");
  unsigned long start = millis();
  while (millis() - start < 60000UL) {
    ledOn();
    delay(2000);
    ledOff();
    delay(2000);
  }
}

void buildIdentityRouting() {
  mqttGyroTopic = "eyetracker/" + savedIdentity + "/gyro";
  mqttCmdTopic = "eyetracker/" + savedIdentity + "/cmd";

  String identitySuffix = savedIdentity;
  if (identitySuffix.length() > 18) {
    identitySuffix = identitySuffix.substring(0, 18);
  }

  mqttClientId = "eyetracker-" + identitySuffix;
  if (mqttClientId.length() == 10) {
    mqttClientId += String(ESP.getChipId(), HEX);
  }
}

String normalizeBackendUrl(const String& url) {
  String normalized = url;
  normalized.trim();
  while (normalized.endsWith("/")) {
    normalized.remove(normalized.length() - 1);
  }
  return normalized;
}

bool isValidBackendUrl(const String& url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

// ─── LITTLEFS HELPERS ─────────────────────────────
void saveConfig(const String& ssid, const String& pass, const String& identity, const String& backendUrl) {
  File f = LittleFS.open("/config.json", "w");
  if (!f) return;
  String json = "{";
  json += "\"ssid\":\"" + escapeJsonString(ssid) + "\",";
  json += "\"pass\":\"" + escapeJsonString(pass) + "\",";
  json += "\"identity\":\"" + escapeJsonString(identity) + "\",";
  json += "\"backendUrl\":\"" + escapeJsonString(backendUrl) + "\"}";
  f.print(json);
  f.close();
}

bool loadConfig() {
  if (!LittleFS.exists("/config.json")) return false;
  File f = LittleFS.open("/config.json", "r");
  if (!f) return false;
  String json = f.readString();
  f.close();
  if (json.length() == 0) return false;

  if (!extractJsonStringField(json, "ssid", savedSSID)) return false;
  if (!extractJsonStringField(json, "pass", savedPassword)) return false;
  if (!extractJsonStringField(json, "identity", savedIdentity)) return false;
  if (!extractJsonStringField(json, "backendUrl", savedBackendUrl)) return false;

  savedBackendUrl = normalizeBackendUrl(savedBackendUrl);

  return savedSSID.length() > 0 && savedIdentity.length() > 0 && savedBackendUrl.length() > 0;
}

void clearConfig() {
  LittleFS.remove("/config.json");
}

void clearIdentityFromConfig() {
  // Keep WiFi config but clear identity marker.
  saveConfig(savedSSID, savedPassword, "", savedBackendUrl);
}

// ─── FORWARD DECLARATIONS ─────────────────────────
void startConfigMode();
void setupConfigServer();
bool requestIdentityToken(const String& backendUrl, const String& email, const String& password, String& identityOut);
void buildIdentityRouting();
void indicateFallbackIdentityInUse();
void connectMQTT();
void initDMP();

// ══════════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n═══ BOOT ═══");
  
  pinMode(LED_PIN, OUTPUT);
  ledOn();
  Serial.println("✓ LED initialized");

  Serial.println("→ Initializing I2C (SDA=D2/GPIO4, SCL=D1/GPIO5)...");
  Wire.begin(4, 5);
  Serial.println("✓ Wire.begin() OK");

  Serial.println("→ Initializing LittleFS...");
  if (!LittleFS.begin()) {
    Serial.println("✗ LittleFS.begin() FAILED!");
    while(1) { ledOn(); delay(100); ledOff(); delay(100); }
  }
  Serial.println("✓ LittleFS OK");

  Serial.println("→ Loading config...");
  if (loadConfig()) {
    buildIdentityRouting();
    Serial.println("✓ Config found");
    Serial.println("  SSID: " + savedSSID);
    Serial.println("  Identity: " + savedIdentity);
    Serial.println("  Backend URL: " + savedBackendUrl);
    Serial.println("Saved config found, connecting WiFi...");
    Serial.print("  SSID: ");
    Serial.println(savedSSID);

    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSSID.c_str(), savedPassword.c_str());
    Serial.println("  WiFi.begin() called, waiting 15s...");

    unsigned long start = millis();
    bool connected = false;
    int lastStatus = -1;
    while (millis() - start < 15000) {
      int status = WiFi.status();
      if (status != lastStatus) {
        Serial.print("  Status: ");
        switch(status) {
          case WL_IDLE_STATUS: Serial.println("WL_IDLE_STATUS"); break;
          case WL_NO_SSID_AVAIL: Serial.println("WL_NO_SSID_AVAIL"); break;
          case WL_SCAN_COMPLETED: Serial.println("WL_SCAN_COMPLETED"); break;
          case WL_CONNECTED: Serial.println("WL_CONNECTED ✓"); break;
          case WL_CONNECT_FAILED: Serial.println("WL_CONNECT_FAILED (BAD PASSWORD?)"); break;
          case WL_CONNECTION_LOST: Serial.println("WL_CONNECTION_LOST"); break;
          case WL_DISCONNECTED: Serial.println("WL_DISCONNECTED"); break;
          default: Serial.println(status); break;
        }
        lastStatus = status;
      }
      if (status == WL_CONNECTED) { connected = true; break; }
      ledOn();  delay(500);
      ledOff(); delay(500);
    }

    if (!connected) {
      int finalStatus = WiFi.status();
      Serial.print("✗ WiFi FAILED (final status=");
      Serial.print(finalStatus);
      Serial.println(") → config mode");
      startConfigMode();
      return;
    }

    Serial.print("✓ WiFi connected! IP: ");
    Serial.println(WiFi.localIP());

    ledOff();

    Serial.println("→ Starting MQTT...");
    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    connectMQTT();
    Serial.println("✓ MQTT connected");
    
    Serial.println("→ Initializing DMP...");
    initDMP();
    Serial.println("✓ DMP initialized");
    
    mqttReady = true;
    Serial.println("═══ READY ═══");

  } else {
    Serial.println("✗ No config found");
    Serial.println("No config → config mode");
    startConfigMode();
  }
}

// ══════════════════════════════════════════════════
//  LOOP
// ══════════════════════════════════════════════════
void loop() {
  if (configMode) {
    configServer.handleClient();
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost → config mode");
    mqttReady = false;
    startConfigMode();
    return;
  }

  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (!mqttReady || !dmpReady) return;

  if (mpu.dmpGetCurrentFIFOPacket(fifoBuffer)) {
    mpu.dmpGetQuaternion(&q, fifoBuffer);
    mpu.dmpGetGravity(&gravity, &q);
    mpu.dmpGetYawPitchRoll(ypr, &q, &gravity);

    float yaw   = ypr[0] * 180.0 / M_PI;
    float pitch = ypr[1] * 180.0 / M_PI;
    float roll  = ypr[2] * 180.0 / M_PI;

    char payload[32];
    snprintf(payload, sizeof(payload), "%.1f,%.1f,%.1f", yaw, pitch, roll);

    mqtt.publish(mqttGyroTopic.c_str(), payload);
    Serial.println(payload);
  }

  delay(10);
}

// ══════════════════════════════════════════════════
//  DMP INIT
// ══════════════════════════════════════════════════
void initDMP() {
  Serial.println("→ Initializing MPU6050 (I2C addr 0x68)...");
  
  Serial.println("  Step 1: mpu.initialize()");
  mpu.initialize();

  Serial.println("  Step 2: Testing I2C connection...");
  if (!mpu.testConnection()) {
    Serial.println("  ✗ MPU6050 NOT FOUND!");
    Serial.println("     Check: SDA=GPIO4(D2), SCL=GPIO5(D1), 3.3V power, GND");
    dmpReady = false;
    return;
  }
  Serial.println("  ✓ MPU6050 detected!");

  Serial.println("  Step 3: Initializing DMP...");
  devStatus = mpu.dmpInitialize();
  
  if (devStatus != 0) {
    Serial.print("  ✗ DMP Init failed (code=");
    Serial.print(devStatus);
    Serial.println(")");
    dmpReady = false;
    return;
  }

  Serial.println("  Step 4: Setting gyro/accel offsets...");
  mpu.setXGyroOffset(0);
  mpu.setYGyroOffset(0);
  mpu.setZGyroOffset(0);
  mpu.setXAccelOffset(0);
  mpu.setYAccelOffset(0);
  mpu.setZAccelOffset(0);

  Serial.println("  Step 5: Calibrating (10s)...");
  mpu.CalibrateAccel(6);
  mpu.CalibrateGyro(6);
  Serial.println("  ✓ Calibration done");
  
  mpu.setDMPEnabled(true);
  dmpReady = true;
  packetSize = mpu.dmpGetFIFOPacketSize();
  Serial.print("✓ DMP Ready (packet=");
  Serial.print(packetSize);
  Serial.println(" bytes)");
}

// ══════════════════════════════════════════════════
//  IDENTITY TOKEN EXCHANGE
// ══════════════════════════════════════════════════
bool requestIdentityToken(const String& backendUrl, const String& email, const String& password, String& identityOut) {
  identityOut = "";

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("✗ WiFi not connected!");
    return false;
  }

  String requestUrl = normalizeBackendUrl(backendUrl);
  if (!isValidBackendUrl(requestUrl)) {
    Serial.println("✗ Backend URL is invalid!");
    return false;
  }

  Serial.print("→ POST ");
  Serial.print(requestUrl);
  Serial.print(" with email: ");
  Serial.println(email);

  WiFiClient client;
  HTTPClient http;
  
  if (!http.begin(client, requestUrl)) {
    Serial.println("✗ HTTP.begin() failed!");
    http.end();
    return false;
  }
  
  http.addHeader("Content-Type", "application/json");
  String body = "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
  
  Serial.println("  Sending request...");
  int code = http.POST(body);
  Serial.print("  Response code: ");
  Serial.println(code);
  
  String response = http.getString();
  
  http.end();

  if (code != 200 && code != 201) {
    Serial.println("✗ Signin failed");
    return false;
  }

  const char* keys[] = {"hashed_uuid", "uuid", "identity", "deviceId", "id"};
  for (size_t i = 0; i < (sizeof(keys) / sizeof(keys[0])); ++i) {
    String candidate;
    if (extractJsonStringField(response, keys[i], candidate) && candidate.length() > 0) {
      identityOut = candidate;
      Serial.print("✓ Identity received from field: ");
      Serial.println(keys[i]);
      return true;
    }
  }

  Serial.println("✗ Signin succeeded but no identity marker found in response");
  return false;
}

// ══════════════════════════════════════════════════
//  MQTT CONNECT
// ══════════════════════════════════════════════════
void connectMQTT() {
  if (mqttClientId.length() == 0 || mqttCmdTopic.length() == 0) {
    buildIdentityRouting();
  }

  Serial.print("→ Connecting MQTT: ");
  Serial.print(MQTT_BROKER);
  Serial.print(":");
  Serial.print(MQTT_PORT);
  Serial.print(" (ID: ");
  Serial.print(mqttClientId);
  Serial.println(")");
  
  int attempts = 0;
  while (!mqtt.connected() && attempts < 5) {
    attempts++;
    Serial.print("  Attempt ");
    Serial.print(attempts);
    Serial.print("/5... ");
    if (mqtt.connect(mqttClientId.c_str())) {
      Serial.println("✓ Connected!");
      mqtt.subscribe(mqttCmdTopic.c_str());
      Serial.print("  Subscribed: ");
      Serial.println(mqttCmdTopic);
      return;
    } else {
      int state = mqtt.state();
      Serial.print("✗ Failed (state=");
      Serial.print(state);
      Serial.println("), retry 2s");
      delay(2000);
    }
  }
  
  if (!mqtt.connected()) {
    Serial.println("✗ MQTT failed!");
  }
}

// ══════════════════════════════════════════════════
//  SOFT AP CONFIG MODE
// ══════════════════════════════════════════════════
void startConfigMode() {
  configMode = true;
  mqttReady = false;
  ledOn();

  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.println("AP started: " + WiFi.softAPIP().toString());
  if (!configServerInitialized) {
    setupConfigServer();
    configServerInitialized = true;
  }
}

// ══════════════════════════════════════════════════
//  CONFIG SERVER
// ══════════════════════════════════════════════════
void setupConfigServer() {
  configServer.on("/", HTTP_GET, []() {
    configServer.sendHeader("Connection", "close");
    String page = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EyeTracker Setup</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:system-ui; background:linear-gradient(135deg,#667eea,#764ba2); min-height:100vh; padding:20px; }
    .card { background:white; border-radius:16px; padding:30px; max-width:480px; margin:0 auto; box-shadow:0 10px 40px rgba(0,0,0,.2); }
    h1 { color:#667eea; margin-bottom:24px; }
    input { width:100%; padding:12px; border:2px solid #e0e0e0; border-radius:8px; margin-bottom:12px; font-size:15px; }
    .btn { width:100%; padding:13px; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; margin-bottom:10px; }
    .primary { background:#667eea; color:white; }
    .danger  { background:#ff4757; color:white; }
    .status  { padding:12px; border-radius:8px; margin-bottom:16px; font-size:14px; }
    .info    { background:#e3f2fd; color:#1976d2; }
    .success { background:#e8f5e9; color:#388e3c; }
    .error   { background:#ffebee; color:#c62828; }
    .net-item { padding:11px; border:2px solid #e0e0e0; border-radius:8px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; }
    .net-item:hover,.net-item.sel { border-color:#667eea; background:#f0f4ff; }
    .section { font-weight:600; color:#555; margin:16px 0 8px; }
  </style>
</head>
<body>
<div class="card">
  <h1>👁️ EyeTracker Setup</h1>
  <div id="status" class="status info">Enter WiFi, backend URL, and account details. Backend URL stays saved until you change it.</div>
  <div class="section">📶 WiFi</div>
  <button class="btn primary" onclick="scan()">🔍 Scan Networks</button>
  <div id="netList" style="margin-bottom:12px"></div>
  <input id="ssid"     placeholder="WiFi SSID" />
  <input id="wifipass" type="password" placeholder="WiFi Password" />
  <div class="section">🌐 Backend</div>
  <input id="backendUrl" placeholder="Backend Validation URL" value="" />
  <div class="section">👤 Account (optional if keeping existing identity)</div>
  <input id="email" placeholder="Account Email (for new identity)" />
  <input id="accpass" type="password" placeholder="Account Password (for new identity)" />
  <button class="btn primary" onclick="connect()">✅ Save & Connect</button>
  <button class="btn danger"  onclick="clearAll()">🗑️ Clear All & Reset</button>
</div>
<script>
  const $ = id => document.getElementById(id);
  function show(msg, type) { $('status').className='status '+type; $('status').innerHTML=msg; }
  async function scan() {
    show('Scanning...','info');
    try {
      const d = await (await fetch('/scan')).json();
      $('netList').innerHTML = '';
      d.forEach(n => {
        const el = document.createElement('div');
        el.className = 'net-item';
        el.innerHTML = `<span>${n.ssid}</span><span>${n.rssi>-50?'📶📶📶':n.rssi>-70?'📶📶':'📶'}</span>`;
        el.onclick = () => {
          document.querySelectorAll('.net-item').forEach(i=>i.classList.remove('sel'));
          el.classList.add('sel');
          $('ssid').value = n.ssid;
        };
        $('netList').appendChild(el);
      });
      show('Found '+d.length+' networks','success');
    } catch(e) { show('Scan failed','error'); }
  }
  async function connect() {
    const ssid=$('ssid').value.trim(), wpass=$('wifipass').value,
          backendUrl=$('backendUrl').value.trim(),
          email=$('email').value.trim(), apass=$('accpass').value;
    if (!ssid||!wpass||!backendUrl) { show('WiFi, backend URL, and password are required','error'); return; }
    if ((email && !apass) || (!email && apass)) {
      show('Enter both email and account password, or leave both empty','error');
      return;
    }
    show('Connecting... please wait ~15s','info');
    try {
      const url=`/connect?ssid=${encodeURIComponent(ssid)}&wifipass=${encodeURIComponent(wpass)}&backendUrl=${encodeURIComponent(backendUrl)}&email=${encodeURIComponent(email)}&accpass=${encodeURIComponent(apass)}`;
      const d = await (await fetch(url)).json();
      show(d.success?'✅ Done! Restarting...':'❌ '+(d.error||'Failed'), d.success?'success':'error');
    } catch(e) { show('Error','error'); }
  }
  async function clearAll() {
    if (!confirm('Clear all?')) return;
    await fetch('/clear');
    show('Cleared! Restarting...','success');
  }
  const savedBackendUrl = "__SAVED_BACKEND_URL__";
  if (savedBackendUrl && savedBackendUrl !== "__SAVED_BACKEND_URL__") {
    $('backendUrl').value = savedBackendUrl;
  }
</script>
</body>
</html>
)rawliteral";
    page.replace("__SAVED_BACKEND_URL__", escapeJsString(savedBackendUrl));
    configServer.send(200, "text/html", page);
  });

  configServer.on("/scan", HTTP_GET, []() {
    configServer.sendHeader("Connection", "close");
    int n = WiFi.scanNetworks();
    String json = "[";
    for (int i = 0; i < n; i++) {
      if (i > 0) json += ",";
      json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + WiFi.RSSI(i) + "}";
    }
    json += "]";
    configServer.send(200, "application/json", json);
    WiFi.scanDelete();
  });

  configServer.on("/connect", HTTP_GET, []() {
    configServer.sendHeader("Connection", "close");
    String ssid    = configServer.arg("ssid");
    String wpass   = configServer.arg("wifipass");
    String backendUrl = configServer.arg("backendUrl");
    String email   = configServer.arg("email");
    if (email.length() == 0) {
      email = configServer.arg("account");
    }
    String accpass = configServer.arg("accpass");

    bool hasEmail = email.length() > 0;
    bool hasAccPass = accpass.length() > 0;
    bool hasAnyAccountInput = hasEmail || hasAccPass;

    Serial.println("\n═══ CONFIG RECEIVED ═══");
    Serial.print("SSID: ");
    Serial.println(ssid);
    Serial.print("Backend URL: ");
    Serial.println(backendUrl.length() > 0 ? backendUrl : savedBackendUrl);
    if (hasEmail) {
      Serial.print("Email: ");
      Serial.println(email);
    } else {
      Serial.println("Email: (not provided)");
    }

    if ((hasEmail && !hasAccPass) || (!hasEmail && hasAccPass)) {
      Serial.println("✗ Partial account credentials provided");
      ledOn();
      configServer.send(200, "application/json", "{\"success\":false,\"error\":\"Provide both email and password, or neither\"}");
      return;
    }

    Serial.println("→ Connecting to WiFi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), wpass.c_str());
    unsigned long start = millis();
    bool wifiOk = false;
    while (millis() - start < 15000) {
      if (WiFi.status() == WL_CONNECTED) { wifiOk = true; break; }
      ledOn();  delay(500);
      ledOff(); delay(500);
    }

    if (!wifiOk) {
      Serial.println("✗ WiFi connection failed");
      blinkLed(50, 2000);
      ledOn();
      configServer.send(200, "application/json", "{\"success\":false,\"error\":\"WiFi failed\"}");
      return;
    }

    Serial.print("✓ WiFi OK: ");
    Serial.println(WiFi.localIP());

    String identityToStore = savedIdentity;
    String backendUrlToStore = savedBackendUrl;
    bool identityFromBackend = false;
    bool usedOldIdentityAfterFailedSignin = false;

    backendUrl = normalizeBackendUrl(backendUrl);
    if (backendUrl.length() == 0) {
      backendUrl = savedBackendUrl;
    }

    if (backendUrl.length() == 0) {
      Serial.println("✗ No backend URL available");
      blinkLed(50, 2000);
      ledOn();
      WiFi.disconnect();
      WiFi.mode(WIFI_AP);
      WiFi.softAP(AP_SSID, AP_PASS);
      configServer.send(200, "application/json", "{\"success\":false,\"error\":\"Backend URL is required\"}");
      return;
    }

    if (hasAnyAccountInput) {
      Serial.println("→ Verifying credentials and requesting identity...");
      String newIdentity;
      if (requestIdentityToken(backendUrl, email, accpass, newIdentity)) {
        identityToStore = newIdentity;
        backendUrlToStore = backendUrl;
        identityFromBackend = true;
        Serial.print("✓ New identity received: ");
        Serial.println(identityToStore);
      } else {
        if (savedIdentity.length() > 0) {
          Serial.println("⚠ Signin failed, keeping existing identity");
          usedOldIdentityAfterFailedSignin = true;
          identityToStore = savedIdentity;
          backendUrlToStore = savedBackendUrl.length() > 0 ? savedBackendUrl : backendUrl;
        } else {
          Serial.println("✗ Signin failed and no existing identity is available");
          blinkLed(50, 2000);
          ledOn();
          WiFi.disconnect();
          WiFi.mode(WIFI_AP);
          WiFi.softAP(AP_SSID, AP_PASS);
          configServer.send(200, "application/json", "{\"success\":false,\"error\":\"No identity available. Provide valid account credentials.\"}");
          return;
        }
      }
    } else {
      if (savedIdentity.length() > 0) {
        Serial.println("→ No account credentials provided, keeping existing identity");
        backendUrlToStore = backendUrl;
      } else {
        Serial.println("✗ No account credentials and no existing identity");
        blinkLed(50, 2000);
        ledOn();
        WiFi.disconnect();
        WiFi.mode(WIFI_AP);
        WiFi.softAP(AP_SSID, AP_PASS);
        configServer.send(200, "application/json", "{\"success\":false,\"error\":\"Account login required to create first identity\"}");
        return;
      }
    }

    if (identityToStore.length() == 0) {
      Serial.println("✗ Identity missing, cannot save config");
      blinkLed(50, 2000);
      ledOn();
      configServer.send(200, "application/json", "{\"success\":false,\"error\":\"Identity is required\"}");
      return;
    }

    saveConfig(ssid, wpass, identityToStore, backendUrlToStore);
    savedSSID = ssid;
    savedPassword = wpass;
    savedIdentity = identityToStore;
    savedBackendUrl = backendUrlToStore;
    buildIdentityRouting();

    ledOff();
    if (identityFromBackend) {
      configServer.send(200, "application/json", "{\"success\":true,\"identityUpdated\":true,\"usedOldIdentity\":false}");
    } else if (usedOldIdentityAfterFailedSignin) {
      configServer.send(200, "application/json", "{\"success\":true,\"identityUpdated\":false,\"usedOldIdentity\":true}");
    } else {
      configServer.send(200, "application/json", "{\"success\":true,\"identityUpdated\":false,\"usedOldIdentity\":false}");
    }

    if (usedOldIdentityAfterFailedSignin) {
      indicateFallbackIdentityInUse();
    }

    Serial.println("✓ Config saved - restarting...");
    delay(1000);
    ESP.restart();
  });

  configServer.on("/clear", HTTP_GET, []() {
    configServer.sendHeader("Connection", "close");
    clearConfig();
    configServer.send(200, "application/json", "{\"success\":true}");
    delay(500);
    ESP.restart();
  });

  configServer.begin();
}
