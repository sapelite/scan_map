import fs from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { Lead } from './types';

// Where leads.json lives. Set SCANMAP_DATA_DIR to a mounted volume in production
// so saved leads survive redeploys; defaults to the app directory locally.
const DATA_DIR = process.env.SCANMAP_DATA_DIR || process.cwd();
const DB_PATH = path.join(DATA_DIR, 'leads.json');

// Initialize DB if missing using sync check at startup
if (!existsSync(DB_PATH)) {
    writeFileSync(DB_PATH, JSON.stringify([]));
}

/**
 * Retrieves all leads from the local JSON vault
 */
export const getLeads = async (): Promise<Lead[]> => {
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
};

/**
 * Atomically persists the full lead list: write a temp file, then rename over
 * the real one. A rename is atomic on the same filesystem, so an interrupted or
 * overlapping write can never leave leads.json half-written (which would make
 * getLeads read it as empty and the whole library look wiped).
 */
const writeLeads = async (leads: Lead[]): Promise<void> => {
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(leads, null, 2));
    await fs.rename(tmp, DB_PATH);
};

/**
 * Persists a new lead to the database if it doesn't already exist
 */
export const saveLead = async (lead: Lead): Promise<boolean> => {
    try {
        const leads = await getLeads();

        // No-website leads carry a placeholder url ("No website detected"), so they
        // must be deduped by name+phone. Only a real http(s) url is a safe unique key.
        const keyFor = (l: Lead): string => {
            const u = (l.url || "").trim();
            return /^https?:\/\//i.test(u) ? u.toLowerCase() : `${l.name}-${l.phone}`.toLowerCase().trim();
        };
        const uniqueKey = keyFor(lead);
        const exists = leads.find((l) => keyFor(l) === uniqueKey);

        if (!exists) {
            const newLead: Lead = { 
                ...lead, 
                id: lead.id?.toString() || Date.now().toString(), 
                status: (lead.status || 'NEW').toUpperCase(),
                date: lead.date || new Date().toISOString().split('T')[0] 
            };
            
            leads.unshift(newLead);
            await writeLeads(leads);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Critical Database Write Error:", error);
        return false;
    }
};

/**
 * Cycles the status: NEW -> CONTACTED -> CLOSED -> REJECTED -> NEW
 */
export const updateStatus = async (id: string, currentStatus: string): Promise<string> => {
    try {
        const statusCycle = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];
        const normalizedStatus = (currentStatus || "NEW").toUpperCase();
        const currentIndex = statusCycle.indexOf(normalizedStatus);
        
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % statusCycle.length;
        const nextStatus = statusCycle[nextIndex];

        const leads = await getLeads();
        const targetId = id.toString().trim();
        const index = leads.findIndex(l => l.id.toString().trim() === targetId);
        
        if (index !== -1) {
            leads[index].status = nextStatus;
            await writeLeads(leads);
            return nextStatus;
        }
        throw new Error("Target not found");
    } catch (error) {
        console.error("Status Update Error:", error);
        throw error;
    }
};

/**
 * Replaces a lead in place by id (used by re-audit). Preserves position.
 */
export const replaceLead = async (next: Lead): Promise<void> => {
    const leads = await getLeads();
    const targetId = next.id.toString().trim();
    const index = leads.findIndex(l => l.id.toString().trim() === targetId);
    if (index === -1) {
        leads.unshift(next);
    } else {
        leads[index] = next;
    }
    await writeLeads(leads);
};

/**
 * Sets the status to a specific value (no cycling)
 */
export const setStatus = async (id: string, nextStatus: string): Promise<string> => {
    const allowed = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];
    const status = (nextStatus || "NEW").toUpperCase();
    if (!allowed.includes(status)) throw new Error(`Invalid status: ${status}`);

    const leads = await getLeads();
    const targetId = id.toString().trim();
    const index = leads.findIndex(l => l.id.toString().trim() === targetId);
    if (index === -1) throw new Error("Target not found");

    leads[index].status = status;
    await writeLeads(leads);
    return status;
};

/**
 * Updates the notes field on a lead
 */
export const updateNotes = async (id: string, notes: string): Promise<void> => {
    const leads = await getLeads();
    const targetId = id.toString().trim();
    const index = leads.findIndex(l => l.id.toString().trim() === targetId);
    if (index === -1) throw new Error("Target not found");

    leads[index].notes = notes;
    await writeLeads(leads);
};

/**
 * Applies a status change to many leads at once
 */
export const bulkSetStatus = async (ids: string[], nextStatus: string): Promise<number> => {
    const allowed = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];
    const status = (nextStatus || "NEW").toUpperCase();
    if (!allowed.includes(status)) throw new Error(`Invalid status: ${status}`);

    const leads = await getLeads();
    const idSet = new Set(ids.map(i => i.toString().trim()));
    let count = 0;
    for (const lead of leads) {
        if (idSet.has(lead.id.toString().trim())) {
            lead.status = status;
            count++;
        }
    }
    await writeLeads(leads);
    return count;
};

/**
 * Bulk-deletes leads
 */
export const bulkDelete = async (ids: string[]): Promise<number> => {
    const leads = await getLeads();
    const idSet = new Set(ids.map(i => i.toString().trim()));
    const remaining = leads.filter(l => !idSet.has(l.id.toString().trim()));
    const removed = leads.length - remaining.length;
    if (removed > 0) {
        await writeLeads(remaining);
    }
    return removed;
};

/**
 * Permanently removes a lead from the vault
 */
export const deleteLead = async (id: string): Promise<void> => {
    try {
        const leads = await getLeads();
        const targetId = id.toString().trim();
        const filteredLeads = leads.filter(l => l.id.toString().trim() !== targetId);
        
        if (leads.length === filteredLeads.length) {
            console.warn(`Purge attempted but no ID matched: ${id}`);
            return;
        }

        await writeLeads(filteredLeads);
    } catch (error) {
        console.error("Database Delete Error:", error);
        throw error;
    }
};