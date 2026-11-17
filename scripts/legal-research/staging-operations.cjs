const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root, output, sha256 } = require('./prepare-staging.cjs');
const { trustedStagingIdentity } = require('./trusted-staging-identity.cjs');

const actions = ['verify-release', 'inspect', 'configuration', 'db-compare', 'rehearse', 'migrate', 'deploy', 'smoke', 'activate', 'rollback'];
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifestPath = path.join(output, 'release-manifest.json');
const statePath = path.join(output, 'operation-state.json');
const requiredEnv = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'WORKOS_AUTHKIT_ISSUER',
  'WORKOS_API_KEY', 'MCP_RESOURCE_URI', 'MCP_FASCICOLO_GRANT_SECRET', 'DOCUMENT_STORAGE_BACKEND',
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

function requireValue(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[<>\r\n]/.test(value)) throw new Error(`MISSING_OR_INVALID:${name}`);
  return value;
}

function origin(value) {
  const url = new URL(requireValue(value, 'origin'));
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('HTTPS_ORIGIN_REQUIRED');
  return url.origin;
}

function validateTarget(config) {
  if (config.environment !== 'preview' || config.nonProductionConfirmed !== true) throw new Error('NON_PRODUCTION_CONFIRMATION_REQUIRED');
  for (const name of ['vercelProjectId', 'vercelTeamId', 'neonProjectId', 'neonBranchId', 'neonSourceHead', 'databaseHost', 'databaseName']) requireValue(config[name], name);
  const preview = origin(config.previewOrigin);
  origin(config.workosIssuer);
  if (!Array.isArray(config.productionOrigins) || config.productionOrigins.length === 0
    || !Array.isArray(config.productionDatabaseHosts) || config.productionDatabaseHosts.length === 0) throw new Error('PRODUCTION_DENYLIST_REQUIRED');
  if (config.vercelProjectId !== trustedStagingIdentity.vercelProjectId
    || config.vercelTeamId !== trustedStagingIdentity.vercelTeamScope
    || config.neonProjectId !== trustedStagingIdentity.neonProjectId
    || config.neonBranchId !== trustedStagingIdentity.neonBranchId
    || preview !== `https://${trustedStagingIdentity.stagingAlias}`) throw new Error('TRUSTED_STAGING_IDENTITY_MISMATCH');
  if ([...config.productionOrigins, 'https://concessioni-portuali-demo.vercel.app'].map(origin).includes(preview)
    || config.productionDatabaseHosts.includes(config.databaseHost)) throw new Error('PRODUCTION_OR_DEMO_TARGET_FORBIDDEN');
  return preview;
}

function verifyRelease(manifest) {
  if (manifest.releaseId !== `staging-c1-${sha256(JSON.stringify(manifest.files))}`) throw new Error('MANIFEST_IDENTITY_MISMATCH');
  const releaseRoot = path.join(output, 'release');
  const allowed = new Map([...manifest.files, ...manifest.additions].map((file) => [file.path, file.sha256]));
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(releaseRoot, relative))) {
      const file = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(path.join(releaseRoot, file));
      if (stat.isSymbolicLink()) throw new Error('RELEASE_SYMLINK');
      if (stat.isDirectory()) visit(file);
      else {
        if (!allowed.has(file) || sha256(fs.readFileSync(path.join(releaseRoot, file))) !== allowed.get(file)) throw new Error(`RELEASE_CHANGED:${file}`);
        allowed.delete(file);
      }
    }
  }
  visit();
  if (allowed.size) throw new Error('RELEASE_FILES_MISSING');
  const marker = readJson(path.join(releaseRoot, 'public/staging-release.json'));
  if (marker.releaseId !== manifest.releaseId) throw new Error('RELEASE_ID_MISMATCH');
  return releaseRoot;
}

function compareMigrations(migrations, rows) {
  const applied = rows.filter((row) => !row.rolled_back_at);
  if (applied.some((row) => !row.finished_at)) throw new Error('FAILED_OR_RUNNING_MIGRATION');
  if (new Set(applied.map((row) => row.migration_name)).size !== applied.length) throw new Error('DUPLICATE_MIGRATION');
  const local = new Map(migrations.map((migration) => [migration.name, migration.sha256]));
  for (const row of applied) if (!local.has(row.migration_name) || local.get(row.migration_name) !== row.checksum) throw new Error('MIGRATION_HISTORY_MISMATCH');
  const names = new Set(applied.map((row) => row.migration_name));
  let pendingSeen = false;
  const pending = [];
  for (const migration of migrations) {
    if (!names.has(migration.name)) { pendingSeen = true; pending.push(migration.name); }
    else if (pendingSeen) throw new Error('NON_LINEAR_MIGRATION_HISTORY');
  }
  return pending;
}

