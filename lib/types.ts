// lib/types.ts

export interface Lead {
  id: string;
  name: string;
  url: string;
  email: string;
  tech: string;
  rating: number;
  reviews: string;
  address: string;
  phone: string;
  mapsUrl: string;
  isSocialUrl: boolean;
  authorityScore: number;
  date?: string;    // Added for CRM view
  status?: string;  // Added for CRM view
  notes?: string;   // Free-form notes per lead
  stats: {
    score: number;
    riskLevel: "Critical" | "High Risk" | "Medium" | "Low";
  };
  pitch: string;
}

export type LeadStatus = "NEW" | "CONTACTED" | "CLOSED" | "REJECTED";

export const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];