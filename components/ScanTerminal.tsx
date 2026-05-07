"use client"

import React, { useEffect, useRef } from 'react';

interface ScanTerminalProps {
  logs: string[];
  isScanning: boolean;
}

export const ScanTerminal = ({ logs, isScanning }: ScanTerminalProps) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest log
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0 && !isScanning) return null;

  return (
    <div className="card-bento p-0 overflow-hidden border-primary/30 mb-6 bg-black">
      <div className="bg-zinc-900 px-4 py-2 border-b border-border flex justify-between items-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-orange-500 animate-pulse' : 'bg-zinc-700'}`}></span>
          Live Acquisition Feed
        </span>
        <span className="text-[9px] font-mono text-zinc-600">ID: PROTOCOL_STREAM_V4</span>
      </div>
      
      <div className="h-48 overflow-y-auto p-4 font-mono text-[10px] space-y-1 custom-scrollbar">
        {logs.map((log, i) => (
          <div key={i} className={`flex gap-3 ${log.includes('[FOUND]') ? 'text-emerald-500' : 'text-zinc-500'}`}>
            <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
            <span className="tracking-tighter">{log}</span>
          </div>
        ))}
        {isScanning && (
          <div className="text-primary animate-pulse flex gap-3">
             <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
             <span> RUNNING SCAN_SEQUENCER...</span>
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};