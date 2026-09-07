/**
 * Populates the app with 50+ realistic users and enough workflow activity
 * that every dashboard / queue / finance / notification surface looks live.
 *
 * Idempotent for demo data: removes prior IND-2026-9xxx demo indents and
 * demo@must.co.in users (except protected core accounts), then recreates.
 *
 * Prerequisites:
 *   npm run db:seed-items
 *   ADMIN_INITIAL_PASSWORD or DEMO_USER_PASSWORD (≥12 chars)
 *
 *   npm run db:seed-demo-activity
 */
import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { query } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

const YEAR = 2026;

/** Writes a real PDF under data/uploads (required by document-store path rules). */
async function writeDemoPdf(filename: string, title: string): Promise<string> {
  const storagePath = path.join("data", "uploads", "demo", "seed", filename);
  const abs = path.resolve(process.cwd(), storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("MedFlow — Demo document", { x: 50, y: 740, size: 12, font });
  page.drawText(title.slice(0, 90), { x: 50, y: 710, size: 14, font });
  page.drawText(`File: ${filename}`, { x: 50, y: 680, size: 10, font });
  await writeFile(abs, await pdf.save());
  return storagePath.split(path.sep).join("/");
}
const DEMO_REF_MIN = 9001;
const DEMO_REF_MAX = 9120;

const FIRST = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
  "Krishna", "Ishaan", "Shaurya", "Atharv", "Advait", "Dhruv", "Kabir",
  "Ananya", "Aadhya", "Diya", "Myra", "Sara", "Anvi", "Aarohi", "Anika",
  "Navya", "Pari", "Ira", "Kiara", "Prisha", "Riya", "Saanvi",
  "Neha", "Priya", "Kavya", "Meera", "Isha", "Tanvi", "Nisha", "Pooja",
  "Rahul", "Amit", "Vikram", "Suresh", "Ramesh", "Deepak", "Nikhil", "Rohan",
  "Karan", "Manish", "Sanjay", "Ajay", "Varun", "Harsh", "Yash", "Dev",
];
const LAST = [
  "Sharma", "Patel", "Reddy", "Nair", "Iyer", "Menon", "Kapoor", "Mehta",
  "Desai", "Joshi", "Kulkarni", "Banerjee", "Chatterjee", "Mukherjee", "Gupta",
  "Agarwal", "Malhotra", "Singh", "Kaur", "Pillai", "Rao", "Shetty", "Verma",
  "Bhat", "Hegde", "Das", "Bose", "Ghosh", "Trivedi", "Pandey",
];
const DEPTS = ["R&D", "Quality Control", "Production", "Stores", "Formulation", "Packaging Ops"];

type Role = "REQUESTER" | "TEAM_LEADER" | "PROCUREMENT" | "DIRECTOR" | "MD" | "FINANCE" | "ADMIN";

type UserSeed = {
  email: string;
  username: string;
  name: string;
  role: Role;
  department: string;
};

/** Core accounts kept across re-seeds (match seed-demo-users). */
const CORE_USERS: UserSeed[] = [
  { email: "ananya.mehta@must.co.in", username: "ananya.mehta", name: "Ananya Mehta", role: "REQUESTER", department: "R&D" },
  { email: "rohan.kapoor@must.co.in", username: "rohan.kapoor", name: "Rohan Kapoor", role: "TEAM_LEADER", department: "R&D" },
  { email: "kavitha.iyer@must.co.in", username: "kavitha.iyer", name: "Kavitha Iyer", role: "PROCUREMENT", department: "Procurement" },
  { email: "suresh.menon@must.co.in", username: "suresh.menon", name: "Suresh Menon", role: "DIRECTOR", department: "Operations" },
  { email: "meera.krishnan@must.co.in", username: "meera.krishnan", name: "Meera Krishnan", role: "MD", department: "Executive" },
  { email: "arjun.desai@must.co.in", username: "arjun.desai", name: "Arjun Desai", role: "FINANCE", department: "Finance" },
];

