import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_EXTERNAL_API_CONFIG,
  type BridgeFromExtensionMessage,
  type BridgeFromExtensionToolEvent,
  type BridgeToExtensionChatRequest,
  type ExternalApiConfig,
  type ExternalApiToolDefinition,
} from '../core/external-api/contracts';
import {
  convertClientToolsToDescriptors,
  createExternalApiService,
  type ExternalApiPromptBuildRequest,
} from '../core/external-api/service';
import type {
  OfficialDeepSeekCallbacks,
  SubmitOfficialDeepSeekInput,
} from '../core/deepseek/official-api';
import { renderToolSchemas } from '../core/prompt';
import type { ToolCall, ToolDescriptor } from '../core/tool/types';
import { getMultimodalSettingsStatus } from '../core/multimodal/settings';
import type { MultimodalMediaAnalyzeRequest } from '../core/multimodal/media';

vi.mock('../core/multimodal/settings', () => ({
  getMultimodalSettingsStatus: vi.fn(),
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateServerMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('External API Service Bridge', () => {
  let activeMockSocket: MockWebSocket | null = null;
  let mockConfig: ExternalApiConfig;

  beforeEach(() => {
    mockConfig = { ...DEFAULT_EXTERNAL_API_CONFIG };
    vi.mocked(getMultimodalSettingsStatus).mockResolvedValue({
      openaiConfigured: false,
      geminiConfigured: false,
      openaiImageModel: '',
      geminiVideoModel: '',
      openaiBaseUrl: '',
      geminiBaseUrl: '',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createTestDependencies(overrides = {}) {
    return {
      getConfig: vi.fn(async () => mockConfig),
      getDeepSeekApiKey: vi.fn(async () => 'sk-mock-key'),
      loadClientHeaders: vi.fn(async () => ({ authorization: 'Bearer token-123' })),
      createChatSession: vi.fn(async () => 'session-abc-123'),
      createPowHeaders: vi.fn(async () => ({ 'x-pow': 'solved' })),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        callbacks.onReasoningChunk?.('Thinking web...', 'Thinking web...');
        callbacks.onTextChunk?.('Hello from web!', 'Hello from web!');
        return {
          assistantText: 'Hello from web!',
          finished: true,
          requestMessageId: 1,
          responseMessageId: 2,
        };
      }),
      submitOfficialPrompt: vi.fn(async (input, callbacks) => {
        callbacks.onReasoningChunk?.('Thinking official...', 'Thinking official...');
        callbacks.onTextChunk?.('Hello from official API!', 'Hello from official API!');
        return {
          assistantText: 'Hello from official API!',
          reasoningText: 'Thinking official...',
          finished: true,
        };
      }),
      executeToolCall: vi.fn(async () => ({ ok: true, summary: 'ok', detail: 'ok' })),
      buildPrompt: vi.fn(async ({ prompt }) => ({ augmented: prompt, enabledDescriptors: [] })),
      WebSocketImpl: class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          activeMockSocket = this;
        }
      } as unknown as typeof WebSocket,
      ...overrides,
    };
  }

  it('starts and sends HANDSHAKE_ACK upon WebSocket connection', async () => {
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(activeMockSocket).not.toBeNull();
    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const handshakeAck = sent.find((m) => m.type === 'HANDSHAKE_ACK');
    expect(handshakeAck).toBeDefined();
    expect(handshakeAck?.status).toBe('ok');
    expect(handshakeAck?.has_official_api_key).toBe(true);
    expect(handshakeAck?.has_deepseek_auth).toBe(true);

    service.stop();
  });

  it('processes CHAT_COMPLETION_REQUEST via official API when preferred or available', async () => {
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'chatcmpl-test-1',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello!' },
      ],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitOfficialPrompt).toHaveBeenCalledTimes(1);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const chunks = sent.filter((m) => m.type === 'CHAT_CHUNK');
    const done = sent.find((m) => m.type === 'CHAT_DONE');

    expect(chunks.length).toBeGreaterThan(0);
    expect(done).toBeDefined();
    expect(done?.id).toBe('chatcmpl-test-1');
    expect(done?.full_text).toBe('Hello from official API!');

    service.stop();
  });

  it('processes CHAT_COMPLETION_REQUEST via DeepSeek Web session when official API key is null', async () => {
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'chatcmpl-web-1',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Web prompt test' }],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.createChatSession).toHaveBeenCalledTimes(1);
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(1);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const done = sent.find((m) => m.type === 'CHAT_DONE');

    expect(done).toBeDefined();
    expect(done?.id).toBe('chatcmpl-web-1');
    expect(done?.full_text).toBe('Hello from web!');

    service.stop();
  });

  it('handles CANCEL_REQUEST and aborts execution gracefully', async () => {
    let capturedSignal: AbortSignal | null = null;
    const deps = createTestDependencies({
      submitOfficialPrompt: vi.fn(async (input, callbacks, signal) => {
        capturedSignal = signal;
        await new Promise((r) => setTimeout(r, 100));
        return {
          assistantText: 'Finished late',
          reasoningText: '',
          finished: true,
        };
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'chatcmpl-cancel-me',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Slow message' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    activeMockSocket!.simulateServerMessage({
      type: 'CANCEL_REQUEST',
      id: 'chatcmpl-cancel-me',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(capturedSignal!.aborted).toBe(true);

    service.stop();
  });

  it('synchronizes authorized API keys when config is updated', async () => {
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    await service.handleConfigUpdated({
      ...mockConfig,
      apiKeys: [
        {
          id: 'k1',
          name: 'Key 1',
          key: 'sk-dspp-12345',
          keyPrefix: 'sk-dspp...2345',
          createdAt: Date.now(),
          lastUsedAt: null,
          usageCount: 0,
          enabled: true,
        },
      ],
    });

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const syncMsg = sent.find((m) => m.type === 'SYNC_API_KEYS');
    expect(syncMsg).toBeDefined();
    expect((syncMsg as any)?.keys).toEqual(['sk-dspp-12345']);

    service.stop();
  });

  it('reuses web chat session across multi-turn requests instead of creating a new session', async () => {
    let promptCallCount = 0;
    const receivedInputs: any[] = [];
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        promptCallCount++;
        receivedInputs.push(input);
        callbacks.onTextChunk?.(`Response ${promptCallCount}`, `Response ${promptCallCount}`);
        return {
          assistantText: `Response ${promptCallCount}`,
          finished: true,
          requestMessageId: promptCallCount * 2 - 1,
          responseMessageId: promptCallCount * 2,
        };
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    // Turn 1
    const request1: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-turn-1',
      session_id: 'conversation-thread-100',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are an expert Python coder.' },
        { role: 'user', content: 'Write hello world' },
      ],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request1);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.createChatSession).toHaveBeenCalledTimes(1);
    expect(receivedInputs[0].chatSessionId).toBe('session-abc-123');
    expect(receivedInputs[0].parentMessageId).toBeNull();
    expect(receivedInputs[0].prompt).toContain('[System Instruction]:\nYou are an expert Python coder.');
    expect(receivedInputs[0].prompt).toContain('Write hello world');

    // Turn 2 in same conversation thread
    const request2: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-turn-2',
      session_id: 'conversation-thread-100',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are an expert Python coder.' },
        { role: 'user', content: 'Write hello world' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Now add docstrings' },
      ],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request2);
    await new Promise((r) => setTimeout(r, 20));

    // Must NOT call createChatSession again!
    expect(deps.createChatSession).toHaveBeenCalledTimes(1);
    expect(receivedInputs[1].chatSessionId).toBe('session-abc-123');
    // Must advance parentMessageId to previous responseMessageId (2)
    expect(receivedInputs[1].parentMessageId).toBe(2);
    expect(receivedInputs[1].prompt).toBe('Now add docstrings');

    service.stop();
  });

  it('executes built-in extension tools (Skill / MCP / Shell) in multi-step agent loop', async () => {
    let callStep = 0;
    const executedTools: any[] = [];
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      executeToolCall: vi.fn(async (call) => {
        executedTools.push(call);
        return { ok: true, summary: 'Files listed', detail: 'Files: main.rs, Cargo.toml' };
      }),
      buildPrompt: vi.fn(async ({ prompt }) => ({
        augmented: prompt,
        enabledDescriptors: [
          {
            id: 'builtin:fs_list',
            name: 'fs_list',
            title: 'fs_list',
            invocationName: 'fs_list',
            provider: {
              kind: 'local',
              id: 'builtin',
              displayName: 'Built-in',
              transport: 'in_process',
            },
            description: 'List files in directory',
            inputSchema: { type: 'object', properties: {} },
            execution: { mode: 'auto', enabled: true, risk: 'low' },
          },
        ],
      })),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        callStep++;
        if (callStep === 1) {
          // Model invokes built-in tool via XML tag
          const toolXml = '<fs_list>{"path": "."}</fs_list>';
          callbacks.onTextChunk?.(toolXml, toolXml);
          return {
            assistantText: toolXml,
            finished: true,
            requestMessageId: 1,
            responseMessageId: 2,
          };
        } else {
          // Model finishes with answer
          const finalAnswer = 'The directory contains main.rs and Cargo.toml.';
          callbacks.onTextChunk?.(finalAnswer, finalAnswer);
          return {
            assistantText: finalAnswer,
            finished: true,
            requestMessageId: 3,
            responseMessageId: 4,
          };
        }
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-tool-loop',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'What files are here?' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.executeToolCall).toHaveBeenCalledTimes(1);
    expect(executedTools[0].name).toBe('fs_list');
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(2);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeDefined();
    expect(done?.finish_reason).toBe('stop');
    expect(done?.full_text).toContain('The directory contains main.rs and Cargo.toml.');

    service.stop();
  });

  it('supports OpenAI client-declared tools returning finish_reason: tool_calls', async () => {
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        const toolXml = '<get_weather>{"city": "Paris"}</get_weather>';
        callbacks.onTextChunk?.(toolXml, toolXml);
        return {
          assistantText: toolXml,
          finished: true,
          requestMessageId: 1,
          responseMessageId: 2,
        };
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-openai-tools',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Weather in Paris?' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
            },
          },
        },
      ],
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeDefined();
    expect(done?.finish_reason).toBe('tool_calls');
    expect(done?.tool_calls).toBeDefined();
    expect(done?.tool_calls?.length).toBe(1);
    expect(done?.tool_calls?.[0].function.name).toBe('get_weather');
    expect(done?.tool_calls?.[0].function.arguments).toContain('Paris');

    service.stop();
  });

  const clientWeatherTool: ExternalApiToolDefinition = {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
      },
    },
  };

  const fsListDescriptor: ToolDescriptor = {
    id: 'builtin:fs_list',
    name: 'fs_list',
    title: 'fs_list',
    invocationName: 'fs_list',
    provider: {
      kind: 'local',
      id: 'builtin',
      displayName: 'Built-in',
      transport: 'in_process',
    },
    description: 'List files in directory',
    inputSchema: { type: 'object', properties: {} },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };

  // Uses the real renderToolSchemas over client descriptors (the same pipeline
  // the background prompt builder runs) so assertions hit real rendered text.
  function createRenderingBuildPromptMock() {
    return vi.fn(async (request: ExternalApiPromptBuildRequest) => {
      const clientDescriptors = convertClientToolsToDescriptors(request.clientTools);
      let toolsContext = '';
      if (clientDescriptors.length > 0) {
        toolsContext = renderToolSchemas(clientDescriptors, 'en');
      }
      const prefix = toolsContext
        ? `[Available Tools & Functions]:\n${toolsContext}\n\n`
        : '';
      return { augmented: `${prefix}${request.prompt}`, enabledDescriptors: [] };
    });
  }

  it('official path triggers buildPrompt with clientTools and prepends rendered client tool schema', async () => {
    const buildPromptMock = createRenderingBuildPromptMock();
    const deps = createTestDependencies({ buildPrompt: buildPromptMock });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-official-tools',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Weather in Paris?' },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
      tools: [clientWeatherTool],
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitOfficialPrompt).toHaveBeenCalledTimes(1);
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isFirstMessage: true,
        clientTools: [clientWeatherTool],
      }),
    );

    const firstUserMessage = deps.submitOfficialPrompt.mock.calls[0][0].messages[0];
    expect(firstUserMessage.role).toBe('user');
    expect(firstUserMessage.content).toContain('[System Instruction]:\nYou are helpful');
    expect(firstUserMessage.content).toContain('### Tool get_weather');
    expect(firstUserMessage.content).toContain('<get_weather>');
    expect(firstUserMessage.content).toContain('Weather in Paris?');

    service.stop();
  });

  it('web path prompt contains rendered client tool schema', async () => {
    const buildPromptMock = createRenderingBuildPromptMock();
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      buildPrompt: buildPromptMock,
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-web-tools',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Weather in Paris?' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
      tools: [clientWeatherTool],
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(1);
    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isFirstMessage: true,
        clientTools: [clientWeatherTool],
      }),
    );

    const webPrompt = deps.submitWebPrompt.mock.calls[0][0].prompt;
    expect(webPrompt).toContain('### Tool get_weather');
    expect(webPrompt).toContain('<get_weather>');
    expect(webPrompt).toContain('Weather in Paris?');

    service.stop();
  });

  it('official path executes built-in tools via executeToolCall in a multi-step loop', async () => {
    let callStep = 0;
    const executedTools: ToolCall[] = [];
    const deps = createTestDependencies({
      getToolDescriptors: vi.fn(async () => [fsListDescriptor]),
      executeToolCall: vi.fn(async (call: ToolCall) => {
        executedTools.push(call);
        return { ok: true, summary: 'Files listed', detail: 'Files: main.rs, Cargo.toml' };
      }),
      submitOfficialPrompt: vi.fn(async (input: SubmitOfficialDeepSeekInput, callbacks: OfficialDeepSeekCallbacks) => {
        callStep++;
        if (callStep === 1) {
          const toolXml = '<fs_list>{"path": "."}</fs_list>';
          callbacks.onTextChunk?.(toolXml, toolXml);
          return { assistantText: toolXml, reasoningText: '', finished: true };
        }
        const finalAnswer = 'The directory contains main.rs and Cargo.toml.';
        callbacks.onTextChunk?.(finalAnswer, finalAnswer);
        return { assistantText: finalAnswer, reasoningText: '', finished: true };
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-official-loop',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'What files are in this directory?' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.executeToolCall).toHaveBeenCalledTimes(1);
    expect(executedTools[0].name).toBe('fs_list');
    expect(deps.submitOfficialPrompt).toHaveBeenCalledTimes(2);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const reasoningChunk = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'CHAT_CHUNK' }> =>
        m.type === 'CHAT_CHUNK' && (m.reasoning_delta ?? '').includes('[Executing fs_list...]'),
    );
    expect(reasoningChunk).toBeDefined();
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeDefined();
    expect(done?.finish_reason).toBe('stop');
    expect(done?.full_text).toContain('The directory contains main.rs and Cargo.toml.');

    service.stop();
  });

  it('official path sends CHAT_ERROR tool_execution_failed when built-in tool execution throws', async () => {
    const deps = createTestDependencies({
      getToolDescriptors: vi.fn(async () => [fsListDescriptor]),
      executeToolCall: vi.fn(async () => {
        throw new Error('tool boom');
      }),
      submitOfficialPrompt: vi.fn(async (input: SubmitOfficialDeepSeekInput, callbacks: OfficialDeepSeekCallbacks) => {
        const toolXml = '<fs_list>{"path": "."}</fs_list>';
        callbacks.onTextChunk?.(toolXml, toolXml);
        return { assistantText: toolXml, reasoningText: '', finished: true };
      }),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-official-fail',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'What files are in this directory?' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.submitOfficialPrompt).toHaveBeenCalledTimes(1);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const error = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'CHAT_ERROR' }> => m.type === 'CHAT_ERROR',
    );
    expect(error).toBeDefined();
    expect(error?.code).toBe('tool_execution_failed');
    expect(error?.error).toContain('tool boom');
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeUndefined();

    service.stop();
  });

  it('TOOL_EVENT bridge message type is part of the bridge contract', () => {
    const event: BridgeFromExtensionToolEvent = {
      type: 'TOOL_EVENT',
      id: 'tool-event-1',
      tool_name: 'get_weather',
      status: 'succeeded',
      result: 'sunny',
    };
    const bridgeMessage: BridgeFromExtensionMessage = event;
    expect(bridgeMessage.type).toBe('TOOL_EVENT');
    expect(bridgeMessage.tool_name).toBe('get_weather');
  });

  it('official path routes image_url media through the multimodal analysis dependency', async () => {
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const analyzeStub = vi.fn(async (request: MultimodalMediaAnalyzeRequest) => ({
      ok: true as const,
      analyses: [
        {
          id: 'images:external-media-image-0',
          kind: 'image' as const,
          media: [
            {
              id: 'external-media-image-0',
              kind: 'image' as const,
              name: 'image-0.png',
              mimeType: 'image/png',
              sizeBytes: 8,
            },
          ],
          result: { ok: true, summary: 'ok', output: { text: 'The image shows a red fox.' } },
        },
      ],
    }));
    vi.mocked(getMultimodalSettingsStatus).mockResolvedValue({
      openaiConfigured: true,
      geminiConfigured: false,
      openaiImageModel: 'gpt-4o-mini',
      geminiVideoModel: '',
      openaiBaseUrl: '',
      geminiBaseUrl: '',
    });
    const deps = createTestDependencies({ analyzeMultimodalMedia: analyzeStub });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-official-media',
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(analyzeStub).toHaveBeenCalledTimes(1);
    expect(analyzeStub).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'What is in this image?' }),
    );
    const receivedMedia = analyzeStub.mock.calls[0][0].media;
    expect(receivedMedia).toHaveLength(1);
    expect(receivedMedia[0]).toEqual(
      expect.objectContaining({
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: 8,
        dataUrl: imageDataUrl,
      }),
    );

    expect(deps.submitOfficialPrompt).toHaveBeenCalledTimes(1);
    const firstUserMessage = deps.submitOfficialPrompt.mock.calls[0][0].messages[0];
    expect(firstUserMessage.content).toContain('[DeepSeek++ automatic multimodal MCP analysis]');
    expect(firstUserMessage.content).toContain('The image shows a red fox.');
    expect(firstUserMessage.content).toContain('What is in this image?');
    // Media bytes must never reach the official DeepSeek API messages.
    expect(firstUserMessage.content).not.toContain('iVBORw0KGgo=');

    service.stop();
  });

  it('official path sends CHAT_ERROR multimodal_unavailable when allowMultimodal is disabled', async () => {
    mockConfig.allowMultimodal = false;
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-media-disabled',
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read the attached image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitOfficialPrompt).not.toHaveBeenCalled();

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const error = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'CHAT_ERROR' }> => m.type === 'CHAT_ERROR',
    );
    expect(error).toBeDefined();
    expect(error?.code).toBe('multimodal_unavailable');
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeUndefined();

    service.stop();
  });

  it('official path fails explicitly when image parts exist but no multimodal provider is configured', async () => {
    const analyzeStub = vi.fn(async () => ({
      ok: true as const,
      analyses: [],
    }));
    const deps = createTestDependencies({ analyzeMultimodalMedia: analyzeStub });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-media-no-provider',
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read the attached image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitOfficialPrompt).not.toHaveBeenCalled();
    expect(analyzeStub).not.toHaveBeenCalled();

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const error = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'CHAT_ERROR' }> => m.type === 'CHAT_ERROR',
    );
    expect(error).toBeDefined();
    expect(error?.code).toBe('multimodal_unavailable');
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeUndefined();

    service.stop();
  });
});