function databaseUrl(config, variable = 'STAGING_DATABASE_URL') {
  const connection = requireValue(process.env[variable], variable);
  const url = new URL(connection);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.hostname !== config.databaseHost
    || decodeURIComponent(url.pathname.slice(1)) !== config.databaseName) throw new Error('DATABASE_TARGET_MISMATCH');
  return connection;
}

async function ledger(config, variable = 'STAGING_DATABASE_URL') {
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl(config, variable), connectionTimeoutMillis: 10000,
    statement_timeout: 10000, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at, migration_name');
    await client.query('ROLLBACK');
    return result.rows;
  } finally { await client.end(); }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 20 * 60_000, ...options });
  if (result.error || result.status !== 0) throw new Error('COMMAND_FAILED_NO_AUTOMATIC_RETRY');
  return result.stdout;
}

function vercel(config, args) {
  const executable = requireValue(config.vercelCliPath, 'vercelCliPath');
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) throw new Error('EXISTING_VERCEL_CLI_REQUIRED');
  return run(process.execPath, [executable, ...args, '--scope', trustedStagingIdentity.vercelTeamScope,
    '--token', requireValue(process.env.STAGING_VERCEL_TOKEN, 'STAGING_VERCEL_TOKEN')], {
    env: { ...process.env, VERCEL_PROJECT_ID: trustedStagingIdentity.vercelProjectId },
  });
}

async function request(url, init = {}) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
}

async function vercelJson(config, route) {
  validateTarget(config);
  try {
    const response = await request(`https://api.vercel.com${route}?teamId=${encodeURIComponent(trustedStagingIdentity.vercelTeamScope)}`, {
      headers: { Authorization: `Bearer ${requireValue(process.env.STAGING_VERCEL_TOKEN, 'STAGING_VERCEL_TOKEN')}` },
    });
    if (!response.ok) throw new Error('VERCEL_METADATA_UNAVAILABLE');
    return response.json();
  } catch {
    throw new Error('VERCEL_METADATA_UNAVAILABLE');
  }
}

async function vercelProjectMetadata(config) {
  const project = await vercelJson(config, `/v9/projects/${encodeURIComponent(trustedStagingIdentity.vercelProjectId)}`);
  if (project.id !== trustedStagingIdentity.vercelProjectId
    || project.name !== trustedStagingIdentity.vercelProjectName) throw new Error('VERCEL_PROJECT_IDENTITY_MISMATCH');
  return { id: project.id, name: project.name, teamScope: trustedStagingIdentity.vercelTeamScope };
}

async function deploymentMetadata(config, identifier) {
  await vercelProjectMetadata(config);
  const deployment = await vercelJson(config, `/v13/deployments/${encodeURIComponent(requireValue(identifier, 'deploymentIdentifier'))}`);
  if (deployment.projectId !== trustedStagingIdentity.vercelProjectId || deployment.target === 'production'
    || ![null, 'preview', 'staging'].includes(deployment.target) || deployment.readyState !== 'READY') throw new Error('DEPLOYMENT_NOT_AUTHORIZED_PREVIEW');
  const url = origin(`https://${requireValue(deployment.url, 'deploymentUrl')}`);
  if (config.productionOrigins.map(origin).includes(url)) throw new Error('PRODUCTION_DEPLOYMENT_FORBIDDEN');
  return { id: requireValue(deployment.id, 'deploymentId'), origin: url, projectId: deployment.projectId,
    target: deployment.target, readyState: deployment.readyState, releaseId: deployment.meta?.stagingReleaseId ?? null };
}

async function aliasDeploymentId(config) {
  await vercelProjectMetadata(config);
  const alias = await vercelJson(config, `/v4/aliases/${encodeURIComponent(trustedStagingIdentity.stagingAlias)}`);
  return requireValue(alias.deploymentId ?? alias.deployment?.id, 'aliasDeploymentId');
}

