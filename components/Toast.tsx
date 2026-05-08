"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "info" | "success" | "warn" | "error";
interface Toast { id: number; kind: ToastKind; msg: string; }

interface ToastApi { push: (msg: string, kind?: ToastKind) => void; }

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) return { push: (m: string) => console.warn("[toast not mounted]", m) };
  return ctx;
};

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  warn:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  error:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
  info:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
};

const KIND_COLOR: Record<ToastKind, string> = {
  success: "text-[#34c759]",
  warn:    "text-[#ff9500]",
  error:   "text-[#ff3b30]",
  info:    "text-[#007aff]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-300 flex flex-col gap-2 pointer-events-none items-center">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-white border border-border shadow-(--shadow-lg) rounded-full pl-4 pr-2 py-2 flex items-center gap-3 max-w-md animate-in slide-in-from-bottom-4 fade-in duration-200"
          >
            <span className={KIND_COLOR[t.kind]}>{ICON[t.kind]}</span>
            <span className="text-sm text-foreground font-medium">{t.msg}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-1 w-7 h-7 rounded-full hover:bg-muted flex items-center justify-center text-(--tertiary-foreground) transition-colors"
              aria-label="Dismiss"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
