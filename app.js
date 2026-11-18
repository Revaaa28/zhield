import { classifyAddress } from './src/address.js';
import { buildPaymentURI, parsePaymentURI } from './src/zip321.js';
import { classifyTransaction } from './src/tx.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ring(score, color) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return `<svg class="ring" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#232a3a" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${filled} ${c}" transform="rotate(-90 32 32)"/>
    <text x="32" y="39" text-anchor="middle">${score}</text>
  </svg>`;
}

function verdictClass(score, valid) {
  if (!valid) return { cls: 'bad', color: '#ff6b5e' };
  if (score >= 80) return { cls: 'good', color: '#3ddc97' };
  if (score >= 40) return { cls: 'warn', color: '#ffb454' };
  return { cls: 'bad', color: '#ff6b5e' };
}

function verdictHtml(info, extraNotes = []) {
  const { cls, color } = verdictClass(info.privacyScore, info.valid);
  const leaks = info.leaks?.length
    ? `<div class="v-note"><strong>What stays public:</strong></div><ul>${info.leaks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '';
  const notes = [...(info.notes ?? []), ...extraNotes]
    .map((n) => `<div class="v-note">${esc(n)}</div>`)
    .join('');
  const check =
    info.checksum === 'valid'
      ? '<div class="v-note">✓ Address checksum verified in your browser.</div>'
      : info.checksum === 'invalid' || info.checksum === 'invalid-hrp'
        ? '<div class="v-note">✗ Address checksum does NOT verify — this address is mistyped or corrupted. Do not pay it.</div>'
        : '';
  return `<div class="v-head">${ring(info.valid ? info.privacyScore : 0, color)}
    <div><div class="v-title">${esc(info.headline)}</div>
    <div class="hint">${esc(info.kind)} · ${esc(info.network)}${info.canMemo ? ' · encrypted memo supported' : ''}</div></div></div>
    ${check}${leaks}${notes}`;
}

/* ================= BUILD ================= */
const bAddress = $('b-address'), bAmount = $('b-amount'), bMemo = $('b-memo'),
  bLabel = $('b-label'), bMessage = $('b-message');

function refreshBuild() {
  const addr = bAddress.value.trim();
  $('memo-count').textContent = `${new TextEncoder().encode(bMemo.value).length} / 512 bytes`;
  const verdictBox = $('build-verdict');
  const errBox = $('build-errors');
  const resultBox = $('build-result');
  if (!addr) {
    verdictBox.className = 'verdict neutral';
    verdictBox.textContent = 'Paste an address to see its privacy verdict.';
    errBox.hidden = true; resultBox.hidden = true;
    return;
  }
  const info = classifyAddress(addr);
  verdictBox.className = `verdict ${verdictClass(info.privacyScore, info.valid).cls}`;
  verdictBox.innerHTML = verdictHtml(info);

  const { uri, errors, warnings } = buildPaymentURI({
    address: addr,
    amount: bAmount.value,
    memo: bMemo.value,
    label: bLabel.value,
    message: bMessage.value,
  });
  const allMessages = [...errors, ...warnings];
  if (allMessages.length) {
    errBox.hidden = false;
    errBox.innerHTML = `<ul>${allMessages.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  } else errBox.hidden = true;

  if (uri) {
    resultBox.hidden = false;
    $('build-uri').textContent = uri;
    $('open-wallet').href = uri;
    const qrBox = $('qr');
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(uri);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    } catch {
      qrBox.innerHTML = '<span class="hint">QR library unavailable offline — the link above carries the same request.</span>';
    }
  } else resultBox.hidden = true;
}
for (const el of [bAddress, bAmount, bMemo, bLabel, bMessage]) el.addEventListener('input', refreshBuild);
$('copy-uri').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('build-uri').textContent);
    $('copy-uri').textContent = 'Copied ✓';
    setTimeout(() => ($('copy-uri').textContent = 'Copy link'), 1500);
  } catch { /* clipboard unavailable */ }
});

/* ================= CHECK ================= */
$('c-run').addEventListener('click', () => {
  const uri = $('c-uri').value.trim();
  const errBox = $('check-errors');
  const out = $('check-result');
  const { payments, errors } = parsePaymentURI(uri);
  if (errors.length) {
    errBox.hidden = false;
    errBox.innerHTML = `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  } else errBox.hidden = true;
  out.innerHTML = payments
    .map((p, i) => {
      const info = p.addressInfo;
      const { cls } = verdictClass(info.privacyScore, info.valid);
      return `<div class="verdict ${cls}" style="margin-top:14px">
        <div class="v-head">${ring(info.privacyScore, verdictClass(info.privacyScore, info.valid).color)}
        <div><div class="v-title">Payment ${i + 1}: ${esc(info.headline)}</div>
        <div class="hint">${esc(info.kind)} · ${esc(info.network)}</div></div></div>
        <dl class="kv">
          <dt>Recipient</dt><dd><code>${esc(p.address)}</code></dd>
          <dt>Amount</dt><dd>${p.amount !== null ? esc(p.amount) + ' ZEC' : 'Not fixed by the request — the wallet will ask'}</dd>
          ${p.memo !== null ? `<dt>Memo</dt><dd>${esc(p.memo)}</dd>` : ''}
          ${p.label ? `<dt>Label</dt><dd>${esc(p.label)}</dd>` : ''}
          ${p.message ? `<dt>Message</dt><dd>${esc(p.message)}</dd>` : ''}
        </dl>
        ${info.leaks?.length ? `<div class="v-note"><strong>What stays public:</strong> ${info.leaks.map(esc).join('; ')}</div>` : ''}
      </div>`;
    })
    .join('');
});