async function neonJson(route) {
  try {
    const response = await request(`https://console.neon.tech/api/v2${route}`, {
      headers: { Authorization: `Bearer ${requireValue(process.env.STAGING_NEON_API_KEY, 'STAGING_NEON_API_KEY')}` },
    });
    if (!response.ok) throw new Error('NEON_METADATA_UNAVAILABLE');
    return response.json();
  } catch {
    throw new Error('NEON_METADATA_UNAVAILABLE');
  }
}

async function neonTargetMetadata(config, variable = 'STAGING_DATABASE_URL') {
  validateTarget(config);
  const connection = new URL(databaseUrl(config, variable));
  const projectResponse = await neonJson(`/projects/${encodeURIComponent(trustedStagingIdentity.neonProjectId)}`);
  const branchResponse = await neonJson(`/projects/${encodeURIComponent(trustedStagingIdentity.neonProjectId)}/branches/${encodeURIComponent(trustedStagingIdentity.neonBranchId)}`);
  const endpointsResponse = await neonJson(`/projects/${encodeURIComponent(trustedStagingIdentity.neonProjectId)}/endpoints`);
  const project = projectResponse.project ?? projectResponse;
  const branch = branchResponse.branch ?? branchResponse;
  const endpoints = endpointsResponse.endpoints ?? [];
  if (project.id !== trustedStagingIdentity.neonProjectId
    || branch.id !== trustedStagingIdentity.neonBranchId
    || (branch.project_id && branch.project_id !== trustedStagingIdentity.neonProjectId)) throw new Error('NEON_PROJECT_OR_BRANCH_IDENTITY_MISMATCH');
  const endpoint = endpoints.find((candidate) => candidate.branch_id === trustedStagingIdentity.neonBranchId
    && (!candidate.project_id || candidate.project_id === trustedStagingIdentity.neonProjectId)
    && candidate.host === connection.hostname);
  if (!endpoint) throw new Error('NEON_DATABASE_IDENTITY_MISMATCH');
  return { projectId: project.id, branchId: branch.id, databaseHost: connection.hostname, endpointId: endpoint.id ?? null };
}

