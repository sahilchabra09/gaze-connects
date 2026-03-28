import { TelegramContactsClient } from "@/components/telegram/telegram-contacts-client";
import { safeTelegramServerCall, serializeTelegramError, telegramServer } from "@/lib/telegram/server";

export const dynamic = "force-dynamic";

export default async function MessagingContactsPage() {
  const authResult = await safeTelegramServerCall(() => telegramServer.getAuthStatus());
  const contactsResult =
    authResult.data && !authResult.error
      ? await safeTelegramServerCall(() => telegramServer.listContacts())
      : { data: null, error: null };

  return (
    <TelegramContactsClient
      initialAuthStatus={authResult.data}
      initialContacts={contactsResult.data ?? []}
      initialError={serializeTelegramError(authResult.error ?? contactsResult.error)}
    />
  );
}
