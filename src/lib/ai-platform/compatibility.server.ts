import type {
  ChatCompatibilityResponse,
  ChatMessage,
  ChatTool,
  ResponsesFunctionTool,
  ResponsesResult,
} from "./types";

export function chatMessagesToResponsesInput(messages: ChatMessage[]): {
  instructions?: string;
  input: Array<Record<string, unknown>>;
} {
  const system = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .map((message) => ({ role: message.role, content: message.content }));
  return { instructions: system || undefined, input };
}

export function chatToolsToResponsesTools(tools: ChatTool[] | undefined): ResponsesFunctionTool[] | undefined {
  return tools?.map(({ function: tool }) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}

export function responsesResultToChatCompletion(result: ResponsesResult): ChatCompatibilityResponse {
  const toolCalls = result.toolCalls.map((call) => ({
    id: call.callId,
    type: "function" as const,
    function: { name: call.name, arguments: call.arguments },
  }));
  return {
    id: result.id,
    object: "chat.completion",
    model: result.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.outputText || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
    }],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
  };
}
