/**
 * Upserts a realistic local item catalog of real medical / pharma materials
 * (APIs, excipients, primary packaging, lab consumables). Non-destructive.
 *
 *   npm run db:seed-items
 */
import "dotenv/config";
import { query } from "../src/lib/db";

const ITEMS = [
  // —— Active pharmaceutical ingredients (USP / Ph. Eur. grade) ——
  {
    sku: "RM-PARA-001",
    name: "Paracetamol API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP/BP grade, micronized. Assay ≥ 99.0%. Residual solvents per ICH Q3C. DMF / CoA required with each batch.",
    regulatoryTag: "DMF on file",
  },
  {
    sku: "RM-IBU-002",
    name: "Ibuprofen API",
    category: "API",
    uom: "KG",
    specNotes:
      "Crystalline powder, Ph. Eur. / USP. Particle size D90 ≤ 100 µm. Prefer vendor with valid CEP.",
    regulatoryTag: "CEP preferred",
  },
  {
    sku: "RM-MET-003",
    name: "Metformin hydrochloride API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP / IP grade. Assay 98.5–101.0%. Nitrosamine risk assessment and NDMA testing records required with CoA.",
    regulatoryTag: "Nitrosamine control",
  },
  {
    sku: "RM-AMOX-004",
    name: "Amoxicillin trihydrate API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP / Ph. Eur. grade. Potency as anhydrous amoxicillin. Disclose 6-APA intermediate country of origin. Cold-chain optional per vendor CoA.",
    regulatoryTag: "GMP + origin traceability",
  },
  {
    sku: "RM-ATOR-005",
    name: "Atorvastatin calcium API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP grade, amorphous or crystalline as agreed. Related substances per monograph. Light- and moisture-sensitive — double poly-lined fibre drums.",
    regulatoryTag: "DMF / CEP",
  },
  {
    sku: "RM-OME-006",
    name: "Omeprazole API",
    category: "API",
    uom: "KG",
    specNotes:
      "Ph. Eur. / USP. Enteric-coating grade preferred for delayed-release. Protect from light and moisture. Assay and impurity profile on CoA.",
    regulatoryTag: "Light-sensitive API",
  },
  {
    sku: "RM-AZI-007",
    name: "Azithromycin dihydrate API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP grade. Macrolide antibiotic. Microbiological purity and residual solvents per ICH. Store cool and dry.",
    regulatoryTag: "USP / WHO-GMP",
  },
  {
    sku: "RM-LOS-008",
    name: "Losartan potassium API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP / IP. Azido / nitroso impurity controls required. Full impurity profile and method references on CoA.",
    regulatoryTag: "Impurity control critical",
  },
  {
    sku: "RM-ASA-009",
    name: "Aspirin (acetylsalicylic acid) API",
    category: "API",
    uom: "KG",
    specNotes:
      "USP / BP. Free salicylic acid within monograph limits. Prefer crystalline grade for tablet compression.",
    regulatoryTag: "USP",
  },
  {
    sku: "RM-CET-010",
    name: "Cetirizine hydrochloride API",
    category: "API",
    uom: "KG",
    specNotes:
      "IP / USP grade antihistamine. Assay and related substances per monograph. Hygroscopic — sealed packs.",
    regulatoryTag: "IP / USP",
  },

  // —— Excipients ——
  {
    sku: "EX-MCC-101",
    name: "Microcrystalline cellulose (MCC PH 102)",
    category: "Excipient",
    uom: "KG",
    specNotes:
      "Ph. Eur. / USP-NF. Binder/diluent for wet and dry granulation. Loss on drying and particle size per vendor CoA.",
    regulatoryTag: "USP-NF / DMF",
  },
  {
    sku: "EX-LAC-102",
    name: "Lactose monohydrate",
    category: "Excipient",
    uom: "KG",
    specNotes:
      "Ph. Eur. / USP-NF. Milled or spray-dried as ordered. TSE/BSE free declaration required for animal-origin lactose.",
    regulatoryTag: "TSE/BSE free",
  },
  {
    sku: "EX-MGS-103",
    name: "Magnesium stearate",
    category: "Excipient",
    uom: "KG",
    specNotes:
      "USP-NF vegetable-origin preferred. Lubricant for tablets/capsules. Heavy metals and stearic/palmitic ratio on CoA.",
    regulatoryTag: "Vegetable grade",
  },
  {
    sku: "EX-STA-104",
    name: "Maize starch (pharma grade)",
    category: "Excipient",
    uom: "KG",
    specNotes:
      "Ph. Eur. / IP. Disintegrant / diluent. Microbial limits and loss on drying per monograph.",
    regulatoryTag: "Ph. Eur.",
  },
  {
    sku: "EX-PVP-105",
    name: "Povidone (PVP K30)",
    category: "Excipient",
    uom: "KG",
    specNotes:
      "USP-NF / Ph. Eur. Binder for wet granulation. K-value ~27–32. Residual vinylpyrrolidone within limits.",
    regulatoryTag: "USP-NF",
  },

  // —— Primary / secondary packaging ——
  {
    sku: "PKG-BLIS-010",
    name: "Blister packaging foil (PVC/PVDC)",
    category: "Packaging",
    uom: "ROLL",
    specNotes:
      "PVC/PVDC laminate, ~250 µm. Food-contact / pharma grade. Print registration within ±0.5 mm. DMF preferred.",
    regulatoryTag: "Food contact / DMF",
  },
  {
    sku: "PKG-ALU-011",
    name: "Alu-Alu cold forming foil",
    category: "Packaging",
    uom: "ROLL",
    specNotes:
      "Cold-form aluminium laminate for high-barrier blisters. Printed or plain as ordered. GMP / DMF documentation.",
    regulatoryTag: "DMF / GMP",
  },
  {
    sku: "PKG-PTP-012",
    name: "Aluminium PTP blister lidding foil",
    category: "Packaging",
    uom: "ROLL",
    specNotes:
      "Hard temper aluminium foil for push-through blister lids. Heat-seal lacquer compatible with PVC/PVDC/Alu bases.",
    regulatoryTag: "DMF / GMP",
  },
  {
    sku: "PKG-HDPE-021",
    name: "HDPE pharma bottles 100 ml",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "Amber HDPE, 100 ml, CRC cap. USP <661> compliant. DMF Type III preferred.",
    regulatoryTag: "DMF Type III",
  },
  {
    sku: "PKG-VIAL-022",
    name: "Tubular glass vials Type I 10 ml",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "USP Type I borosilicate tubular vials, 10 ml. Clear or amber. Compatible with 20 mm rubber stoppers and flip-off seals.",
    regulatoryTag: "USP Type I / DMF",
  },
  {
    sku: "PKG-STOP-023",
    name: "Bromobutyl rubber stoppers 20 mm",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "Ready-for-sterilisation or RTU bromobutyl stoppers, 20 mm. Low extractables. Suitable for injectable vials.",
    regulatoryTag: "DMF / GMP",
  },
  {
    sku: "PKG-SEAL-024",
    name: "Aluminium flip-off seals 20 mm",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "20 mm aluminium flip-off / tear-off seals for injectable vials. Colour-coded as ordered.",
    regulatoryTag: "GMP",
  },
  {
    sku: "PKG-GEL-050",
    name: "Hard gelatin capsules size 0",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "Size 0, opaque white empty shells. Bovine or porcine gelatin with TSE/BSE free statement.",
    regulatoryTag: "TSE/BSE statement",
  },
  {
    sku: "PKG-CART-060",
    name: "Folding cartons 20×10×5 cm",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "SBS board, varnish finish. Artwork approval required before print run.",
    regulatoryTag: "Artwork approval",
  },
  {
    sku: "PKG-SYR-061",
    name: "Oral syrup measuring cups 5 ml",
    category: "Packaging",
    uom: "PCS",
    specNotes:
      "Graduated PP measuring cups, 5 ml. USP Class VI / food-contact grade polymer.",
    regulatoryTag: "USP Class VI",
  },

  // —— Laboratory & medical consumables ——
  {
    sku: "LAB-HPLC-040",
    name: "Acetonitrile HPLC grade",
    category: "Laboratory",
    uom: "L",
    specNotes:
      "HPLC grade acetonitrile ≥ 99.9%. Water ≤ 0.02%. UV cutoff suitable for HPLC. CoA per lot mandatory.",
    regulatoryTag: "COA per batch",
  },
  {
    sku: "LAB-IPA-041",
    name: "Isopropyl alcohol 70% (pharma)",
    category: "Laboratory",
    uom: "L",
    specNotes:
      "IPA 70% v/v for cleanroom / surface disinfection. Residue and assay on CoA. Suitable for Grade C/D areas.",
    regulatoryTag: "Pharma disinfectant",
  },
  {
    sku: "LAB-NACL-042",
    name: "Sodium chloride IR grade",
    category: "Laboratory",
    uom: "KG",
    specNotes:
      "IR spectroscopy grade NaCl. For pellet / window prep. Low moisture and halide impurities.",
    regulatoryTag: "Analytical grade",
  },
  {
    sku: "LAB-GLV-030",
    name: "Nitrile lab gloves",
    category: "Consumables",
    uom: "BOX",
    specNotes:
      "Powder-free nitrile, size M/L mix. ISO Class 5 compatible. Non-sterile. 100 pcs/box typical.",
    regulatoryTag: "Non-sterile",
  },
  {
    sku: "MED-SYR-031",
    name: "Disposable sterile syringes 5 ml",
    category: "Medical device",
    uom: "BOX",
    specNotes:
      "Sterile, single-use Luer-lock or Luer-slip syringes, 5 ml. ISO 7886. EO or gamma sterilized. CE / CDSCO as applicable.",
    regulatoryTag: "ISO 7886 / sterile",
  },
  {
    sku: "MED-MASK-032",
    name: "Surgical face masks (3-ply)",
    category: "Medical device",
    uom: "BOX",
    specNotes:
      "3-ply disposable surgical masks. Bacterial filtration efficiency per EN 14683 Type IIR or equivalent.",
    regulatoryTag: "EN 14683",
  },
  {
    sku: "MED-IV-033",
    name: "IV infusion set (sterile)",
    category: "Medical device",
    uom: "PCS",
    specNotes:
      "Sterile disposable IV administration set with drip chamber and roller clamp. DEHP-free tubing preferred.",
    regulatoryTag: "Sterile / ISO",
  },
  {
    sku: "SVC-STAB-070",
    name: "ICH stability chamber service (6 months)",
    category: "Services",
    uom: "LOT",
    specNotes:
      "Contract ICH stability storage and pull testing (long-term / accelerated). GLP-capable lab preferred.",
    regulatoryTag: "GLP certificate",
  },
] as const;

async function main() {
  let created = 0;
  let updated = 0;

  for (const item of ITEMS) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM items WHERE sku = $1 LIMIT 1`,
      [item.sku]
    );
    if (existing.rows[0]?.id) {
      await query(
        `UPDATE items SET
           name = $2, category = $3, uom = $4, spec_notes = $5, regulatory_tag = $6
         WHERE id = $1`,
        [
          existing.rows[0].id,
          item.name,
          item.category,
          item.uom,
          item.specNotes,
          item.regulatoryTag,
        ]
      );
      updated += 1;
    } else {
      await query(
        `INSERT INTO items (sku, name, category, uom, spec_notes, regulatory_tag)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.sku, item.name, item.category, item.uom, item.specNotes, item.regulatoryTag]
      );
      created += 1;
    }
  }

  console.log(`Items ready: ${created} created, ${updated} updated (${ITEMS.length} SKUs).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
