import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyAddress } from '../src/address.js';
import { buildPaymentURI, parsePaymentURI, validateAmount, memoToBase64Url, base64UrlToMemo } from '../src/zip321.js';
import { classifyTransaction } from '../src/tx.js';
import { bech32Encode, bech32Decode, convertBits } from '../src/bech32.js';

// --- Bech32 roundtrip + tamper detection ---
test('bech32m roundtrip verifies, tampering fails', () => {
  const words = convertBits([...new TextEncoder().encode('zhield-test-payload-0123456789')], 8, 5, true);
  const enc = bech32Encode('u', words, 'bech32m');
  const dec = bech32Decode(enc);
  assert.equal(dec.hrp, 'u');
  assert.equal(dec.encoding, 'bech32m');
  const tampered = enc.slice(0, -2) + (enc.at(-2) === 'q' ? 'p' : 'q') + enc.at(-1);
  assert.equal(bech32Decode(tampered), null);
});

// --- Address classification ---
test('transparent mainnet t1 is fully public and cannot memo', () => {
  const r = classifyAddress('t1eB29zfe9n9hAL68D3MV14tVFWA55iwymc');
  assert.equal(r.kind, 'transparent');
  assert.equal(r.network, 'mainnet');
  assert.equal(r.valid, true);
  assert.equal(r.canMemo, false);
  assert.equal(r.privacyScore, 0);
});

test('sapling example from the ZIP-321 documentation classifies as shielded testnet', () => {
  const r = classifyAddress('ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez');
  assert.equal(r.kind, 'sapling');
  assert.equal(r.network, 'testnet');
  assert.equal(r.canMemo, true);
  assert.equal(r.checksum, 'valid');
});

test('sprout is flagged legacy', () => {
  const r = classifyAddress('zc' + 'A'.repeat(92));
  assert.equal(r.kind, 'sprout');
});

test('garbage is unknown', () => {
  const r = classifyAddress('hello world');
  assert.equal(r.kind, 'unknown');
  assert.equal(r.valid, false);
});

test('unified address with a generated valid checksum classifies as unified', () => {
  const words = convertBits([...new Uint8Array(64).fill(7)], 8, 5, true);
  const ua = bech32Encode('u', words, 'bech32m');
  assert.ok(ua.startsWith('u1'));
  const r = classifyAddress(ua);
  assert.equal(r.kind, 'unified');
  assert.equal(r.valid, true);
  assert.equal(r.checksum, 'valid');
});

// --- Amounts ---
test('amount validation follows ZIP-321', () => {
  assert.equal(validateAmount('0.5').ok, true);
  assert.equal(validateAmount('50').ok, true);
  assert.equal(validateAmount('50.').ok, false);
  assert.equal(validateAmount('.5').ok, false);
  assert.equal(validateAmount('50,000.00').ok, false);
  assert.equal(validateAmount('0.123456789').ok, false);
  assert.equal(validateAmount('21000000').ok, true);
  assert.equal(validateAmount('21000000.00000001').ok, false);
});

// --- Memo codec ---
test('memo base64url roundtrip, incl. the documented example', () => {
  assert.equal(memoToBase64Url('This is a simple memo.'), 'VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg');
  assert.equal(base64UrlToMemo('VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg'), 'This is a simple memo.');
  assert.equal(base64UrlToMemo(memoToBase64Url('Thanks!')), 'Thanks!');
  assert.throws(() => memoToBase64Url('x'.repeat(513)), /512/);
});

// --- ZIP-321 build ---
const SAPLING_TEST = 'ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez';

test('build reproduces the documented ZIP-321 example URI', () => {
  const { uri, errors } = buildPaymentURI({ address: SAPLING_TEST, amount: '1', memo: 'This is a simple memo.', message: 'Thank you for your purchase' });
  assert.deepEqual(errors, []);
  assert.equal(uri, `zcash:${SAPLING_TEST}?amount=1&memo=VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg&message=Thank+you+for+your+purchase`);
});

