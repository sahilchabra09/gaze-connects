import { TelegramChatsClient } from "@/components/telegram/telegram-chats-client";
import { safeTelegramServerCall, serializeTelegramError, telegramServer } from "@/lib/telegram/server";

export const dynamic = "force-dynamic";

type MessagingChatsPageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function MessagingChatsPage({ searchParams }: MessagingChatsPageProps) {
  const { page } = await searchParams;
  const authResult = await safeTelegramServerCall(() => telegramServer.getAuthStatus());
  const contactsResult =
    authResult.data && !authResult.error
      ? await safeTelegramServerCall(() => telegramServer.listContacts())
      : { data: null, error: null };
  const chatsResult =
    authResult.data?.authState === "authenticated"
      ? await safeTelegramServerCall(() => telegramServer.listChats())
      : { data: null, error: null };

  return (
    <TelegramChatsClient
      initialAuthStatus={authResult.data}
      initialContacts={contactsResult.data ?? []}
      initialChats={chatsResult.data ?? []}
      initialPage={Math.max(1, Number(page) || 1)}
      initialError={serializeTelegramError(authResult.error ?? contactsResult.error)}
      paginationBasePath="/messaging/chats"
      firstPageBackHref="/messaging"
      firstPageBackSubtitle="Return to messaging hub."
    />
  );
}
