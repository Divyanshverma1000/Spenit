"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ChevronLeft, Camera, Image as ImageIcon, Users, User as UserIcon } from "lucide-react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";
import { motion, AnimatePresence } from "framer-motion";
import { useAIExpense } from "@/hooks/useAIExpense";
import ExpenseConfirmCard from "@/components/ExpenseConfirmCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function GlobalScanPage() {
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();
  
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [showGroupSelect, setShowGroupSelect] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = useAIExpense();

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/groups`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(res => res.json())
      .then(data => setGroups(data || []))
      .catch(console.error);
  }, [accessToken]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });
      newImages.push(base64);
    }

    setSelectedImages(prev => [...prev, ...newImages]);
  };

  const handleSelectContext = (groupId?: string) => {
    setShowGroupSelect(false);
    if (selectedImages.length > 0) {
      ai.parseReceipt(selectedImages, groupId || "");
    }
  };

  useEffect(() => {
    if (ai.state === "fallback" && ai.fallbackData) {
      const reason = ai.fallbackData.reason;
      if (reason === "config_error") {
        alert("Bring your own AI: Groq API Key required. Please set it in your Profile.");
        router.push("/profile");
        return;
      }
      alert("Failed to parse receipt correctly. Please add manually.");
      router.push("/dashboard");
    }
  }, [ai.state, ai.fallbackData, router]);

  useEffect(() => {
    if (ai.state === "done") {
      setTimeout(() => router.push("/dashboard"), 1500);
    }
  }, [ai.state, router]);

  if (!authed) return null;

  if ((ai.state === "review" || ai.state === "submitting") && ai.draft) {
    // If it's a personal context (no groupId selected), we pass a dummy group ID 
    // or we'd ideally render a different card. For now, pass empty members/groupId
    // and let submitDraft handle it.
    return (
      <div className="min-h-screen bg-black text-white pb-24">
        <header className="px-5 py-4 flex items-center gap-4 border-b border-white/10">
          <button onClick={() => ai.reset()} className="text-white/70 hover:text-white p-1 -ml-1">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-[17px] font-bold tracking-tight">Confirm Receipt</h1>
        </header>
        <main className="p-5">
          <ExpenseConfirmCard 
            draft={ai.draft} 
            members={[]} 
            groupId={""} 
            onConfirmed={() => {}} 
            onManual={() => {}} 
            onCancel={ai.reset} 
            isSubmitting={ai.state === "submitting"} 
            onSubmit={async (updated) => { await ai.submitDraft(updated, ""); }} 
          />
        </main>
      </div>
    );
  }

  if (ai.state === "parsing") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-white/10 border-t-[var(--accent)] rounded-full animate-spin mb-6"></div>
        <h2 className="text-[20px] font-bold">Analyzing Receipt...</h2>
        <p className="text-white/50 mt-2 text-[14px]">Extracting items and amounts</p>
      </div>
    );
  }

  if (ai.state === "done") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-[20px] font-bold">Saved Successfully</h2>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)] pb-24 flex flex-col">
      <header className="px-5 py-4 flex items-center gap-4 bg-[var(--bg-main)]/80 backdrop-blur-md sticky top-0 z-10 border-b border-[rgba(0,0,0,0.05)]">
        <Link href="/dashboard" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 -ml-1 active:scale-95 transition-transform">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-[17px] font-bold text-[var(--text-primary)] tracking-tight">Scan Receipt</h1>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        {selectedImages.length > 0 ? (
          <div className="w-full max-w-md flex flex-col items-center">
            <h2 className="text-[20px] font-extrabold text-[var(--text-primary)] mb-6">
              {selectedImages.length} Image{selectedImages.length > 1 ? 's' : ''} Selected
            </h2>
            <div className="grid grid-cols-2 gap-3 w-full mb-8 max-h-[50vh] overflow-y-auto pr-2 pb-2">
              {selectedImages.map((img, idx) => (
                <div key={idx} className="relative rounded-[16px] overflow-hidden aspect-[3/4] border border-[rgba(0,0,0,0.05)] shadow-sm">
                  <img src={img} alt={`Receipt ${idx + 1}`} className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-2 right-2 w-8 h-8 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 w-full">
              <button 
                onClick={() => setShowGroupSelect(true)}
                disabled={selectedImages.length === 0}
                className="w-full bg-[var(--accent)] text-white font-bold text-[15px] py-4 rounded-[16px] shadow-[0_8px_20px_rgba(245,158,11,0.25)] active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100"
              >
                Process Receipts
              </button>
              <button 
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute('capture');
                    fileInputRef.current.multiple = true;
                    fileInputRef.current.click();
                  }
                }}
                className="w-full bg-[var(--paper)] text-[var(--text-primary)] font-bold text-[15px] py-4 rounded-[16px] border border-[rgba(0,0,0,0.05)] active:scale-95 transition-transform"
              >
                + Add More Photos
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="w-24 h-24 bg-[var(--accent)]/10 text-[var(--accent)] rounded-full flex items-center justify-center mb-6">
              <Camera size={40} />
            </div>
            <h2 className="text-[22px] font-extrabold text-[var(--text-primary)] mb-2">Capture a Receipt</h2>
            <p className="text-[14px] text-[var(--text-secondary)] mb-10 max-w-xs">
              Upload clear photos of your receipts and let AI do the data entry for you.
            </p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button 
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.setAttribute('capture', 'environment');
                    fileInputRef.current.multiple = false;
                    fileInputRef.current.click();
                  }
                }}
                className="w-full bg-[var(--accent)] text-white font-bold text-[15px] py-4 rounded-[16px] shadow-[0_8px_20px_rgba(245,158,11,0.25)] active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <Camera size={20} /> Open Camera
              </button>
              
              <button 
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute('capture');
                    fileInputRef.current.multiple = true;
                    fileInputRef.current.click();
                  }
                }}
                className="w-full bg-[var(--paper)] text-[var(--text-primary)] font-bold text-[15px] py-4 rounded-[16px] border border-[rgba(0,0,0,0.05)] active:scale-95 transition-transform flex items-center justify-center gap-2"
              >
                <ImageIcon size={20} /> Choose from Gallery
              </button>
            </div>
          </>
        )}

        <input 
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleImageSelect}
        />
      </main>

      <AnimatePresence>
        {showGroupSelect && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-[var(--bg-main)] rounded-t-[24px] p-6 w-full max-w-md mx-auto relative shadow-[0_-10px_40px_rgba(0,0,0,0.2)] pb-safe"
            >
              <button 
                onClick={() => setShowGroupSelect(false)}
                className="absolute top-4 right-4 text-[var(--text-muted)] p-2 hover:bg-[var(--paper)] rounded-full"
              >
                ✕
              </button>
              
              <h3 className="text-[20px] font-extrabold text-[var(--text-primary)] mb-2">Where does this belong?</h3>
              <p className="text-[14px] text-[var(--text-secondary)] mb-6">Choose the context for this receipt</p>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 pb-6">
                <button 
                  onClick={() => handleSelectContext()}
                  className="w-full text-left bg-[var(--paper)] border border-[var(--accent)]/30 p-4 rounded-[16px] flex items-center gap-4 active:scale-95 transition-transform"
                >
                  <div className="w-12 h-12 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <UserIcon size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-[15px] text-[var(--text-primary)]">Personal Expense</h4>
                    <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">Just for me</p>
                  </div>
                </button>

                {groups.length > 0 && (
                  <div className="pt-4 pb-2">
                    <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider pl-1 mb-2">Your Groups</div>
                  </div>
                )}

                {groups.map(g => (
                  <button 
                    key={g.id}
                    onClick={() => handleSelectContext(g.id)}
                    className="w-full text-left bg-[var(--paper)] border border-[rgba(0,0,0,0.05)] p-4 rounded-[16px] flex items-center gap-4 active:scale-95 transition-transform"
                  >
                    <div className="w-12 h-12 rounded-full bg-[var(--paper-dim)] flex items-center justify-center text-[var(--text-secondary)]">
                      <Users size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-[15px] text-[var(--text-primary)]">{g.name}</h4>
                      <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">Split with group</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <BottomNav />
    </div>
  );
}
