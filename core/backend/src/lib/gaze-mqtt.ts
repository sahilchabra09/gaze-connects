import { randomUUID } from "node:crypto"
import mqtt, { type MqttClient } from "mqtt"
import { buildGyroTopic, gazeConfig } from "./gaze-config"
import type { GyroReading } from "./gaze-types"
import type { GyroPayloadRecord, GyroWaiter, TopicSubscription } from "../types/gaze-mqtt"

function parseGyroPayload(payload: string): Pick<GyroReading, "x" | "y" | "z" | "yaw" | "pitch" | "roll"> | null {
  const raw = payload.trim()
  if (!raw) return null

  const parts = raw.split(",").map((part) => part.trim())
  if (parts.length === 3) {
    const [yaw, pitch, roll] = parts.map(Number)
    if ([yaw, pitch, roll].every((value) => Number.isFinite(value))) {
      return { x: yaw, y: pitch, z: roll, yaw, pitch, roll }
    }
  }

  try {
    const decoded = JSON.parse(raw) as GyroPayloadRecord
    const x = Number(decoded.x ?? decoded.yaw)
    const y = Number(decoded.y ?? decoded.pitch)
    const z = Number(decoded.z ?? decoded.roll)
    if ([x, y, z].every((value) => Number.isFinite(value))) {
      return { x, y, z, yaw: x, pitch: y, roll: z }
    }
  } catch {
    return null
  }

  return null
}

class GazeMqttBridge {
  private client: MqttClient | null = null
  private connected = false
  private lastErrorLogAt = 0
  private readonly latestReadings = new Map<string, GyroReading>()
  private readonly subscriptionsByUuid = new Map<string, TopicSubscription>()
  private readonly uuidByTopic = new Map<string, string>()
  private readonly waitersByUuid = new Map<string, Set<GyroWaiter>>()

  private buildZeroGyroReading(topic?: string): GyroReading {
    return {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      timestamp: Date.now(),
      ...(topic ? { topic } : {}),
    }
  }

  private ensureClient() {
    if (this.client) return this.client

    const client = mqtt.connect(gazeConfig.mqttBrokerUrl, {
      clientId: `${gazeConfig.mqttClientIdPrefix}-${randomUUID().slice(0, 8)}`,
      reconnectPeriod: 2000,
      keepalive: 60,
      connectTimeout: 5000,
    })

    client.on("connect", () => {
      this.connected = true
      for (const subscription of this.subscriptionsByUuid.values()) {
        client.subscribe(subscription.topic)
      }
    })

    client.on("reconnect", () => {
      this.connected = false
    })

    client.on("close", () => {
      this.connected = false
    })

    client.on("error", (error) => {
      const now = Date.now()
      if (now - this.lastErrorLogAt >= 15000) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn("[MQTT] bridge unavailable, running with gyro fallback:", message)
        this.lastErrorLogAt = now
      }
    })

    client.on("message", (topic, payloadBuffer) => {
      const uuid = this.uuidByTopic.get(topic)
      if (!uuid) return

      const parsed = parseGyroPayload(payloadBuffer.toString("utf8"))
      if (!parsed) return

      const reading: GyroReading = {
        ...parsed,
        topic,
        timestamp: Date.now(),
      }

      this.latestReadings.set(uuid, reading)

      const waiters = this.waitersByUuid.get(uuid)
      if (!waiters || waiters.size === 0) return

      for (const waiter of [...waiters]) {
        if (reading.timestamp < waiter.minTimestamp) continue

        clearTimeout(waiter.timeout)
        waiters.delete(waiter)
        waiter.resolve(reading)
      }

      if (waiters.size === 0) {
        this.waitersByUuid.delete(uuid)
      }
    })

    this.client = client
    return client
  }

  async retainSubscription(uuid: string) {
    const normalizedUuid = uuid.trim()
    if (!normalizedUuid) {
      throw new Error("UUID is required to subscribe to gyro telemetry.")
    }

    const existing = this.subscriptionsByUuid.get(normalizedUuid)
    if (existing) {
      existing.refCount += 1
      return () => this.releaseSubscription(normalizedUuid)
    }

    const topic = buildGyroTopic(normalizedUuid)
    const subscription: TopicSubscription = {
      uuid: normalizedUuid,
      topic,
      refCount: 1,
    }

    this.subscriptionsByUuid.set(normalizedUuid, subscription)
    this.uuidByTopic.set(topic, normalizedUuid)

    const client = this.ensureClient()
    if (this.connected) {
      client.subscribe(topic)
    }

    return () => this.releaseSubscription(normalizedUuid)
  }

  private releaseSubscription(uuid: string) {
    const subscription = this.subscriptionsByUuid.get(uuid)
    if (!subscription) return

    subscription.refCount -= 1
    if (subscription.refCount > 0) return

    this.subscriptionsByUuid.delete(uuid)
    this.uuidByTopic.delete(subscription.topic)
    this.client?.unsubscribe(subscription.topic)
  }

  latestReading(uuid: string) {
    return this.latestReadings.get(uuid.trim()) ?? null
  }

  async awaitSnapshot(uuid: string, timeoutMs: number) {
    const normalizedUuid = uuid.trim()
    const requestTimestamp = Date.now()
    const release = await this.retainSubscription(normalizedUuid)
    const topic = buildGyroTopic(normalizedUuid)

    try {
      const latest = this.latestReading(normalizedUuid)
      if (latest && requestTimestamp - latest.timestamp <= 150) {
        return latest
      }

      const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000

      return await new Promise<GyroReading>((resolve) => {
        const waiters = this.waitersByUuid.get(normalizedUuid) ?? new Set<GyroWaiter>()
        const waiter: GyroWaiter = {
          minTimestamp: requestTimestamp,
          resolve,
          reject: () => {},
          timeout: setTimeout(() => {
            waiters.delete(waiter)
            if (waiters.size === 0) {
              this.waitersByUuid.delete(normalizedUuid)
            }
            resolve(this.buildZeroGyroReading(topic))
          }, safeTimeoutMs),
        }

        waiters.add(waiter)
        this.waitersByUuid.set(normalizedUuid, waiters)
      })
    } catch {
      return this.buildZeroGyroReading(topic)
    } finally {
      release()
    }
  }

  close() {
    this.connected = false
    for (const waiters of this.waitersByUuid.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout)
        waiter.resolve(this.buildZeroGyroReading())
      }
    }

    this.waitersByUuid.clear()
    this.latestReadings.clear()
    this.subscriptionsByUuid.clear()
    this.uuidByTopic.clear()

    this.client?.end(true)
    this.client = null
  }
}

export const gazeMqttBridge = new GazeMqttBridge()
