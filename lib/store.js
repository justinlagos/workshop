// File-backed store (Express local dev + Netlify local fallback).
// Schema per applicant:
//   reference, fullName, email, country, whatsapp, aiExperience, claudePlan,
//   projectGoal, currency, classification, classificationScore,
//   classificationBreakdown, rulesVersion, status, createdAt, ip,
//   invite: { sessionId, url, amount, currency, createdAt, remindedAt } | null
//   payment: { receipt, amount, currency, paidAt, eventId } | null
// Statuses: applied | invited | paid | waitlisted | foundation | reviewed
// processedEvents: [stripe event ids] for webhook idempotency.

import fs from 'node:fs';
import path from 'node:path';

export function createFileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ applicants: [], processedEvents: [], payments: [] }));
  }
  const read = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) return { applicants: raw, processedEvents: [], payments: [] }; // legacy shape
      return {
        applicants: raw.applicants || [],
        processedEvents: raw.processedEvents || [],
        payments: raw.payments || [], // complete payment + booking history ledger
      };
    } catch {
      return { applicants: [], processedEvents: [], payments: [] };
    }
  };
  const write = (data) => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  return {
    all() { return read().applicants; },
    get(ref) { return read().applicants.find((a) => a.reference === ref); },
    getByEmail(email) {
      return read().applicants.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
    },
    getBySession(sessionId) {
      return read().applicants.find((a) => a.invite && a.invite.sessionId === sessionId);
    },
    insert(row) {
      const data = read();
      data.applicants.push(row);
      write(data);
    },
    update(ref, patch) {
      const data = read();
      const i = data.applicants.findIndex((a) => a.reference === ref);
      if (i === -1) return null;
      data.applicants[i] = { ...data.applicants[i], ...patch };
      write(data);
      return data.applicants[i];
    },
    paidCount() { return read().applicants.filter((a) => a.status === 'paid').length; },
    // Append-only payment/booking ledger: { reference, receipt, amount, currency,
    // at, source: 'stripe-webhook' | 'manual-exception', eventId }
    logPayment(entry) {
      const data = read();
      data.payments.push({ at: new Date().toISOString(), ...entry });
      write(data);
    },
    paymentHistory() { return read().payments; },
    hasEvent(eventId) { return read().processedEvents.includes(eventId); },
    markEvent(eventId) {
      const data = read();
      if (!data.processedEvents.includes(eventId)) {
        data.processedEvents.push(eventId);
        write(data);
      }
    },
  };
}
