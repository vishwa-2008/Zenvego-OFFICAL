import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, type LiveServerMessage, type Session } from '@google/genai';
import { getAuth as getAdminAuth, type DecodedIdToken } from 'firebase-admin/auth';

export type AssistantMode = 'general' | 'fast' | 'search' | 'maps';
export type AssistantUserRole = 'customer' | 'grower' | 'delivery' | 'bulk';

export interface AssistantChatMessageInput {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantSearchSource {
  title: string;
  uri: string;
}

export interface AssistantMapSource {
  title: string;
  uri: string;
  reviewSnippets: string[];
}

export interface AssistantChatResult {
  reply: string;
  model: string;
  mode: AssistantMode;
  searchSources: AssistantSearchSource[];
  mapSources: AssistantMapSource[];
}

const ROLE_INSTRUCTIONS: Record<AssistantUserRole, string> = {
  customer:
    'The user is shopping on Zenvego as a Household Customer. Help with fresh produce selection, seasonal cooking tips, neighborhood grower freshness, delivery zones, order tracking, QR handover verification, and local area questions.',
  grower:
    'The user is a Zenvego Urban Grower / Farmer. Help with listing fresh harvests, shelf-life & storage best practices, packaging for 10 km hyperlocal EV dispatch, QR product studio labels, and order fulfilment.',
  delivery:
    'The user is a Zenvego EV Delivery Partner. Help with live GPS tracking best practices, smooth pickup/drop-off QR handshakes, hyperlocal routing, safe fresh-produce handling, and shift workflow.',
  bulk:
    'The user is an Institutional / Bulk Buyer (cafe, kitchen, or restaurant). Help with wholesale produce planning, seasonal availability, quote comparisons, and recurring fresh supply.',
};

function buildSystemInstruction(role: AssistantUserRole, contextSummary?: string, voiceMode = false): string {
  const safeRole: AssistantUserRole =
    role === 'grower' || role === 'delivery' || role === 'bulk' ? role : 'customer';
  const base = [
    'You are the Zenvego Marketplace Desk Assistant — practical, accurate, and grounded in real facts.',
    ROLE_INSTRUCTIONS[safeRole],
    'For official inquiries or support requests, share Zenvego email zenvego.in@gmail.com and Instagram @zenvego.in (https://www.instagram.com/zenvego.in/?utm_source=ig_web_button_share_sheet).',
    'Never fabricate order IDs, payment statuses, driver locations, prices, or live traffic data that were not explicitly provided.',
    voiceMode
      ? 'Keep spoken answers crisp, warm, and conversational (2 to 4 short sentences) without markdown formatting or bullet symbols.'
      : 'Keep responses clear, direct, and easy to scan. Use concise paragraphs or short lists only when genuinely helpful.',
  ];
  if (contextSummary && contextSummary.trim()) {
    base.push(`Active session context: ${contextSummary.trim().slice(0, 500)}`);
  }
  return base.join('\n');
}

function isValidCoords(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  );
}

interface RawGroundingChunk {
  web?: { uri?: string; title?: string };
  maps?: {
    uri?: string;
    title?: string;
    placeAnswerSources?: {
      reviewSnippets?: Array<{ content?: string; text?: string } | string>;
    };
  };
}

