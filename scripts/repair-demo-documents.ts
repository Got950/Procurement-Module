/**
 * Materializes missing demo document PDFs and rewrites storage_path from the
 * invalid `demo/seed/...` locations (outside data/uploads) to
 * `data/uploads/demo/seed/...` so /api/documents/[id]/file can serve them.
 *
 *   npx tsx scripts/repair-demo-documents.ts
 */
import "dotenv/config";
import { mkdir, writeFile, access } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { query } from "../src/lib/db";

async function ensurePdf(abs: string, title: string) {
  try {
    await access(abs);
    return;
  } catch {
    /* create */
  }
  await mkdir(path.dirname(abs), { recursive: true });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("MedFlow — Demo document", { x: 50, y: 740, size: 12, font });
  page.drawText(title.slice(0, 90), { x: 50, y: 710, size: 14, font });
  await writeFile(abs, await pdf.save());
}

async function main() {
  const rows = await query<{
    id: string;
    filename: string;
    storage_path: string;
  }>(
    `SELECT id, filename, storage_path
     FROM documents
     WHERE storage_path LIKE 'demo/seed/%'
        OR storage_path LIKE 'data/uploads/demo/seed/%'`
  );

  let fixed = 0;
  for (const row of rows.rows) {
    const filename = row.filename || path.basename(row.storage_path);
    const storagePath = path.join("data", "uploads", "demo", "seed", filename).split(path.sep).join("/");
    const abs = path.resolve(process.cwd(), storagePath);
    await ensurePdf(abs, filename);
    if (row.storage_path !== storagePath) {
      await query(`UPDATE documents SET storage_path = $1 WHERE id = $2`, [storagePath, row.id]);
    }
    fixed += 1;
  }

  console.log(`Repaired ${fixed} document(s). Download links under /api/documents/[id]/file should work now.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