test('memo on a transparent address is a hard error', () => {
  const { uri, errors } = buildPaymentURI({ address: 't1eB29zfe9n9hAL68D3MV14tVFWA55iwymc', amount: '0.5', memo: 'hi' });
  assert.equal(uri, null);
  assert.ok(errors.some((e) => /memo/i.test(e)));
});

test('transparent request builds but carries the public warning', () => {
  const { uri, errors, warnings } = buildPaymentURI({ address: 't1eB29zfe9n9hAL68D3MV14tVFWA55iwymc', amount: '0.5' });
  assert.deepEqual(errors, []);
  assert.ok(uri.startsWith('zcash:t1'));
  assert.ok(warnings.length > 0);
});

// --- ZIP-321 parse ---
test('parse of the documented example returns the payment', () => {
  const uri = `zcash:${SAPLING_TEST}?amount=1&memo=VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg&message=Thank%20you%20for%20your%20purchase`;
  const { payments, errors } = parsePaymentURI(uri);
  assert.deepEqual(errors, []);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].memo, 'This is a simple memo.');
  assert.equal(payments[0].amount, '1');
});

test('unknown req- parameter rejects the whole URI', () => {
  const { errors } = parsePaymentURI(`zcash:${SAPLING_TEST}?amount=1&req-future=1`);
  assert.ok(errors.some((e) => /req-future/.test(e)));
});

test('multi-payment URI parses indexed payments', () => {
  const uri = `zcash:${SAPLING_TEST}?amount=1&address.1=${SAPLING_TEST}&amount.1=2`;
  const { payments, errors } = parsePaymentURI(uri);
  assert.deepEqual(errors, []);
  assert.equal(payments.length, 2);
  assert.equal(payments[1].amount, '2');
});

// --- Transaction classification (structural fixtures in the node verbose format) ---
test('t-to-t fixture', () => {
  const r = classifyTransaction({
    txid: 'aa',
    vin: [{ txid: 'bb', vout: 0 }],
    vout: [{ value: 0.5, scriptPubKey: { addresses: ['t1eB29zfe9n9hAL68D3MV14tVFWA55iwymc'] } }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.flow, 't-to-t');
  assert.equal(r.privacyScore, 0);
  assert.ok(r.visible.includes('Exact amount'));
});

test('t-to-z shielding fixture', () => {
  const r = classifyTransaction({
    txid: 'cc',
    vin: [{ txid: 'bb', vout: 1 }],
    vout: [],
    vShieldedOutput: [{}, {}],
    valueBalance: 0.4999,
  });
  assert.equal(r.flow, 't-to-z');
  assert.ok(r.hidden.some((h) => /Recipient/.test(h)));
});

test('z-to-t deshielding fixture', () => {
  const r = classifyTransaction({
    txid: 'dd',
    vin: [],
    vout: [{ value: 0.25, scriptPubKey: { addresses: ['t1eB29zfe9n9hAL68D3MV14tVFWA55iwymc'] } }],
    vShieldedSpend: [{}],
    valueBalance: -0.2501,
  });
  assert.equal(r.flow, 'z-to-t');
});

test('z-to-z fully shielded orchard fixture hides amount', () => {
  const r = classifyTransaction({
    txid: 'ee',
    vin: [],
    vout: [],
    orchard: { actions: [{}, {}, {}] },
    valueBalanceOrchard: 0,
  });
  assert.equal(r.flow, 'z-to-z');
  assert.equal(r.privacyScore, 100);
  assert.ok(r.hidden.includes('Amount'));
  assert.ok(r.pools.includes('Orchard / Ironwood'));
});

test('coinbase fixture', () => {
  const r = classifyTransaction({
    txid: 'ff',
    vin: [{ coinbase: 'abcd' }],
    vout: [{ value: 3.125, scriptPubKey: { addresses: ['t1miner'] } }],
  });
  assert.equal(r.flow, 'coinbase');
});

test('non-transaction JSON is rejected honestly', () => {
  const r = classifyTransaction({ hello: 'world' });
  assert.equal(r.ok, false);
});
