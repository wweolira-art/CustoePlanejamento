import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationCompetencia, migrationMoney, migrationUuid, safraDates } from "../server/supabase-migration.js";

test("migração preserva a virada de ano da safra setembro/agosto", () => {
  assert.equal(migrationCompetencia(2026, 0), "2026-09-01");
  assert.equal(migrationCompetencia(2026, 3), "2026-12-01");
  assert.equal(migrationCompetencia(2026, 4), "2027-01-01");
  assert.equal(migrationCompetencia(2026, 11), "2027-08-01");
  assert.throws(() => migrationCompetencia(2026, 12));
  assert.deepEqual(safraDates("26/27"), { year: 2026, inicio: "2026-09-01", fim: "2027-08-31" });
  assert.throws(() => safraDates("26/28"));
});

test("IDs de migração são estáveis por snapshot e separados por entidade", () => {
  const first = migrationUuid("snapshot-a", "line:1");
  assert.equal(first, migrationUuid("snapshot-a", "line:1"));
  assert.notEqual(first, migrationUuid("snapshot-b", "line:1"));
  assert.notEqual(first, migrationUuid("snapshot-a", "category:1"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("valores são arredondados para centavos e valores não finitos bloqueiam importação", () => {
  assert.equal(migrationMoney(123.4567), 123.46);
  assert.equal(migrationMoney(-123.4567), -123.46);
  assert.throws(() => migrationMoney(Infinity));
  assert.throws(() => migrationMoney("#REF!"));
});