function extractGroundingSources(response: unknown): {
  searchSources: AssistantSearchSource[];
  mapSources: AssistantMapSource[];
} {
  const candidates = (
    response as {
      candidates?: Array<{
        groundingMetadata?: {
          groundingChunks?: RawGroundingChunk[];
        };
      }>;
    }
  )?.candidates;

  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { searchSources: [], mapSources: [] };
  }

  const searchSources: AssistantSearchSource[] = [];
  const seenSearch = new Set<string>();
  const mapSources: AssistantMapSource[] = [];
  const seenMaps = new Set<string>();

  for (const chunk of chunks) {
    if (chunk.web?.uri && typeof chunk.web.uri === 'string') {
      const uri = chunk.web.uri.trim();
      if (uri && !seenSearch.has(uri)) {
        seenSearch.add(uri);
        searchSources.push({
          uri,
          title: (chunk.web.title || uri).trim(),
        });
      }
    }

    if (chunk.maps?.uri && typeof chunk.maps.uri === 'string') {
      const uri = chunk.maps.uri.trim();
      if (uri && !seenMaps.has(uri)) {
        seenMaps.add(uri);
        const rawSnippets = chunk.maps.placeAnswerSources?.reviewSnippets;
        const reviewSnippets: string[] = [];
        if (Array.isArray(rawSnippets)) {
          for (const item of rawSnippets) {
            const text =
              typeof item === 'string'
                ? item.trim()
                : typeof item?.content === 'string'
                  ? item.content.trim()
                  : typeof item?.text === 'string'
                    ? item.text.trim()
                    : '';
            if (text && reviewSnippets.length < 3) {
              reviewSnippets.push(text.slice(0, 260));
            }
          }
        }
        mapSources.push({
          uri,
          title: (chunk.maps.title || 'Google Maps Place').trim(),
          reviewSnippets,
        });
      }
    }
  }

  return { searchSources, mapSources };
}

