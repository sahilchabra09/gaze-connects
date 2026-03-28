import { NecessityGridClient } from "@/components/necessity/necessity-grid-client";
import {
  necessityServer,
  safeNecessityServerCall,
  serializeNecessityError,
} from "@/lib/necessity/server";

export const dynamic = "force-dynamic";

export default async function NecessityPage() {
  const activeResult = await safeNecessityServerCall(() => necessityServer.listActive());

  return (
    <NecessityGridClient
      initialNecessities={activeResult.data ?? []}
      initialError={serializeNecessityError(activeResult.error)}
    />
  );
}

