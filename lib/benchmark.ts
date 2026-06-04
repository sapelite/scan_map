// lib/benchmark.ts
// Compare a lead against its peers in your own library: same niche, ideally same
// area, falling back to broader. This is what makes a gap feel real to a client
// ("typical villas in Canggu score 71, you're at 38").
import { Lead, PresenceKey } from "./types";
import { BALI_AREAS } from "./bali";
import { maxFollowers } from "./leadValue";

export interface PeerBenchmark {
  label: string;           // "villas in Canggu" / "cafes in Bali" / "Bali businesses"
  count: number;           // peers used
  yourScore: number;
  medianScore: number;
  topScore: number;        // ~top-quartile target
  medianFollowers: number;
  pctWithWebsite: number;  // 0-100
  pctWithBooking: number;
  dimMedian: Partial<Record<PresenceKey, number>>;
  yourPercentile: number;  // 0-100, where this lead sits among peers
  basis: string;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

const DIMS: PresenceKey[] = ["site", "social", "marketing", "reputation", "content"];

export function peerBenchmark(lead: Lead, all: Lead[]): PeerBenchmark | null {
  const cat = (lead.category || "").toLowerCase().trim();
  const area = BALI_AREAS.find((a) => (lead.address || "").toLowerCase().includes(a.toLowerCase()));
  const scored = all.filter((l) => String(l.id) !== String(lead.id) && typeof l.stats?.score === "number");
  const catPeers = cat ? scored.filter((l) => (l.category || "").toLowerCase().trim() === cat) : [];
  const areaPeers = area ? catPeers.filter((l) => (l.address || "").toLowerCase().includes(area.toLowerCase())) : [];

  let pool: Lead[]; let label: string;
  if (areaPeers.length >= 4) { pool = areaPeers; label = `${lead.category} in ${area}`; }
  else if (catPeers.length >= 4) { pool = catPeers; label = `${lead.category} in Bali`; }
  else if (scored.length >= 8) { pool = scored; label = "Bali businesses"; }
  else return null;

  const scores = pool.map((l) => l.stats!.score);
  const topQuartile = [...scores].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(scores.length * 0.25)));
  const your = lead.stats.score;

  const dimMedian: Partial<Record<PresenceKey, number>> = {};
  for (const k of DIMS) {
    const vals = pool.map((l) => l.stats?.dimensions?.[k]).filter((v): v is number => typeof v === "number");
    if (vals.length) dimMedian[k] = median(vals);
  }

  return {
    label,
    count: pool.length,
    yourScore: your,
    medianScore: median(scores),
    topScore: Math.max(median(topQuartile), median(scores)),
    medianFollowers: median(pool.map(maxFollowers).filter((v) => v > 0)),
    pctWithWebsite: pct(pool.filter((l) => l.websiteStatus === "audited").length, pool.length),
    pctWithBooking: pct(pool.filter((l) => l.audit?.hasBooking).length, pool.length),
    dimMedian,
    yourPercentile: Math.round((scores.filter((s) => s < your).length / scores.length) * 100),
    basis: `Based on ${pool.length} ${label} in your library.`,
  };
}