export async function runAssistantChat(
  ai: GoogleGenAI,
  params: {
    messages: AssistantChatMessageInput[];
    mode: AssistantMode;
    userRole: AssistantUserRole;
    lat?: number;
    lng?: number;
    contextSummary?: string;
  }
): Promise<AssistantChatResult> {
  const cleaned = params.messages
    .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim().length > 0)
    .slice(-20)
    .map((m) => ({
      role: m.role,
      text: m.text.trim().slice(0, 2000),
    }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('The latest message must be a non-empty user message.');
  }

  const latestUserText = cleaned[cleaned.length - 1].text;
  const historyTurns = cleaned.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const mode: AssistantMode =
    params.mode === 'fast' || params.mode === 'search' || params.mode === 'maps' ? params.mode : 'general';

  const systemInstruction = buildSystemInstruction(params.userRole, params.contextSummary, false);

  let model = 'gemini-4-hydrogen';
  const config: Record<string, unknown> = {
    systemInstruction,
  };

  if (mode === 'fast') {
    model = 'gemini-3.1-flash-lite';
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  } else if (mode === 'search') {
    model = 'gemini-4-hydrogen';
    config.tools = [{ googleSearch: {} }];
  } else if (mode === 'maps') {
    // Google Maps grounding: never combine with googleSearch or responseMimeType/responseSchema
    model = 'gemini-4-hydrogen';
    config.tools = [{ googleMaps: {} }];
    const latitude = isValidCoords(params.lat, params.lng) ? (params.lat as number) : 12.9716;
    const longitude = isValidCoords(params.lat, params.lng) ? (params.lng as number) : 77.5946;
    config.toolConfig = {
      retrievalConfig: {
        latLng: { latitude, longitude },
      },
    };
  } else {
    model = 'gemini-4-hydrogen';
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

  const chat = ai.chats.create({
    model,
    history: historyTurns,
    config,
  });

  const response = await chat.sendMessage({ message: latestUserText });
  const reply = (response.text ?? '').trim();
  const { searchSources, mapSources } = extractGroundingSources(response);

  return {
    reply: reply || 'I could not generate a response for that query. Please try rephrasing.',
    model,
    mode,
    searchSources,
    mapSources,
  };
}

export interface LiveVoiceServerOptions {
  getGeminiClient: () => GoogleGenAI | null;
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  logEvent?: (level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void;
}

export function attachLiveVoiceServer(httpServer: HttpServer, options: LiveVoiceServerOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  const verifyToken =
    options.verifyIdToken ||
    (async (token: string) => {
      return getAdminAuth().verifyIdToken(token);
    });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url || '/', 'http://localhost');
    } catch {
      return;
    }

    // Strictly isolate /ws/live-voice so Socket.IO (/socket.io/) and other upgrade paths are untouched
    if (parsedUrl.pathname !== '/ws/live-voice') {
      return;
    }

    const token = parsedUrl.searchParams.get('token')?.trim() || '';
    if (!token || token.length > 4096) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required.');
      socket.destroy();
      return;
    }

    const ai = options.getGeminiClient();
    if (!ai) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nLive voice service unavailable.');
      socket.destroy();
      return;
    }

    void verifyToken(token)
      .then((decoded) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, decoded, parsedUrl);
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nInvalid Firebase token.');
        socket.destroy();
      });
  });

  wss.on(
    'connection',
    (ws: WebSocket, _req: IncomingMessage, decoded: DecodedIdToken, parsedUrl: URL) => {
      const ai = options.getGeminiClient();
      if (!ai) {
        ws.close(1011, 'Gemini API key missing on server');
        return;
      }

      const roleParam = parsedUrl.searchParams.get('role') || 'customer';
      const userRole: AssistantUserRole =
        roleParam === 'grower' || roleParam === 'delivery' || roleParam === 'bulk' ? roleParam : 'customer';
      const contextSummary = parsedUrl.searchParams.get('context')?.slice(0, 400) || '';

      let session: Session | null = null;
      let closing = false;

      const sendJson = (payload: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      };

      const cleanup = () => {
        if (closing) return;
        closing = true;
        if (session) {
          try {
            session.close();
          } catch {
            // Ignore close errors
          }
          session = null;
        }
      };

      options.logEvent?.('info', 'live_voice_session_start', { uid: decoded.uid, role: userRole });

      void ai.live
        .connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Zephyr',
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: buildSystemInstruction(userRole, contextSummary, true),
          },
          callbacks: {
            onopen: () => {
              sendJson({ type: 'ready', model: 'gemini-3.8-live' });
            },
            onmessage: (msg: LiveServerMessage) => {
              if (closing) return;
              const serverContent = msg.serverContent;
              if (!serverContent) return;

              if (serverContent.interrupted) {
                sendJson({ type: 'interrupted' });
              }

              if (serverContent.inputTranscription?.text) {
                sendJson({ type: 'input_transcript', text: serverContent.inputTranscription.text });
              }

              if (serverContent.outputTranscription?.text) {
                sendJson({ type: 'output_transcript', text: serverContent.outputTranscription.text });
              }

              const parts = serverContent.modelTurn?.parts;
              if (Array.isArray(parts)) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    sendJson({ type: 'audio', data: part.inlineData.data });
                  }
                }
              }

              if (serverContent.turnComplete) {
                sendJson({ type: 'turn_complete' });
              }
            },
            onerror: (err: ErrorEvent) => {
              options.logEvent?.('warn', 'live_voice_upstream_error', {
                uid: decoded.uid,
                message: err?.message || 'Live API error',
              });
              sendJson({ type: 'error', error: err?.message || 'Voice connection error.' });
            },
            onclose: () => {
              sendJson({ type: 'closed' });
              cleanup();
              if (ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'Session ended');
              }
            },
          },
        })
        .then((liveSession) => {
          if (closing || ws.readyState !== WebSocket.OPEN) {
            liveSession.close();
            return;
          }
          session = liveSession;
        })
        .catch((err) => {
          options.logEvent?.('error', 'live_voice_connect_failed', {
            uid: decoded.uid,
            message: err instanceof Error ? err.message : String(err),
          });
          sendJson({
            type: 'error',
            error: 'Could not start live voice session right now. Please try again.',
          });
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'Upstream connect failed');
          }
        });

      ws.on('message', (raw) => {
        if (!session || closing) return;
        try {
          const parsed = JSON.parse(raw.toString()) as {
            type?: string;
            data?: string;
            text?: string;
          };
          if (parsed.type === 'audio' && typeof parsed.data === 'string' && parsed.data.length > 0) {
            session.sendRealtimeInput({
              audio: {
                data: parsed.data,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if (parsed.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim()) {
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: parsed.text.trim().slice(0, 1000) }] }],
              turnComplete: true,
            });
          } else if (parsed.type === 'close') {
            cleanup();
            ws.close(1000, 'Client requested close');
          }
        } catch {
          // Ignore malformed client frames
        }
      });

      ws.on('close', () => {
        cleanup();
      });

      ws.on('error', () => {
        cleanup();
      });
    }
  );

  return {
    close: () => {
      wss.close();
    },
  };
}
