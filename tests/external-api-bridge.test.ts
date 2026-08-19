import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_EXTERNAL_API_CONFIG,
  EXTERNAL_API_MODEL_CATALOG,
  EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE,
  type BridgeFromExtensionChatChunk,
  type BridgeFromExtensionMessage,
  type BridgeFromExtensionToolEvent,
  type BridgeToExtensionChatRequest,
  type ExternalApiConfig,
  type ExternalApiToolDefinition,
} from '../core/external-api/contracts';
import { startRelayProcess } from '../core/external-api/process';
import {
  convertClientToolsToDescriptors,
  createExternalApiService,
  resolveDeepSeekModelParams,
  type ExternalApiPromptBuildRequest,
} from '../core/external-api/service';
import {
  submitOfficialDeepSeekStreaming,
  type OfficialDeepSeekCallbacks,
  type SubmitOfficialDeepSeekInput,
} from '../core/deepseek/official-api';
import { renderToolSchemas } from '../core/prompt';
import type { ToolCall, ToolDescriptor } from '../core/tool/types';
import { getMultimodalSettingsStatus } from '../core/multimodal/settings';
import type { MultimodalMediaAnalyzeRequest } from '../core/multimodal/media';

vi.mock('../core/multimodal/settings', () => ({
  getMultimodalSettingsStatus: vi.fn(),
}));