const VENDORS = [
  { company: "Apex Pharma Chemicals Pvt Ltd", contact: "R. Menon", email: "quotes@apexpharma.example", city: "Mumbai", gst: "27AAAAA0000A1Z5", license: "WHO-GMP, FDA India", days: 18, rating: 4.6 },
  { company: "Continental Labs GmbH", contact: "H. Weber", email: "sales@continentallabs.example", city: "Munich", gst: null, license: "EU GMP, EDQM CEP", days: 28, rating: 4.8 },
  { company: "PackPro India Ltd", contact: "S. Iyer", email: "rfq@packpro.example", city: "Bengaluru", gst: "29BBBBB0000B1Z5", license: "ISO 15378", days: 12, rating: 4.3 },
  { company: "MediSource Healthcare", contact: "P. Banerjee", email: "orders@medisource.example", city: "Hyderabad", gst: "36CCCCC0000C1Z5", license: "CDSCO, ISO 13485", days: 10, rating: 4.4 },
  { company: "Sterling Excipients Ltd", contact: "A. Kulkarni", email: "sales@sterlingexc.example", city: "Pune", gst: "27DDDDD0000D1Z5", license: "USP-NF DMF", days: 15, rating: 4.5 },
  { company: "NovaGlass Packaging", contact: "L. Fernandes", email: "info@novaglass.example", city: "Goa", gst: "30EEEEE0000E1Z5", license: "DMF Type III", days: 21, rating: 4.2 },
  { company: "BioPure Solvents", contact: "K. Shah", email: "lab@biopure.example", city: "Ahmedabad", gst: "24FFFFF0000F1Z5", license: "ISO 9001", days: 7, rating: 4.1 },
  { company: "Helix API Works", contact: "M. Reddy", email: "api@helixworks.example", city: "Visakhapatnam", gst: "37GGGGG0000G1Z5", license: "USFDA inspected", days: 22, rating: 4.7 },
  { company: "CareShield Devices", contact: "N. Kaur", email: "devices@careshield.example", city: "Chandigarh", gst: "04HHHHH0000H1Z5", license: "ISO 13485, CE", days: 14, rating: 4.0 },
  { company: "Orient Foil Tech", contact: "T. Das", email: "foil@orientfoil.example", city: "Kolkata", gst: "19IIIII0000I1Z5", license: "ISO 15378", days: 16, rating: 4.3 },
  { company: "Zenith Capsules", contact: "V. Pillai", email: "caps@zenithcap.example", city: "Chennai", gst: "33JJJJJ0000J1Z5", license: "TSE/BSE free", days: 11, rating: 4.4 },
  { company: "PrimeChem Intermediates", contact: "G. Trivedi", email: "sales@primechem.example", city: "Vadodara", gst: "24KKKKK0000K1Z5", license: "WHO-GMP", days: 20, rating: 4.2 },
  { company: "Atlas Stability Services", contact: "J. Bose", email: "stability@atlaslab.example", city: "Delhi", gst: "07LLLLL0000L1Z5", license: "GLP", days: 5, rating: 4.6 },
  { company: "SafeHands Consumables", contact: "R. Verma", email: "ppe@safehands.example", city: "Noida", gst: "09MMMMM0000M1Z5", license: "ISO 9001", days: 6, rating: 3.9 },
  { company: "EuroForm Packaging SA", contact: "C. Dubois", email: "eu@euroform.example", city: "Lyon", gst: null, license: "EU GMP packaging", days: 30, rating: 4.5 },
];

type StatusPlan = {
  status: string;
  count: number;
  budget: number; // approval_budget_amount
  priority?: string;
};

const STATUS_PLANS: StatusPlan[] = [
  { status: "DRAFT", count: 5, budget: 25000 },
  { status: "PENDING_TL_INDENT", count: 5, budget: 40000 },
  { status: "REJECTED_TL_INDENT", count: 2, budget: 30000 },
  { status: "PROCUREMENT_ACTIVE", count: 4, budget: 45000 },
  { status: "RFQ_SENT", count: 3, budget: 80000 },
  { status: "AWAITING_QUOTES", count: 3, budget: 95000 },
  { status: "QUOTES_READY", count: 4, budget: 120000 },
  { status: "PENDING_TL_VENDOR", count: 3, budget: 150000 },
  { status: "REJECTED_TL_VENDOR", count: 1, budget: 110000 },
  { status: "PENDING_DIRECTOR", count: 4, budget: 250000 },
  { status: "REJECTED_DIRECTOR", count: 1, budget: 200000 },
  { status: "PENDING_MD", count: 3, budget: 750000 },
  { status: "REJECTED_MD", count: 1, budget: 900000 },
  { status: "PROCUREMENT_PO", count: 3, budget: 180000 },
  { status: "PO_DRAFT", count: 2, budget: 160000 },
  { status: "PO_SENT", count: 3, budget: 175000 },
  { status: "AWAITING_INVOICE", count: 2, budget: 140000 },
  { status: "PENDING_FINANCE", count: 3, budget: 220000 },
  { status: "PAYMENT_DONE", count: 2, budget: 130000 },
  { status: "PENDING_FINANCE_FINAL", count: 2, budget: 210000 },
  { status: "PAYMENT_PROOF_TO_VENDOR", count: 1, budget: 125000 },
  { status: "CLOSED", count: 2, budget: 90000 },
];

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 40);
}

