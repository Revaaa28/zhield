// ZIP-321 payment request URIs: build, parse, validate.
//
// Spec summary (https://zips.z.cash/zip-0321):
//   zcash:<address>?amount=<zec>&memo=<base64url>&label=<text>&message=<text>
//   - Multiple payments: parameters may be indexed, e.g. address.1, amount.1
//     for the second payment; the un-indexed set is payment 0.
//   - amount: decimal ZEC, '.' separator, at most 8 decimal places, no
//     grouping separators, ".5" and "50." are invalid, max 21,000,000.
//   - memo: UTF-8 bytes, at most 512 bytes, base64url-encoded WITHOUT '='
//     padding. Only allowed for shielded addresses — a memo attached to a
//     transparent address makes the whole URI invalid.
//   - A parameter starting with "req-" is required: a parser that does not
//     understand it must reject the entire URI.
//   - Sprout addresses must not be used in payment requests.

import { classifyAddress } from './address.js';

export const MAX_ZEC = 21000000;
export const MAX_MEMO_BYTES = 512;

const AMOUNT_RE = /^(0|[0-9]+)(\.[0-9]{1,8})?$/;

export function validateAmount(str) {
  if (typeof str !== 'string' || str === '') return { ok: false, error: 'Amount is empty.' };
  if (/[,]/.test(str)) return { ok: false, error: 'Amount must not contain grouping separators like commas.' };
  if (!AMOUNT_RE.test(str)) {
    return { ok: false, error: 'Amount must be a plain decimal like 0.5 or 12.25 — at most 8 decimal places, no leading ".", no trailing ".".' };
  }
  const value = Number(str);
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Amount must be a non-negative number.' };
  if (value > MAX_ZEC) return { ok: false, error: 'Amount exceeds the total possible supply of 21,000,000 ZEC.' };
  return { ok: true, value };
}

