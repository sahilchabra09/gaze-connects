import { TelegramConnectClient } from "@/components/telegram/telegram-connect-client";
import { safeTelegramServerCall, serializeTelegramError, telegramServer } from "@/lib/telegram/server";

export const dynamic = "force-dynamic";

export default async function MessagingConnectPage() {
  const authResult = await safeTelegramServerCall(() => telegramServer.getAuthStatus());

  return (
    <TelegramConnectClient
      initialAuthStatus={authResult.data}
      initialError={serializeTelegramError(authResult.error)}
    />
  );
}
