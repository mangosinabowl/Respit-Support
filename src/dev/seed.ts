import type { RespiteDb } from "../store/db";
import type { DomainEvent } from "../domain/events";

/**
 * Demonstration data: three months of realistic work, for looking at the app
 * with something in it.
 *
 * Kept in the repository rather than as a dump of one machine's database, so it
 * can be re-run at any time and stays readable when a record's shape changes.
 * It never runs on its own; it has to be asked for.
 *
 * In the browser console: respiteSeed() to load it, respiteWipe() to clear.
 */
export async function seedDemoData(db: RespiteDb, deviceId: string): Promise<number> {
  let seq = 0;
  const events: DomainEvent[] = [];
  const uid = () => crypto.randomUUID();
  const RECORDED_AT = new Date(2026, 5, 1, 9).toISOString();
  /**
   * occurredAt is when the work happened; recordedAt is when it was written
   * down, and every seeded record is written down at the same early moment.
   *
   * They must not be the same value. Some demo records are dated in the future,
   * and giving them a future recordedAt made them beat any real edit made
   * today: last-write-wins compares recordedAt, so a change would be applied
   * and then silently lose to the record it was changing.
   */
  const RECORDED = RECORDED_AT;
  const meta = (at: string) => ({ occurredAt: at, recordedAt: RECORDED, zone: "America/Vancouver", tags: [], customFields: {} });
  const put = (entityType: string, entityId: string, fields: Record<string, unknown>, _at: string) => {
    seq += 1;
    // The EVENT's recordedAt decides ordering, so it uses the same early moment
    // rather than the date the thing happened on.
    events.push({ eventId: uid(), entityType, entityId, fields, recordedAt: RECORDED, deviceId, seq } as unknown as DomainEvent);
  };
  const iso = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

  const people = [
    { id: uid(), name: "Rory", rate: 2000, rule: "fullPerPayer" },
    { id: uid(), name: "Mia", rate: 3200, rule: "splitEvenly" },
    { id: uid(), name: "Jonah", rate: 2750, rule: "splitEvenly" },
    { id: uid(), name: "Placeholder", rate: 0, rule: "fullPerPayer" },
  ];
  for (const p of people) {
    const at = iso(2026, 6, 15, 9);
    put("client", p.id, { name: p.name, defaultRate: p.rate, defaultTimeRule: p.rule, ...meta(at) }, at);
    put("party", `payer-${p.id}`, { kind: "org", name: `${p.name} (payer)`, defaultMileageRate: 68, mileagePolicy: "perTrip", ...meta(at) }, at);
    for (const role of ["payer", "guardian"]) put("role", uid(), { clientId: p.id, partyId: `payer-${p.id}`, role, ...meta(at) }, at);
  }
  const [rory, mia, jonah, ph] = people;
  const per = (p: typeof rory, f: string, t: string) =>
    ({ clientId: p.id, payerPartyId: `payer-${p.id}`, inAt: f, outAt: t, payRate: p.rate, timeRule: p.rule });

  const shifts: { id: string; startAt: string }[] = [];
  const shift = (y: number, m: number, d: number, sh: number, eh: number, who: unknown[], o: { status?: string; incident?: boolean } = {}) => {
    const id = uid();
    const startAt = iso(y, m, d, sh);
    put("shift", id, {
      startAt, endAt: iso(y, m, d, eh), participants: who,
      isIncident: !!o.incident, reimbursementStatus: o.status ?? "unclaimed", ...meta(startAt),
    }, startAt);
    shifts.push({ id, startAt });
  };

  // July, long since settled.
  shift(2026, 7, 2, 9, 15, [per(rory, iso(2026, 7, 2, 9), iso(2026, 7, 2, 15))], { status: "paid" });
  shift(2026, 7, 9, 10, 14, [per(mia, iso(2026, 7, 9, 10), iso(2026, 7, 9, 14))], { status: "paid" });
  shift(2026, 7, 16, 13, 18, [per(rory, iso(2026, 7, 16, 13), iso(2026, 7, 16, 18))], { status: "paid" });
  shift(2026, 7, 23, 9, 12, [per(jonah, iso(2026, 7, 23, 9), iso(2026, 7, 23, 12))], { status: "paid" });

  // August, invoiced and still waiting on the money.
  shift(2026, 8, 4, 9, 16, [per(rory, iso(2026, 8, 4, 9), iso(2026, 8, 4, 16))], { status: "submitted" });
  shift(2026, 8, 6, 14, 19, [per(mia, iso(2026, 8, 6, 14), iso(2026, 8, 6, 19)), per(jonah, iso(2026, 8, 6, 15), iso(2026, 8, 6, 19))], { status: "submitted" });
  shift(2026, 8, 11, 8, 13, [per(rory, iso(2026, 8, 11, 8), iso(2026, 8, 11, 13))], { status: "submitted" });
  shift(2026, 8, 13, 16, 21, [per(mia, iso(2026, 8, 13, 16), iso(2026, 8, 13, 21))], { status: "submitted", incident: true });
  shift(2026, 8, 18, 9, 14, [per(jonah, iso(2026, 8, 18, 9), iso(2026, 8, 18, 14))], { status: "submitted" });
  shift(2026, 8, 20, 10, 17, [per(rory, iso(2026, 8, 20, 10), iso(2026, 8, 20, 17)), per(mia, iso(2026, 8, 20, 12), iso(2026, 8, 20, 17))], { status: "submitted" });
  shift(2026, 8, 25, 13, 18, [per(rory, iso(2026, 8, 25, 13), iso(2026, 8, 25, 18))], { status: "submitted" });
  shift(2026, 8, 27, 9, 12, [per(jonah, iso(2026, 8, 27, 9), iso(2026, 8, 27, 12))], { status: "submitted" });

  // September, not claimed yet. The 2nd has three children on three payers.
  shift(2026, 9, 1, 9, 15, [per(rory, iso(2026, 9, 1, 9), iso(2026, 9, 1, 15))]);
  shift(2026, 9, 2, 14, 20, [per(mia, iso(2026, 9, 2, 14), iso(2026, 9, 2, 20)), per(jonah, iso(2026, 9, 2, 16), iso(2026, 9, 2, 20)), per(rory, iso(2026, 9, 2, 14), iso(2026, 9, 2, 18))]);
  shift(2026, 9, 3, 8, 12, [per(rory, iso(2026, 9, 3, 8), iso(2026, 9, 3, 12))]);
  shift(2026, 9, 5, 15, 21, [per(mia, iso(2026, 9, 5, 15), iso(2026, 9, 5, 21))], { incident: true });
  shift(2026, 9, 8, 9, 14, [per(jonah, iso(2026, 9, 8, 9), iso(2026, 9, 8, 14))]);
  shift(2026, 9, 10, 10, 16, [per(rory, iso(2026, 9, 10, 10), iso(2026, 9, 10, 16))]);
  shift(2026, 9, 12, 13, 19, [per(mia, iso(2026, 9, 12, 13), iso(2026, 9, 12, 19)), per(jonah, iso(2026, 9, 12, 13), iso(2026, 9, 12, 19))]);
  shift(2026, 9, 15, 9, 13, [per(ph, iso(2026, 9, 15, 9), iso(2026, 9, 15, 13))]);

  const share = (p: typeof rory, amount: number) => ({ clientId: p.id, payerPartyId: `payer-${p.id}`, amount });
  const expense = (y: number, m: number, d: number, desc: string, cents: number, splits: unknown[], status = "unclaimed") => {
    const at = iso(y, m, d, 12);
    put("expense", uid(), {
      description: desc, totalAmount: cents, category: "other", shiftId: null,
      receiptAttachmentIds: [], reimbursementStatus: status, splits, ...meta(at),
    }, at);
  };
  expense(2026, 7, 2, "Swimming and lunch", 3400, [share(rory, 3400)], "paid");
  expense(2026, 7, 16, "Cinema tickets", 2600, [share(rory, 2600)], "paid");
  expense(2026, 8, 6, "Lunch for two", 3000, [share(mia, 1500), share(jonah, 1500)], "submitted");
  expense(2026, 8, 13, "Art supplies", 1875, [share(mia, 1875)], "submitted");
  expense(2026, 8, 20, "Zoo entry", 4500, [share(rory, 2250), share(mia, 2250)], "submitted");
  expense(2026, 9, 2, "Lunch for three", 4500, [share(rory, 1500), share(mia, 1500), share(jonah, 1500)]);
  expense(2026, 9, 5, "Bowling", 2200, [share(mia, 2200)]);
  expense(2026, 9, 10, "Groceries for baking", 1640, [share(rory, 1640)]);
  expense(2026, 9, 12, "Trampoline park", 3800, [share(mia, 1900), share(jonah, 1900)]);

  const trip = (y: number, m: number, d: number, purpose: string, km: number, who: typeof people, status = "unclaimed") => {
    const at = iso(y, m, d, 11);
    const rate = 68;
    const each = km / who.length;
    put("trip", uid(), {
      distance: km, distanceUnit: "km", purpose, isClaimable: true, shiftId: null, reimbursementStatus: status,
      splits: who.map((p) => ({
        clientId: p.id, payerPartyId: `payer-${p.id}`, distanceShare: each, rateApplied: rate,
        claimAmount: Math.ceil(Number((each * rate).toPrecision(12))),
      })),
      ...meta(at),
    }, at);
  };
  trip(2026, 7, 2, "Pool and back", 14, [rory], "paid");
  trip(2026, 8, 6, "Lunch run", 9, [mia, jonah], "submitted");
  trip(2026, 8, 20, "Zoo", 42, [rory, mia], "submitted");
  trip(2026, 9, 2, "Park and lunch", 18, [rory, mia, jonah]);
  trip(2026, 9, 5, "Bowling alley", 11, [mia]);
  trip(2026, 9, 10, "Shops", 7, [rory]);
  trip(2026, 9, 12, "Trampoline park", 23, [mia, jonah]);

  const note = (i: number, body: string, payer: boolean, guardian: boolean) => {
    const at = shifts[i].startAt;
    put("note", uid(), {
      body, attachedToType: "shift", attachedToId: shifts[i].id,
      visibility: { me: true, payer, guardian }, ...meta(at),
    }, at);
  };
  note(7, "Very unsettled after the fire alarm. Calmed down after a walk. Parents told at pickup.", false, true);
  note(16, "Great session. Asked to go again next week.", false, true);
  note(13, "Late finish agreed with the family on the day.", true, true);
  note(10, "Reminder to self: bring the spare inhaler next time.", false, false);
  note(18, "Wet clothes sent home in the blue bag.", false, true);

  const adjAt = iso(2026, 9, 12, 18);
  put("adjustment", uid(), { payerPartyId: `payer-${rory.id}`, amountDelta: -1500, note: "Agreed goodwill discount for the late start on 1 Sept", ...meta(adjAt) }, adjAt);
  put("adjustment", uid(), { payerPartyId: `payer-${mia.id}`, amountDelta: 2000, note: "Agreed late finish on 5 Sept, two hours over", ...meta(adjAt) }, adjAt);

  const paidAt = iso(2026, 8, 1, 10);
  put("submission", uid(), {
    kind: "invoice", payerPartyId: `payer-${rory.id}`, clientId: rory.id, clientName: "Rory",
    issuedAt: iso(2026, 7, 28, 9), paidAt, amount: 18952,
    time: 12000, expenses: 6000, mileage: 952, adjustments: 0,
    covers: { shifts: [shifts[0].id, shifts[2].id], expenses: [], trips: [] }, ...meta(paidAt),
  }, paidAt);

  // Replaces whatever is there. This is demonstration data, not something to
  // merge into real records.
  await db.transaction("rw", db.events, db.seqs, async () => {
    await db.events.clear();
    await db.seqs.clear();
    await db.events.bulkAdd(events);
    await db.seqs.put({ deviceId, nextSeq: seq });
  });
  return events.length;
}

/** Empties the local database. Used by respiteWipe() in the console. */
export async function wipeAll(db: RespiteDb): Promise<void> {
  await db.transaction("rw", db.events, db.seqs, async () => {
    await db.events.clear();
    await db.seqs.clear();
  });
}