/* ================= SCAN ================= */
function scanHtml(r, sourceNote) {
  const { cls, color } = verdictClass(r.privacyScore, true);
  const c = r.components;
  return `<div class="verdict ${cls}" style="margin-top:14px">
    <div class="v-head">${ring(r.privacyScore, color)}
    <div><div class="v-title">${esc(r.title)}</div>
    <div class="hint">${r.pools.length ? 'Pools: ' + esc(r.pools.join(', ')) + ' · ' : ''}${esc(sourceNote)}</div></div></div>
    <dl class="kv">
      ${r.txid ? `<dt>Transaction</dt><dd><code>${esc(r.txid)}</code></dd>` : ''}
      <dt>Components</dt><dd>${c.transparentInputs} transparent input(s), ${c.transparentOutputs} transparent output(s)${c.saplingSpends + c.saplingOutputs ? `, ${c.saplingSpends} Sapling spend(s), ${c.saplingOutputs} Sapling output(s)` : ''}${c.orchardActions ? `, ${c.orchardActions} Orchard/Ironwood action(s)` : ''}${c.joinsplits ? `, ${c.joinsplits} Sprout JoinSplit(s)` : ''}</dd>
      ${r.transparentRecipients.length ? `<dt>Public recipients</dt><dd>${r.transparentRecipients.map((a) => `<code>${esc(a)}</code>`).join(' ')}</dd>` : ''}
    </dl>
    <div class="two-col">
      <div class="see-box sees"><h4>👁 What a stranger can see</h4><ul>${r.visible.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>
      <div class="see-box hides"><h4>🛡 What stays hidden</h4><ul>${r.hidden.length ? r.hidden.map((v) => `<li>${esc(v)}</li>`).join('') : '<li>Nothing — this payment is fully public.</li>'}</ul></div>
    </div>
  </div>`;
}

$('s-run-json').addEventListener('click', () => {
  const status = $('scan-status');
  let tx;
  try {
    tx = JSON.parse($('s-json').value);
  } catch (e) {
    status.textContent = `That is not valid JSON (${e.message}). Paste the full transaction object.`;
    return;
  }
  const r = classifyTransaction(tx);
  if (!r.ok) {
    status.textContent = r.error;
    $('scan-result').innerHTML = '';
    return;
  }
  status.textContent = 'Classified locally from the raw transaction — nothing left your browser.';
  $('scan-result').innerHTML = scanHtml(r, 'exact classification from raw JSON');
});

$('s-example').addEventListener('click', () => {
  $('s-json').value = JSON.stringify(
    {
      txid: 'example-structure-fully-shielded',
      vin: [],
      vout: [],
      orchard: { actions: [{ cv: '…', nullifier: '…' }, { cv: '…', nullifier: '…' }] },
      valueBalanceOrchard: 0,
    },
    null,
    2,
  );
  $('scan-status').textContent = 'Example structure loaded (a fully shielded transaction in the node JSON format). Press "Classify this JSON".';
});

$('s-fetch').addEventListener('click', async () => {
  const txid = $('s-txid').value.trim().toLowerCase();
  const status = $('scan-status');
  const out = $('scan-result');
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    status.textContent = 'A Zcash transaction ID is 64 hexadecimal characters.';
    return;
  }
  status.textContent = 'Looking up on Blockchair…';
  out.innerHTML = '';
  try {
    const res = await fetch(`https://api.blockchair.com/zcash/dashboards/transaction/${txid}`);
    const body = await res.json();
    const entry = body?.data?.[txid];
    if (!entry) throw new Error(body?.context?.error || 'Transaction not found on Blockchair.');
    const t = entry.transaction ?? {};
    const inputs = entry.inputs ?? [];
    const outputs = entry.outputs ?? [];
    // Prefer exact shielded fields when the response carries them.
    const normalized = {
      txid,
      vin: t.is_coinbase ? [{ coinbase: '00' }] : inputs.map(() => ({})),
      vout: outputs.map((o) => ({
        value: (o.value ?? 0) / 1e8,
        scriptPubKey: { addresses: o.recipient ? [o.recipient] : [] },
      })),
      vShieldedSpend: t.vShieldedSpend ?? entry.vShieldedSpend ?? [],
      vShieldedOutput: t.vShieldedOutput ?? entry.vShieldedOutput ?? [],
      valueBalance: t.valueBalance ?? entry.valueBalance,
      orchard: t.orchard ?? entry.orchard,
      valueBalanceOrchard: t.valueBalanceOrchard ?? entry.valueBalanceOrchard,
    };
    const hasShieldedFields =
      normalized.vShieldedSpend.length + normalized.vShieldedOutput.length + (normalized.orchard?.actions?.length ?? 0) > 0;
    let r = classifyTransaction(normalized);
    if (!r.ok && inputs.length === 0 && outputs.length === 0) {
      // The transaction exists but leaves no transparent footprint at all.
      r = classifyTransaction({ txid, vin: [], vout: [], orchard: { actions: [{}] }, valueBalanceOrchard: 0 });
      status.textContent = 'Found on Blockchair with zero transparent inputs and outputs — the footprint of a fully shielded transaction.';
      out.innerHTML = scanHtml(r, 'inferred from the transparent footprint via Blockchair — paste the raw JSON for an exact classification');
      return;
    }
    if (!r.ok) throw new Error(r.error);
    status.textContent = hasShieldedFields
      ? 'Classified from the explorer response, including its shielded fields.'
      : 'Classified from the transparent footprint Blockchair indexes. If this transaction also had shielded components that Blockchair does not return, paste its raw JSON for the exact answer.';
    out.innerHTML = scanHtml(r, 'via Blockchair, from your browser');
  } catch (e) {
    status.textContent = `Lookup failed: ${e.message} You can still paste the transaction's raw JSON below for an exact offline classification.`;
  }
});
