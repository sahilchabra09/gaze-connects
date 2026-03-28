export type MiddlewareErrorResponse = {
  error: {
    message: string;
  };
};

export type BetterAuthApiEndpoint = {
  path?: string;
  options?: {
    method?: string | string[];
    metadata?: {
      openapi?: {
        description?: string;
        operationId?: string;
      };
    };
  };
};

export type BetterAuthApiRecord = Record<string, BetterAuthApiEndpoint>;

export type EmailRequestBody = {
  email?: string;
};

export type AuthHandlerContext = {
  request: Request;
};

export type AuthHandler = (context: AuthHandlerContext) => unknown;

export type UserIdLookupResult = {
  id: string;
};

export type BetterAuthRouteDetail = {
  tags: string[];
  summary: string;
  description?: string;
};

export type BetterAuthRouteRegistrar = {
  get: (
    path: string,
    handler: AuthHandler,
    options: { detail: BetterAuthRouteDetail }
  ) => unknown;
  post: (
    path: string,
    handler: AuthHandler,
    options: { detail: BetterAuthRouteDetail }
  ) => unknown;
};
