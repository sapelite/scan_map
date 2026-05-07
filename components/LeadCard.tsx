"use client"

import React from 'react';
import { Lead } from '@/lib/types';

interface LeadCardProps {
  item: Lead;
  downloadPDF: (item: Lead) => void;
}

export const LeadCard = ({ item, downloadPDF }: LeadCardProps) => {
  const isGhost = !item.url || item.url === "No Website Detected";
  const isSocial = item.isSocialUrl;
  
  let statusText = "SAFE";
  let typeCategory = "opt";
  let scoreColor = "text-white";

  if (isGhost) { 
    statusText = "NO SITE"; 
    typeCategory = "ghost"; 
    scoreColor = "text-rose-600";
  } else if (isSocial) { 
    statusText = "SOCIAL"; 
    typeCategory = "social"; 
  } else if (item.stats.score < 50) { 
    statusText = "RISK"; 
    typeCategory = "low"; 
    scoreColor = "text-rose-500";
  }

  return (
    <div className="lead-card card-bento p-6 mb-4 relative group" data-type={typeCategory}>
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="bg-zinc-800 text-zinc-500 px-2 py-0.5 text-[9px] font-mono font-bold">
              {item.tech.toUpperCase()}
            </span>
            <span className="text-orange-500 text-[10px] font-black uppercase tracking-widest">
              {statusText}
            </span>
            <span className="text-zinc-600 text-[10px]">★ {item.rating || 'N/A'}</span>
          </div>
          
          <h4 className="text-white text-xl font-black uppercase tracking-tighter mb-1 truncate max-w-[280px]">
            {item.name}
          </h4>
          <p className="text-zinc-600 text-[10px] font-mono uppercase mb-4">
            {item.address || 'LOCATION_UNKNOWN'}
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/40 p-4 border border-zinc-800/50">
            <div>
              <span className="text-zinc-600 text-[9px] font-black uppercase block mb-1">Web Protocol</span>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 text-xs truncate block hover:text-orange-500 transition-colors">
                {item.url}
              </a>
            </div>
            <div>
              <span className="text-zinc-600 text-[9px] font-black uppercase block mb-1">Contact Channel</span>
              <span className="text-zinc-300 text-xs font-mono select-all break-all">
                {item.email}
              </span>
            </div>
          </div>

          <div className="mt-4 relative group/pitch">
            <p className="text-zinc-500 text-[11px] italic leading-relaxed border-l-2 border-zinc-800 pl-4 py-1 pr-10">
              {"\""}{item.pitch}{"\""}
            </p>
            <button 
              onClick={() => navigator.clipboard.writeText(item.pitch)}
              className="absolute right-2 top-2 text-zinc-700 hover:text-white transition-all cursor-pointer opacity-0 group-hover/pitch:opacity-100"
              title="Copy Pitch"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </button>
          </div>
        </div>
        
        <div className="mt-6 md:mt-0 md:ml-10 flex flex-col items-end shrink-0">
          <div className="text-right mb-6">
            <div className={`text-6xl font-black font-mono tracking-tighter ${scoreColor}`}>
              {item.stats.score}%
            </div>
            <div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Efficiency Rating</div>
          </div>
          <div className="flex flex-col gap-2 w-full min-w-[140px]">
            <button 
              onClick={() => window.open(item.mapsUrl, '_blank')}
              className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-black uppercase transition-all cursor-pointer"
            >
              View Coordinates
            </button>
            <button 
              onClick={() => downloadPDF(item)}
              className="w-full py-2 border border-zinc-700 text-zinc-500 hover:text-white hover:border-white text-[10px] font-black uppercase transition-all cursor-pointer"
            >
              Extract Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};