async function smoke(config, deploymentOrigin, releaseId) {
  const headers = config.previewProtectionBypassEnv ? {
    'x-vercel-protection-bypass': requireValue(process.env[config.previewProtectionBypassEnv], config.previewProtectionBypassEnv),
  } : {};
  const marker = await request(`${origin(deploymentOrigin)}/staging-release.json`, { headers });
  if (!marker.ok || (await marker.json()).releaseId !== releaseId) throw new Error('DEPLOYED_VERSION_MISMATCH');
  const metadata = await request(`${deploymentOrigin}/.well-known/oauth-protected-resource`, { headers });
  if (!metadata.ok) throw new Error('RESOURCE_METADATA_FAILED');
  const resource = await metadata.json();
  if (resource.resource !== `${origin(config.previewOrigin)}/api/mcp`
    || !resource.authorization_servers?.includes(origin(config.workosIssuer))) throw new Error('RUNTIME_AUTH_CONFIGURATION_MISMATCH');
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'controlled-staging-smoke', version: '1' },
  } });
  for (const authorization of [null, 'Bearer invalid-staging-verification-token']) {
    const response = await request(`${deploymentOrigin}/api/mcp`, { method: 'POST', body,
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(authorization ? { authorization } : {}) } });
    if (response.status !== 401) throw new Error('UNAUTHENTICATED_REQUEST_NOT_REJECTED');
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  for (const [tokenEnv, allowed] of [[config.readTokenEnv, true], [config.deniedTokenEnv, false]]) {
    const client = new Client({ name: 'controlled-staging-smoke', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(`${deploymentOrigin}/api/mcp`), {
      requestInit: { headers: { ...headers, Authorization: `Bearer ${requireValue(process.env[requireValue(tokenEnv, 'tokenEnv')], tokenEnv)}` } },
      fetch: request,
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      if (!allowed) throw new Error('DENIED_PRINCIPAL_ACCEPTED');
      const names = tools.tools.map((tool) => tool.name).sort();
      const expected = ['research_capabilities', 'research_list_pending', 'research_get_mission', 'research_claim_mission',
        'research_submit_evidence_bundle', 'research_defer_mission', 'research_complete_mission'].sort();
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('TOOL_CONTRACT_MISMATCH');
    } catch (error) {
      if (allowed || error.code !== 403) throw new Error('AUTHORIZATION_SMOKE_FAILED');
    } finally { await client.close(); }
  }
  const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
  if (config.storageNonProductionConfirmed !== true || typeof config.storageForcePathStyle !== 'boolean'
    || !Number.isSafeInteger(config.storageProbeBytes) || config.storageProbeBytes < 1) throw new Error('STORAGE_PROBE_CONFIGURATION_REQUIRED');
  if (origin(config.storageEndpoint) === origin(config.previewOrigin)) throw new Error('STORAGE_TARGET_INVALID');
  const storage = new S3Client({ endpoint: origin(config.storageEndpoint), region: requireValue(config.storageRegion, 'storageRegion'),
    forcePathStyle: config.storageForcePathStyle === true, maxAttempts: 1,
    credentials: { accessKeyId: requireValue(process.env.STAGING_S3_ACCESS_KEY_ID, 'STAGING_S3_ACCESS_KEY_ID'),
      secretAccessKey: requireValue(process.env.STAGING_S3_SECRET_ACCESS_KEY, 'STAGING_S3_SECRET_ACCESS_KEY') } });
  try {
    const head = await storage.send(new HeadObjectCommand({ Bucket: requireValue(config.storageBucket, 'storageBucket'),
      Key: requireValue(config.storageProbeKey, 'storageProbeKey') }), { abortSignal: AbortSignal.timeout(15000) });
    if (head.ContentLength !== config.storageProbeBytes) throw new Error('STORAGE_OBJECT_MISMATCH');
  } finally { storage.destroy(); }
  return { version: 'PASS', metadata: 'PASS', authentication: 'PASS', authorization: 'PASS', storageHead: 'PASS',
    limitation: 'Read-only storage probe with operator credentials; upload and application storage credentials require separate runtime confirmation.' };
}

async function execute(action, config, manifest) {
  const releaseRoot = verifyRelease(manifest);
  if (action === 'verify-release') return { releaseId: manifest.releaseId, integrity: 'PASS' };
  validateTarget(config);
  if (process.env.STAGING_AUTHORIZATION !== manifest.releaseId || !config.authorizedActions?.includes(action)) throw new Error('EXPLICIT_ACTION_AUTHORIZATION_REQUIRED');
  const state = fs.existsSync(statePath) ? readJson(statePath) : {};
  const target = sha256(JSON.stringify([trustedStagingIdentity.vercelProjectId, trustedStagingIdentity.vercelTeamScope,
    trustedStagingIdentity.neonProjectId, trustedStagingIdentity.neonBranchId, config.databaseHost, config.databaseName,
    trustedStagingIdentity.stagingAlias]));
  if (state.releaseId && (state.releaseId !== manifest.releaseId || state.target !== target)) throw new Error('STATE_TARGET_MISMATCH');
  Object.assign(state, { releaseId: manifest.releaseId, target });
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  if (action === 'inspect') {
    const previous = await deploymentMetadata(config, config.previousDeploymentId);
    if (await aliasDeploymentId(config) !== previous.id || previous.origin !== origin(config.previousDeploymentOrigin)) throw new Error('PREVIOUS_DEPLOYMENT_ALIAS_MISMATCH');
    state.previousDeployment = previous;
  } else if (action === 'configuration') {
    await vercelProjectMetadata(config);
    const listing = vercel(config, ['env', 'ls', 'preview']);
    const absent = requiredEnv.filter((name) => !new RegExp(`\\b${name}\\b`).test(listing));
    if (absent.length) throw new Error(`PREVIEW_ENV_MISSING:${absent.join(',')}`);
    if (config.runtimeConfigurationReviewed !== true || config.adminBypassDisabled !== true) throw new Error('RUNTIME_VALUES_REVIEW_REQUIRED');
    state.configuration = { checkedAt: new Date().toISOString(), requiredNamesPresent: true, valuesReviewedByOperator: true };
  } else if (action === 'rehearse') {
    await neonTargetMetadata(config);
    if (!state.database || JSON.stringify(config.approvedPendingMigrations) !== JSON.stringify(state.database.pending)) throw new Error('APPROVED_COMPARISON_REQUIRED');
    requireValue(config.validationBranchId, 'validationBranchId');
    if (config.validationBranchId === config.neonBranchId || config.validationSourceHead !== config.neonSourceHead) throw new Error('ISOLATED_CLONE_REQUIRED');
    const clone = { ...config, databaseHost: requireValue(config.validationDatabaseHost, 'validationDatabaseHost'),
      databaseName: requireValue(config.validationDatabaseName, 'validationDatabaseName') };
    if (clone.databaseHost === config.databaseHost || config.productionDatabaseHosts.includes(clone.databaseHost)) throw new Error('CLONE_TARGET_FORBIDDEN');
    await neonTargetMetadata(clone, 'STAGING_VALIDATION_DATABASE_URL');
    const before = await ledger(clone, 'STAGING_VALIDATION_DATABASE_URL');
    if (sha256(JSON.stringify(before)) !== state.database.ledgerHash) throw new Error('CLONE_LEDGER_MISMATCH');
    const pending = compareMigrations(manifest.migrations, before);
    const env = { ...process.env, DATABASE_URL: databaseUrl(clone, 'STAGING_VALIDATION_DATABASE_URL') };
    if (pending.length) run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
      '--config', path.join(releaseRoot, 'prisma.config.ts')], { cwd: releaseRoot, env });
    if (compareMigrations(manifest.migrations, await ledger(clone, 'STAGING_VALIDATION_DATABASE_URL')).length) throw new Error('CLONE_MIGRATIONS_PENDING');
    run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-config-datasource',
      '--to-schema', path.join(releaseRoot, 'prisma/schema.prisma'), '--exit-code', '--config', path.join(releaseRoot, 'prisma.config.ts')], { cwd: releaseRoot, env });
    const receipt = { releaseId: manifest.releaseId, pending, result: 'PASS', sourceLedgerHash: state.database.ledgerHash,
      validationBranchId: config.validationBranchId, checkedAt: new Date().toISOString(), target };
    fs.writeFileSync(path.join(output, 'migration-rehearsal.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    state.rehearsalReceipt = 'staging-preparation/migration-rehearsal.json';
  } else if (action === 'db-compare' || action === 'migrate') {
    await neonTargetMetadata(config);
    const rows = await ledger(config);
    const pending = compareMigrations(manifest.migrations, rows);
    const ledgerHash = sha256(JSON.stringify(rows));
    if (action === 'db-compare') state.database = { pending, ledgerHash, checkedAt: new Date().toISOString(), branchId: config.neonBranchId };
    else {
      if (!state.database || state.database.ledgerHash !== ledgerHash || JSON.stringify(config.approvedPendingMigrations) !== JSON.stringify(pending)) throw new Error('MIGRATION_COMPARISON_OR_APPROVAL_MISMATCH');
      if (pending.length) {
        requireValue(config.databaseRecoveryPoint, 'databaseRecoveryPoint');
        const rehearsal = readJson(requireValue(config.migrationRehearsalReceipt, 'migrationRehearsalReceipt'));
        if (rehearsal.releaseId !== manifest.releaseId || rehearsal.result !== 'PASS' || rehearsal.target !== target || rehearsal.sourceLedgerHash !== ledgerHash
          || JSON.stringify(rehearsal.pending) !== JSON.stringify(pending)) throw new Error('CLONE_REHEARSAL_REQUIRED');
        run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', path.join(releaseRoot, 'prisma.config.ts')],
          { cwd: releaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl(config) } });
      }
      const after = await ledger(config);
      if (compareMigrations(manifest.migrations, after).length) throw new Error('MIGRATIONS_STILL_PENDING');
      run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-config-datasource',
        '--to-schema', path.join(releaseRoot, 'prisma/schema.prisma'), '--exit-code', '--config', path.join(releaseRoot, 'prisma.config.ts')],
      { cwd: releaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl(config) } });
      state.database = { pending: [], ledgerHash: sha256(JSON.stringify(after)), checkedAt: new Date().toISOString(), schemaMatched: true };
    }
  } else if (action === 'deploy') {
    await vercelProjectMetadata(config);
    if (!state.configuration || !state.database?.schemaMatched || !state.previousDeployment) throw new Error('PREVIOUS_VERSION_CONFIGURATION_AND_SCHEMA_REQUIRED');
    if (state.deploymentAttempted) throw new Error('DEPLOYMENT_ALREADY_ATTEMPTED_INSPECT_BEFORE_RETRY');
    state.deploymentAttempted = true; save();
    const stdout = vercel(config, ['deploy', releaseRoot, '--yes', '--target=preview', '--skip-domain', '--meta', `stagingReleaseId=${manifest.releaseId}`]);
    const urls = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app\b/g) ?? [];
    if (!urls.length) throw new Error('DEPLOYMENT_IDENTITY_UNCERTAIN_INSPECT_MANUALLY');
    state.deploymentOrigin = origin(urls[urls.length - 1]);
    const deployed = await deploymentMetadata(config, new URL(state.deploymentOrigin).hostname);
    if (deployed.releaseId !== manifest.releaseId) throw new Error('DEPLOYMENT_RELEASE_METADATA_MISMATCH');
    state.deployment = deployed;
  } else if (action === 'smoke') {
    const verified = await deploymentMetadata(config, requireValue(state.deployment?.id, 'deploymentId'));
    if (verified.origin !== state.deploymentOrigin) throw new Error('DEPLOYMENT_IDENTITY_CHANGED');
    state.smoke = await smoke(config, requireValue(state.deploymentOrigin, 'deploymentOrigin'), manifest.releaseId);
    state.smoke.checkedAt = new Date().toISOString();
  } else if (action === 'activate' || action === 'rollback') {
    if (config.previousApplicationDatabaseCompatible !== true) throw new Error('APPLICATION_DATABASE_COMPATIBILITY_REVIEW_REQUIRED');
    const expected = action === 'rollback' ? state.previousDeployment : state.deployment;
    if (!expected) throw new Error('VERIFIED_DEPLOYMENT_IDENTITY_REQUIRED');
    const verified = await deploymentMetadata(config, expected.id);
    if (verified.origin !== expected.origin) throw new Error('DEPLOYMENT_IDENTITY_CHANGED');
    const destination = verified.origin;
    if (action === 'activate' && !state.smoke) throw new Error('SMOKE_REQUIRED');
    if (config.productionOrigins.map(origin).includes(destination)) throw new Error('PRODUCTION_DEPLOYMENT_FORBIDDEN');
    requireValue(config.previousDeploymentId, 'previousDeploymentId');
    const currentAlias = await aliasDeploymentId(config);
    if (currentAlias !== (action === 'rollback' ? state.deployment?.id : state.previousDeployment?.id)) throw new Error('ALIAS_CHANGED_STOP');
    vercel(config, ['alias', 'set', destination, trustedStagingIdentity.stagingAlias]);
    if (await aliasDeploymentId(config) !== verified.id) throw new Error('ALIAS_OUTCOME_UNCERTAIN');
    state.alias = { destination, action, checkedAt: new Date().toISOString() };
  }
  save();
  return state;
}

