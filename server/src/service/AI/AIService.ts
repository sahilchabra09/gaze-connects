import { createGroq } from "@ai-sdk/groq";
import { generateText, jsonSchema, Output, stepCountIs } from "ai";

type KnowledgeBaseChunk =
  | string
  | {
    content?: string;
    text?: string;
    chunk?: string;
    chunk_content?: string;
    chunkText?: string;
    summary?: string;
  };

type KnowledgeBaseDocument = {
  summary?: string;
  chunks?: Array<
    | string
    | {
      content?: string;
      text?: string;
      chunk?: string;
      chunk_content?: string;
      chunkText?: string;
      summary?: string;
    }
    | {
      page?: number;
      content?: string;
      text?: string;
      chunk?: string;
      chunk_content?: string;
      chunkText?: string;
      summary?: string;
    }
  >;
};

function extractChunkText(chunk: KnowledgeBaseChunk): string {
  return typeof chunk === "string"
    ? chunk
    : chunk.content ?? chunk.text ?? chunk.chunk ?? chunk.chunk_content ?? chunk.chunkText ?? chunk.summary ?? "";
}

function flattenChunkGroups(groups: Array<string | { chunks?: KnowledgeBaseChunk[] } | KnowledgeBaseChunk>): KnowledgeBaseChunk[] {
  const flattened: KnowledgeBaseChunk[] = [];

  for (const group of groups) {
    if (typeof group === "string") {
      flattened.push(group);
      continue;
    }

    if ("chunks" in group) {
      if (Array.isArray(group.chunks)) {
        flattened.push(...group.chunks);
      }
      continue;
    }

    flattened.push(group as KnowledgeBaseChunk);
  }

  return flattened;
}

