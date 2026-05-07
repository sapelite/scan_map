"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastKind = "info" | "success" | "warn" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  msg: string;
}

interface ToastApi {
  push: (msg: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { push: (m: string) => console.warn("[toast not mounted]", m) };
  }
  return ctx;
};

const KIND_STYLES: Record<ToastKind, { border: string; bar: string; label: string; tag: string }> = {
  info:    { border: "border-zinc-500",   bar: "bg-zinc-400",    label: "text-zinc-200",   tag: "INFO" },
  success: { border: "border-emerald-500", bar: "bg-emerald-500", label: "text-emerald-300", tag: "OK" },
  warn:    { border: "border-amber-500",  bar: "bg-amber-500",   label: "text-amber-300",  tag: "WARN" },
  error:   { border: "border-rose-500",   bar: "bg-rose-500",    label: "text-rose-300",   tag: "FAIL" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const s = KIND_STYLES[t.kind];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto bg-zinc-950/95 backdrop-blur-md border ${s.border} shadow-[0_10px_40px_rgba(0,0,0,0.7)] flex items-stretch min-w-[280px] max-w-md animate-in slide-in-from-right-4 fade-in duration-200`}
            >
              <div className={`w-1 ${s.bar}`} />
              <div className="flex-1 p-3 flex items-start gap-3">
                <span className={`text-[9px] font-black uppercase tracking-widest ${s.label} font-mono pt-0.5`}>
                  {s.tag}
                </span>
                <span className="text-[11px] text-zinc-300 font-mono leading-relaxed flex-1 break-words">
                  {t.msg}
                </span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="text-zinc-600 hover:text-white text-[10px] font-black"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function ToastEscDismiss() {
  // unused convenience hook placeholder
  useEffect(() => {}, []);
  return null;
}
