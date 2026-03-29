import { TelegramHubClient } from "@/components/telegram/telegram-hub-client";
import { safeTelegramServerCall, serializeTelegramError, telegramServer } from "@/lib/telegram/server";

export const dynamic = "force-dynamic";

type MessagingPageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function MessagingPage({ searchParams }: MessagingPageProps) {
  await searchParams;
  const authResult = await safeTelegramServerCall(() => telegramServer.getAuthStatus());
  const contactsResult =
    authResult.data && !authResult.error
      ? await safeTelegramServerCall(() => telegramServer.listContacts())
      : { data: null, error: null };
  const chatsResult =
    authResult.data?.authState === "authenticated"
      ? await safeTelegramServerCall(() => telegramServer.listChats())
      : { data: null, error: null };

  const contacts = contactsResult.data ?? [];
  const chats = chatsResult.data ?? [];
  const activeContacts = contacts.filter((contact) => contact.isActive);

  return (
    <TelegramHubClient
      initialAuthStatus={authResult.data}
      initialError={serializeTelegramError(authResult.error ?? contactsResult.error ?? chatsResult.error)}
      counts={{
        activeContacts: activeContacts.length,
        mappedChats: chats.length,
        unreadChats: chats.reduce((total, chat) => total + (chat.unreadCount ?? 0), 0),
      }}
    />
  );
}
