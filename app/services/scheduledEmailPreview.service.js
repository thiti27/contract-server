import { select } from '../../config/mysql.js';
import { getLoggedMap } from './scheduledEmailLog.service.js';

// ---------------------------------------------------------------------------
// Read-only calculation preview for the two upcoming automated-email features
// (Overdue Contract Requests / Contract Expiration Reminder) — Settings/Legal
// asked to see, ahead of time, exactly which contracts and recipients the real
// cron jobs will compute once they're wired up, so the grouping/date logic can
// be verified against real data before anything actually auto-sends. Nothing in
// this file sends mail or writes to the database.
// ---------------------------------------------------------------------------

const MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// contract_requests.remark -> the Overdue Contract Requests email's "Remark" column.
// Independent local copy rather than importing contractRequestHelper.js's own
// REMARK_LABELS — same controller/helper isolation convention that file's own comment
// already documents (kept in sync manually, not by import, across this codebase).
const REMARK_LABELS = {
  new: 'New Contract',
  renew: 'Renew',
  amend: 'Amend',
  claim: 'Claim Note',
  terminate: 'Terminate',
  cancel: 'Cancel Contract',
  waived: 'Waived',
};

// The round is purely a notification CYCLE, not a data filter — every round sends
// the same thing (every contract currently status = 'Drafted', no matter when it was
// requested); only the fixed day-of-year it fires/deadlines on differs between them.
export const DRAFTED_TRACKING_ROUNDS = [
  { key: 'round1', fireMonth: 2, fireDay: 1, deadlineMonth: 2, deadlineDay: 15 },
  { key: 'round2', fireMonth: 6, fireDay: 1, deadlineMonth: 6, deadlineDay: 15 },
  { key: 'round3', fireMonth: 10, fireDay: 1, deadlineMonth: 10, deadlineDay: 15 },
];

// {emId, name} for every active Legal user — emId is what the actual send jobs
// resolve to an email via getEmployeeEmail; name is only for this preview's display.
async function getLegalUsers() {
  return select(`SELECT em_id AS emId, CONCAT(first_name, ' ', last_name) AS name FROM admin_users WHERE legal = 1 AND active = 1 AND deleted_at IS NULL`);
}

