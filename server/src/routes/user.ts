import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema";
import { auth } from "../lib/auth";
import { authSchemas } from "../lib/schemas";
import type { UserProfileChanges, UserResponse, UserRow } from "../types/user";

const updateProfileBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  image: t.Optional(t.String()),
});

const hardwarePasswordBody = t.Object({
  password: t.String({ minLength: 6 }),
});

const hardwarePasswordStatusResponse = t.Object({
  isSet: t.Boolean(),
});

const hardwarePasswordUpdatedResponse = t.Object({
  ok: t.Boolean(),
  message: t.String(),
});

const errorResponse = (error: string, message: string) => ({ error, message });

const toUserResponse = (row: UserRow): UserResponse => ({
  id: row.id,
  email: row.email,
  name: row.name,
  image: row.image,
  emailVerified: row.emailVerified,
  createdAt: row.createdAt.toISOString(),
});

async function resolveSessionUser(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  return sessionData?.user ?? null;
}

export const userRoutes = new Elysia({
  prefix: "/users",
  detail: {
    tags: ["Users"],
  },
})
  .get(
    "/me",
    async ({ request, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const result = await db.select().from(user).where(eq(user.id, sessionUser.id));
      const found = result[0];
      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      response: {
        200: authSchemas.user,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .patch(
    "/me",
    async ({ request, body, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const changes: UserProfileChanges = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.image !== undefined) changes.image = body.image;

      const updated =
        Object.keys(changes).length > 0
          ? await db
              .update(user)
              .set({ ...changes, updatedAt: new Date() })
              .where(eq(user.id, sessionUser.id))
              .returning()
          : await db.select().from(user).where(eq(user.id, sessionUser.id));

      const found = updated[0];
      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      body: updateProfileBody,
      response: {
        200: authSchemas.user,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .get(
    "/me/hardware-password",
    async ({ request, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      const result = await db
        .select({ hardwarePasswordHash: user.hardwarePasswordHash })
        .from(user)
        .where(eq(user.id, sessionUser.id))
        .limit(1);

      const found = result[0];
      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return {
        isSet: Boolean(found.hardwarePasswordHash),
      };
    },
    {
      response: {
        200: hardwarePasswordStatusResponse,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .post(
    "/me/hardware-password",
    async ({ request, body, set }) => {
      const sessionUser = await resolveSessionUser(request);
      if (!sessionUser) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Sign in required");
      }

      if (!body.password.trim()) {
        set.status = 400;
        return errorResponse("VALIDATION_ERROR", "Hardware password cannot be empty");
      }

      const passwordHash = await Bun.password.hash(body.password);
      const updated = await db
        .update(user)
        .set({
          hardwarePasswordHash: passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(user.id, sessionUser.id))
        .returning({ id: user.id });

      if (!updated[0]) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return {
        ok: true,
        message: "Hardware password saved",
      };
    },
    {
      body: hardwarePasswordBody,
      response: {
        200: hardwarePasswordUpdatedResponse,
        400: authSchemas.error,
        401: authSchemas.error,
        404: authSchemas.error,
      },
    }
  )
  .get(
    "/:id",
    async ({ params: { id }, set }) => {
      const result = await db.select().from(user).where(eq(user.id, id));
      const found = result[0];

      if (!found) {
        set.status = 404;
        return errorResponse("NOT_FOUND", "User not found");
      }

      return toUserResponse(found);
    },
    {
      response: {
        200: authSchemas.user,
        404: authSchemas.error,
      },
    }
  );
