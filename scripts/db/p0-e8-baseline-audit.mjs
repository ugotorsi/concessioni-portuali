import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");
const migrationsDir = path.join(repoRoot, "prisma", "migrations");
const baselinePath = path.join(repoRoot, "prisma", "baselines", "20260803_p0_e8_empty_to_current", "baseline.sql");
const outDir = path.join(repoRoot, "artifacts", "staging", "p0-e8-baseline-audit");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listMigrationEntries(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function parseSchema(schemaText) {
  const enumNames = [];
  for (const match of schemaText.matchAll(/^enum\s+(\w+)\s*\{/gm)) {
    enumNames.push(match[1]);
  }

  const modelBlocks = [...schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const modelNames = modelBlocks.map((match) => match[1]);
  const modelNameSet = new Set(modelNames);
  const enumNameSet = new Set(enumNames);

  const models = modelBlocks.map((match) => {
    const modelName = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;

    const dependencies = new Set();
    const enumDependencies = new Set();

    const lines = body.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) {
        continue;
      }

      const fieldMatch = line.match(/^(\w+)\s+([A-Za-z_][A-Za-z0-9_]*(?:\?|\[\])?)/);
      if (!fieldMatch) {
        continue;
      }

      let fieldType = fieldMatch[2];
      fieldType = fieldType.replace(/\?$/, "").replace(/\[\]$/, "");

      if (modelNameSet.has(fieldType) && fieldType !== modelName) {
        dependencies.add(fieldType);
      }

      if (enumNameSet.has(fieldType)) {
        enumDependencies.add(fieldType);
      }
    }

    const indexCount = (body.match(/@@index\(/g) ?? []).length;
    const uniqueCount = (body.match(/@@unique\(/g) ?? []).length;
    const hasCompoundId = (body.match(/@@id\(/g) ?? []).length > 0;

    return {
      modelName,
      tableName,
      dependencies: [...dependencies].sort(),
      enumDependencies: [...enumDependencies].sort(),
      indexCount,
      uniqueCount,
      hasCompoundId,
    };
  });

  return {
    enums: enumNames.sort(),
    models,
  };
}

function parseMigrations(migrationsRoot) {
  const migrationEntries = listMigrationEntries(migrationsRoot);
  const createTypeByObject = new Map();
  const createTableByObject = new Map();
  const alterByTable = new Map();

  for (const migrationName of migrationEntries) {
    const sqlPath = path.join(migrationsRoot, migrationName, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      continue;
    }

    const sql = readText(sqlPath);

    for (const match of sql.matchAll(/CREATE TYPE\s+"([^"]+)"/g)) {
      const objectName = match[1];
      if (!createTypeByObject.has(objectName)) {
        createTypeByObject.set(objectName, migrationName);
      }
    }

    for (const match of sql.matchAll(/CREATE TABLE\s+"([^"]+)"/g)) {
      const objectName = match[1];
      if (!createTableByObject.has(objectName)) {
        createTableByObject.set(objectName, migrationName);
      }
    }

    for (const match of sql.matchAll(/ALTER TABLE\s+"([^"]+)"/g)) {
      const tableName = match[1];
      const entries = alterByTable.get(tableName) ?? [];
      entries.push(migrationName);
      alterByTable.set(tableName, entries);
    }
  }

  return {
    migrationEntries,
    createTypeByObject,
    createTableByObject,
    alterByTable,
  };
}

function parseBaselineSql(sql) {
  const createTypes = new Set([...sql.matchAll(/CREATE TYPE\s+"([^"]+)"/g)].map((m) => m[1]));
  const createTables = new Set([...sql.matchAll(/CREATE TABLE\s+"([^"]+)"/g)].map((m) => m[1]));

  const foreignKeys = [];
  for (const match of sql.matchAll(/ALTER TABLE\s+"([^"]+)"[\s\S]*?REFERENCES\s+"([^"]+)"\("([^"]+)"\)/g)) {
    foreignKeys.push({ fromTable: match[1], toTable: match[2], toColumn: match[3] });
  }

  const createIndexCount = (sql.match(/CREATE INDEX/g) ?? []).length;
  const createUniqueIndexCount = (sql.match(/CREATE UNIQUE INDEX/g) ?? []).length;

  const hasDrop = /\bDROP\b/i.test(sql);
  const hasDml = /^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/gim.test(sql);

  return {
    createTypes,
    createTables,
    foreignKeys,
    createIndexCount,
    createUniqueIndexCount,
    hasDrop,
    hasDml,
  };
}

function toCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
      return `"${text.replace(/\"/g, '""')}"`;
    }
    return text;
  };

  const headers = [
    "objectType",
    "prismaObject",
    "sqlObject",
    "createdByMigration",
    "dependsOn",
    "coverage",
    "risk",
    "notes",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header] ?? "")).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const schemaText = readText(schemaPath);
  const schema = parseSchema(schemaText);
  const migrationInfo = parseMigrations(migrationsDir);
  const baselineSql = readText(baselinePath);
  const baselineInfo = parseBaselineSql(baselineSql);

  const rows = [];
  let highRiskCount = 0;
  let mediumRiskCount = 0;

  for (const enumName of schema.enums) {
    const createdByMigration = migrationInfo.createTypeByObject.get(enumName) ?? "";
    const coverage = createdByMigration ? "present-in-history" : "missing-in-history";
    const risk = createdByMigration ? "LOW" : "HIGH";
    if (risk === "HIGH") highRiskCount += 1;

    rows.push({
      objectType: "enum",
      prismaObject: enumName,
      sqlObject: enumName,
      createdByMigration,
      dependsOn: "",
      coverage,
      risk,
      notes: createdByMigration
        ? "Created by existing migration."
        : "Not created by migration history; requires baseline on empty DB.",
    });
  }

  const modelNameToTable = new Map(schema.models.map((model) => [model.modelName, model.tableName]));

  for (const model of schema.models) {
    const createdByMigration = migrationInfo.createTableByObject.get(model.tableName) ?? "";
    const deps = model.dependencies.map((dependencyModel) => modelNameToTable.get(dependencyModel) ?? dependencyModel);
    const missingDepsInHistory = deps.filter((tableName) => !migrationInfo.createTableByObject.has(tableName));

    let risk = "LOW";
    let coverage = createdByMigration ? "present-in-history" : "missing-in-history";
    let notes = "";

    if (!createdByMigration) {
      risk = "HIGH";
      notes = "Not created by migration history; requires baseline on empty DB.";
      highRiskCount += 1;
    } else if (missingDepsInHistory.length > 0) {
      risk = "HIGH";
      notes = `Created in history but depends on tables missing in history: ${missingDepsInHistory.join(";")}.`;
      highRiskCount += 1;
    } else if (model.enumDependencies.some((enumName) => !migrationInfo.createTypeByObject.has(enumName))) {
      risk = "MEDIUM";
      notes = "Model uses enum(s) not created by history.";
      mediumRiskCount += 1;
    } else {
      notes = "Covered by migration history and dependencies.";
    }

    rows.push({
      objectType: "model",
      prismaObject: model.modelName,
      sqlObject: model.tableName,
      createdByMigration,
      dependsOn: deps.join(";"),
      coverage,
      risk,
      notes,
    });
  }

  const missingEnumsInBaseline = schema.enums.filter((enumName) => !baselineInfo.createTypes.has(enumName));
  const missingTablesInBaseline = schema.models
    .map((model) => model.tableName)
    .filter((tableName) => !baselineInfo.createTables.has(tableName));

  const fkMissingTargets = baselineInfo.foreignKeys.filter((fk) => !baselineInfo.createTables.has(fk.toTable));
  const fkMissingSources = baselineInfo.foreignKeys.filter((fk) => !baselineInfo.createTables.has(fk.fromTable));

  const summary = {
    generatedAt: new Date().toISOString(),
    migrationCount: migrationInfo.migrationEntries.length,
    migrationNames: migrationInfo.migrationEntries,
    schemaEnumCount: schema.enums.length,
    schemaModelCount: schema.models.length,
    historyCreatesEnumCount: migrationInfo.createTypeByObject.size,
    historyCreatesTableCount: migrationInfo.createTableByObject.size,
    migrateDeployOnEmptyLikelySafe: highRiskCount === 0,
    riskCounts: {
      high: highRiskCount,
      medium: mediumRiskCount,
    },
    baseline: {
      path: path.relative(repoRoot, baselinePath).replace(/\\/g, "/"),
      lineCount: baselineSql.split(/\r?\n/).length,
      createTypeCount: baselineInfo.createTypes.size,
      createTableCount: baselineInfo.createTables.size,
      createIndexCount: baselineInfo.createIndexCount,
      createUniqueIndexCount: baselineInfo.createUniqueIndexCount,
      hasDrop: baselineInfo.hasDrop,
      hasDml: baselineInfo.hasDml,
      missingEnumsInBaseline,
      missingTablesInBaseline,
      fkMissingTargets,
      fkMissingSources,
    },
  };

  const csv = toCsv(rows);
  const csvPath = path.join(outDir, "object-matrix.csv");
  fs.writeFileSync(csvPath, csv, "utf8");

  const jsonPath = path.join(outDir, "baseline-static-verification.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const markdownLines = [
    "# P0-E8 Baseline Audit",
    "",
    `Generated at: ${summary.generatedAt}`,
    "",
    "## Migration History Assessment",
    `- Existing migrations: ${summary.migrationCount}`,
    `- Existing migration names: ${summary.migrationNames.join(", ") || "none"}`,
    `- Prisma enums: ${summary.schemaEnumCount}`,
    `- Prisma models: ${summary.schemaModelCount}`,
    `- Enums created by history: ${summary.historyCreatesEnumCount}`,
    `- Tables created by history: ${summary.historyCreatesTableCount}`,
    `- Prisma migrate deploy on empty DB likely safe: ${summary.migrateDeployOnEmptyLikelySafe ? "yes" : "no"}`,
    "",
    "## Baseline Static Verification",
    `- Baseline path: ${summary.baseline.path}`,
    `- Baseline line count: ${summary.baseline.lineCount}`,
    `- CREATE TYPE count: ${summary.baseline.createTypeCount}`,
    `- CREATE TABLE count: ${summary.baseline.createTableCount}`,
    `- CREATE UNIQUE INDEX count: ${summary.baseline.createUniqueIndexCount}`,
    `- CREATE INDEX count: ${summary.baseline.createIndexCount}`,
    `- DROP statements present: ${summary.baseline.hasDrop ? "yes" : "no"}`,
    `- DML statements present (INSERT/UPDATE/DELETE/MERGE/TRUNCATE): ${summary.baseline.hasDml ? "yes" : "no"}`,
    `- Missing enums in baseline: ${summary.baseline.missingEnumsInBaseline.length}`,
    `- Missing tables in baseline: ${summary.baseline.missingTablesInBaseline.length}`,
    `- FK missing target table references: ${summary.baseline.fkMissingTargets.length}`,
    `- FK missing source table references: ${summary.baseline.fkMissingSources.length}`,
    "",
    "## Risk Summary",
    `- HIGH risk objects: ${summary.riskCounts.high}`,
    `- MEDIUM risk objects: ${summary.riskCounts.medium}`,
    "",
    "## Artifacts",
    "- object-matrix.csv",
    "- baseline-static-verification.json",
  ];

  fs.writeFileSync(path.join(outDir, "audit-report.md"), `${markdownLines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    csvPath: path.relative(repoRoot, csvPath).replace(/\\/g, "/"),
    jsonPath: path.relative(repoRoot, jsonPath).replace(/\\/g, "/"),
    reportPath: path.relative(repoRoot, path.join(outDir, "audit-report.md")).replace(/\\/g, "/"),
    summary,
  }, null, 2));
}

main();
