export type AppliancePinName = "d0" | "d1" | "d2" | "d3" | "d4" | "d5" | "d6" | "d7" | "d8";

export type AppliancePinState = "on" | "off";

export type ApplianceControlPayload = {
  pins: Record<AppliancePinName, AppliancePinState>;
  password: string;
};

export type ApplianceControlSuccess = {
  success: boolean;
  message: string;
  topic: string;
  pinsUpdated: string[];
};

export type ApplianceApiErrorPayload = {
  error?: string;
  message?: string;
};

export class ApplianceRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApplianceRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isApplianceRequestError(error: unknown): error is ApplianceRequestError {
  return error instanceof ApplianceRequestError;
}
