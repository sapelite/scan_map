import { NextRequest } from "next/server";
import {
  withBrowser, discoverPlaceLinks, extractMapsTarget, buildLeadFromTarget,
  runPool, LEAD_CONCURRENCY,
} from "@/lib/engine";
import { getLeads, saveLead } from "@/lib/database";
import { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // allow long sweeps

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

type SweepEvent =
  | { type: "plan"; combos: number; niches: number; areas: number }
  | { type: "status"; msg: string; i: number; total: number }
  | { type: "result"; data: Lead }
  | { type: "tick"; found: number; saved: number; skipped: number; noWeb: number }
  | { type: "done"; found: number; saved: number; skipped: number; noWeb: number }
  | { type: "error"; msg: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const niches: string[] = Array.isArray(body.niches) ? body.niches.filter(Boolean) : [];
  const areas: string[] = Array.isArray(body.areas) ? body.areas.filter(Boolean) : [];
  const region: string = typeof body.region === "string" && body.region.trim() ? body.region.trim() : "Bali";
  const perCombo: number = Math.min(Math.max(Number(body.perCombo) || 5, 1), 30);
  const maxLeads: number = Math.min(Math.max(Number(body.maxLeads) || 200, 1), 2000);
  // Chosen up front: only no-website, only with-website, or both.
  const websiteFilter: "none_only" | "with_only" | "any" =
    body.websiteFilter === "with_only" || body.websiteFilter === "any" ? body.websiteFilter : "none_only";

  if (niches.length === 0 || areas.length === 0) {
    return new Response(JSON.stringify({ error: "Pick at least one niche and one area." }), { status: 400 });
  }

  // Build the combo plan (niche × area).
  const combos: Array<{ niche: string; area: string }> = [];
  for (const area of areas) for (const niche of niches) combos.push({ niche, area });

  // No-website businesses are the minority, so scan deeper when we only want those.
  const depth = websiteFilter === "none_only" ? Math.min(perCombo * 3 + 8, 60) : Math.min(perCombo * 2 + 4, 40);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: SweepEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ }
      };

      let found = 0, saved = 0, skipped = 0, noWeb = 0;

      try {
        // Resume support: skip anything already in the library.
        const existing = await getLeads();
        const seenNames = new Set(existing.map((l) => norm(l.name)));
        const seenMaps = new Set(existing.map((l) => l.mapsUrl).filter(Boolean));

        send({ type: "plan", combos: combos.length, niches: niches.length, areas: areas.length });
        send({
          type: "status", i: 0, total: combos.length,
          msg: websiteFilter === "none_only" ? "Looking for businesses with no website"
            : websiteFilter === "with_only" ? "Looking for businesses that have a website"
            : "Looking for all businesses",
        });

        await withBrowser(async (browser) => {
          for (let i = 0; i < combos.length; i++) {
            if (req.signal.aborted) break;
            if (found >= maxLeads) {
              send({ type: "status", msg: `Reached cap of ${maxLeads} leads — stopping.`, i, total: combos.length });
              break;
            }
            const { niche, area } = combos[i];
            send({ type: "status", msg: `${niche} · ${area}`, i, total: combos.length });

            let links: string[] = [];
            try {
              links = await discoverPlaceLinks(browser, niche, `${area}, ${region}`, depth);
            } catch {
              send({ type: "status", msg: `${niche} · ${area}: search failed, skipping`, i, total: combos.length });
              continue;
            }

            let keptThisCombo = 0;
            // Audit several businesses in parallel (a headless browser handles a
            // few pages at once); stop pulling work once a cap is hit.
            const stop = () => req.signal.aborted || found >= maxLeads || keptThisCombo >= perCombo;
            await runPool(links, LEAD_CONCURRENCY, async (link) => {
              if (seenMaps.has(link)) { skipped++; send({ type: "tick", found, saved, skipped, noWeb }); return; }
              seenMaps.add(link);

              const target = await extractMapsTarget(browser, link);
              if (!target) return;

              const nameKey = norm(target.name);
              if (seenNames.has(nameKey)) { skipped++; send({ type: "tick", found, saved, skipped, noWeb }); return; }
              seenNames.add(nameKey);

              // Website focus: only keep the kind of business we're actually looking for,
              // so we never spend an audit on something we don't need.
              const hasWeb = !!target.website;
              if (websiteFilter === "none_only" && hasWeb) return;
              if (websiteFilter === "with_only" && !hasWeb) return;
              if (stop()) return;

              try {
                const lead = await buildLeadFromTarget(browser, target, niche);
                const didSave = await saveLead(lead);
                found++;
                if (didSave) saved++; else skipped++;
                if (!hasWeb) noWeb++;
                keptThisCombo++;
                send({ type: "result", data: lead });
                send({ type: "tick", found, saved, skipped, noWeb });
              } catch {
                /* one business failing shouldn't kill the sweep */
              }
            }, stop);
          }
        });

        send({ type: "done", found, saved, skipped, noWeb });
      } catch (err) {
        console.error("Sweep error:", err);
        send({ type: "error", msg: "Sweep failed unexpectedly." });
        send({ type: "done", found, saved, skipped, noWeb });
      } finally {
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
