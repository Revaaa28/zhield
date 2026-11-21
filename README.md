<p align="center">
  <img src="logo.svg" alt="Zhield logo" width="96">
</p>

# Zhield — Shielded or Exposed?

**A Zcash payment privacy check that runs before you share, and after you receive.**

Zcash gives every user a choice: a payment can be shielded (sender, recipient and amount hidden by zero-knowledge proofs) or transparent (all three public forever, like Bitcoin). In practice the choice is made by wallets and address formats, and most users never find out which one they got. Zhield makes the choice visible.

Zhield is a read-only, fully client-side web app. It never asks for keys, never signs anything, and cannot move funds.

## What it does

### 1. Build a payment request (ZIP-321) — with a pre-share privacy check
Paste a recipient address and Zhield classifies it *as you type*:

- **Address families**: Unified (ZIP-316), Sapling, Sprout (legacy), transparent P2PKH/P2SH, and TEX (ZIP-320). Testnet variants included.
- **Real checksum verification**: Bech32 (BIP-173) and Bech32m (BIP-350) checksums for Sapling, Unified and TEX addresses are verified in the browser — a mistyped shielded address is caught before anyone pays it. Transparent addresses are classified structurally and labelled honestly as checksum-not-verified.
- **A privacy verdict with a score (0–100)** and a plain-language list of exactly what stays public for that address.
- **Spec enforcement, not just formatting**: a memo on a non-shielded address is a hard error (ZIP-321 makes the whole request invalid), Sprout recipients are rejected, amounts are validated against the ZIP-321 grammar (plain decimal, ≤ 8 decimal places, ≤ 21,000,000 ZEC, no `50.` / `.5` / grouping separators), memos are capped at 512 UTF-8 bytes.
- Output: a standards-compliant `zcash:` URI, a QR code, and copy / open-in-wallet actions.

### 2. Check a request you received
Paste any `zcash:` link before paying it. Zhield parses it the way a wallet should — including multi-payment indexed parameters — rejects unknown `req-` parameters outright (per spec), and shows, per payment, where the money goes and how public it will be.

### 3. Scan a transaction
Given a transaction ID, Zhield looks it up on the public Blockchair API *from your browser* and classifies its privacy footprint. Or paste a transaction's raw JSON (node `getrawtransaction` verbose format) for an exact classification that works fully offline. Either way the answer is presented the way a stranger would see it:

| Flow | Public | Hidden |
|---|---|---|
| t → t | sender, recipient, amount | nothing |
| t → z (shielding) | sender, amount entering the pool | recipient, everything after |
| z → t (deshielding) | recipient, amount leaving the pool | sender, everything before |
| z → z (fully shielded) | fee, block, timestamp only | sender, recipient, amount, memo |

### 4. Learn
The four ways ZEC can move, plus three facts most guides get wrong in 2026: Ironwood is the current shielded pool (NU6.3, activated 28 July 2026, succeeding Orchard); a Unified Address is a bundle of receivers and can contain a transparent one; and a memo is an encrypted shielded-only message, not a note field.

## How it works

- **Zero dependencies, zero build step.** Plain ES modules (`src/`) shared by the page and the test suite.
- `src/bech32.js` — dependency-free Bech32/Bech32m codec (BIP-173 / BIP-350).
- `src/address.js` — address classification, checksum verification, privacy scoring.
- `src/zip321.js` — ZIP-321 build + parse (single and multi-payment), amount grammar, memo base64url codec.
- `src/tx.js` — structural transaction classifier over the node verbose-JSON shape (transparent inputs/outputs, Sapling spends/outputs and `valueBalance`, Orchard/Ironwood actions and `valueBalanceOrchard`, Sprout JoinSplits, coinbase).
- `server.mjs` — a 30-line static server so the app can be deployed anywhere (Render, a VPS, `python3 -m http.server` also works).

Classification is deterministic and fail-closed: input that cannot be understood is reported as such, never guessed. Where a data source is incomplete (an explorer's transparent index), the UI says exactly what the classification is based on.

## Run it

```bash
npm start          # serves on $PORT or 8080
# or open index.html via any static file server
```

## Tests

```bash
npm test           # node --test, 20 tests, no dependencies
```

The suite covers, among others: reproduction of the worked example from the ZIP-321 specification (the built URI must match the spec's example byte-for-byte, including the base64url memo), checksum tamper detection, every invalid-amount shape, memo-on-transparent rejection, unknown `req-` rejection, multi-payment parsing, and structural fixtures for all four transaction flows plus coinbase.

## Verified live

During development the scanner was checked against real mainnet transactions through the app's own UI, e.g. the coinbase transaction of block 3,585,480 (`3be9e42e…b3bc8b06`, classified "Mining reward") and a 15-input transparent transaction in block 3,585,479 (`ce67174e…ee5a491`, classified "Transparent → Transparent").

## Privacy & safety posture

- No custody, no keys, no signing, no analytics, no server-side processing of anything you paste.
- The only network call the app can make is the Blockchair lookup *you* start, from *your* browser.
- Address validation is a pre-flight check, not a replacement for your wallet's own validation.

## License

MIT © 2026 Revly Rotty. Built for the ZcashIND "Build on Zcash" bounty.
