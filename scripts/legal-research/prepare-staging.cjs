const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'staging-preparation');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const roots = ['src', 'public', 'prisma/migrations', 'data/legal-rule-packs', 'data/legal-source-compatibility'];
const configs = ['package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts', 'middleware.ts',
  'postcss.config.mjs', 'tsconfig.json', 'prisma.config.ts', 'prisma/schema.prisma',
  'scripts/legal-research/execute-trusted-mission.ts'];

function selectedFiles(base = root) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(base, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN:${relative}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) visit(`${relative}/${child}`);
    } else if (stat.isFile()) {
      if (/(^|\/)(\.env(?:\..*)?|node_modules|\.git|\.next|artifacts|logs|test-results)(\/|$)|\.(log|zip|pem|key|tsbuildinfo)$/i.test(relative)) {
        throw new Error(`UNSAFE_RELEASE_FILE:${relative}`);
      }
      files.push({ path: relative, bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) });
    }
  }
  for (const relative of [...roots, ...configs]) if (fs.existsSync(path.join(base, relative))) visit(relative);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function prepare(materialize = false) {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/s1-s2-verification.json'), 'utf8'));
  for (const [relative, expected] of Object.entries({ ...evidence.sourceHashes, ...evidence.evidenceHashes, ...evidence.contracts })) {
    if (sha256(fs.readFileSync(path.join(root, relative))) !== expected) throw new Error(`C1_CHANGED:${relative}`);
  }
  const files = selectedFiles();
  const releaseId = `staging-c1-${sha256(JSON.stringify(files))}`;
  const untracked = new Set(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'));
  const manifest = {
    releaseId, createdAt: new Date().toISOString(), sourceRoot: root,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    files, untrackedIncluded: files.filter((file) => untracked.has(file.path)).map((file) => file.path),
    migrations: files.filter((file) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(file.path))
      .map((file) => ({ name: file.path.split('/')[2], sha256: file.sha256, path: file.path })),
    reusedEvidence: { manifestSha256: sha256(fs.readFileSync(path.join(root, 'artifacts/s1-s2-verification.json'))),
      tests: evidence.unit.passed, suites: evidence.unit.files.length, typecheck: evidence.typecheckExitCode, build: evidence.buildExitCode },
    exclusions: ['credentials and .env files', 'node_modules', '.next', '.git', 'artifacts and logs',
      'operational samples', 'tests and fixtures', 'prisma/seed.ts', 'legal originals', 'temporary acquisition tools'],
    additions: [{ path: 'public/staging-release.json', purpose: 'Public release identity; no secrets or operational IDs' }],
  };
  if (materialize) {
    const destination = path.join(output, 'release');
    if (fs.existsSync(destination)) throw new Error('RELEASE_ALREADY_EXISTS_DO_NOT_OVERWRITE');
    fs.mkdirSync(destination, { recursive: true });
    for (const file of files) {
      const target = path.join(destination, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file.path), target, fs.constants.COPYFILE_EXCL);
      if (sha256(fs.readFileSync(target)) !== file.sha256) throw new Error('COPY_HASH_MISMATCH');
    }
    const marker = JSON.stringify({ releaseId, sourceManifestSha256: sha256(JSON.stringify(files)) }, null, 2);
    fs.mkdirSync(path.join(destination, 'public'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'public/staging-release.json'), marker, { flag: 'wx' });
    manifest.additions[0].sha256 = sha256(Buffer.from(marker));
    fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  }
  return manifest;
}

module.exports = { root, output, sha256, selectedFiles, prepare };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--materialize')) throw new Error('UNKNOWN_ARGUMENT');
  const manifest = prepare(args.includes('--materialize'));
  console.log(JSON.stringify({ releaseId: manifest.releaseId, fileCount: manifest.files.length,
    migrationCount: manifest.migrations.length, untrackedIncluded: manifest.untrackedIncluded.length,
    materialized: args.includes('--materialize'), reusedEvidence: manifest.reusedEvidence }, null, 2));
}