// Grouped per requestor_section (matches the reference mockup: "Overdue Contract
// Requests of {Section}", "Dear Section Head & User of {Section}") — 1 email per
// section with at least one still-Drafted contract. TO = every distinct requestor in
// that section (the "User of {Section}" audience); CC = union of approver1-3 across
// every contract listed (the "Section Head/Supervisor/Manager" audience) + Legal.
export async function getDraftedTrackingPreview() {
  const today = new Date();

  const rows = await select(
    `SELECT cr.id, cr.contract_no AS contractNo, cr.supplier_name AS supplierName,
            ct.name AS contractType, cr.request_date AS requestDate, cr.remark AS remark,
            cr.created_by AS createdBy, cr.requestor_name AS requestorName,
            cr.requestor_section AS requestorSection,
            cr.approver1_em_id AS approver1EmId, cr.approver1_name AS approver1Name,
            cr.approver2_em_id AS approver2EmId, cr.approver2_name AS approver2Name,
            cr.approver3_em_id AS approver3EmId, cr.approver3_name AS approver3Name
     FROM contract_requests cr
     LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
     WHERE cr.status = 'Drafted' AND cr.deleted_at IS NULL AND cr.active = 1
     ORDER BY cr.requestor_section, cr.request_date`
  );

  const legalUsers = await getLegalUsers();
  const loggedMap = await getLoggedMap('drafted_tracking');
  const finalLoggedMap = await getLoggedMap('drafted_tracking_final');
  const year = today.getFullYear();

  const sectionMap = new Map();
  for (const row of rows) {
    const section = row.requestorSection || '(Unspecified Section)';
    if (!sectionMap.has(section)) {
      sectionMap.set(section, {
        section,
        contracts: [],
        requestorNames: new Map(), // created_by -> name, dedupes automatically
        approverNames: new Map(), // em_id -> name, dedupes automatically
      });
    }
    const group = sectionMap.get(section);
    group.contracts.push({
      id: row.id,
      contractNo: row.contractNo,
      supplierName: row.supplierName,
      contractType: row.contractType,
      requestDate: row.requestDate,
      requestorName: row.requestorName,
      remarkLabel: REMARK_LABELS[row.remark] || row.remark,
    });
    group.requestorNames.set(row.createdBy, row.requestorName || row.createdBy);
    [
      [row.approver1EmId, row.approver1Name],
      [row.approver2EmId, row.approver2Name],
      [row.approver3EmId, row.approver3Name],
    ].forEach(([emId, name]) => {
      if (emId) group.approverNames.set(emId, name || emId);
    });
  }

  const sections = [...sectionMap.values()]
    .map(group => ({
      section: group.section,
      contractCount: group.contracts.length,
      contracts: group.contracts,
      requestors: [...group.requestorNames.entries()].map(([emId, name]) => ({ emId, name })),
      ccApprovers: [...group.approverNames.entries()].map(([emId, name]) => ({ emId, name })),
      ccLegal: legalUsers,
      // Per-round send status for THIS section, this year — same entity_key shape
      // the real job/manual send both write to (see draftedTracking.job.js).
      // `eligible` mirrors the cron's own gate (today >= that round's fire date this
      // year) — a round that hasn't reached its fire date yet can't be sent, even
      // manually. finalReminderEligible/finalReminderSentAt are the same idea for the
      // FINAL REMINDER follow-up, which fires on the round's own deadline date (15-Feb/
      // 15-Jun/15-Oct) — a separate job_type ('drafted_tracking_final') and its own log
      // entries, not a second send of the same entity_key.
      rounds: DRAFTED_TRACKING_ROUNDS.map(r => {
        const fireDateThisYear = new Date(year, r.fireMonth - 1, r.fireDay);
        const finalReminderDateThisYear = new Date(year, r.deadlineMonth - 1, r.deadlineDay);
        return {
          key: r.key,
          fireDate: `${r.fireDay}-${MONTH_LABEL[r.fireMonth]}`,
          deadline: `${r.deadlineDay}-${MONTH_LABEL[r.deadlineMonth]}`,
          eligible: today >= fireDateThisYear,
          sentAt: loggedMap.get(`${group.section}_${year}_${r.key}`) || null,
          finalReminderEligible: today >= finalReminderDateThisYear,
          finalReminderSentAt: finalLoggedMap.get(`${group.section}_${year}_${r.key}`) || null,
        };
      }),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));

  return {
    asOfDate: today.toISOString().slice(0, 10),
    rounds: DRAFTED_TRACKING_ROUNDS.map(r => ({
      key: r.key,
      fireDate: `${r.fireDay}-${MONTH_LABEL[r.fireMonth]}`,
      deadline: `${r.deadlineDay}-${MONTH_LABEL[r.deadlineMonth]}`,
      isToday: today.getMonth() + 1 === r.fireMonth && today.getDate() === r.fireDay,
    })),
    sections,
  };
}

// One row per Signed contract with has_expiry=1 AND auto_renewal=0 — flat list
// (not grouped; the real job sends one email per contract), sorted by the
// computed target send date so the soonest-due reminder surfaces first.
export async function getExpirationReminderPreview() {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;

  const rows = await select(
    `SELECT cr.id, cr.contract_no AS contractNo, cr.supplier_name AS supplierName,
            ct.name AS contractType, cr.contract_purpose AS purpose,
            cr.expire_date AS expireDate, cr.reminder_before_expiry_days AS reminderDays,
            cr.created_by AS createdBy, cr.requestor_name AS requestorName,
            cr.approver1_em_id AS approver1EmId, cr.approver1_name AS approver1Name,
            cr.approver2_em_id AS approver2EmId, cr.approver2_name AS approver2Name,
            cr.approver3_em_id AS approver3EmId, cr.approver3_name AS approver3Name
     FROM contract_requests cr
     LEFT JOIN contract_types ct ON ct.id = cr.contract_type_id
     WHERE cr.status = 'Signed' AND cr.has_expiry = 1 AND cr.auto_renewal = 0
       AND cr.expire_date IS NOT NULL AND cr.reminder_before_expiry_days IS NOT NULL
       AND cr.deleted_at IS NULL AND cr.active = 1
     ORDER BY cr.expire_date`
  );

  const legalUsers = await getLegalUsers();
  const loggedMap = await getLoggedMap('expiration_reminder');

  const items = rows.map(row => {
    const expireDate = new Date(row.expireDate);
    const targetSendDate = new Date(expireDate);
    targetSendDate.setDate(targetSendDate.getDate() - row.reminderDays);
    const daysUntilSend = Math.round((targetSendDate - todayMidnight) / msPerDay);

    let sendStatus;
    if (expireDate < todayMidnight) sendStatus = 'expired';
    else if (daysUntilSend === 0) sendStatus = 'today';
    else if (daysUntilSend < 0) sendStatus = 'passed';
    else sendStatus = 'upcoming';

    const approverNames = new Map();
    [
      [row.approver1EmId, row.approver1Name],
      [row.approver2EmId, row.approver2Name],
      [row.approver3EmId, row.approver3Name],
    ].forEach(([emId, name]) => {
      if (emId) approverNames.set(emId, name || emId);
    });

    return {
      id: row.id,
      contractNo: row.contractNo,
      supplierName: row.supplierName,
      contractType: row.contractType,
      purpose: row.purpose,
      expireDate: row.expireDate,
      reminderDays: row.reminderDays,
      targetSendDate: targetSendDate.toISOString().slice(0, 10),
      daysUntilSend,
      sendStatus,
      createdBy: row.createdBy,
      requestorName: row.requestorName,
      ccApprovers: [...approverNames.entries()].map(([emId, name]) => ({ emId, name })),
      ccLegal: legalUsers,
      sentAt: row.contractNo ? loggedMap.get(row.contractNo) || null : null,
    };
  });

  return { asOfDate: today.toISOString().slice(0, 10), items };
}
