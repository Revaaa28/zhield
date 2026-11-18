// Zcash address classification for Zhield.
//
// Classification is prefix + structure based, with a real Bech32/Bech32m
// checksum verification for the address families that use it (Sapling,
// Unified, TEX). Transparent addresses use Base58Check; we validate the
// alphabet and length here and report checksum status honestly as
// "not verified" instead of pretending to check what we do not.
//
// Privacy model (what a public observer learns from the address alone):
//  - transparent (t1/t3 mainnet, tm/t2 testnet): everything is public,
//    exactly like Bitcoin. No memos possible.
//  - Sapling (zs / ztestsapling): shielded. Sender, recipient and amount of
//    z->z payments are hidden; encrypted memos supported.
//  - Unified (u1 / utest1): a bundle of receivers (ZIP-316). Modern wallets
//    put shielded receivers (Ironwood, Orchard, Sapling) first, but a UA can
//    also contain a transparent receiver — so the verdict is "shielded by
//    default, check your wallet", not an absolute guarantee.
//  - TEX (tex1): a transparent address encoded for exchange deposits
//    (ZIP-320). Still fully transparent on chain.
//  - Sprout (zc): legacy shielded pool, deprecated. ZIP-321 forbids payment
//    requests to Sprout addresses.

import { bech32Decode } from './bech32.js';

const BASE58 = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

function result(fields) {
  return Object.assign(
    {
      valid: false,
      kind: 'unknown',
      network: 'unknown',
      shielded: false,
      canMemo: false,
      checksum: 'not-verified',
      privacyScore: 0,
      headline: 'Unknown address',
      leaks: [],
      notes: [],
    },
    fields,
  );
}

export function classifyAddress(raw) {
  const address = String(raw ?? '').trim();
  if (!address) return result({ notes: ['Address is empty.'] });
  if (/\s/.test(address)) return result({ notes: ['Address contains whitespace — copy it exactly, with no spaces.'] });

  // --- Unified Addresses (Bech32m, ZIP-316) ---
  if (/^utest1/i.test(address) || /^u1/i.test(address)) {
    const testnet = /^utest1/i.test(address);
    const dec = bech32Decode(address);
    const hrpOk = dec && dec.hrp === (testnet ? 'utest' : 'u');
    return result({
      valid: Boolean(hrpOk),
      kind: 'unified',
      network: testnet ? 'testnet' : 'mainnet',
      shielded: true,
      canMemo: true,
      checksum: dec ? (hrpOk ? 'valid' : 'invalid-hrp') : 'invalid',
      privacyScore: 85,
      headline: 'Unified Address — shielded by default',
      leaks: ['That a payment happened, its fee and its timing stay public'],
      notes: [
        'A Unified Address bundles several receivers (ZIP-316). Modern wallets include shielded receivers — Ironwood first, the current pool since NU6.3 — so a payment to this address is shielded in practice.',
        'A UA can also carry a transparent receiver. If the sending wallet picks it, that payment is public. Good wallets prefer shielded receivers; Zhield cannot see inside the bundle without fully decoding it, so treat 85 as "private unless the wallet chooses otherwise", not a promise.',
      ],
    });
  }

  // --- TEX addresses (Bech32m, ZIP-320) ---
  if (/^tex1/i.test(address)) {
    const dec = bech32Decode(address);
    return result({
      valid: Boolean(dec && dec.hrp === 'tex'),
      kind: 'tex',
      network: 'mainnet',
      shielded: false,
      canMemo: false,
      checksum: dec ? 'valid' : 'invalid',
      privacyScore: 0,
      headline: 'TEX address — transparent (exchange deposit)',
      leaks: ['Sender address', 'Recipient address', 'Amount', 'Full history of the address'],
      notes: [
        'TEX addresses (ZIP-320) are transparent addresses in a safer encoding, made so exchanges can accept shielded withdrawals without exposing a raw t-address. On chain the payment is still fully public and cannot carry a memo.',
      ],
    });
  }

  // --- Sapling shielded (Bech32, ZIP-173 style hrps) ---
  if (/^ztestsapling1/i.test(address) || /^zs1/i.test(address)) {
    const testnet = /^ztestsapling1/i.test(address);
    const dec = bech32Decode(address);
    const hrpOk = dec && dec.hrp === (testnet ? 'ztestsapling' : 'zs');
    return result({
      valid: Boolean(hrpOk),
      kind: 'sapling',
      network: testnet ? 'testnet' : 'mainnet',
      shielded: true,
      canMemo: true,
      checksum: dec ? (hrpOk ? 'valid' : 'invalid-hrp') : 'invalid',
      privacyScore: 95,
      headline: 'Sapling shielded address — private',
      leaks: ['That a payment happened, its fee and its timing stay public'],
      notes: [
        'Payments to a Sapling address are shielded: sender, recipient and amount are hidden from public observers, and the payment can carry an encrypted memo that only the recipient can read.',
      ],
    });
  }

  // --- Sprout shielded (legacy Base58) ---
  if (/^zc/i.test(address)) {
    return result({
      valid: BASE58.test(address) && address.length >= 90,
      kind: 'sprout',
      network: 'mainnet',
      shielded: true,
      canMemo: true,
      checksum: 'not-verified',
      privacyScore: 60,
      headline: 'Sprout address — legacy shielded, do not use for new requests',
      leaks: ['That a payment happened, its fee and its timing stay public'],
      notes: [
        'Sprout is the first, deprecated shielded pool. ZIP-321 says payment requests must not be built for Sprout addresses. Ask the recipient for a Unified or Sapling address instead.',
      ],
    });
  }

  // --- Transparent (Base58Check) ---
  const transparentPrefixes = [
    { re: /^t1/i, network: 'mainnet', label: 'Transparent address (P2PKH)' },
    { re: /^t3/i, network: 'mainnet', label: 'Transparent address (P2SH)' },
    { re: /^tm/i, network: 'testnet', label: 'Transparent testnet address (P2PKH)' },
    { re: /^t2/i, network: 'testnet', label: 'Transparent testnet address (P2SH)' },
  ];
  for (const p of transparentPrefixes) {
    if (p.re.test(address)) {
      const structural = BASE58.test(address) && address.length === 35;
      return result({
        valid: structural,
        kind: 'transparent',
        network: p.network,
        shielded: false,
        canMemo: false,
        checksum: 'not-verified',
        privacyScore: 0,
        headline: p.label + ' — fully public',
        leaks: ['Sender address', 'Recipient address', 'Amount', 'Full history of the address — anyone can follow the money in and out'],
        notes: [
          'A transparent Zcash address works exactly like a Bitcoin address: every payment to or from it is public forever. It cannot carry a memo — a ZIP-321 request with a memo to this address is invalid by spec.',
          structural ? 'Structure looks right (35 Base58 characters). Zhield does not verify the Base58Check checksum in your browser; your wallet will reject a mistyped address.' : 'This does not look structurally valid: mainnet/testnet transparent addresses are 35 Base58 characters.',
        ],
      });
    }
  }

  return result({
    notes: [
      'Zhield does not recognise this as a Zcash address. Expected a transparent (t1/t3), Sapling (zs), Unified (u1), TEX (tex1) or testnet equivalent address.',
    ],
  });
}
