"use client";

import Link from "next/link";
import ChatIdentityControls from "../components/ChatIdentityControls";
import { showErrorToast } from "../components/ErrorToast";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../lib/session";
import {
  getConversations,
  getConversation,
  getMessages,
  markConversationRead,
  sendMessageRest,
} from "../../lib/chatApi";
import { timeAgo } from "../../lib/format";
import { useWebSocket, useWebSocketEvent, WS_EVENTS } from "../../lib/websocket";

function formatMessageTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateSeparator(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get("conversation");
  const reduce = useReducedMotion();

  const { client, isConnected } = useWebSocket();
  const { user, ready: sessionReady } = useSession();
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [selectedConvId, setSelectedConvId] = useState(initialConvId || null);
  const [selectedConv, setSelectedConv] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [otherUserTyping, setOtherUserTyping] = useState(false);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isTypingEmittedRef = useRef(false);
  const selectedConvIdRef = useRef(selectedConvId);
  const conversationsRef = useRef(conversations);
  const accountRef = useRef(user?.id);
  const listRevision = useRef(0);
  const routeSelection = useRef(null);
  const mounted = useRef(false);
  conversationsRef.current = conversations;
  accountRef.current = user?.id;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listRevision.current += 1; };
  }, [user?.id]);

  useEffect(() => {
    selectedConvIdRef.current = selectedConvId;
  }, [selectedConvId]);

  useEffect(() => {
    if (sessionReady && !user) router.push("/login");
  }, [router, sessionReady, user]);

  // All callers join the shared API request; only the latest page load applies.
  const refreshConversations = useCallback(async () => {
    if (!accountRef.current) return [];
    const account = accountRef.current;
    const revision = ++listRevision.current;
    try {
      const data = await getConversations();
      if (mounted.current && account === accountRef.current && revision === listRevision.current) setConversations(data || []);
      return data || [];
    } catch (err) {
      if (err.name !== "AbortError") console.warn("Failed to fetch conversations:", err);
      return [];
    } finally {
      if (mounted.current && account === accountRef.current && revision === listRevision.current) setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady || !user) return undefined;
    setConversations([]);
    setLoadingConvs(true);
    refreshConversations();
    window.addEventListener("fmlcore:chat-sync", refreshConversations);
    return () => window.removeEventListener("fmlcore:chat-sync", refreshConversations);
  }, [sessionReady, user?.id, refreshConversations]);

  useEffect(() => {
    const key = `${user?.id}:${initialConvId}`;
    if (initialConvId && routeSelection.current !== key && conversations.some((conversation) => conversation.id === initialConvId)) {
      routeSelection.current = key;
      setSelectedConvId(initialConvId);
    }
  }, [initialConvId, conversations, user?.id]);

  // Load selected conversation & messages
  useEffect(() => {
    if (!selectedConvId) {
      setSelectedConv(null);
      setMessages([]);
      return;
    }

    let isMounted = true;
    setLoadingMessages(true);

    Promise.all([
      getConversation(selectedConvId),
      getMessages(selectedConvId, { limit: 50 }),
    ])
      .then(([detail, msgData]) => {
        if (!isMounted) return;
        setSelectedConv(detail);
        setMessages(msgData.messages || []);
        setNextCursor(msgData.next_cursor);
        setHasMore(msgData.has_more);
        setLoadingMessages(false);

        // Mark read
        markConversationRead(selectedConvId)
          .then(() => {
            setConversations((prev) =>
              prev.map((c) => (c.id === selectedConvId ? { ...c, unread_count: 0 } : c))
            );
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Error loading chat detail:", err);
        setLoadingMessages(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedConvId, user?.id, isConnected]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const messagePane = messagesEndRef.current?.parentElement;
    if (messagePane) {
      // Scroll the conversation, rather than pulling the whole page (and its
      // heading) underneath the sticky navigation.
      messagePane.scrollTo({ top: messagePane.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    }
  }, [messages, otherUserTyping, reduce]);

  // Real-time Event Subscriptions
  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE, (data) => {
    const { conversation_id, message } = data || {};
    if (!conversation_id || !message) return;

    const activeId = selectedConvIdRef.current;
    if (activeId === conversation_id) {
      // Append to active conversation messages
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });

      // Mark as read immediately since user is actively viewing
      markConversationRead(conversation_id).catch(() => {});
    }

    // Fetching inside a state updater repeats side effects in development.
    // Decide whether a refresh is needed before the pure state update.
    if (!conversationsRef.current.some((conversation) => conversation.id === conversation_id)) refreshConversations();
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversation_id);
      if (idx === -1) return prev;
      const existing = prev[idx];
      const updated = {
        ...existing,
        last_message: message,
        last_message_at: message.created_at,
        unread_count: activeId === conversation_id ? 0 : existing.unread_count + 1,
      };
      const rest = prev.filter((c) => c.id !== conversation_id);
      return [updated, ...rest];
    });

  });

  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE_SENT, (data) => {
    const { conversation_id, message, client_event_id } = data || {};
    if (!message) return;

    setMessages((prev) =>
      prev.map((m) => (m.id === client_event_id || m.client_event_id === client_event_id ? message : m))
    );
  });

  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE_DELIVERED, (data) => {
    const { conversation_id, message_id } = data || {};
    setMessages((prev) =>
      prev.map((m) => (m.id === message_id ? { ...m, status: "delivered" } : m))
    );
  });

  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE_READ, (data) => {
    const { conversation_id } = data || {};
    const activeId = selectedConvIdRef.current;
    if (activeId === conversation_id) {
      setMessages((prev) =>
        prev.map((m) => (m.status !== "read" ? { ...m, status: "read" } : m))
      );
    }
  });

  useWebSocketEvent(WS_EVENTS.CHAT_TYPING_START, (data) => {
    const { conversation_id } = data || {};
    if (selectedConvIdRef.current === conversation_id) {
      setOtherUserTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setOtherUserTyping(false);
      }, 3500);
    }
  });

  useWebSocketEvent(WS_EVENTS.CHAT_TYPING_STOP, (data) => {
    const { conversation_id } = data || {};
    if (selectedConvIdRef.current === conversation_id) {
      setOtherUserTyping(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  });

  // Real-time Presence Subscriptions (instant online/offline without refresh)
  useWebSocketEvent(WS_EVENTS.PRESENCE_ONLINE, (data) => {
    const userId = data?.user_id;
    if (!userId) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.other_user?.user_id === userId
          ? { ...c, other_user: { ...c.other_user, is_online: true } }
          : c
      )
    );

    setSelectedConv((prev) => {
      if (prev?.other_user?.user_id === userId) {
        return { ...prev, other_user: { ...prev.other_user, is_online: true } };
      }
      return prev;
    });
  });

  useWebSocketEvent(WS_EVENTS.PRESENCE_OFFLINE, (data) => {
    const userId = data?.user_id;
    if (!userId) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.other_user?.user_id === userId
          ? { ...c, other_user: { ...c.other_user, is_online: false } }
          : c
      )
    );

    setSelectedConv((prev) => {
      if (prev?.other_user?.user_id === userId) {
        return { ...prev, other_user: { ...prev.other_user, is_online: false } };
      }
      return prev;
    });
  });

  useWebSocketEvent(WS_EVENTS.PRESENCE_STATUS, (data) => {
    const onlineSet = new Set(data?.online_user_ids || []);
    setConversations((prev) =>
      prev.map((c) => {
        const isOnline = onlineSet.has(c.other_user?.user_id);
        return {
          ...c,
          other_user: { ...c.other_user, is_online: isOnline },
        };
      })
    );

    setSelectedConv((prev) => {
      if (prev?.other_user) {
        const isOnline = onlineSet.has(prev.other_user.user_id);
        return { ...prev, other_user: { ...prev.other_user, is_online: isOnline } };
      }
      return prev;
    });
  });

  // Query live presence when connected or conversations load
  useEffect(() => {
    if (!client || !isConnected || conversations.length === 0) return;
    const uids = conversations.map((c) => c.other_user?.user_id).filter(Boolean);
    if (uids.length > 0) {
      client.send(WS_EVENTS.PRESENCE_QUERY, { user_ids: uids });
    }
  }, [client, isConnected, conversations.length]);

  // Handle typing debounce
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    if (!selectedConvId || !client) return;

    if (val.trim() && !isTypingEmittedRef.current) {
      isTypingEmittedRef.current = true;
      client.send(WS_EVENTS.CHAT_TYPING_START, { conversation_id: selectedConvId });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingEmittedRef.current) {
        isTypingEmittedRef.current = false;
        client.send(WS_EVENTS.CHAT_TYPING_STOP, { conversation_id: selectedConvId });
      }
    }, 2000);
  };

  // Send message
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !selectedConvId || sending) return;

    if (isTypingEmittedRef.current && client) {
      isTypingEmittedRef.current = false;
      client.send(WS_EVENTS.CHAT_TYPING_STOP, { conversation_id: selectedConvId });
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      client_event_id: tempId,
      conversation_id: selectedConvId,
      sender_id: user?.id,
      sender_username: user?.username || "",
      content: text,
      message_type: "text",
      created_at: new Date().toISOString(),
      status: "sending",
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText("");
    setSending(true);

    let sentViaWs = false;
    if (client && isConnected) {
      sentViaWs = client.send(
        WS_EVENTS.CHAT_MESSAGE_SEND,
        { conversation_id: selectedConvId, content: text },
        tempId
      );
    }

    if (!sentViaWs) {
      try {
        const persisted = await sendMessageRest(selectedConvId, text);
        setMessages((prev) => prev.map((m) => (m.id === tempId ? persisted : m)));
        refreshConversations();
      } catch (err) {
        console.error("Failed to send message via REST fallback:", err);
        showErrorToast(err.message || "Couldn't send your message. Try again.");
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "error" } : m))
        );
      }
    }

    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    const other = c.other_user;
    return (
      other?.username?.toLowerCase().includes(term) ||
      other?.bio?.toLowerCase().includes(term) ||
      c.last_message?.content?.toLowerCase().includes(term)
    );
  });

  useWebSocketEvent(WS_EVENTS.CHAT_IDENTITY_CHANGED, async (data) => {
    refreshConversations();
    const id = selectedConvIdRef.current;
    if (data?.conversation_id !== id) return;
    try {
      const [detail, history] = await Promise.all([getConversation(id), getMessages(id, { limit: 50 })]);
      if (selectedConvIdRef.current === id) { setSelectedConv(detail); setMessages(history.messages); setNextCursor(history.next_cursor); setHasMore(history.has_more); }
    } catch (err) { console.warn("Could not refresh profile sharing:", err); }
  });
  const otherUser = selectedConv?.other_user;

  return (
    <main className="chat-page mx-auto max-w-6xl px-3 py-3 sm:px-4 sm:py-4">
      {/* Top Banner */}
      <div className="mb-3 border-4 border-ink bg-paper p-3 shadow-[4px_4px_0_var(--color-shadow)]">
        <p className="font-note text-xl leading-none">words without the noise</p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">SAME SKY CHAT</h1>
      </div>

      {/* Main 2-Panel Layout: Fixed dynamic height, zero vertical stretching */}
      <div className="chat-workspace grid h-[calc(100dvh-185px)] min-h-[500px] grid-cols-1 overflow-hidden border-4 border-ink bg-white shadow-[8px_8px_0_var(--color-shadow)] md:grid-cols-[340px_1fr]">
        {/* Left Panel: Conversation List */}
        <section
          className={`chat-conversations flex h-full min-h-0 flex-col overflow-hidden border-b-4 border-ink bg-[#faf6ee] md:border-b-0 md:border-r-4 ${
            selectedConvId ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Search Bar */}
          <div className="shrink-0 border-b-2 border-ink bg-paper p-3">
            <input
              type="text"
              placeholder="Search conversations…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full border-2 border-ink bg-white px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0_var(--color-shadow)] placeholder:text-ink/50 focus:outline-none focus:ring-2 focus:ring-lime"
            />
          </div>

          {/* Conversations Scroll Area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loadingConvs ? (
              <div className="p-6 text-center text-sm font-bold text-ink/70">
                Loading conversations…
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center">
                <p className="font-note text-2xl">it's quiet up here</p>
                <p className="mt-2 text-xs font-semibold text-ink/75">
                  No conversations yet. Your next meaningful connection might be one click away.
                </p>
                <Link
                  href="/same-sky"
                  className="mt-4 inline-block border-2 border-ink bg-lime px-3 py-1.5 text-xs font-extrabold shadow-[2px_2px_0_var(--color-shadow)]"
                >
                  VISIT SAME SKY →
                </Link>
              </div>
            ) : (
              <ul className="divide-y-2 divide-ink/20">
                {filteredConversations.map((c) => {
                  const isSelected = c.id === selectedConvId;
                  const person = c.other_user;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedConvId(c.id)}
                        className={`chat-conversation flex w-full items-start gap-3 p-3 text-left transition-colors ${
                          isSelected
                            ? "bg-lime text-ink"
                            : "hover:bg-soft-purple/60"
                        }`}
                      >
                        {/* Avatar */}
                        <div className="relative shrink-0">
                          {person.avatar_url ? (
                            <img
                              src={`/api${person.avatar_url}`}
                              alt=""
                              className="h-11 w-11 rounded-full border-2 border-ink object-cover"
                            />
                          ) : (
                            <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-coral font-display text-lg font-extrabold text-on-brand">
                              {person.username?.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          {/* Online Dot */}
                          <span
                            className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-ink ${
                              person.is_online ? "bg-lime" : "bg-ink/30"
                            }`}
                            title={person.is_online ? "Online" : "Offline"}
                          />
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-1">
                            <h2 className="truncate font-display text-sm font-extrabold">
                              {person.username}
                            </h2>
                            <span className="shrink-0 text-[10px] font-bold text-ink/60">
                              {c.last_message ? timeAgo(c.last_message.created_at) : timeAgo(c.created_at)}
                            </span>
                          </div>

                          <p className="mt-0.5 truncate text-xs font-semibold text-ink/80">
                            {c.last_message?.content || "Connection formed. Say hello!"}
                          </p>

                          {/* Unread Badge */}
                          {c.unread_count > 0 ? (
                            <span className="mt-1 inline-flex min-w-4 items-center justify-center rounded-full border border-ink bg-coral px-1.5 py-0.5 text-[9px] font-extrabold text-on-brand">
                              {c.unread_count} new
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Right Panel: Chat Window */}
        <section className={`flex h-full min-h-0 flex-col overflow-hidden bg-paper ${!selectedConvId ? "hidden md:flex" : "flex"}`}>
          {selectedConvId && otherUser ? (
            <>
              {/* Chat Header */}
              <div className="shrink-0 flex items-center justify-between border-b-4 border-ink bg-white px-4 py-3 shadow-[0_2px_0_var(--color-shadow)]">
                <div className="flex items-center gap-3">
                  {/* Mobile Back Button */}
                  <button
                    type="button"
                    onClick={() => setSelectedConvId(null)}
                    className="border-2 border-ink bg-soft-coral px-2 py-1 text-xs font-extrabold md:hidden"
                    aria-label="Back to conversations"
                  >
                    ← BACK
                  </button>

                  {/* Other user avatar */}
                  <div className="relative">
                    {otherUser.avatar_url ? (
                      <img
                        src={`/api${otherUser.avatar_url}`}
                        alt=""
                        className="h-10 w-10 rounded-full border-2 border-ink object-cover"
                      />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-ink bg-coral font-display text-base font-extrabold text-on-brand">
                        {otherUser.username?.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span
                      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border border-ink ${
                        otherUser.is_online ? "bg-lime" : "bg-ink/30"
                      }`}
                    />
                  </div>

                  <div>
                    <h2 className="font-display text-base font-extrabold leading-tight">
                      {otherUser.username}
                    </h2>
                    <p className="text-[11px] font-bold text-ink/70">
                      {otherUser.is_online ? "● Online" : "Offline"}
                      {otherUser.bio ? ` · ${otherUser.bio.slice(0, 36)}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {otherUser.is_revealed && otherUser.profile_username ? <Link
                    href={`/users/${encodeURIComponent(otherUser.profile_username)}`}
                    className="border-2 border-ink bg-paper px-2.5 py-1 text-xs font-extrabold shadow-[2px_2px_0_var(--color-shadow)] hover:bg-soft-purple"
                  >
                    VIEW PROFILE
                  </Link> : <span className="text-xs font-bold">Anonymous match</span>}
                </div>
              </div>

              <ChatIdentityControls key={selectedConv.id} conversation={selectedConv} onChange={(detail) => { if (selectedConvIdRef.current === detail.id) setSelectedConv(detail); refreshConversations(); }} />

              {/* Messages Area - strictly scrollable within fixed height */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="py-12 text-center text-sm font-bold text-ink/70">
                    Loading messages…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="my-auto py-16 text-center">
                    <p className="font-note text-3xl">the start of a shared story</p>
                    <p className="mt-2 text-xs font-bold text-ink/70">
                      You both accepted each other under the Same Sky. Say hello!
                    </p>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.sender_id === user?.id;
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showDate =
                      !prevMsg ||
                      new Date(prevMsg.created_at).toDateString() !==
                        new Date(msg.created_at).toDateString();

                    return (
                      <div key={msg.id || idx}>
                        {showDate ? (
                          <div className="my-4 flex items-center justify-center">
                            <span className="border-2 border-ink bg-white px-3 py-0.5 text-[10px] font-extrabold uppercase shadow-[2px_2px_0_var(--color-shadow)]">
                              {formatDateSeparator(msg.created_at)}
                            </span>
                          </div>
                        ) : null}

                        <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          <div
                            className={`chat-bubble ${isMe ? "chat-bubble-own" : "chat-bubble-other"} max-w-[82%] sm:max-w-[70%] border-2 border-ink p-3 shadow-[3px_3px_0_var(--color-shadow)] ${
                              isMe ? "bg-lime text-ink" : "bg-white text-ink"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed">
                              {msg.content}
                            </p>
                            <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] font-bold opacity-75">
                              <span>{formatMessageTime(msg.created_at)}</span>
                              {isMe ? (
                                <span>
                                  {msg.status === "sending"
                                    ? "…"
                                    : msg.status === "read"
                                    ? "✓✓ Read"
                                    : msg.status === "delivered"
                                    ? "✓✓"
                                    : msg.status === "error"
                                    ? "⚠ Failed"
                                    : "✓"}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Typing indicator bubble */}
                {otherUserTyping ? (
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 border-2 border-ink bg-white px-3 py-1.5 text-xs font-extrabold shadow-[2px_2px_0_var(--color-shadow)] max-w-xs"
                  >
                    <span className="animate-pulse">{otherUser.username} is typing</span>
                    <span className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink animate-bounce" />
                      <span className="h-1.5 w-1.5 rounded-full bg-ink animate-bounce [animation-delay:0.15s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-ink animate-bounce [animation-delay:0.3s]" />
                    </span>
                  </motion.div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer */}
              <form
                onSubmit={handleSendMessage}
                className="shrink-0 border-t-4 border-ink bg-white p-3 shadow-[0_-2px_0_var(--color-shadow)]"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    rows={1}
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                    className="flex-1 resize-none border-2 border-ink bg-paper p-2.5 text-sm font-semibold shadow-[2px_2px_0_var(--color-shadow)] focus:outline-none focus:ring-2 focus:ring-lime"
                    style={{ minHeight: "44px", maxHeight: "120px" }}
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || sending}
                    className="border-2 border-ink bg-coral px-4 py-2.5 font-display text-sm font-extrabold text-on-brand shadow-[3px_3px_0_var(--color-shadow)] disabled:opacity-50 hover:brightness-105 active:scale-95 transition-all"
                  >
                    {sending ? "SENDING…" : "SEND"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            /* Empty selection state on desktop */
            <div className="m-auto max-w-md p-8 text-center">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border-4 border-ink bg-lime text-3xl shadow-[4px_4px_0_var(--color-shadow)]">
                💬
              </div>
              <p className="font-note text-3xl">open a door</p>
              <h2 className="mt-1 font-display text-2xl font-extrabold">Select a conversation</h2>
              <p className="mt-2 text-xs font-semibold text-ink/75">
                Pick someone from your Same Sky connections on the left to start or continue your conversation.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center font-bold">Loading Same Sky Chat…</div>}>
      <ChatContent />
    </Suspense>
  );
}