module.exports = { actions, validateTarget, compareMigrations, verifyRelease, execute, requiredEnv, deploymentMetadata,
  vercelProjectMetadata, neonTargetMetadata };
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0] ?? 'plan';
  if (!['plan', ...actions].includes(action) || args.slice(1).some((value) => value !== '--execute')) throw new Error('UNKNOWN_ARGUMENT');
  if (!args.includes('--execute')) {
    console.log(JSON.stringify({ mode: 'PLAN_ONLY_NO_NETWORK', action, actions,
      config: 'staging-preparation/target.json', authorization: 'STAGING_AUTHORIZATION must equal releaseId; authorizedActions must include action',
      effects: { inspect: 'Read deployment metadata and current staging alias; forbid other projects and production',
        configuration: 'Preview environment names only; values reviewed separately', 'db-compare': 'Read-only migration ledger',
        migrate: 'Approved pending migrations only, then schema diff; requires recovery point and clone rehearsal',
        rehearse: 'Approved migrations on explicitly identified validation clone only; compare original ledger and generate receipt',
        deploy: 'Selected source directory to Preview without alias assignment', smoke: 'Version/auth/permission/storage read-only probes; no provider or mission execution',
        activate: 'Move staging alias after smoke', rollback: 'Move staging alias to previous application only; database unchanged' } }, null, 2));
  } else {
    if (action === 'plan') throw new Error('PLAN_CANNOT_EXECUTE');
    execute(action, readJson(path.join(output, 'target.json')), readJson(manifestPath))
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => { console.error(`STOP:${String(error.message).match(/^[A-Z_]+/)?.[0] ?? 'OPERATION_FAILED'}; no automatic retry or database rollback`); process.exitCode = 1; });
  }
}