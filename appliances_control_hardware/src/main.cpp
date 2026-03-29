#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ===== CONFIGURATION =====
const char* mqtt_server = "broker.emqx.io"; // Public MQTT broker
const int mqtt_port = 1883;
const char* mqtt_user = "";
const char* mqtt_password = "";
const char* control_topic = "gazeconnect/appliances/control"; // Your unique topic
const char* state_topic = "gazeconnect/appliances/state";

// Control password for security
String control_password_stored = "appliances123"; // Default password
const int EEPROM_MAGIC = 0xCD34;

// Pin mapping
struct PinMap {
  const char* name;
  uint8_t pin;
} pinMap[] = {
  {"d0", D0},
  {"d1", D1},
  {"d2", D2},
  {"d3", D3},
  {"d4", D4},
  {"d5", D5},
  {"d6", D6},
  {"d7", D7},
  {"d8", D8}
};
const int pinCount = sizeof(pinMap) / sizeof(pinMap[0]);

// WiFi credentials
String ssid_stored = "";
String password_stored = "";
bool configMode = false;

WiFiClient espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);

// ===== FUNCTION DECLARATIONS =====
void setupPins();
void loadCredentials();
void saveCredentials(String ssid, String password);
void loadControlPassword();
void saveControlPassword(String password);
void clearEEPROM();
bool validateControlPassword(String password);
void connectToWiFi();
void startConfigMode();
void setupWebServer();
void handleRoot();
void handleScan();
void handleConnect();
void handleClearWiFi();
void handleSetPassword();
void publish_state();
void callback(char* topic, byte* payload, unsigned int length);
void reconnect();

// ===== PIN SETUP =====
void setupPins() {
  for (int i = 0; i < pinCount; i++) {
    pinMode(pinMap[i].pin, OUTPUT);
    digitalWrite(pinMap[i].pin, LOW);
  }
  Serial.println("✅ All pins initialized to LOW");
}

// ===== EEPROM FUNCTIONS =====
void clearEEPROM() {
  Serial.println("🗑️ Clearing EEPROM...");
  for (int i = 0; i < 512; i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  ssid_stored = "";
  password_stored = "";
  control_password_stored = "appliances123";
  Serial.println("✅ EEPROM cleared!");
}

void loadCredentials() {
  Serial.println("📖 Loading WiFi credentials...");
  
  int magic = (EEPROM.read(200) << 8) | EEPROM.read(201);
  if (magic != EEPROM_MAGIC) {
    Serial.println("⚠️ No valid credentials found");
    return;
  }
  
  int ssidLength = EEPROM.read(0);
  if (ssidLength > 0 && ssidLength < 100) {
    for (int i = 0; i < ssidLength; i++) {
      ssid_stored += char(EEPROM.read(1 + i));
    }
  }
  
  int passwordLength = EEPROM.read(100);
  if (passwordLength > 0 && passwordLength < 100) {
    for (int i = 0; i < passwordLength; i++) {
      password_stored += char(EEPROM.read(101 + i));
    }
  }
  
  Serial.println("✅ SSID: " + ssid_stored);
}

void saveCredentials(String ssid, String password) {
  Serial.println("💾 Saving WiFi credentials...");
  
  for (int i = 0; i < 512; i++) {
    EEPROM.write(i, 0);
  }
  
  EEPROM.write(0, ssid.length());
  for (int i = 0; i < ssid.length(); i++) {
    EEPROM.write(1 + i, ssid[i]);
  }
  
  EEPROM.write(100, password.length());
  for (int i = 0; i < password.length(); i++) {
    EEPROM.write(101 + i, password[i]);
  }
  
  EEPROM.write(300, control_password_stored.length());
  for (int i = 0; i < control_password_stored.length(); i++) {
    EEPROM.write(301 + i, control_password_stored[i]);
  }
  
  EEPROM.write(200, (EEPROM_MAGIC >> 8) & 0xFF);
  EEPROM.write(201, EEPROM_MAGIC & 0xFF);
  
  EEPROM.commit();
  Serial.println("✅ Credentials saved!");
}

void loadControlPassword() {
  Serial.println("📖 Loading control password...");
  
  int passwordLength = EEPROM.read(300);
  if (passwordLength > 0 && passwordLength < 50) {
    control_password_stored = "";
    for (int i = 0; i < passwordLength; i++) {
      control_password_stored += char(EEPROM.read(301 + i));
    }
  }
  
  Serial.println("✅ Control password loaded");
}

void saveControlPassword(String password) {
  Serial.println("💾 Saving control password...");
  
  control_password_stored = password;
  
  EEPROM.write(300, password.length());
  for (int i = 0; i < password.length(); i++) {
    EEPROM.write(301 + i, password[i]);
  }
  
  EEPROM.commit();
  Serial.println("✅ Control password saved!");
}

bool validateControlPassword(String password) {
  return (password == control_password_stored);
}

// ===== WIFI FUNCTIONS =====
void connectToWiFi() {
  Serial.println("📡 Connecting to WiFi: " + ssid_stored);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_stored.c_str(), password_stored.c_str());
  
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 40) {
    delay(500);
    Serial.print(".");
    timeout++;
    
    if (timeout % 10 == 0) {
      Serial.println();
      Serial.println("⏳ Still connecting... (" + String(timeout/2) + "s)");
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✅ WiFi connected!");
    Serial.println("📍 IP address: " + WiFi.localIP().toString());
    
    // Connect to MQTT
    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(callback);
  } else {
    Serial.println();
    Serial.println("❌ WiFi connection failed! Starting config mode...");
    startConfigMode();
  }
}

