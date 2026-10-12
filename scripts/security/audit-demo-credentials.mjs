import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;
const knownPasswords = [
  "admin123",
  "operatore123",
  "giuridico123",
  "tecnico123",
  "economico123",
  "adsp123",
  "pm123",
  "lockout123",
];

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const result = await client.query(
    'SELECT "email", "ruolo", "passwordHash" FROM "User" WHERE "attivo" = true',
  );
  const matches = [];

  for (const user of result.rows) {
    if (!user.passwordHash) continue;
    const known = (await Promise.all(
      knownPasswords.map((password) => bcrypt.compare(password, user.passwordHash)),
    )).some(Boolean);
    if (known) matches.push(user);
  }

  const demoIdentity = (email) => email.endsWith("@demo.local") || email.endsWith("@concessioni.local");
  console.log(JSON.stringify({
    activeUsers: result.rows.length,
    activeDemoIdentities: result.rows.filter((user) => demoIdentity(user.email)).length,
    activeOperationalIdentities: result.rows.filter((user) => !demoIdentity(user.email)).length,
    knownPasswordMatches: matches.length,
    affectedRoles: [...new Set(matches.map((user) => user.ruolo))].sort(),
  }));
} finally {
  await client.end();
}