function buildExtraUsers(): UserSeed[] {
  const out: UserSeed[] = [];
  const used = new Set(CORE_USERS.map((u) => u.email));

  const push = (first: string, last: string, role: Role, department: string) => {
    const username = slug(`${first}.${last}`);
    const email = `${username}@must.co.in`;
    if (used.has(email)) return false;
    used.add(email);
    out.push({
      email,
      username,
      name: `${first} ${last}`,
      role,
      department,
    });
    return true;
  };

  // Role-specific extras
  const extras: Array<{ role: Role; dept: string; n: number }> = [
    { role: "TEAM_LEADER", dept: "Quality Control", n: 3 },
    { role: "TEAM_LEADER", dept: "Production", n: 2 },
    { role: "PROCUREMENT", dept: "Procurement", n: 3 },
    { role: "FINANCE", dept: "Finance", n: 2 },
    { role: "DIRECTOR", dept: "Operations", n: 1 },
    { role: "REQUESTER", dept: "R&D", n: 12 },
    { role: "REQUESTER", dept: "Quality Control", n: 10 },
    { role: "REQUESTER", dept: "Production", n: 10 },
    { role: "REQUESTER", dept: "Stores", n: 8 },
  ];

  let fi = 0;
  let li = 7;
  for (const block of extras) {
    let made = 0;
    let guard = 0;
    while (made < block.n && guard < 200) {
      guard += 1;
      const ok = push(FIRST[fi % FIRST.length], LAST[li % LAST.length], block.role, block.dept);
      fi += 1;
      li += 3;
      if (ok) made += 1;
    }
  }

  // Top up requesters to ensure 50+ total with core
  while (CORE_USERS.length + out.length < 54) {
    push(FIRST[fi % FIRST.length], LAST[li % LAST.length], "REQUESTER", DEPTS[fi % DEPTS.length]);
    fi += 1;
    li += 2;
  }

  return out;
}

