import fs from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { Lead } from './types';

const DB_PATH = path.join(process.cwd(), 'leads.json');

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
 * Persists a new lead to the database if it doesn't already exist
 */
export const saveLead = async (lead: Lead): Promise<boolean> => {
    try {
        const leads = await getLeads();
        
        const uniqueKey = lead.url && lead.url !== "No Website Detected" 
            ? lead.url.toLowerCase().trim() 
            : `${lead.name}-${lead.phone}`.toLowerCase().trim();
        
        const exists = leads.find(l => {
            const lKey = l.url && l.url !== "No Website Detected" ? l.url.toLowerCase().trim() : `${l.name}-${l.phone}`.toLowerCase().trim();
            return lKey === uniqueKey;
        });

        if (!exists) {
            const newLead: Lead = { 
                ...lead, 
                id: lead.id?.toString() || Date.now().toString(), 
                status: (lead.status || 'NEW').toUpperCase(),
                date: lead.date || new Date().toISOString().split('T')[0] 
            };
            
            leads.unshift(newLead);
            await fs.writeFile(DB_PATH, JSON.stringify(leads, null, 2));
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
            await fs.writeFile(DB_PATH, JSON.stringify(leads, null, 2));
            return nextStatus;
        }
        throw new Error("Target not found");
    } catch (error) {
        console.error("Status Update Error:", error);
        throw error;
    }
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
    await fs.writeFile(DB_PATH, JSON.stringify(leads, null, 2));
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
    await fs.writeFile(DB_PATH, JSON.stringify(leads, null, 2));
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
    await fs.writeFile(DB_PATH, JSON.stringify(leads, null, 2));
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
        await fs.writeFile(DB_PATH, JSON.stringify(remaining, null, 2));
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

        await fs.writeFile(DB_PATH, JSON.stringify(filteredLeads, null, 2));
    } catch (error) {
        console.error("Database Delete Error:", error);
        throw error;
    }
};