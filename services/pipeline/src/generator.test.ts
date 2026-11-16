import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import type { Server } from 'node:http';
import { lanternCapture, type Bundle } from '@t2t/shared';
import { startLocalShop } from '@t2t/svc-shop/src/local-server.js';
import { generateTest, literal, pathSlug } from './generator.js';

const root = resolve(__dirname, '../../..');

export function lanternBundle(): Bundle {
  const c = lanternCapture();
  return {
    incidentId: '01JCXK2M8Q4T9V6B3N7RZ5WDHE',
    service: c.service,
    capturedAt: c.capturedAt,
    fingerprint: 'a41f9c0d1e2f',
    request: c.request,
    response: c.response,
    error: c.error,
    redactions: c.redactions,
    leakCount: 0,
  };
}

/** Evaluates a generated file with stand-in Jest globals and returns what it would send. */
function runInSandbox(source: string) {
  const sent: { url: string; init: RequestInit }[] = [];
  const tests: (() => Promise<void>)[] = [];
  const ctx = vm.createContext({
    process: { env: { T2T_TARGET_URL: 'http://target.test/', T2T_TARGET_API_KEY: 'k' } },
    describe: (_n: string, fn: () => void) => fn(),
    beforeAll: (fn: () => void) => fn(),
    test: (_n: string, fn: () => Promise<void>) => tests.push(fn),
    expect: () => ({ toBeLessThan: () => {} }),
    console: { error: () => {} },
    URLSearchParams,
    fetch: async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return { status: 200, text: async () => '' };
    },
  });
  vm.runInContext(source, ctx);
  return { sent, tests };
}

describe('generated test', () => {
  test('the Lantern Books incident produces exactly the expected file', async () => {
    const { filename, source } = generateTest({ bundle: lanternBundle(), stagingStatus: 500 });
    expect(filename).toBe('checkout-500-a41f9c.test.js');
    await expect(source).toMatchFileSnapshot('./__snapshots__/checkout-500-a41f9c.test.js');
    // Deterministic: the same incident always yields the same bytes.
    expect(generateTest({ bundle: lanternBundle(), stagingStatus: 500 }).source).toBe(source);
  });

  test('hostile captured strings cannot break out of strings or comments', async () => {
    const evil = 'a"b\'c`d ${process.exit(1)} */ x(); /* \\   \n end';
    const bundle = lanternBundle();
    bundle.request = {
      ...bundle.request,
      path: '/checkout/*/`${x}`',
      query: { q: evil },
      headers: { 'content-type': evil },
      body: { [evil]: evil, nested: [evil, { '*/': '${}' }], n: 1.5, t: true, z: null },
    };
    bundle.error = { name: 'Error*/', message: evil, stackTop: '' };
    bundle.redactions = [{ path: `request.body.${evil}`, type: 'email' }];
    const { source } = generateTest({ bundle, stagingStatus: 500 });

    const { sent, tests } = runInSandbox(source);
    expect(tests).toHaveLength(1);
    await tests[0]();
    expect(JSON.parse(sent[0].init.body as string)).toEqual(bundle.request.body);
    expect(sent[0].url).toBe('http://target.test/checkout/*/`${x}`?q=' + encodeURIComponent(evil).replace(/%20/g, '+').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29'));
    expect((sent[0].init.headers as Record<string, string>)['content-type']).toBe(evil);
  });

  test('the generated file passes node --check', () => {
    const dir = mkdtempSync(join(tmpdir(), 't2t-gen-'));
    const { filename, source } = generateTest({ bundle: lanternBundle(), stagingStatus: 500 });
    writeFileSync(join(dir, filename), source);
    expect(() => execFileSync(process.execPath, ['--check', join(dir, filename)])).not.toThrow();
  });

  test('literal() keeps small objects on one line', () => {
    expect(literal({ sku: 'BK-1042', price: 1299, qty: 1 })).toBe('{ sku: "BK-1042", price: 1299, qty: 1 }');
    expect(literal({ 'content-type': 'x' })).toBe('{ "content-type": "x" }');
    expect(pathSlug('/v1/Orders/{id}')).toBe('v1-orders-id');
    expect(pathSlug('/')).toBe('root');
  });
});

describe('generated test end to end with Jest', () => {
  let buggy: { url: string; server: Server };
  let fixed: { url: string; server: Server };
  const dir = mkdtempSync(join(tmpdir(), 't2t-e2e-'));
  const { filename, source } = generateTest({ bundle: lanternBundle(), stagingStatus: 500 });
  writeFileSync(join(dir, filename), source);

  beforeAll(async () => {
    buggy = await startLocalShop({ apiKey: 'staging-key', fixed: false });
    fixed = await startLocalShop({ apiKey: 'staging-key', fixed: true });
  });
  afterAll(() => { buggy.server.close(); fixed.server.close(); });

  /** Runs Jest on the generated file in a child process, with its own empty config, and reads its JSON report. */
  const jest = (url: string) =>
    new Promise<{ passed: number; failed: number; total: number }>((done, fail) => {
      const report = join(dir, `report-${Date.now()}.json`);
      const p = spawn(
        process.execPath,
        [join(root, 'node_modules/jest/bin/jest.js'), '--config', '{}', '--rootDir', dir, '--ci', '--json', `--outputFile=${report}`, join(dir, filename)],
        { cwd: dir, env: { ...process.env, T2T_TARGET_URL: url, T2T_TARGET_API_KEY: 'staging-key' }, stdio: 'ignore' },
      );
      p.on('exit', () => {
        try {
          const r = JSON.parse(readFileSync(report, 'utf8'));
          done({ passed: r.numPassedTests, failed: r.numFailedTests, total: r.numTotalTests });
        } catch (err) {
          fail(err);
        }
      });
    });

  test('fails against the server with the bug', async () => {
    expect(await jest(buggy.url)).toEqual({ passed: 0, failed: 1, total: 1 });
  }, 60_000);

  test('passes against the server with the fix', async () => {
    expect(await jest(fixed.url)).toEqual({ passed: 1, failed: 0, total: 1 });
  }, 60_000);
});