export async function AIService<TStructuredOutput = string>({
  query,
  systemPrompt,
  model = "llama-3.3-70b-versatile",
  chunkCount = 15,
  knowledgeBaseQuery,
  structuredOutput,
}: {
  query: string;
  systemPrompt: string;
  model?: string;
  chunkCount?: number;
  knowledgeBaseQuery?: string;
  structuredOutput?: {
    schema: Record<string, unknown>;
    name?: string;
    description?: string;
  };
}): Promise<TStructuredOutput | string> {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  const autosageApiKey = process.env.AUTOSAGE_API_KEY?.trim();
  const knowledgeBaseId = "6adea869-2afc-4f96-94f4-7d6be100133d";
  const structuredOutputModel =
    process.env.GROQ_STRUCTURED_OUTPUT_MODEL?.trim() ||
    (model === "llama-3.3-70b-versatile" ? "openai/gpt-oss-20b" : model);

  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  if (!autosageApiKey) {
    throw new Error("AUTOSAGE_API_KEY is not configured");
  }

  const groq = createGroq({ apiKey: groqApiKey });
  const fetchKnowledgeBaseChunks = async (knowledgeQuery: string) => {
    const url = new URL("https://alpha-api.autosage.ai/api/v1/chats/fast-raw-query");

    url.searchParams.set("api_key", autosageApiKey);
    url.searchParams.set("apiKey", autosageApiKey);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": autosageApiKey,
        Authorization: `Bearer ${autosageApiKey}`,
      },
      body: JSON.stringify({
        knowledge_base_id: knowledgeBaseId,
        content: knowledgeQuery,
        model,
        chunk_count: chunkCount,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Knowledge base request failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`,
      );
    }

    const rawText = await response.text();

    if (!rawText.trim()) {
      return [] as string[];
    }

    const payload = JSON.parse(rawText) as
      | {
        success?: boolean;
        chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
        grouped_chunks?: Array<
          | string
          | {
            content?: string;
            text?: string;
            chunk?: string;
            chunk_content?: string;
            chunkText?: string;
            chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
          }
        >;
        groups?: Array<{
          chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
        }>;
        data?:
          | Array<{
            chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
            grouped_chunks?: Array<
              | string
              | {
                content?: string;
                text?: string;
                chunk?: string;
                chunk_content?: string;
                chunkText?: string;
                chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
              }
            >;
            documents?: KnowledgeBaseDocument[];
          }>
          | {
            chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
            grouped_chunks?: Array<
              | string
              | {
                content?: string;
                text?: string;
                chunk?: string;
                chunk_content?: string;
                chunkText?: string;
                chunks?: Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;
              }
            >;
            documents?: KnowledgeBaseDocument[];
            query?: string;
            userModel?: string;
            found?: number;
          };
        documents?: KnowledgeBaseDocument[];
      }
      | Array<string | { content?: string; text?: string; chunk?: string; chunk_content?: string; chunkText?: string }>;

    const extractDocuments = (documents?: KnowledgeBaseDocument[]): KnowledgeBaseChunk[] =>
      (documents ?? []).flatMap((document) => [
        ...(document.summary ? [document.summary] : []),
        ...(document.chunks ?? []),
      ]);

    const groupedChunks: KnowledgeBaseChunk[] = Array.isArray(payload)
      ? payload
      : [
        ...(payload.chunks ?? []),
        ...flattenChunkGroups(payload.grouped_chunks ?? []),
        ...(Array.isArray(payload.data)
          ? payload.data.flatMap((group) => [
            ...(group.chunks ?? []),
            ...flattenChunkGroups(group.grouped_chunks ?? []),
            ...extractDocuments(group.documents),
          ])
          : [
            ...(payload.data?.chunks ?? []),
            ...flattenChunkGroups(payload.data?.grouped_chunks ?? []),
            ...extractDocuments(payload.data?.documents),
          ]),
        ...(payload.groups ?? []).flatMap((group) => group.chunks ?? []),
        ...extractDocuments(payload.documents),
      ];

    return groupedChunks
      .map((chunk) => extractChunkText(chunk))
      .filter(Boolean);
  };

  const commonGenerateOptions = {
    model: groq(model),
    system: `${systemPrompt}

Always use KnowledgeBaseTool before answering.
Treat the KnowledgeBaseTool payload as the knowledge base for this request.
Answer only from the returned knowledge base chunks.
If the knowledge base does not contain enough information, say that clearly.`,
    prompt: query,
    tools: {
      KnowledgeBaseTool: {
        description:
          "Fetch up to 15 relevant knowledge base chunks for the current request. Pass a focused content query that describes what person, profile, entity, or context should be fetched from the knowledge base.",
        inputSchema: jsonSchema<{ query: string }>({
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "A focused knowledge base fetch query describing what person, profile, entity, facts, or context are needed for the current task.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        }),
        execute: async ({ query }: { query: string }) => ({
          chunks: await fetchKnowledgeBaseChunks(query),
        }),
      },
    },
    stopWhen: stepCountIs(2),
    prepareStep: ({ stepNumber }: { stepNumber: number }) =>
      stepNumber === 0
        ? {
            toolChoice: { type: "tool" as const, toolName: "KnowledgeBaseTool" as const },
            activeTools: ["KnowledgeBaseTool"] as "KnowledgeBaseTool"[],
          }
        : {
            toolChoice: "none" as const,
          },
  };

  if (structuredOutput) {
    const knowledgeBaseChunks = await fetchKnowledgeBaseChunks(knowledgeBaseQuery?.trim() || query);
    const { output } = await generateText({
      model: groq(structuredOutputModel),
      system: `${systemPrompt}

Use only the knowledge base context below plus the user query.
If the knowledge base context is insufficient, return the best safe result allowed by the requested schema without inventing facts.`,
      prompt: `${query}

Knowledge base context:
${knowledgeBaseChunks.length ? knowledgeBaseChunks.map((chunk, index) => `${index + 1}. ${chunk}`).join("\n") : "No knowledge base chunks were returned."}`,
      output: Output.object<TStructuredOutput>({
        schema: jsonSchema<TStructuredOutput>(structuredOutput.schema as never),
        name: structuredOutput.name,
        description: structuredOutput.description,
      }),
    });

    return output;
  }

  const { text } = await generateText(commonGenerateOptions);
  return text;
}