async function upsertUser(u: UserSeed, hash: string) {
  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
    [u.email, u.username]
  );
  if (existing.rows[0]?.id) {
    await query(
      `UPDATE users SET email=$1, username=$2, name=$3, role=$4, department=$5,
         password_hash=$6, is_active=TRUE WHERE id=$7`,
      [u.email, u.username, u.name, u.role, u.department, hash, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const inserted = await query<{ id: string }>(
    `INSERT INTO users (email, username, name, role, department, password_hash, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
    [u.email, u.username, u.name, u.role, u.department, hash]
  );
  return inserted.rows[0].id;
}

async function main() {
  const password =
    process.env.DEMO_USER_PASSWORD?.trim() || process.env.ADMIN_INITIAL_PASSWORD?.trim();
  if (!password || password.length < 12) {
    throw new Error("Set DEMO_USER_PASSWORD or ADMIN_INITIAL_PASSWORD (≥12 chars)");
  }

  const items = await query<{ id: string; sku: string; name: string }>(
    `SELECT id, sku, name FROM items ORDER BY sku`
  );
  if (items.rows.length < 8) {
    throw new Error("Run npm run db:seed-items first (need a populated catalog).");
  }

  await query(`
    INSERT INTO roles (code, label) VALUES
      ('REQUESTER', 'Requester'),
      ('TEAM_LEADER', 'Team Leader'),
      ('PROCUREMENT', 'Procurement'),
      ('DIRECTOR', 'Director'),
      ('FINANCE', 'Finance'),
      ('MD', 'Managing Director'),
      ('ADMIN', 'Admin')
    ON CONFLICT (code) DO NOTHING
  `);

  const hash = await hashPassword(password);
  const allUserSeeds = [...CORE_USERS, ...buildExtraUsers()];
  const userIdsByRole: Record<string, string[]> = {};

  for (const u of allUserSeeds) {
    const id = await upsertUser(u, hash);
    (userIdsByRole[u.role] ??= []).push(id);
  }

  // Keep existing admin; do not recreate
  const admin = await query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'ADMIN' AND is_active ORDER BY created_at ASC LIMIT 1`
  );
  if (admin.rows[0]) (userIdsByRole.ADMIN ??= []).push(admin.rows[0].id);

  const requesters = userIdsByRole.REQUESTER ?? [];
  const tls = userIdsByRole.TEAM_LEADER ?? [];
  const procurement = userIdsByRole.PROCUREMENT ?? [];
  const directors = userIdsByRole.DIRECTOR ?? [];
  const mds = userIdsByRole.MD ?? [];
  const finance = userIdsByRole.FINANCE ?? [];

  if (!requesters.length || !tls.length || !procurement.length) {
    throw new Error("Missing required roles after user seed");
  }

  // Clear previous demo indents (cascade children)
  await query(
    `DELETE FROM indents
      WHERE reference ~ $1`,
    [`^IND-${YEAR}-9[0-9]{3}$`]
  );

  // Vendors
  const vendorIds: string[] = [];
  for (const v of VENDORS) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM vendors WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [v.email]
    );
    let id = existing.rows[0]?.id;
    if (id) {
      await query(
        `UPDATE vendors SET company_name=$2, contact_person=$3, city=$4, gst_number=$5,
           license_info=$6, average_delivery_days=$7, rating=$8, status='ACTIVE'
         WHERE id=$1`,
        [id, v.company, v.contact, v.city, v.gst, v.license, v.days, v.rating]
      );
    } else {
      const ins = await query<{ id: string }>(
        `INSERT INTO vendors
           (company_name, contact_person, email, city, gst_number, license_info,
            average_delivery_days, payment_terms, rating, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Net 30',$8,'ACTIVE') RETURNING id`,
        [v.company, v.contact, v.email, v.city, v.gst, v.license, v.days, v.rating]
      );
      id = ins.rows[0].id;
    }
    vendorIds.push(id!);
  }

  // Map each vendor to a few items
  for (let i = 0; i < vendorIds.length; i++) {
    for (let j = 0; j < 3; j++) {
      const item = items.rows[(i * 3 + j) % items.rows.length];
      await query(
        `INSERT INTO vendor_items (vendor_id, item_id) VALUES ($1,$2)
         ON CONFLICT (vendor_id, item_id) DO NOTHING`,
        [vendorIds[i], item.id]
      );
    }
  }

  const needsQuotes = new Set([
    "RFQ_SENT",
    "AWAITING_QUOTES",
    "QUOTES_READY",
    "PENDING_TL_VENDOR",
    "REJECTED_TL_VENDOR",
    "PENDING_DIRECTOR",
    "REJECTED_DIRECTOR",
    "PENDING_MD",
    "REJECTED_MD",
    "PROCUREMENT_PO",
    "PO_DRAFT",
    "PO_SENT",
    "AWAITING_INVOICE",
    "PENDING_FINANCE",
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
  ]);
  const needsSelection = new Set([
    "PENDING_TL_VENDOR",
    "REJECTED_TL_VENDOR",
    "PENDING_DIRECTOR",
    "REJECTED_DIRECTOR",
    "PENDING_MD",
    "REJECTED_MD",
    "PROCUREMENT_PO",
    "PO_DRAFT",
    "PO_SENT",
    "AWAITING_INVOICE",
    "PENDING_FINANCE",
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
  ]);
  const needsPo = new Set([
    "PO_DRAFT",
    "PO_SENT",
    "AWAITING_INVOICE",
    "PENDING_FINANCE",
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
    "PROCUREMENT_PO",
  ]);
  const needsInvoice = new Set([
    "AWAITING_INVOICE",
    "PENDING_FINANCE",
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
  ]);
  const needsPayment = new Set([
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
  ]);

  let refNum = DEMO_REF_MIN;
  let indentCount = 0;
  const createdIndentIds: string[] = [];

  for (const plan of STATUS_PLANS) {
    for (let n = 0; n < plan.count; n++) {
      if (refNum > DEMO_REF_MAX) break;
      const reference = `IND-${YEAR}-${String(refNum).padStart(4, "0")}`;
      refNum += 1;
      const requesterId = requesters[indentCount % requesters.length];
      const item = items.rows[indentCount % items.rows.length];
      const qty = 10 + (indentCount % 40) * 5;
      const priority = plan.priority ?? (indentCount % 5 === 0 ? "HIGH" : indentCount % 3 === 0 ? "LOW" : "NORMAL");
      const hoursAgo = 2 + (indentCount % 72);
      const justifications = [
        `Scale-up batch requirement for ${item.name}.`,
        `Routine replenishment — QC released stock below reorder point.`,
        `New process validation run needs qualified ${item.sku}.`,
        `Packaging line changeover requires approved ${item.name}.`,
        `Stability protocol pull materials for ICH conditions.`,
      ];

      const ins = await query<{ id: string }>(
        `INSERT INTO indents (
           reference, requester_id, item_id, quantity, priority, justification,
           estimated_amount, approval_budget_amount, current_status,
           procurement_specifications, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           NOW() - ($11 || ' hours')::interval,
           NOW() - ($12 || ' hours')::interval
         ) RETURNING id`,
        [
          reference,
          requesterId,
          item.id,
          qty,
          priority,
          justifications[indentCount % justifications.length],
          plan.budget * 0.9,
          plan.budget,
          plan.status,
          `Catalog specs for ${item.name} (${item.sku}).`,
          String(hoursAgo + 8),
          String(hoursAgo),
        ]
      );
      const indentId = ins.rows[0].id;
      createdIndentIds.push(indentId);
      indentCount += 1;

      await query(
        `INSERT INTO indent_state_history (indent_id, from_status, to_status, actor_id, note)
         VALUES ($1,'DRAFT',$2,$3,'Demo activity seed')`,
        [indentId, plan.status, requesterId]
      );

      // Document attachment for most cases
      {
        const indentPdfName = `${reference}-indent.pdf`;
        const indentStoragePath = await writeDemoPdf(indentPdfName, `${reference} indent attachment`);
        await query(
          `INSERT INTO documents
             (indent_id, logical_key, version, filename, storage_path, mime_type, type,
              uploaded_by_id, processing_status)
           VALUES ($1,$2,1,$3,$4,'application/pdf','INDENT_ATTACHMENT',$5,'READY')
           ON CONFLICT DO NOTHING`,
          [
            indentId,
            `demo-indent-${reference}`,
            indentPdfName,
            indentStoragePath,
            requesterId,
          ]
        );
      }

      const v1 = vendorIds[indentCount % vendorIds.length];
      const v2 = vendorIds[(indentCount + 1) % vendorIds.length];
      const v3 = vendorIds[(indentCount + 2) % vendorIds.length];

      let rfqId: string | null = null;
      if (needsQuotes.has(plan.status)) {
        const rfq = await query<{ id: string }>(
          `INSERT INTO rfqs (indent_id, subject, body_template, sent_at)
           VALUES ($1,$2,$3,NOW() - interval '2 days') RETURNING id`,
          [
            indentId,
            `${reference} — RFQ for ${item.name}`,
            `Dear {{company_name}}, please quote for ${item.name} (${item.sku}), qty ${qty}.`,
          ]
        );
        rfqId = rfq.rows[0].id;
        for (const vid of [v1, v2, v3]) {
          await query(
            `INSERT INTO rfq_vendors (rfq_id, vendor_id) VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [rfqId, vid]
          );
        }

        if (plan.status !== "RFQ_SENT") {
          for (const [idx, vid] of [v1, v2, v3].entries()) {
            const unit = 1000 + idx * 175 + (indentCount % 50) * 10;
            await query(
              `INSERT INTO quotations
                 (indent_id, rfq_id, vendor_id, unit_price, currency, lead_time_days,
                  payment_terms, summary_text, attribution_status)
               VALUES ($1,$2,$3,$4,'INR',$5,'Net 30',$6,'MATCHED')`,
              [
                indentId,
                rfqId,
                vid,
                unit,
                12 + idx * 5,
                `Competitive offer for ${item.name} from vendor ${idx + 1}.`,
              ]
            );
          }
        }
      }

      if (needsSelection.has(plan.status)) {
        await query(
          `INSERT INTO vendor_selection
             (indent_id, selected_vendor_id, ai_recommended_vendor_id, submitted_at)
           VALUES ($1,$2,$2,NOW() - interval '1 day')
           ON CONFLICT (indent_id) DO NOTHING`,
          [indentId, v1]
        );

        const stage =
          plan.status.includes("MD")
            ? "MD_VENDOR"
            : plan.status.includes("DIRECTOR")
              ? "DIRECTOR_VENDOR"
              : "TEAM_LEADER_VENDOR";
        const actor =
          stage === "MD_VENDOR"
            ? mds[0] ?? directors[0] ?? tls[0]
            : stage === "DIRECTOR_VENDOR"
              ? directors[0] ?? tls[0]
              : tls[indentCount % tls.length];
        const decision = plan.status.startsWith("REJECTED") ? "REJECTED" : "APPROVED";
        await query(
          `INSERT INTO approval_events
             (indent_id, stage, actor_id, decision, remarks, budget_amount_at_decision, budget_track_at_decision)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            indentId,
            stage,
            actor,
            decision,
            decision === "REJECTED" ? "Does not meet commercial terms." : "Approved for demo activity.",
            plan.budget,
            plan.budget > 500000 ? "MD" : plan.budget > 50000 ? "DIRECTOR" : "TL_ONLY",
          ]
        );
      }

      let poId: string | null = null;
      if (needsPo.has(plan.status)) {
        const po = await query<{ id: string }>(
          `INSERT INTO purchase_orders (indent_id, po_number, body_html, sent_at)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [
            indentId,
            `PO-${YEAR}-${String(refNum - 1).padStart(4, "0")}`,
            `<p>Purchase order for ${reference} — ${item.name}</p>`,
            ["PO_DRAFT", "PROCUREMENT_PO"].includes(plan.status) ? null : new Date(),
          ]
        );
        poId = po.rows[0].id;
        {
          const poPdfName = `${reference}-po.pdf`;
          const poStoragePath = await writeDemoPdf(poPdfName, `${reference} purchase order`);
          await query(
            `INSERT INTO documents
               (indent_id, logical_key, version, filename, storage_path, mime_type, type,
                uploaded_by_id, processing_status)
             VALUES ($1,$2,1,$3,$4,'application/pdf','PURCHASE_ORDER',$5,'READY')`,
            [
              indentId,
              `demo-po-${reference}`,
              poPdfName,
              poStoragePath,
              procurement[indentCount % procurement.length],
            ]
          );
        }
      }

      if (needsInvoice.has(plan.status)) {
        const vendorName = VENDORS[indentCount % VENDORS.length].company;
        await query(
          `INSERT INTO invoices (indent_id, purchase_order_id, vendor_name, amount, kind, notes)
           VALUES ($1,$2,$3,$4,'PROFORMA',$5)`,
          [indentId, poId, vendorName, plan.budget, "Demo proforma invoice"]
        );
        if (
          ["PENDING_FINANCE_FINAL", "PAYMENT_PROOF_TO_VENDOR", "CLOSED", "PAYMENT_DONE"].includes(
            plan.status
          )
        ) {
          await query(
            `INSERT INTO invoices (indent_id, purchase_order_id, vendor_name, amount, kind, notes)
             VALUES ($1,$2,$3,$4,'FINAL',$5)`,
            [indentId, poId, vendorName, plan.budget, "Demo final invoice"]
          );
        }
        {
          const invPdfName = `${reference}-invoice.pdf`;
          const invStoragePath = await writeDemoPdf(invPdfName, `${reference} invoice`);
          await query(
            `INSERT INTO documents
               (indent_id, logical_key, version, filename, storage_path, mime_type, type,
                uploaded_by_id, processing_status)
             VALUES ($1,$2,1,$3,$4,'application/pdf','INVOICE',$5,'READY')`,
            [
              indentId,
              `demo-inv-${reference}`,
              invPdfName,
              invStoragePath,
              procurement[0],
            ]
          );
        }
      }

      if (needsPayment.has(plan.status)) {
        const completed = ["PAYMENT_DONE", "PAYMENT_PROOF_TO_VENDOR", "CLOSED"].includes(plan.status);
        await query(
          `INSERT INTO payments (indent_id, status, recorded_by_id, paid_at)
           VALUES ($1,$2,$3,$4)`,
          [
            indentId,
            completed ? "COMPLETED" : "PENDING",
            finance[indentCount % finance.length] ?? finance[0],
            completed ? new Date() : null,
          ]
        );
        if (completed) {
          {
            const payPdfName = `${reference}-payment.pdf`;
            const payStoragePath = await writeDemoPdf(payPdfName, `${reference} payment proof`);
            await query(
              `INSERT INTO documents
                 (indent_id, logical_key, version, filename, storage_path, mime_type, type,
                  uploaded_by_id, processing_status)
               VALUES ($1,$2,1,$3,$4,'application/pdf','PAYMENT_PROOF',$5,'READY')`,
              [
                indentId,
                `demo-pay-${reference}`,
                payPdfName,
                payStoragePath,
                finance[0],
              ]
            );
          }
        }
      }

      // Notifications to relevant roles
      const notify = async (
        userId: string,
        type: string,
        title: string,
        body: string,
        hoursBack = 6
      ) => {
        await query(
          `INSERT INTO notifications (user_id, indent_id, type, title, body, action_url, created_at)
           VALUES ($1,$2,$3,$4,$5,$6, NOW() - ($7 || ' hours')::interval)`,
          [userId, indentId, type, title, body, `/indents/${indentId}`, String(hoursBack)]
        );
      };

      if (plan.status === "PENDING_TL_INDENT" || plan.status === "PENDING_TL_VENDOR") {
        for (const tl of tls.slice(0, 3)) {
          await notify(tl, "APPROVAL_REQUIRED", "Approval required", `${reference} awaits team leader review.`, 3);
        }
      }
      if (plan.status === "PENDING_DIRECTOR") {
        for (const d of directors) {
          await notify(d, "APPROVAL_REQUIRED", "Director approval", `${reference} awaits director decision.`, 4);
        }
      }
      if (plan.status === "PENDING_MD") {
        for (const m of mds) {
          await notify(m, "APPROVAL_REQUIRED", "MD approval", `${reference} awaits MD decision.`, 5);
        }
      }
      if (plan.status === "PENDING_FINANCE" || plan.status === "PENDING_FINANCE_FINAL") {
        for (const f of finance) {
          await notify(f, "PAYMENT", "Finance action", `${reference} is in the finance queue.`, 2);
        }
      }
      if (plan.status.startsWith("REJECTED")) {
        await notify(requesterId, "REJECTION", "Indent rejected", `${reference} was rejected.`, 10);
      }
      await notify(requesterId, "STATUS_CHANGE", "Status update", `${reference} is now ${plan.status.replace(/_/g, " ")}.`, hoursAgo);

      // Procurement Gmail-style alerts (dashboard inbox)
      if (needsQuotes.has(plan.status) || plan.status === "PROCUREMENT_ACTIVE") {
        for (const p of procurement) {
          await query(
            `INSERT INTO notifications (user_id, indent_id, type, title, body, action_url, created_at)
             VALUES ($1,$2,'VENDOR_GMAIL',$3,$4,$5, NOW() - ($6 || ' hours')::interval)`,
            [
              p,
              indentId,
              `Vendor mail · ${reference}`,
              `Inbound quotation / reply detected for ${item.name}.`,
              `/indents/${indentId}`,
              String(6 + (indentCount % 48)),
            ]
          );
        }
      }
    }
  }

  // Sync reference counter so new UI indents don't collide
  await query(
    `INSERT INTO indent_reference_counters (year, last_value)
     VALUES ($1, $2)
     ON CONFLICT (year) DO UPDATE
       SET last_value = GREATEST(indent_reference_counters.last_value, EXCLUDED.last_value)`,
    [YEAR, DEMO_REF_MAX]
  );

  const counts = await query<{ role: string; n: string }>(
    `SELECT role, COUNT(*)::text AS n FROM users WHERE is_active GROUP BY role ORDER BY role`
  );
  const indentTotal = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM indents`);
  const vendorTotal = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM vendors`);
  const notifTotal = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM notifications`);

  console.log(`Users seeded/updated: ${allUserSeeds.length} (+ existing admin if present)`);
  for (const row of counts.rows) console.log(`  ${row.role.padEnd(12)} ${row.n}`);
  console.log(`Indents: ${indentTotal.rows[0].n} (demo refs IND-${YEAR}-9xxx)`);
  console.log(`Vendors: ${vendorTotal.rows[0].n}`);
  console.log(`Notifications: ${notifTotal.rows[0].n}`);
  console.log("Password for new users: DEMO_USER_PASSWORD or ADMIN_INITIAL_PASSWORD (not printed).");
  console.log("Log in as admin / role users and open Dashboard, Approvals, Queue, Finance, Notifications.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
