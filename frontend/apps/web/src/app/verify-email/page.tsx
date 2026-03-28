import { VerifyEmailContent } from "./verify-email-content";

type VerifyEmailPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;

  return <VerifyEmailContent token={token ?? null} />;
}
