import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  zenvegoApi,
  type AssistantChatMode,
  type AssistantMapSource,
  type AssistantSearchSource,
} from '../lib/apiClient';
import type { UserRole } from '../types';

type DeskTab = AssistantChatMode | 'voice';

interface ChatThreadItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  mode?: AssistantChatMode;
  searchSources?: AssistantSearchSource[];
  mapSources?: AssistantMapSource[];
}

interface VoiceTranscriptItem {
  id: string;
  speaker: 'you' | 'desk';
  text: string;
}

interface ZenvegoConciergeProps {
  open: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  role: UserRole;
  lat?: number;
  lng?: number;
  addressLabel?: string;
  contextSummary?: string;
  onRequireSignIn: () => void;
}

const TAB_ITEMS: Array<{ id: DeskTab; label: string; icon: string }> = [
  { id: 'general', label: 'Chat', icon: 'chat_bubble_outline' },
  { id: 'fast', label: 'Quick', icon: 'bolt' },
  { id: 'search', label: 'Web', icon: 'public' },
  { id: 'maps', label: 'Places', icon: 'map' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
];

const QUICK_PROMPTS: Record<AssistantChatMode, string[]> = {
  general: [
    'How should I store freshly harvested leafy greens to keep them crisp?',
    'How does QR pickup and doorstep handover verification work?',
  ],
  fast: [
    'Give me a 10-minute stir-fry idea using spinach and cherry tomatoes.',
    'What is the standard hyperlocal service radius on Zenvego?',
  ],
  search: [
    'What seasonal vegetables are freshest in Bengaluru right now?',
    'What are the best organic soil mixes for growing leafy greens on a terrace?',
  ],
  maps: [
    'Find popular organic farmers markets or fresh produce hubs near my pinned location.',
    'Which neighborhood parks or landmarks are closest to my delivery area?',
  ],
};

function float32ToPcm16Base64(input: Float32Array): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  // Chunked encoding avoids call-stack limits on large buffers
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(bytes.length / 2);
  const float32 = new Float32Array(new ArrayBuffer(sampleCount * 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const ZenvegoConcierge: React.FC<ZenvegoConciergeProps> = ({
  open,
  onClose,
  isAuthenticated,
  role,
  lat,
  lng,
  addressLabel,
  contextSummary,
  onRequireSignIn,
}) => {
  const [activeTab, setActiveTab] = useState<DeskTab>('general');
  const [messages, setMessages] = useState<ChatThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Live Voice session state
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscriptItem[]>([]);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const voiceEndRef = useRef<HTMLDivElement | null>(null);

  // Live audio / WebSocket refs
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const voiceMutedRef = useRef<boolean>(false);
  voiceMutedRef.current = voiceMuted;

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const stopVoiceSession = useCallback(() => {
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop();
      }
      micStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'close' }));
        }
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    setVoiceMuted(false);
    setVoiceState('idle');
  }, [stopPlaybackQueue]);

  // Clean up voice session if drawer closes or component unmounts
  useEffect(() => {
    if (!open && voiceState !== 'idle') {
      stopVoiceSession();
    }
  }, [open, voiceState, stopVoiceSession]);

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  useEffect(() => {
    if (open && activeTab !== 'voice') {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending, open, activeTab]);

  useEffect(() => {
    if (open && activeTab === 'voice') {
      voiceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [voiceTranscripts, open, activeTab]);

  const schedulePcm24kPlayback = useCallback((base64Pcm: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    const samples = pcm16Base64ToFloat32(base64Pcm);
    if (samples.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, samples.length, 24000);
    audioBuffer.copyToChannel(samples, 0);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const startAt = Math.max(nextStartTimeRef.current, outCtx.currentTime);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  }, []);

  const appendTranscript = useCallback((speaker: 'you' | 'desk', text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setVoiceTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text} ${trimmed}`.replace(/\s+/g, ' ').trim(),
        };
        return updated;
      }
      return [...prev.slice(-30), { id: `${Date.now()}-${Math.random()}`, speaker, text: trimmed }];
    });
  }, []);

  const startVoiceSession = useCallback(async () => {
    if (!isAuthenticated || !auth.currentUser) {
      onRequireSignIn();
      return;
    }

    setVoiceError(null);
    setVoiceState('connecting');

    try {
      const idToken = await auth.currentUser.getIdToken();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = new URLSearchParams({
        token: idToken,
        role,
        context: (contextSummary || '').slice(0, 350),
      });
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live-voice?${qs.toString()}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            text?: string;
            error?: string;
          };
          if (msg.type === 'ready') {
            setVoiceState('live');
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (audioEvt) => {
              if (voiceMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
              const channelData = audioEvt.inputBuffer.getChannelData(0);
              const base64 = float32ToPcm16Base64(channelData);
              ws.send(JSON.stringify({ type: 'audio', data: base64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          } else if (msg.type === 'audio' && msg.data) {
            schedulePcm24kPlayback(msg.data);
          } else if (msg.type === 'interrupted') {
            stopPlaybackQueue();
          } else if (msg.type === 'input_transcript' && msg.text) {
            appendTranscript('you', msg.text);
          } else if (msg.type === 'output_transcript' && msg.text) {
            appendTranscript('desk', msg.text);
          } else if (msg.type === 'error') {
            setVoiceError(msg.error || 'Voice session encountered an error.');
            setVoiceState('error');
          } else if (msg.type === 'closed') {
            stopVoiceSession();
          }
        } catch {
          // Ignore malformed payloads
        }
      };

      ws.onerror = () => {
        setVoiceError('Unable to maintain live voice connection. Please try again.');
        stopVoiceSession();
        setVoiceState('error');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          stopVoiceSession();
        }
      };
    } catch (err) {
      stopVoiceSession();
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow microphone permission in your browser settings to talk.'
          : err instanceof Error
            ? err.message
            : 'Could not start microphone audio.';
      setVoiceError(message);
      setVoiceState('error');
    }
  }, [
    isAuthenticated,
    onRequireSignIn,
    role,
    contextSummary,
    schedulePcm24kPlayback,
    stopPlaybackQueue,
    appendTranscript,
    stopVoiceSession,
  ]);

  const sendMessage = useCallback(
    async (textOverride?: string) => {
      const content = (textOverride ?? draft).trim();
      if (!content || sending || activeTab === 'voice') return;
      if (!isAuthenticated) {
        onRequireSignIn();
        return;
      }

      const mode: AssistantChatMode = activeTab;
      const nextUserMsg: ChatThreadItem = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: content,
        mode,
      };

      const historyPayload = [...messages, nextUserMsg].slice(-16).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((prev) => [...prev, nextUserMsg]);
      if (!textOverride) setDraft('');
      setChatError(null);
      setSending(true);

      try {
        const res = await zenvegoApi.assistantChat({
          messages: historyPayload,
          mode,
          userRole: role,
          lat,
          lng,
          contextSummary,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}`,
            role: 'model',
            text: res.reply,
            mode: res.mode,
            searchSources: res.searchSources,
            mapSources: res.mapSources,
          },
        ]);
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Unable to send message right now.');
      } finally {
        setSending(false);
      }
    },
    [draft, sending, activeTab, isAuthenticated, onRequireSignIn, messages, role, lat, lng, contextSummary]
  );

  if (!open) return null;

  const currentChatMode: AssistantChatMode = activeTab === 'voice' ? 'general' : activeTab;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Zenvego Desk"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-surface-container-lowest border-l border-outline-variant/25 flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Clean Editorial Header */}
        <div className="px-4 py-3.5 border-b border-outline-variant/20 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-primary tracking-tight">Zenvego Desk</h2>
            <p className="text-[11px] text-on-surface-variant truncate">
              {activeTab === 'voice'
                ? 'Live voice conversation'
                : activeTab === 'search'
                  ? 'Grounded with live Google Search results'
                  : activeTab === 'maps'
                    ? addressLabel
                      ? `Local places near ${addressLabel}`
                      : 'Local places & Google Maps info'
                    : activeTab === 'fast'
                      ? 'Short, rapid answers'
                      : 'Produce, orders, grower & delivery help'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {activeTab !== 'voice' && messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setChatError(null);
                }}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-primary cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Zenvego Desk"
              className="w-8 h-8 rounded-lg hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Clean Segmented Mode Bar (Functional Tabs Only) */}
        <div className="px-3 pt-2 pb-0 border-b border-outline-variant/20 grid grid-cols-5 gap-1 bg-surface-container-low/50">
          {TAB_ITEMS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (activeTab === 'voice' && tab.id !== 'voice' && voiceState !== 'idle') {
                    stopVoiceSession();
                  }
                  setActiveTab(tab.id);
                  setChatError(null);
                }}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 border-b-2 text-[11px] font-bold transition-colors cursor-pointer ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sign-In Gate if Unauthenticated */}
        {!isAuthenticated ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-surface-container-low border border-outline-variant/25 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[24px]">lock</span>
            </div>
            <div className="space-y-1 max-w-xs">
              <h3 className="text-sm font-extrabold text-primary">Sign in to use Zenvego Desk</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Chat, web search, local place lookup, and live voice conversations are tied to your verified account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRequireSignIn();
              }}
              className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
            >
              Sign In with Google
            </button>
          </div>
        ) : activeTab === 'voice' ? (
          /* Real-Time Voice Conversation Panel */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-5 border-b border-outline-variant/20 bg-surface-container-low/40 flex flex-col items-center text-center space-y-3">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center border transition-colors ${
                  voiceState === 'live'
                    ? 'bg-primary text-on-primary border-primary'
                    : 'bg-surface-container-lowest text-primary border-outline-variant/30'
                }`}
              >
                <span className="material-symbols-outlined text-[28px]">
                  {voiceState === 'live' ? (voiceMuted ? 'mic_off' : 'graphic_eq') : 'mic'}
                </span>
              </div>

              <div className="space-y-0.5">
                <div className="text-sm font-extrabold text-primary">
                  {voiceState === 'connecting'
                    ? 'Connecting microphone...'
                    : voiceState === 'live'
                      ? voiceMuted
                        ? 'Microphone muted'
                        : 'Listening — speak naturally'
                      : 'Voice Desk Ready'}
                </div>
                <p className="text-xs text-on-surface-variant max-w-xs">
                  {voiceState === 'live'
                    ? 'Interrupt anytime by speaking. Audio streams live both ways.'
                    : 'Ask hands-free questions about harvests, storage, orders, or local delivery handoffs.'}
                </p>
              </div>

              {voiceError && (
                <div className="w-full rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800 text-left">
                  {voiceError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                {voiceState === 'idle' || voiceState === 'error' ? (
                  <button
                    type="button"
                    onClick={() => void startVoiceSession()}
                    className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">call</span>
                    <span>Start Voice Conversation</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setVoiceMuted((m) => !m)}
                      disabled={voiceState !== 'live'}
                      className="px-4 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {voiceMuted ? 'mic' : 'mic_off'}
                      </span>
                      <span>{voiceMuted ? 'Unmute' : 'Mute'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopVoiceSession}
                      className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">call_end</span>
                      <span>End</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Live Transcript Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {voiceTranscripts.length === 0 ? (
                <p className="text-xs text-on-surface-variant text-center py-8">
                  Live spoken transcripts appear here once the conversation begins.
                </p>
              ) : (
                voiceTranscripts.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-col ${item.speaker === 'you' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-0.5 px-1">
                      {item.speaker === 'you' ? 'You' : 'Zenvego Desk'}
                    </span>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                        item.speaker === 'you'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-low text-on-surface border border-outline-variant/20'
                      }`}
                    >
                      {item.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={voiceEndRef} />
            </div>
          </div>
        ) : (
          /* Multi-Turn Chat Thread (Chat / Quick / Web Search / Google Maps Places) */
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="space-y-3 py-4">
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    {currentChatMode === 'search'
                      ? 'Ask a question to look up current web information with verified source links.'
                      : currentChatMode === 'maps'
                        ? 'Ask about nearby produce markets, streets, landmarks, or neighborhood spots around your selected location.'
                        : 'Ask about fresh produce storage, seasonal crops, grower QR labels, or live order handoffs.'}
                  </p>
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">
                      Suggested questions
                    </div>
                    {QUICK_PROMPTS[currentChatMode].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendMessage(prompt)}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/20 text-xs font-medium text-on-surface transition-colors cursor-pointer"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-low text-on-surface border border-outline-variant/20'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {/* Google Search Grounding Sources (Required Clickable Links) */}
                    {msg.searchSources && msg.searchSources.length > 0 && (
                      <div className="mt-1.5 max-w-[88%] w-full rounded-xl bg-surface-container-lowest border border-outline-variant/25 p-2.5 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
                          Web Sources
                        </div>
                        <ul className="space-y-1">
                          {msg.searchSources.map((src) => (
                            <li key={src.uri}>
                              <a
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1 break-all"
                              >
                                <span className="material-symbols-outlined text-[13px] shrink-0">open_in_new</span>
                                <span className="truncate">{src.title}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Google Maps Grounding Place Links & Review Snippets */}
                    {msg.mapSources && msg.mapSources.length > 0 && (
                      <div className="mt-1.5 max-w-[88%] w-full rounded-xl bg-surface-container-lowest border border-outline-variant/25 p-2.5 space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
                          Google Maps Places
                        </div>
                        <ul className="space-y-2">
                          {msg.mapSources.map((place) => (
                            <li key={place.uri} className="space-y-1">
                              <a
                                href={place.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[14px] shrink-0">location_on</span>
                                <span className="truncate">{place.title}</span>
                              </a>
                              {place.reviewSnippets.length > 0 && (
                                <div className="pl-4 space-y-1">
                                  {place.reviewSnippets.map((snippet, idx) => (
                                    <p
                                      key={idx}
                                      className="text-[11px] text-on-surface-variant italic leading-snug"
                                    >
                                      &ldquo;{snippet}&rdquo;
                                    </p>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}

              {sending && (
                <div className="flex items-start">
                  <div className="rounded-2xl px-3.5 py-2.5 bg-surface-container-low border border-outline-variant/20 text-xs text-on-surface-variant">
                    {currentChatMode === 'search'
                      ? 'Searching web sources...'
                      : currentChatMode === 'maps'
                        ? 'Checking nearby Google Maps places...'
                        : 'Drafting reply...'}
                  </div>
                </div>
              )}

              {chatError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                  {chatError}
                </div>
              )}

              <div ref={threadEndRef} />
            </div>

            {/* Clean Single-Line Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="p-3 border-t border-outline-variant/20 bg-surface-container-lowest flex items-center gap-2"
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={sending}
                placeholder={
                  currentChatMode === 'search'
                    ? 'Search live web info...'
                    : currentChatMode === 'maps'
                      ? 'Ask about nearby places...'
                      : 'Ask Zenvego Desk...'
                }
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/25 text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label="Send message"
                className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-45"
              >
                <span className="material-symbols-outlined text-[19px]">arrow_upward</span>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
