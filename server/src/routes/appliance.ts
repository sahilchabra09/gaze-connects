import { Elysia, t } from "elysia";
import mqtt, { type MqttClient } from "mqtt";
import { logger } from "../lib/logger";

const APPLIANCE_MQTT_BROKER_URL = process.env.APPLIANCE_MQTT_BROKER_URL?.trim() || "mqtt://broker.emqx.io:1883";
const APPLIANCE_MQTT_USERNAME = process.env.APPLIANCE_MQTT_USERNAME?.trim() || undefined;
const APPLIANCE_MQTT_PASSWORD = process.env.APPLIANCE_MQTT_PASSWORD?.trim() || undefined;
const APPLIANCE_MQTT_CLIENT_PREFIX = process.env.APPLIANCE_MQTT_CLIENT_PREFIX?.trim() || "gazeconnect-server";
const APPLIANCE_MQTT_CONTROL_TOPIC = process.env.APPLIANCE_MQTT_CONTROL_TOPIC?.trim() || "gazeconnect/appliances/control";
const APPLIANCE_CONTROL_PASSWORD = process.env.APPLIANCE_CONTROL_PASSWORD?.trim() || "";

const ALLOWED_PINS = new Set(["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"]);
const ALLOWED_STATES = new Set(["on", "off", "high", "low"]);

let mqttClient: MqttClient | null = null;
let mqttConnectPromise: Promise<MqttClient> | null = null;

const controlBodySchema = t.Object({
  pins: t.Record(t.String({ minLength: 2 }), t.String({ minLength: 2 })),
  password: t.String({ minLength: 1 }),
});

const controlSuccessSchema = t.Object({
  success: t.Boolean(),
  message: t.String(),
  topic: t.String(),
  pinsUpdated: t.Array(t.String()),
});

const controlErrorSchema = t.Object({
  error: t.String(),
  message: t.String(),
});

function createMqttClient() {
  const client = mqtt.connect(APPLIANCE_MQTT_BROKER_URL, {
    clientId: `${APPLIANCE_MQTT_CLIENT_PREFIX}-${Math.random().toString(16).slice(2, 10)}`,
    username: APPLIANCE_MQTT_USERNAME,
    password: APPLIANCE_MQTT_PASSWORD,
    reconnectPeriod: 1000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    logger.info({ broker: APPLIANCE_MQTT_BROKER_URL }, "appliance mqtt connected");
  });

  client.on("reconnect", () => {
    logger.warn({ broker: APPLIANCE_MQTT_BROKER_URL }, "appliance mqtt reconnecting");
  });

  client.on("offline", () => {
    logger.warn({ broker: APPLIANCE_MQTT_BROKER_URL }, "appliance mqtt offline");
  });

  client.on("error", (error) => {
    logger.error({ error, broker: APPLIANCE_MQTT_BROKER_URL }, "appliance mqtt error");
  });

  return client;
}

async function getMqttClient() {
  if (mqttClient?.connected) {
    return mqttClient;
  }

  if (mqttConnectPromise) {
    return mqttConnectPromise;
  }

  mqttConnectPromise = new Promise<MqttClient>((resolve, reject) => {
    const client = createMqttClient();

    const timeout = setTimeout(() => {
      cleanup();
      client.end(true);
      reject(new Error("Timed out connecting to appliance MQTT broker"));
    }, 10000);

    const onConnect = () => {
      cleanup();
      mqttClient = client;
      resolve(client);
    };

    const onError = (error: Error) => {
      cleanup();
      client.end(true);
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.off("connect", onConnect);
      client.off("error", onError);
      mqttConnectPromise = null;
    };

    client.once("connect", onConnect);
    client.once("error", onError);
  });

  return mqttConnectPromise;
}

async function publishControlMessage(payload: string) {
  const client = await getMqttClient();

  await new Promise<void>((resolve, reject) => {
    client.publish(
      APPLIANCE_MQTT_CONTROL_TOPIC,
      payload,
      { qos: 1, retain: false },
      (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function normalizeAndValidatePins(pins: Record<string, string>) {
  const normalized: Record<string, string> = {};

  for (const [rawPin, rawState] of Object.entries(pins)) {
    const pin = rawPin.trim().toLowerCase();
    const state = rawState.trim().toLowerCase();

    if (!ALLOWED_PINS.has(pin)) {
      return {
        ok: false as const,
        error: "VALIDATION_ERROR",
        message: `Invalid pin ${rawPin}. Allowed pins: d0-d8.`,
      };
    }

    if (!ALLOWED_STATES.has(state)) {
      return {
        ok: false as const,
        error: "VALIDATION_ERROR",
        message: `Invalid state ${rawState} for ${rawPin}. Allowed states: on, off, high, low.`,
      };
    }

    normalized[pin] = state;
  }

  if (Object.keys(normalized).length === 0) {
    return {
      ok: false as const,
      error: "VALIDATION_ERROR",
      message: "pins must include at least one pin state.",
    };
  }

  return {
    ok: true as const,
    pins: normalized,
  };
}

export const applianceRoutes = new Elysia({
  prefix: "/appliances",
  detail: {
    tags: ["appliances"],
  },
}).post(
  "/control",
  async ({ body, set }) => {
    if (APPLIANCE_CONTROL_PASSWORD && body.password !== APPLIANCE_CONTROL_PASSWORD) {
      set.status = 401;
      return {
        error: "UNAUTHORIZED",
        message: "Invalid appliance control password.",
      };
    }

    const normalized = normalizeAndValidatePins(body.pins);
    if (!normalized.ok) {
      set.status = 400;
      return {
        error: normalized.error,
        message: normalized.message,
      };
    }

    const mqttPayload = JSON.stringify({
      password: body.password,
      pins: normalized.pins,
    });

    try {
      await publishControlMessage(mqttPayload);

      logger.info(
        {
          topic: APPLIANCE_MQTT_CONTROL_TOPIC,
          pinsUpdated: Object.keys(normalized.pins),
        },
        "appliance control payload published",
      );

      return {
        success: true,
        message: "Control commands sent successfully",
        topic: APPLIANCE_MQTT_CONTROL_TOPIC,
        pinsUpdated: Object.keys(normalized.pins),
      };
    } catch (error) {
      logger.error({ error, topic: APPLIANCE_MQTT_CONTROL_TOPIC }, "failed to publish appliance control payload");
      set.status = 502;
      return {
        error: "MQTT_PUBLISH_FAILED",
        message: "Failed to publish appliance control payload to MQTT.",
      };
    }
  },
  {
    body: controlBodySchema,
    response: {
      200: controlSuccessSchema,
      400: controlErrorSchema,
      401: controlErrorSchema,
      502: controlErrorSchema,
    },
  },
);