// Process module: spy-wrapped so service auto-start assertions can inspect
// call args while the REAL gate logic still runs underneath (importOriginal).
vi.mock('../core/external-api/process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/external-api/process')>();
  return {
    ...actual,
    isNativeHostAvailable: vi.fn(async () => true),
    startRelayProcess: vi.fn((options) => actual.startRelayProcess(options)),
  };
});

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
  let mockStorage: Record<string, unknown> = {};

  beforeEach(() => {
    mockStorage = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(mockStorage, items);
          }),
        },
      },
    } as unknown as typeof chrome;
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
      uploadFile: vi.fn(async () => null),
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

    // Turn 3: User opens a brand new chat (0 assistant messages) -> Starts a fresh session
    (deps.createChatSession as any).mockResolvedValueOnce('session-fresh-456');
    const request3: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-turn-3-new-chat',
      session_id: 'conversation-thread-100',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'user', content: 'Brand new topic' },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'low',
    };

    activeMockSocket!.simulateServerMessage(request3);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.createChatSession).toHaveBeenCalledTimes(2);
    expect(receivedInputs[2].chatSessionId).toBe('session-fresh-456');
    expect(receivedInputs[2].parentMessageId).toBeNull();
    expect(receivedInputs[2].prompt).toContain('Brand new topic');

    service.stop();
  });

  it('recovers gracefully by creating a fresh session when continuing a stale/deleted session', async () => {
    const receivedInputs: any[] = [];
    let submitCallCount = 0;
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      createChatSession: vi.fn()
        .mockResolvedValueOnce('session-stale-1')
        .mockResolvedValueOnce('session-recovered-2'),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        submitCallCount++;
        receivedInputs.push(input);
        if (submitCallCount === 1) {
          // Turn 1 initial success
          callbacks.onTextChunk?.('Answer 1', 'Answer 1');
          return {
            assistantText: 'Answer 1',
            finished: true,
            requestMessageId: 10,
            responseMessageId: 20,
          };
        }
        if (submitCallCount === 2) {
          // Turn 2 fails with session not found (e.g. deleted on web)
          throw new Error('Chat session not found (404)');
        }
        // Turn 2 retry on recovered session
        callbacks.onTextChunk?.('Recovered Answer', 'Recovered Answer');
        return {
          assistantText: 'Recovered Answer',
          finished: true,
          requestMessageId: 30,
          responseMessageId: 40,
        };
      }),
    });
    const service = createExternalApiService(deps);
    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    // Turn 1
    activeMockSocket!.simulateServerMessage({
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-t1',
      session_id: 'sess-recover-test',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Turn 1 prompt' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'low',
    });
    await new Promise((r) => setTimeout(r, 20));

    // Turn 2 (multi-turn, encounters 404, should auto-recover)
    activeMockSocket!.simulateServerMessage({
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-t2',
      session_id: 'sess-recover-test',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'user', content: 'Turn 1 prompt' },
        { role: 'assistant', content: 'Answer 1' },
        { role: 'user', content: 'Turn 2 prompt' },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'low',
    });
    await new Promise((r) => setTimeout(r, 40));

    expect(deps.createChatSession).toHaveBeenCalledTimes(2);
    // 3rd submitWebPrompt call was the recovered call on session-recovered-2
    expect(receivedInputs.length).toBe(3);
    expect(receivedInputs[2].chatSessionId).toBe('session-recovered-2');
    expect(receivedInputs[2].parentMessageId).toBeNull();
    expect(receivedInputs[2].prompt).toContain('Turn 1 prompt');
    expect(receivedInputs[2].prompt).toContain('Turn 2 prompt');

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
    const toolStarted = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'TOOL_EVENT' }> =>
        m.type === 'TOOL_EVENT' && m.tool_name === 'fs_list' && m.status === 'started',
    );
    expect(toolStarted).toBeDefined();
    const toolSucceeded = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'TOOL_EVENT' }> =>
        m.type === 'TOOL_EVENT' && m.tool_name === 'fs_list' && m.status === 'succeeded',
    );
    expect(toolSucceeded).toBeDefined();
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

  it('resolveDeepSeekModelParams maps deepseek-v4-pro to web expert + thinking and keeps aliases', () => {
    // Contract: declaring deepseek-v4-pro must yield web expert mode and the
    // official deepseek-v4-pro id on the wire (never a silent flash fallback).
    expect(resolveDeepSeekModelParams('deepseek-v4-pro')).toEqual({
      webModelType: 'expert',
      thinkingEnabled: true,
      officialModel: 'deepseek-v4-pro',
    });
    // Aliases stay unchanged.
    expect(resolveDeepSeekModelParams('deepseek-v4-flash')).toEqual({
      webModelType: null,
      thinkingEnabled: false,
      officialModel: 'deepseek-v4-flash',
    });
    expect(resolveDeepSeekModelParams('deepseek-v4-vision')).toEqual({
      webModelType: 'vision',
      thinkingEnabled: false,
      officialModel: 'deepseek-v4-flash',
    });
    expect(resolveDeepSeekModelParams('deepseek-chat')).toEqual({
      webModelType: null,
      thinkingEnabled: false,
      officialModel: 'deepseek-v4-flash',
    });
    expect(resolveDeepSeekModelParams('deepseek-reasoner')).toEqual({
      webModelType: 'expert',
      thinkingEnabled: true,
      officialModel: 'deepseek-v4-pro',
    });
  });

  it('official path emits model deepseek-v4-pro in the request body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => createSseResponse([
      'data: {"choices":[{"delta":{"content":"Pro reply"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n\n')));
    const deps = createTestDependencies({
      submitOfficialPrompt: vi.fn((input, callbacks, signal) =>
        submitOfficialDeepSeekStreaming({ ...input, fetchImpl }, callbacks, signal),
      ),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-v4-pro-official',
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hello from pro' }],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
    });

    service.stop();
  });

  it('web path receives modelType expert and thinking for deepseek-v4-pro', async () => {
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-v4-pro-web',
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hello from pro' }],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(1);
    const input = deps.submitWebPrompt.mock.calls[0][0];
    expect(input.modelType).toBe('expert');
    expect(input.thinkingEnabled).toBe(true);

    service.stop();
  });

  it('handshake advertises the full model catalog including deepseek-v4-vision', async () => {
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const handshakeAck = sent.find((m) => m.type === 'HANDSHAKE_ACK');
    expect(handshakeAck).toBeDefined();
    expect(handshakeAck?.supported_models).toEqual([...EXTERNAL_API_MODEL_CATALOG]);
    expect(handshakeAck?.supported_models).toContain('deepseek-v4-vision');
    expect(handshakeAck?.supported_models).toHaveLength(5);

    service.stop();
  });

  it('unmappable model fails explicitly with CHAT_ERROR and never falls back', async () => {
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-unknown-model',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 20));

    // No silent fallback to any backend.
    expect(deps.submitWebPrompt).not.toHaveBeenCalled();
    expect(deps.submitOfficialPrompt).not.toHaveBeenCalled();
    expect(deps.createChatSession).not.toHaveBeenCalled();

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const error = sent.find(
      (m): m is Extract<BridgeFromExtensionMessage, { type: 'CHAT_ERROR' }> => m.type === 'CHAT_ERROR',
    );
    expect(error).toBeDefined();
    expect(error?.code).toBe('model_not_supported');
    expect(error?.error).toContain('gpt-4o');
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeUndefined();

    service.stop();
  });

  it('auto-start with relayHost 0.0.0.0 passes host and extensionToken to startRelayProcess', async () => {
    mockConfig.relayHost = '0.0.0.0';
    mockConfig.extensionToken = 'tok-abc-123';
    mockConfig.autoStartRelay = true;
    mockConfig.apiKeys = [
      {
        id: 'k-managed',
        name: 'Managed Key',
        key: 'sk-dspp-managed',
        keyPrefix: 'sk-dspp...naged',
        createdAt: 0,
        lastUsedAt: null,
        usageCount: 0,
        enabled: true,
      },
    ];
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(startRelayProcess)).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '0.0.0.0',
        port: 3000,
        apiKey: 'sk-dspp-managed',
        extensionToken: 'tok-abc-123',
      }),
    );

    service.stop();
  });

  it('service auto-start refuses non-loopback host without any enabled API key', async () => {
    mockConfig.relayHost = '0.0.0.0';
    mockConfig.autoStartRelay = true;
    mockConfig.apiKeys = [];
    mockConfig.apiKey = '';
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(startRelayProcess)).not.toHaveBeenCalled();
    expect(service.getStatus().lastError).toBe(EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE);

    service.stop();
  });

  it('startRelayProcess refuses non-loopback host without an API key (process gate)', async () => {
    const result = await startRelayProcess({ host: '0.0.0.0', port: 3000, apiKey: '' });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE);
    expect(EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE).toContain('requires at least one enabled API key');
  });

  it('service auto-start allows loopback host without keys (backward compatible)', async () => {
    mockConfig.relayHost = '127.0.0.1';
    mockConfig.autoStartRelay = true;
    mockConfig.apiKeys = [];
    mockConfig.apiKey = '';
    const deps = createTestDependencies();
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(startRelayProcess)).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 3000 }),
    );

    service.stop();
  });

  it('startRelayProcess allows loopback host without an API key (backward compatible)', async () => {
    const result = await startRelayProcess({ host: '127.0.0.1', port: 3000, apiKey: '' });

    expect(result.message).not.toBe(EXTERNAL_API_RELAY_AUTH_GATE_MESSAGE);
  });

  it('suppresses tool XML tags during streaming chunks and continues agent loop cleanly', async () => {
    let callStep = 0;
    const executedTools: ToolCall[] = [];
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      executeToolCall: vi.fn(async (call: ToolCall) => {
        executedTools.push(call);
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify([{ title: 'World Anvil', url: 'https://worldanvil.com' }]),
          detail: 'found 1 result',
        };
      }),
      getToolDescriptors: vi.fn(async () => [
        {
          id: 'local:web_search',
          name: 'web_search',
          title: 'web_search',
          invocationName: 'web_search',
          provider: {
            kind: 'local' as const,
            id: 'web',
            displayName: 'Web',
            transport: 'in_process' as const,
          },
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          execution: { mode: 'auto' as const, enabled: true, risk: 'low' as const },
        },
      ]),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        callStep++;
        if (callStep === 1) {
          callbacks.onTextChunk?.('Let me search that for you.\n\n<web_search>\n{"query": "worldbuilding"}\n</web_search>', 'Let me search that for you.\n\n<web_search>\n{"query": "worldbuilding"}\n</web_search>');
          return {
            assistantText: 'Let me search that for you.\n\n<web_search>\n{"query": "worldbuilding"}\n</web_search>',
            finished: true,
            requestMessageId: 1,
            responseMessageId: 2,
          };
        } else {
          callbacks.onTextChunk?.('Based on search results, World Anvil is great.', 'Based on search results, World Anvil is great.');
          return {
            assistantText: 'Based on search results, World Anvil is great.',
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
      id: 'req-streaming-tool',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Search worldbuilding tools' }],
      stream: true,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.executeToolCall).toHaveBeenCalledTimes(1);
    expect(executedTools[0].name).toBe('web_search');
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(2);

    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const chunks = sent.filter((m): m is BridgeFromExtensionChatChunk => m.type === 'CHAT_CHUNK' && Boolean(m.text_delta));
    // Ensure no chunk contains <web_search> or XML tool call syntax
    for (const chunk of chunks) {
      expect(chunk.text_delta).not.toContain('<web_search>');
      expect(chunk.text_delta).not.toContain('</web_search>');
    }

    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeDefined();
    expect(done?.finish_reason).toBe('stop');
    expect(done?.full_text).not.toContain('<web_search>');
    expect(done?.full_text).toContain('Based on search results, World Anvil is great.');

    service.stop();
  });

  it('extracts and uploads images in multiple standard formats (data URL, raw base64, msg.images)', async () => {
    const uploadedFiles: Array<{ filename: string; modelType: string }> = [];
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      uploadFile: vi.fn(async (input: { file: Blob; filename: string; modelType: string }) => {
        uploadedFiles.push({ filename: input.filename, modelType: input.modelType });
        return {
          id: `file-${uploadedFiles.length}`,
          filename: input.filename,
          size: input.file.size,
          status: 'SUCCESS' as const,
        };
      }),
      submitWebPrompt: vi.fn(async () => ({
        assistantText: 'I can see the image.',
        finished: true,
        requestMessageId: 1,
        responseMessageId: 2,
      })),
    });
    const service = createExternalApiService(deps);

    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    // Send request with both image_url and msg.images formats
    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-multimodal-formats',
      model: 'deepseek-v4-vision',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe these pictures' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              },
            },
          ],
        },
        {
          role: 'user',
          content: 'Here is another one',
          images: [
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          ],
        } as any,
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadedFiles[0].modelType).toBe('vision');
    expect(uploadedFiles[1].modelType).toBe('vision');

    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(1);
    const submitCallInput = deps.submitWebPrompt.mock.calls[0][0];
    expect(submitCallInput.modelType).toBe('vision');
    expect(submitCallInput.refFileIds).toEqual(['file-1', 'file-2']);

    service.stop();
  });

  it('preserves session context and parentMessageId across multiple turns and service restarts', async () => {
    let turnCount = 0;
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      createChatSession: vi.fn(async () => 'chat-session-persistent-1'),
      submitWebPrompt: vi.fn(async (input: { parentMessageId: number | null }) => {
        turnCount++;
        return {
          assistantText: `Response ${turnCount}`,
          finished: true,
          requestMessageId: turnCount * 2 - 1,
          responseMessageId: turnCount * 2,
        };
      }),
    });

    const service1 = createExternalApiService(deps);
    await service1.start();
    await new Promise((r) => setTimeout(r, 10));

    // Turn 1
    const request1: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-turn-1',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Turn 1 user' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };
    activeMockSocket!.simulateServerMessage(request1);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.createChatSession).toHaveBeenCalledTimes(1);
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(1);
    expect(deps.submitWebPrompt.mock.calls[0][0].parentMessageId).toBeNull();
    service1.stop();

    // Now create a fresh service instance (simulating extension reload / service worker wake up)
    const service2 = createExternalApiService(deps);
    await service2.start();
    await new Promise((r) => setTimeout(r, 10));

    // Turn 2
    const request2: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-turn-2',
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'user', content: 'Turn 1 user' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Turn 2 user' },
      ],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };
    activeMockSocket!.simulateServerMessage(request2);
    await new Promise((r) => setTimeout(r, 30));

    // createChatSession should NOT be called again because the session was hydrated from storage!
    expect(deps.createChatSession).toHaveBeenCalledTimes(1);
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(2);
    // parentMessageId on turn 2 should be the responseMessageId from turn 1 (which was 2)
    expect(deps.submitWebPrompt.mock.calls[1][0].parentMessageId).toBe(2);

    service2.stop();
  });

  it('generates a fresh PoW challenge on each step of multi-step agent tool execution', async () => {
    let callStep = 0;
    const powCalls: number[] = [];
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      getToolDescriptors: vi.fn(async () => [
        {
          id: 'local:web:web_search',
          name: 'web_search',
          invocationName: 'web_search',
          provider: {
            kind: 'local' as const,
            id: 'web',
            displayName: 'Web',
            transport: 'in_process' as const,
          },
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          execution: { mode: 'auto' as const, enabled: true, risk: 'low' as const },
        },
      ]),
      createPowHeaders: vi.fn(async () => {
        const count = powCalls.length + 1;
        powCalls.push(count);
        return { 'x-pow': `solved-${count}` };
      }),
      submitWebPrompt: vi.fn(async (input: { powHeaders?: Record<string, string> }) => {
        callStep++;
        if (callStep === 1) {
          return {
            assistantText: 'Let me search.\n<web_search>{"query":"test"}</web_search>',
            finished: true,
            requestMessageId: 1,
            responseMessageId: 2,
          };
        }
        return {
          assistantText: 'Final search result.',
          finished: true,
          requestMessageId: 3,
          responseMessageId: 4,
        };
      }),
    });

    const service = createExternalApiService(deps);
    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-multi-pow',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Test search' }],
      stream: false,
      thinking: false,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 30));

    expect(deps.createPowHeaders).toHaveBeenCalledTimes(2);
    expect(deps.submitWebPrompt.mock.calls[0][0].powHeaders).toEqual({ 'x-pow': 'solved-1' });
    expect(deps.submitWebPrompt.mock.calls[1][0].powHeaders).toEqual({ 'x-pow': 'solved-2' });

    service.stop();
  });

  it('sanitizes tool result URLs in expert mode and cleans DeepSeek link reading notice', async () => {
    let callStep = 0;
    const deps = createTestDependencies({
      getDeepSeekApiKey: vi.fn(async () => null),
      buildPrompt: vi.fn(async ({ prompt }) => ({
        augmented: prompt,
        enabledDescriptors: [
          {
            id: 'builtin:web_search',
            name: 'web_search',
            title: 'web_search',
            invocationName: 'web_search',
            provider: {
              kind: 'local',
              id: 'builtin',
              displayName: 'Built-in',
              transport: 'in_process',
            },
            description: 'Search the web',
            inputSchema: { type: 'object', properties: {} },
            execution: { mode: 'auto', enabled: true, risk: 'low' },
          },
        ],
      })),
      executeToolCall: vi.fn(async () => ({
        ok: true,
        name: 'web_search',
        summary: 'Search completed',
        output: '1. [Result](https://geometry-dash.fandom.com/wiki/BOOBAWAMBA)\nBOOBAWAMBA details',
      })),
      submitWebPrompt: vi.fn(async (input, callbacks) => {
        callStep++;
        if (callStep === 1) {
          callbacks.onTextChunk?.('<web_search>{"query":"boobawamba"}</web_search>', '<web_search>{"query":"boobawamba"}</web_search>');
          return {
            assistantText: '<web_search>{"query":"boobawamba"}</web_search>',
            finished: true,
            requestMessageId: 1,
            responseMessageId: 2,
          };
        }
        // Turn 2 receives sanitized tool results and DeepSeek prepends link reading warning
        callbacks.onTextChunk?.('Link reading is unavailable in Expert Mode. Please use Instant Mode. BOOBAWAMBA is a level.', 'Link reading is unavailable in Expert Mode. Please use Instant Mode. BOOBAWAMBA is a level.');
        return {
          assistantText: 'Link reading is unavailable in Expert Mode. Please use Instant Mode. BOOBAWAMBA is a level.',
          finished: true,
          requestMessageId: 3,
          responseMessageId: 4,
        };
      }),
    });

    const service = createExternalApiService(deps);
    await service.start();
    await new Promise((r) => setTimeout(r, 10));

    const request: BridgeToExtensionChatRequest = {
      type: 'CHAT_COMPLETION_REQUEST',
      id: 'req-expert-search',
      model: 'deepseek-v4-pro', // Maps to expert mode
      messages: [{ role: 'user', content: '帮我搜索 boobawamba' }],
      stream: false,
      thinking: true,
      reasoning_effort: 'high',
    };

    activeMockSocket!.simulateServerMessage(request);
    await new Promise((r) => setTimeout(r, 60));

    // Turn 2 prompt must have sanitized https:// to source-url://
    expect(deps.submitWebPrompt).toHaveBeenCalledTimes(2);
    expect(deps.submitWebPrompt.mock.calls[1][0].prompt).toContain('source-url://');
    expect(deps.submitWebPrompt.mock.calls[1][0].prompt).not.toContain('https://');

    // Final response must have stripped "Link reading is unavailable in Expert Mode. Please use Instant Mode."
    const sent = activeMockSocket!.sentMessages.map((m) => JSON.parse(m) as BridgeFromExtensionMessage);
    const done = sent.find((m) => m.type === 'CHAT_DONE');
    expect(done).toBeDefined();
    expect(done?.full_text).toBe('BOOBAWAMBA is a level.');
    expect(done?.full_text).not.toContain('Link reading is unavailable');

    service.stop();
  });
});

function createSseResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  }), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

