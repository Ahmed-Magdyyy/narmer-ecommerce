import { spawn } from 'node:child_process';

// The tests override dbName and drop only their randomly named, asserted test database.
if (process.env.NODE_ENV === 'production' || !/^mongodb(?:\+srv)?:\/\//.test(process.env.MONGODB_URI ?? '')) {
  console.error('Development database tests require a non-production environment and MONGODB_URI.');
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--emails-only', '--security-only', '--reports-only', '--sizecharts-only', '--wholesale-only'].includes(args[0]))) throw new Error('Unknown test selection.');
  const target = args.includes('--wholesale-only') ? 'tests/wholesale-slugs-mongo.test.js' : args.includes('--sizecharts-only') ? 'tests/sizecharts-mongo.test.js' : args.includes('--reports-only') ? 'tests/reports-mongo.test.js' : args.includes('--security-only') ? 'tests/security-mongo.test.js'
    : args.includes('--emails-only') ? 'tests/email-mongo.test.js' : 'tests/identity-mongo.test.js';
  const child = spawn(process.execPath, ['--test', target], {
    env: { ...process.env, NARMER_TEST_MONGODB_URI: process.env.MONGODB_URI },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => {
    console.error(JSON.stringify({ event: 'test_runner_failed', code: error.code ?? 'UNKNOWN' }));
    process.exitCode = 1;
  });
  child.on('close', code => {
    // Do not echo raw driver errors: they can contain connection details.
    for (const line of output.split(/\r?\n/)) {
      if (/^(?:ok \d|not ok \d|# (?:tests|pass|fail|skipped|duration_ms)\b|\s+(?:location|failureType|code):)/.test(line)
        || /TestContext\.<anonymous> \(file:.*\/tests\/(?:identity|email|security|reports|sizecharts|wholesale-slugs)-mongo\.test\.js:\d+:\d+\)/.test(line)) console.log(line);
    }
    process.exitCode = code === 0 ? 0 : 1;
  });
}