void startConfigMode() {
  Serial.println("========================================");
  Serial.println("    🔧 WIFI CONFIGURATION MODE");
  Serial.println("========================================");
  
  configMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ApplianceControl_Setup", "12345678");
  
  IPAddress IP = WiFi.softAPIP();
  Serial.println("✅ Configuration AP started");
  Serial.println("📶 SSID: ApplianceControl_Setup");
  Serial.println("🔑 Password: 12345678");
  Serial.println("📍 IP: " + IP.toString());
  Serial.println("🌐 Open browser: http://" + IP.toString());
  Serial.println("========================================");
  
  setupWebServer();
}

// ===== WEB SERVER =====
void setupWebServer() {
  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/connect", handleConnect);
  server.on("/clear", handleClearWiFi);
  server.on("/setpassword", handleSetPassword);
  
  server.begin();
  Serial.println("🌐 Web server started on port 80");
}

void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Appliance Control Setup</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        .card { background: white; border-radius: 16px; padding: 30px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
        h1 { color: #667eea; font-size: 28px; margin-bottom: 10px; }
        h2 { color: #333; font-size: 20px; margin-bottom: 20px; }
        .subtitle { color: #666; margin-bottom: 30px; }
        .btn { width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s; margin-bottom: 10px; }
        .btn-primary { background: #667eea; color: white; }
        .btn-primary:hover { background: #5568d3; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(102,126,234,0.3); }
        .btn-secondary { background: #f0f0f0; color: #333; }
        .btn-secondary:hover { background: #e0e0e0; }
        .btn-danger { background: #ff4757; color: white; }
        .btn-danger:hover { background: #ee3344; }
        input, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; margin-bottom: 15px; transition: border 0.3s; }
        input:focus, select:focus { outline: none; border-color: #667eea; }
        .status { padding: 12px; border-radius: 8px; margin-bottom: 15px; font-size: 14px; }
        .status-info { background: #e3f2fd; color: #1976d2; }
        .status-success { background: #e8f5e9; color: #388e3c; }
        .status-error { background: #ffebee; color: #c62828; }
        .loading { display: inline-block; width: 16px; height: 16px; border: 3px solid #f3f3f3; border-top: 3px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin-left: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .network-list { max-height: 300px; overflow-y: auto; }
        .network-item { padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: all 0.3s; display: flex; justify-content: space-between; align-items: center; }
        .network-item:hover { border-color: #667eea; background: #f8f9ff; }
        .network-item.selected { border-color: #667eea; background: #e3f2fd; }
        .signal { font-size: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>🏠 Appliance Control</h1>
            <p class="subtitle">Configure WiFi and MQTT Settings</p>
            
            <div id="status" class="status status-info">
                📡 Ready to configure
            </div>
            
            <button class="btn btn-primary" onclick="scanNetworks()">🔍 Scan WiFi Networks</button>
            
            <div id="networkList" class="network-list"></div>
            
            <input type="text" id="ssid" placeholder="WiFi SSID" />
            <input type="password" id="password" placeholder="WiFi Password" />
            <button class="btn btn-primary" onclick="connect()">✅ Connect to WiFi</button>
            
            <h2 style="margin-top: 30px;">🔐 Security</h2>
            <input type="password" id="controlPassword" placeholder="Control Password" value="appliances123" />
            <button class="btn btn-secondary" onclick="setPassword()">💾 Update Password</button>
            
            <button class="btn btn-danger" onclick="clearWiFi()" style="margin-top: 30px;">🗑️ Clear WiFi Settings</button>
        </div>
    </div>
    
    <script>
        let selectedSSID = '';
        
        function showStatus(message, type) {
            const status = document.getElementById('status');
            status.className = 'status status-' + type;
            status.innerHTML = message;
        }
        
        async function scanNetworks() {
            showStatus('🔍 Scanning networks... <span class="loading"></span>', 'info');
            try {
                const response = await fetch('/scan');
                const networks = await response.json();
                displayNetworks(networks);
                showStatus('✅ Found ' + networks.length + ' networks', 'success');
            } catch (error) {
                showStatus('❌ Scan failed: ' + error.message, 'error');
            }
        }
        
        function displayNetworks(networks) {
            const list = document.getElementById('networkList');
            list.innerHTML = '';
            networks.forEach(network => {
                const item = document.createElement('div');
                item.className = 'network-item';
                item.innerHTML = `
                    <span>${network.ssid}</span>
                    <span class="signal">${getSignalIcon(network.rssi)}</span>
                `;
                item.onclick = () => selectNetwork(network.ssid, item);
                list.appendChild(item);
            });
        }
        
        function getSignalIcon(rssi) {
            if (rssi > -50) return '📶';
            if (rssi > -70) return '📶';
            if (rssi > -80) return '📡';
            return '📡';
        }
        
        function selectNetwork(ssid, element) {
            document.querySelectorAll('.network-item').forEach(item => {
                item.classList.remove('selected');
            });
            element.classList.add('selected');
            document.getElementById('ssid').value = ssid;
            selectedSSID = ssid;
        }
        
        async function connect() {
            const ssid = document.getElementById('ssid').value;
            const password = document.getElementById('password').value;
            
            if (!ssid || !password) {
                showStatus('❌ Please enter SSID and password', 'error');
                return;
            }
            
            showStatus('🔄 Connecting to ' + ssid + '... <span class="loading"></span>', 'info');
            
            try {
                const response = await fetch('/connect?ssid=' + encodeURIComponent(ssid) + '&password=' + encodeURIComponent(password));
                const result = await response.json();
                
                if (result.success) {
                    showStatus('✅ Connected! Device will restart and connect to MQTT...', 'success');
                    setTimeout(() => {
                        showStatus('🔄 Restarting device...', 'info');
                    }, 2000);
                } else {
                    showStatus('❌ Connection failed: ' + result.message, 'error');
                }
            } catch (error) {
                showStatus('❌ Error: ' + error.message, 'error');
            }
        }
        
        async function setPassword() {
            const password = document.getElementById('controlPassword').value;
            
            if (!password) {
                showStatus('❌ Please enter a password', 'error');
                return;
            }
            
            try {
                const response = await fetch('/setpassword?password=' + encodeURIComponent(password));
                const result = await response.json();
                showStatus('✅ Password updated!', 'success');
            } catch (error) {
                showStatus('❌ Error: ' + error.message, 'error');
            }
        }
        
        async function clearWiFi() {
            if (!confirm('Clear all WiFi settings and restart?')) return;
            
            try {
                await fetch('/clear');
                showStatus('✅ Settings cleared! Restarting...', 'success');
                setTimeout(() => location.reload(), 2000);
            } catch (error) {
                showStatus('❌ Error: ' + error.message, 'error');
            }
        }
    </script>
</body>
</html>
)rawliteral";
  
  server.send(200, "text/html", html);
}

void handleScan() {
  Serial.println("🔍 Scanning WiFi networks...");
  int n = WiFi.scanNetworks();
  
  JsonDocument doc;
  JsonArray networks = doc.to<JsonArray>();
  
  for (int i = 0; i < n; i++) {
    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = WiFi.SSID(i);
    network["rssi"] = WiFi.RSSI(i);
    network["encryption"] = (WiFi.encryptionType(i) == ENC_TYPE_NONE) ? "open" : "encrypted";
  }
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

void handleConnect() {
  String ssid = server.arg("ssid");
  String password = server.arg("password");
  
  Serial.println("🔌 Attempting connection to: " + ssid);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 20) {
    delay(500);
    Serial.print(".");
    timeout++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Connected!");
    saveCredentials(ssid, password);
    
    server.send(200, "application/json", "{\"success\":true}");
    delay(1000);
    ESP.restart();
  } else {
    Serial.println("\n❌ Connection failed!");
    server.send(200, "application/json", "{\"success\":false,\"message\":\"Connection timeout\"}");
  }
}

void handleClearWiFi() {
  clearEEPROM();
  server.send(200, "application/json", "{\"success\":true}");
  delay(1000);
  ESP.restart();
}

void handleSetPassword() {
  String password = server.arg("password");
  saveControlPassword(password);
  server.send(200, "application/json", "{\"success\":true}");
}

// ===== MQTT FUNCTIONS =====
void publish_state() {
  JsonDocument doc;
  for (int i = 0; i < pinCount; i++) {
    doc[pinMap[i].name] = digitalRead(pinMap[i].pin) == HIGH ? "on" : "off";
  }
  
  char payload[256];
  serializeJson(doc, payload, sizeof(payload));
  
  if (client.publish(state_topic, payload, true)) {
    Serial.println("📤 Published state: " + String(payload));
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.println("========================================");
  Serial.println("📩 MQTT Message Received");
  Serial.print("📍 Topic: ");
  Serial.println(topic);
  
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  
  if (error) {
    Serial.println("❌ JSON parse error: " + String(error.c_str()));
    return;
  }
  
  // Authenticate
  String receivedPassword = doc["password"] | "";
  if (!validateControlPassword(receivedPassword)) {
    Serial.println("❌ Invalid password!");
    return;
  }
  
  Serial.println("✅ Password validated");
  
  // Process pin controls
  JsonObject controls = doc["pins"].as<JsonObject>();
  for (JsonPair kv : controls) {
    const char* pinLabel = kv.key().c_str();
    const char* value = kv.value().as<const char*>();
    
    for (int i = 0; i < pinCount; i++) {
      if (strcasecmp(pinMap[i].name, pinLabel) == 0) {
        if (strcasecmp(value, "on") == 0 || strcasecmp(value, "high") == 0) {
          digitalWrite(pinMap[i].pin, HIGH);
          Serial.printf("✅ %s → HIGH\n", pinLabel);
        } else {
          digitalWrite(pinMap[i].pin, LOW);
          Serial.printf("⚫ %s → LOW\n", pinLabel);
        }
        break;
      }
    }
  }
  
  publish_state();
  Serial.println("========================================");
}

void reconnect() {
  int attempts = 0;
  while (!client.connected() && attempts < 5) {
    Serial.print("🔄 Connecting to MQTT... ");
    
    String clientId = "ApplianceControl_" + String(ESP.getChipId());
    
    if (client.connect(clientId.c_str(), mqtt_user, mqtt_password)) {
      Serial.println("✅ Connected!");
      client.subscribe(control_topic);
      Serial.println("📡 Subscribed to: " + String(control_topic));
      publish_state();
    } else {
      Serial.println("❌ Failed, rc=" + String(client.state()));
      attempts++;
      delay(2000);
    }
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\n\n========================================");
  Serial.println("    🏠 APPLIANCE CONTROL SYSTEM");
  Serial.println("========================================");
  
  EEPROM.begin(512);
  setupPins();
  
  // Check for reset button
  pinMode(0, INPUT_PULLUP);
  delay(100);
  
  if (digitalRead(0) == LOW) {
    Serial.println("🔧 Reset button pressed - starting config mode");
    clearEEPROM();
    startConfigMode();
    return;
  }
  
  loadCredentials();
  loadControlPassword();
  
  if (ssid_stored.length() > 0) {
    connectToWiFi();
  } else {
    Serial.println("⚠️ No WiFi credentials - starting config mode");
    startConfigMode();
  }
}

// ===== LOOP =====
void loop() {
  if (configMode) {
    server.handleClient();
  } else {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("❌ WiFi disconnected! Reconnecting...");
      connectToWiFi();
    }
    
    if (!client.connected()) {
      reconnect();
    }
    
    client.loop();
  }
  
  delay(10);
}
