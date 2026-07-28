"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Send, Sparkles } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
}

export default function PersonalChatPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/ai/ask-personal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ question: userMsg.content })
      });

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("AI Provider (Groq) has blocked access from your network. Please try using a VPN.");
        }
        throw new Error("Failed to get answer");
      }
      
      const data = await res.json();
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: "ai", content: data.answer };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errMsg = err.message.includes("VPN") 
        ? err.message 
        : "Sorry, I had trouble answering that.";
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "ai", content: errMsg }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-main)]">
      <PageHeader title="AI Finance Manager" onBack={() => router.push("/personal")} />

      <main className="flex-1 overflow-y-auto p-4 space-y-4 pb-32 max-w-lg w-full mx-auto">
        {messages.length === 0 && (
          <div className="text-center p-8 mt-12 bg-[var(--paper-dim)] rounded-[24px] text-[var(--text-secondary)]">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-[var(--accent)]" />
            <p className="font-medium text-[var(--text-primary)]">I'm your AI Finance Manager.</p>
            <p className="text-sm mt-1">Ask me about your personal expenses or spending habits.</p>
          </div>
        )}
        
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`px-4 py-3 rounded-2xl max-w-[85%] ${
              msg.role === 'user' 
                ? 'bg-[var(--accent)] text-[var(--paper)] rounded-tr-sm' 
                : 'bg-[var(--paper)] text-[var(--text-primary)] border border-[rgba(0,0,0,0.05)] rounded-tl-sm'
            }`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 bg-[var(--paper)] border border-[rgba(0,0,0,0.05)] rounded-2xl rounded-tl-sm flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce" />
              <div className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:-0.15s]" />
              <div className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:-0.3s]" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--bg-main)]/90 backdrop-blur-md border-t border-[rgba(0,0,0,0.03)] flex justify-center">
        <div className="max-w-lg w-full flex items-center gap-2">
          <input
            type="text"
            className="input-field flex-1 px-4 py-3 text-sm rounded-full"
            placeholder="Ask anything about your spending..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="w-12 h-12 flex-shrink-0 bg-[var(--accent)] text-white rounded-full flex items-center justify-center disabled:opacity-50 transition-opacity"
          >
            <Send size={18} className="translate-x-[-1px] translate-y-[1px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
