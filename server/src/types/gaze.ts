export type GazeCoreTokenResponse = {
  token: string;
  uuid: string;
  expiresAt: string;
  expiresInSeconds: number;
  websocketUrl?: string;
};

export type GazeCoreGyroSnapshotResponse = {
  uuid: string;
  snapshot: unknown;
};

export type UpstreamErrorPayload = {
  error?: unknown;
  message?: unknown;
};

export type GazeCoreTokenResponseCandidate = {
  token?: unknown;
  uuid?: unknown;
  expiresAt?: unknown;
  expiresInSeconds?: unknown;
  websocketUrl?: unknown;
};

export type GazeCoreGyroSnapshotResponseCandidate = {
  uuid?: unknown;
  snapshot?: unknown;
};