export function memoToBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (bytes.length > MAX_MEMO_BYTES) {
    throw new Error(`Memo is ${bytes.length} bytes — the maximum is ${MAX_MEMO_BYTES} bytes once UTF-8 encoded.`);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToMemo(b64url) {
  if (typeof b64url !== 'string' || !/^[A-Za-z0-9_-]*$/.test(b64url)) {
    throw new Error('Memo is not valid base64url (A-Z, a-z, 0-9, - and _ only, no "=" padding).');
  }
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let bin;
  try {
    bin = atob(padded);
  } catch {
    throw new Error('Memo base64url could not be decoded.');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.length > MAX_MEMO_BYTES) throw new Error(`Decoded memo is ${bytes.length} bytes — over the ${MAX_MEMO_BYTES}-byte limit.`);
  return new TextDecoder().decode(bytes);
}

/**
 * Build a single-payment ZIP-321 URI.
 * @returns {{uri: string|null, errors: string[], warnings: string[], addressInfo: object}}
 */
export function buildPaymentURI({ address, amount, memo, label, message } = {}) {
  const errors = [];
  const warnings = [];
  const info = classifyAddress(address ?? '');
  if (!address || !String(address).trim()) errors.push('Address is required.');
  else if (info.kind === 'unknown') errors.push('Address is not a recognised Zcash address.');
  else if (!info.valid) errors.push(`Address failed validation (${info.headline}). ${info.notes[0] ?? ''}`.trim());
  if (info.kind === 'sprout') errors.push('ZIP-321 forbids payment requests to Sprout addresses.');

  let amountStr = null;
  if (amount !== undefined && amount !== null && String(amount).trim() !== '') {
    amountStr = String(amount).trim();
    const v = validateAmount(amountStr);
    if (!v.ok) errors.push(v.error);
  }

  let memoB64 = null;
  if (memo !== undefined && memo !== null && String(memo) !== '') {
    if (!info.canMemo) {
      errors.push('A memo can only be attached to a shielded address. Transparent and TEX addresses cannot carry memos — ZIP-321 makes the whole request invalid.');
    } else {
      try {
        memoB64 = memoToBase64Url(memo);
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  if (info.kind === 'transparent' || info.kind === 'tex') {
    warnings.push('This request asks for a PUBLIC payment: sender, recipient and amount will be visible to anyone, forever. For a private payment, ask the recipient for a Unified (u1) or Sapling (zs) address.');
  }

  if (errors.length) return { uri: null, errors, warnings, addressInfo: info };

  const params = new URLSearchParams();
  if (amountStr !== null) params.set('amount', amountStr);
  if (memoB64 !== null) params.set('memo', memoB64);
  if (label) params.set('label', String(label));
  if (message) params.set('message', String(message));
  const qs = params.toString();
  return { uri: `zcash:${String(address).trim()}${qs ? '?' + qs : ''}`, errors, warnings, addressInfo: info };
}

const KNOWN_PARAMS = new Set(['address', 'amount', 'memo', 'label', 'message']);

/**
 * Parse a ZIP-321 URI (single or multi-payment).
 * @returns {{payments: Array, errors: string[]}}
 * Each payment: {address, amount (string|null), memo (string|null), label, message, addressInfo}
 */
export function parsePaymentURI(uri) {
  const errors = [];
  const payments = [];
  if (typeof uri !== 'string' || !/^zcash:/i.test(uri.trim())) {
    return { payments, errors: ['Not a ZIP-321 URI: it must start with "zcash:".'] };
  }
  const body = uri.trim().slice('zcash:'.length);
  const [addrPart, queryPart] = body.split('?', 2);
  const params = new URLSearchParams(queryPart ?? '');

  // First payment's address can be positional (zcash:<address>?...) or a param.
  const byIndex = new Map();
  const bucket = (idx) => {
    if (!byIndex.has(idx)) byIndex.set(idx, {});
    return byIndex.get(idx);
  };
  if (addrPart) bucket(0).address = decodeURIComponent(addrPart);

  for (const [rawKey, value] of params.entries()) {
    const m = rawKey.match(/^([A-Za-z-]+?)(?:\.([0-9]+))?$/);
    if (!m) {
      errors.push(`Malformed parameter name "${rawKey}".`);
      continue;
    }
    const [, name, idxStr] = m;
    const idx = idxStr === undefined ? 0 : Number(idxStr);
    if (name.startsWith('req-')) {
      errors.push(`Required parameter "${rawKey}" is not understood by Zhield — ZIP-321 says the whole request must be rejected.`);
      continue;
    }
    if (!KNOWN_PARAMS.has(name)) continue; // unknown optional params are ignored per spec
    bucket(idx)[name] = value;
  }

  const indexes = [...byIndex.keys()].sort((a, b) => a - b);
  if (!indexes.length) errors.push('The URI contains no payment.');

  for (const idx of indexes) {
    const p = byIndex.get(idx);
    if (!p.address) {
      errors.push(`Payment ${idx} has no address.`);
      continue;
    }
    const info = classifyAddress(p.address);
    if (info.kind === 'sprout') errors.push(`Payment ${idx}: Sprout addresses must not be used in payment requests.`);
    if (info.kind === 'unknown') errors.push(`Payment ${idx}: address is not a recognised Zcash address.`);

    let memo = null;
    if (p.memo !== undefined) {
      if (!info.canMemo) {
        errors.push(`Payment ${idx}: a memo is attached to a non-shielded address — ZIP-321 makes the whole request invalid.`);
      } else {
        try {
          memo = base64UrlToMemo(p.memo);
        } catch (e) {
          errors.push(`Payment ${idx}: ${e.message}`);
        }
      }
    }
    if (p.amount !== undefined) {
      const v = validateAmount(p.amount);
      if (!v.ok) errors.push(`Payment ${idx}: ${v.error}`);
    }
    payments.push({
      index: idx,
      address: p.address,
      amount: p.amount ?? null,
      memo,
      label: p.label ?? null,
      message: p.message ?? null,
      addressInfo: info,
    });
  }
  return { payments, errors };
}
