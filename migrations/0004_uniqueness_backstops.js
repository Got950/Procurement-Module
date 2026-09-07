/**
 * Database-level backstops for two races the application cannot fully prevent:
 * a second COMPLETED payment on the same case, and two vendors sharing an email
 * (which makes reply attribution ambiguous).
 *
 * Both can fail on existing data, so each reports the offending rows instead of
 * surfacing a bare constraint violation.
 */
exports.disableTransaction = true;

async function assertNoDuplicates(pgm, { label, sql }) {
  const { rows } = await pgm.db.query(sql);
  if (rows.length > 0) {
    throw new Error(
      `${label}: resolve these before migrating -> ${rows.map((r) => r.key).join(", ")}`
    );
  }
}

exports.up = async (pgm) => {
  await assertNoDuplicates(pgm, {
    label: "Duplicate vendors.email (case-insensitive)",
    sql: `SELECT LOWER(email) AS key FROM vendors GROUP BY LOWER(email) HAVING COUNT(*) > 1`,
  });
  await pgm.db.query(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_vendors_lower_email ON vendors (LOWER(email))`
  );

  await assertNoDuplicates(pgm, {
    label: "Multiple COMPLETED payments on one indent",
    sql: `SELECT indent_id AS key FROM payments WHERE status = 'COMPLETED' GROUP BY indent_id HAVING COUNT(*) > 1`,
  });
  await pgm.db.query(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_payments_completed ON payments (indent_id) WHERE status = 'COMPLETED'`
  );
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP INDEX CONCURRENTLY IF EXISTS uq_payments_completed`);
  await pgm.db.query(`DROP INDEX CONCURRENTLY IF EXISTS uq_vendors_lower_email`);
};
