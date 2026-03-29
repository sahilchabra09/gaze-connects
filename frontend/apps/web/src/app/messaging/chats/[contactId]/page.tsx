import { TelegramChatDetailClient } from "@/components/telegram/telegram-chat-detail-client";
import { safeTelegramServerCall, serializeTelegramError, telegramServer } from "@/lib/telegram/server";

export const dynamic = "force-dynamic";

type MessagingChatDetailPageProps = {
  params: Promise<{ contactId: string }>;
};

export default async function MessagingChatDetailPage({ params }: MessagingChatDetailPageProps) {
  const { contactId } = await params;
  const authResult = await safeTelegramServerCall(() => telegramServer.getAuthStatus());
  const openChatResult =
    authResult.data && !authResult.error
      ? await safeTelegramServerCall(() => telegramServer.openChat(contactId))
      : { data: null, error: null };
  const replyOptionsResult =
    openChatResult.data?.chat.chatId
      ? await safeTelegramServerCall(() => telegramServer.getReplyOptions(openChatResult.data.chat.chatId))
      : { data: null, error: null };

  return (
    <TelegramChatDetailClient
      contactId={contactId}
      initialAuthStatus={authResult.data}
      initialOpenChat={openChatResult.data}
      initialReplyOptions={replyOptionsResult.data ?? []}
      initialError={serializeTelegramError(authResult.error ?? openChatResult.error ?? replyOptionsResult.error)}
    />
  );
}
