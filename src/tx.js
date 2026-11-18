// Zcash transaction privacy classification for Zhield.
//
// Input: a transaction object in the shape returned by a node's verbose
// `getrawtransaction` (zcashd / Zebra-style JSON), which is the shape public
// explorers derive their pages from:
//   {
//     txid, vin: [{coinbase} | {txid, vout, ...}],
//     vout: [{value, n, scriptPubKey: {addresses: [...]}}],
//     vShieldedSpend: [...], vShieldedOutput: [...],
//     valueBalance: <sapling net, ZEC>,            // >0 value entered the pool
//     orchard: { actions: [...] },
//     valueBalanceOrchard: <orchard net, ZEC>
//   }
// Sprout JoinSplits (vjoinsplit) are reported when present.
//
// The classification is purely structural — it reads only what is public on
// chain, which is exactly the point of the tool: this is what any stranger
// with an explorer can work out about a payment.

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function classifyTransaction(tx) {
  if (!tx || typeof tx !== 'object') {
    return { ok: false, error: 'No transaction object provided.' };
  }
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const isCoinbase = vin.some((i) => i && typeof i === 'object' && 'coinbase' in i);
  const transparentInputs = isCoinbase ? 0 : vin.length;
  const transparentOutputs = vout.filter((o) => num(o?.value) > 0);
  const transparentOutTotal = transparentOutputs.reduce((s, o) => s + num(o.value), 0);

  const saplingSpends = Array.isArray(tx.vShieldedSpend) ? tx.vShieldedSpend.length : 0;
  const saplingOutputs = Array.isArray(tx.vShieldedOutput) ? tx.vShieldedOutput.length : 0;
  const orchardActions = Array.isArray(tx.orchard?.actions) ? tx.orchard.actions.length : 0;
  const joinsplits = Array.isArray(tx.vjoinsplit) ? tx.vjoinsplit.length : 0;

  const saplingBalance = num(tx.valueBalance);
  const orchardBalance = num(tx.valueBalanceOrchard);
  const shieldedNet = saplingBalance + orchardBalance; // >0: value flowed INTO shielded pools
  const hasShielded = saplingSpends + saplingOutputs + orchardActions + joinsplits > 0;

  const pools = [];
  if (saplingSpends + saplingOutputs > 0) pools.push('Sapling');
  if (orchardActions > 0) pools.push('Orchard / Ironwood');
  if (joinsplits > 0) pools.push('Sprout (legacy JoinSplit)');

  let flow;
  let score;
  let title;
  if (isCoinbase) {
    flow = 'coinbase';
    title = 'Mining reward (coinbase)';
    score = 0;
  } else if (!hasShielded && transparentInputs > 0) {
    flow = 't-to-t';
    title = 'Transparent → Transparent';
    score = 0;
  } else if (hasShielded && transparentInputs > 0 && transparentOutputs.length === 0 && shieldedNet > 0) {
    flow = 't-to-z';
    title = 'Transparent → Shielded (shielding)';
    score = 55;
  } else if (hasShielded && transparentInputs === 0 && transparentOutputs.length > 0 && shieldedNet < 0) {
    flow = 'z-to-t';
    title = 'Shielded → Transparent (deshielding)';
    score = 45;
  } else if (hasShielded && transparentInputs === 0 && transparentOutputs.length === 0) {
    flow = 'z-to-z';
    title = 'Shielded → Shielded (fully shielded)';
    score = 100;
  } else if (hasShielded) {
    flow = 'mixed';
    title = 'Mixed transparent + shielded';
    score = shieldedNet > 0 ? 50 : 40;
  } else {
    return { ok: false, error: 'This JSON does not look like a Zcash transaction (no transparent inputs/outputs and no shielded components found).' };
  }

  // What a public observer can see, per flow. Fee/timing/block are always public.
  const alwaysVisible = ['That the transaction exists', 'Its fee', 'Block height and timestamp'];
  const visibility = {
    't-to-t': {
      visible: [...alwaysVisible, 'Sender address(es)', 'Recipient address(es)', 'Exact amount'],
      hidden: [],
    },
    't-to-z': {
      visible: [...alwaysVisible, 'Sender address(es)', 'Amount moved into the shielded pool'],
      hidden: ['Recipient (shielded)', 'What happens to the funds after they enter the pool'],
    },
    'z-to-t': {
      visible: [...alwaysVisible, 'Recipient address(es)', 'Amount moved out of the shielded pool'],
      hidden: ['Sender (shielded)', 'Where the funds were before they left the pool'],
    },
    'z-to-z': {
      visible: [...alwaysVisible],
      hidden: ['Sender', 'Recipient', 'Amount', 'Memo (encrypted, recipient only)'],
    },
    mixed: {
      visible: [...alwaysVisible, 'Transparent side addresses', 'Amounts crossing between the transparent side and the shielded pools'],
      hidden: ['Shielded-side sender/recipient details'],
    },
    coinbase: {
      visible: [...alwaysVisible, 'Mining reward recipient and amount'],
      hidden: [],
    },
  }[flow];

  const transparentSenders = [
    ...new Set(
      vin.flatMap((i) => (i && typeof i === 'object' && i.address ? [i.address] : [])),
    ),
  ];
  const transparentRecipients = [
    ...new Set(transparentOutputs.flatMap((o) => o?.scriptPubKey?.addresses ?? (o?.scriptPubKey?.address ? [o.scriptPubKey.address] : []))),
  ];

  return {
    ok: true,
    txid: tx.txid ?? null,
    flow,
    title,
    privacyScore: score,
    pools,
    components: {
      transparentInputs,
      transparentOutputs: transparentOutputs.length,
      transparentOutTotalZec: transparentOutTotal,
      saplingSpends,
      saplingOutputs,
      orchardActions,
      joinsplits,
      shieldedNetZec: shieldedNet,
      isCoinbase,
    },
    transparentSenders,
    transparentRecipients,
    visible: visibility.visible,
    hidden: visibility.hidden,
  };
}
