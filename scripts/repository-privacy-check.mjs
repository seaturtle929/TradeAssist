import { spawnSync } from 'node:child_process';

// Inspect Git blobs, never the live browser/runtime stores. Report paths only.
const runtimeScripts = new Set([
  'build-verified.sh', 'execution-profile.mjs', 'install-ci.mjs', 'install-ci.sh',
  'install-pnpm.sh', 'npm-install.mjs', 'pnpm-install.mjs', 'run-framework.mjs',
  'sites-env.mjs', 'sites-env.sh', 'start-local.mjs', 'stop-local.mjs',
  'repository-privacy-check.mjs', 'connector-preview/connector-preview-session.mjs',
  'connector-preview/host-binding.mjs', 'connector-preview/protocol.mjs',
  // Reviewed synthetic offline suite only; historical/private QA stays blocked.
  'conversation-regression-suite.mjs', 'regression/conversation-fixtures.mjs',
  'regression/conversation-worker.mjs', 'regression/evaluate-reply.mjs',
  'regression/typescript-loader.mjs',
  'regression/scheduled-comparison.mjs', 'regression/scheduled-lifecycle-worker.mjs',
]);
function git(args, input) {
  const result = spawnSync('git', args, { input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git inspection failed: ${args[0]}`);
  return result.stdout;
}
function forbiddenPath(path) {
  return /(^|\/)(?:\.env[^/]*|outputs|work|node_modules|\.sites-runtime|\.wrangler|\.agents|\.codex|\.openai|\.next|\.vinext|dist|coverage)(\/|$)/i.test(path) ||
    /\.(?:swp|swo|log|sqlite\d*|db|wav|mp3|m4a|webm|har|pem|p12|key)$/i.test(path) ||
    /\.private\./i.test(path) ||
    /^(?:app\/regression\/|components\/regression-harness\.|lib\/(?:brain-regressions|debug-scenarios|private-learning-fixtures)\.ts$)/.test(path) ||
    (path.startsWith('scripts/') && !runtimeScripts.has(path.slice(8)));
}
function secretType(text) {
  const patterns = [
    ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/],
    ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
    ['AWS credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['registry credential', /(?:_authToken|_password)\s*=\s*(?!\$\{|process\.env)[A-Za-z0-9+/=_-]{12,}/],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}
const mode = process.argv[2] || '--index';
const refs = process.argv.slice(3);
const failures = new Set();
let trees = [], blobCount = 0, pathCount = 0;
if (mode === '--history') {
  if (!refs.length || refs.some(ref => ref.startsWith('-'))) throw new Error('Specify explicit publish refs.');
  trees = git(['rev-list', ...refs]).toString().trim().split('\n').filter(Boolean);
} else if (mode !== '--index') throw new Error('Use --index or --history <explicit refs>.');
const checked = new Set();
for (const tree of trees.length ? trees : [null]) {
  const entries = git(tree ? ['ls-tree', '-rz', '--full-tree', tree] : ['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean);
  for (const entry of entries) {
    const [meta, path] = entry.split('\t');
    const pieces = meta.split(' '), hash = pieces[tree ? 2 : 1];
    pathCount++;
    if (forbiddenPath(path)) failures.add(`${path}: private/local path`);
    if (pieces[0] === '120000' || pieces[0] === '160000') failures.add(`${path}: review external link/submodule`);
    if (checked.has(hash)) continue;
    checked.add(hash); blobCount++;
    const content = git(['cat-file', 'blob', hash]);
    if (content.length > 10 * 1024 * 1024) failures.add(`${path}: oversized blob requires review`);
    const reason = secretType(content.toString('utf8'));
    if (reason) failures.add(`${path}: ${reason}`);
    if (path.endsWith('.json') && /"(?:turns|transcript|manufacturers|coachingRequestTrace|buyerMemory)"\s*:/.test(content.toString('utf8')))
      failures.add(`${path}: possible customer/runtime export`);
  }
}
if (failures.size) {
  console.error('Upload review FAILED (values withheld):\n' + [...failures].sort().join('\n'));
  process.exitCode = 1;
} else console.log(`Upload review passed: ${blobCount} unique blobs, ${pathCount} path versions, ${trees.length || 1} ${trees.length ? 'commits' : 'index'}. Manual content review is still required.`);
