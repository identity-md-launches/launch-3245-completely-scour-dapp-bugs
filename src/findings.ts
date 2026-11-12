export type Severity = 'high' | 'medium' | 'low';

export interface Location {
  path: string;
  /** Omitted where only a searchable snippet was pinned (see note). */
  line?: number;
  note?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  area: string;
  title: string;
  locations: Location[];
  now: string;
  impact: string;
  fix: string;
  code?: string;
}

export const REPO = 'https://github.com/z0r0z/tacit';
export const COMMIT = '2a3ec21c62f4af6bd88e72c525c242a08700c246';
export const COMMIT_SHORT = COMMIT.slice(0, 7);

export const sourceUrl = (l: Location) => `${REPO}/blob/${COMMIT}/${l.path}${l.line ? `#L${l.line}` : ''}`;
export const locLabel = (path: string, line?: number) => (line ? `${path}:${line}` : path);

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

export const findings: Finding[] = [
  {
    id: 'h1',
    severity: 'high',
    area: 'Ethereum transactions',
    title: 'The tETH withdraw sends without checking which chain the wallet is on',
    locations: [
      { path: 'dapp/tacit.js', line: 10526, note: 'bridgeWithdrawETH' },
      { path: 'dapp/tacit.js', line: 10559, note: 'reads the relay with eth_call through the wallet' },
      { path: 'dapp/tacit.js', line: 10605, note: 'eth_sendTransaction, no eth_chainId' },
      { path: 'dapp/tacit.js', line: 39802, note: '_bridgeConnectEth caches the provider' },
      { path: 'dapp/tacit.js', line: 40201, note: 'caller' },
      { path: 'dapp/tacit.js', line: 8660, note: 'bridgeBatchDepositETH sends value the same way (exported)' },
    ],
    now: "bridgeWithdrawETH reads HEADER_RELAY() and tipHeight() through the wallet's provider, builds the proof calldata and calls eth_sendTransaction to the bridge address. Nothing reads eth_chainId first. _bridgeConnectEth keeps the provider in `_bridgeEthProvider`, so a wallet moved to Base or Sepolia after connecting is used as-is. Other send paths in the same file (tacit.js:3829) do check.",
    impact: "On the wrong network the relay read returns another chain's state, or nothing, and the withdraw goes to an address that is not the bridge there. The visitor pays gas for a transaction that cannot work, and the UI reports a withdraw failure it cannot explain. The exported bridgeBatchDepositETH sends ETH value with the same gap, so any caller of it can send funds on the wrong chain.",
    fix: 'Before every read and send in these two functions, require the bridge chain: switch, read eth_chainId again, and refuse when it still differs. Better, route every send through one helper (see the trade/wallet.js:100 pattern under the changes below).',
    code: "async function requireChain(provider, chainId) {\n  const want = '0x' + Number(chainId).toString(16);\n  const now = () => provider.request({ method: 'eth_chainId' });\n  if ((await now()).toLowerCase() === want) return;\n  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });\n  if ((await now()).toLowerCase() !== want) throw new Error('Switch your wallet to Ethereum mainnet, then try again.');\n}",
  },
  {
    id: 'm1',
    severity: 'medium',
    area: 'Bridge status',
    title: 'A reverted Ethereum transaction leaves the bridge waiting forever',
    locations: [
      { path: 'dapp/tacit.js', line: 39817, note: "if (!result || result.status !== '0x1') return;" },
      { path: 'dapp/tacit.js', line: 39822, note: 'setInterval every 8 s' },
    ],
    now: "_autoMintAfterEthConfirm polls the receipt every 8 seconds and returns early unless status is '0x1'. A mined receipt with status '0x0' (reverted) is treated the same as no receipt yet.",
    impact: "The interval never clears. The badge stays on 'Waiting for Ethereum confirmation' with no error and no retry, and the tab keeps polling RPCs until it is closed.",
    fix: "Separate 'not mined' from 'reverted'. On status '0x0', clear the interval and set the error stage with a message that names the transaction and the next step.",
    code: "if (!result) return; // not mined yet\nclearInterval(_ethPoller);\nif (result.status !== '0x1') {\n  _bridgePipelineUpdate('error', `Ethereum transaction ${rec.ethTxHash.slice(0, 10)}… reverted. Nothing was minted; start the bridge again.`);\n  return;\n}\n_doAutoMint(rec);",
  },
  {
    id: 'm2',
    severity: 'medium',
    area: 'Ethereum transactions',
    title: 'A network switch is trusted without reading the chain again',
    locations: [
      { path: 'dapp/tacit.js', line: 3800, note: 'publish record' },
      { path: 'dapp/tacit.js', line: 37470, note: 'ethSend (bond back)' },
      { path: 'dapp/tacit.js', line: 37478, note: 'ethPay (top up, sends value)' },
      { path: 'dapp/sats/eth.js', line: 289, note: 'browserSigner' },
    ],
    now: 'These paths call wallet_switchEthereumChain and send right after it returns. They do not read eth_chainId again. sats/eth.js also returns a `send` closure that is used later with no check at all. tacit.js:3829 and trade/wallet.js:100 already re-read the chain and refuse.',
    impact: "Some wallets resolve the switch request without switching (WalletConnect sessions without that chain, mobile in-app browsers), and the user can move networks between steps. ethPay then sends ETH to the same address on whichever chain the wallet is on.",
    fix: 'Use the requireChain helper above in all four places, and call it inside `send` itself so a closure created earlier still checks at send time.',
  },
  {
    id: 'm3',
    severity: 'medium',
    area: 'Key management',
    title: 'A new CDP position can reuse a key when the chain walk fails',
    locations: [
      { path: 'dapp/confidential-defi-tab.js', line: 58, note: 'nextKeyNonce' },
      { path: 'dapp/confidential-defi-tab.js', line: 70, note: 'Math.max(local, onchain ?? 0)' },
      { path: 'dapp/confidential-defi-tab.js', line: 71, note: 'counter saved before the open succeeds' },
    ],
    now: "If recoverCdpPositions throws or reports skipped leaves, `onchain` stays null. The code only refuses when this browser has no saved positions too (`local === 0`). Otherwise it continues with this browser's own count.",
    impact: 'A user who opened positions on another device, or in another browser profile, gets a key index that is already in use on chain, which is the reuse the error message warns about. The counter is also advanced in localStorage before the position opens, so a failed open leaves a gap.',
    fix: "Refuse whenever the chain walk did not finish, whatever the local count. Write the counter only after the open transaction is confirmed.",
    code: "if (onchain == null) throw new Error('Could not read your positions from the chain, so the next key index is unknown. Nothing was opened. Try again when the RPC answers.');",
  },
  {
    id: 'm4',
    severity: 'medium',
    area: 'Ethereum reads',
    title: 'A cached chain check sends reads to the wrong network for 30 seconds',
    locations: [
      { path: 'dapp/tacit.js', line: 8446, note: '_ethProviderOnBridgeChain caches for 30 s' },
      { path: 'dapp/tacit.js', line: 8462, note: '_ethRpcCall prefers the wallet provider' },
    ],
    now: "_ethProviderOnBridgeChain caches its answer for 30 seconds and nothing in tacit.js listens for chainChanged. _ethRpcCall uses the wallet's provider whenever that cached answer is true.",
    impact: "After the user switches the wallet to another network, receipt polls and eth_calls go to that network for up to 30 seconds. A receipt read as missing only delays things; a contract read can return another chain's data.",
    fix: "Reset the cache on the provider's chainChanged event, or read through the public RPC list only, so the wallet's network never decides what the app reads.",
    code: "provider.on?.('chainChanged', () => { _ethProviderChainOkUntil = 0; });",
  },
  {
    id: 'm5',
    severity: 'medium',
    area: 'Admin pages',
    title: 'The admin deploy pages send to whichever chain the wallet is on',
    locations: [
      { path: 'dapp/admin/proof-market/index.html', note: "deploy(): if (W.chain !== k.chainId) reads a cached value" },
      { path: 'dapp/admin/gas-relay/index.html', note: 'deploy(): same cached W.chain check' },
      { path: 'dapp/admin/tacit-chain/index.html', note: 'deploy(i): no chain check; only the button gate `W.chain === KIT.chainId`' },
      { path: 'dapp/admin/token-pools/index.html', note: 'send(): await stateOf(kit) runs after the last eth_chainId read' },
    ],
    now: "proof-market and gas-relay compare W.chain, a value read at connect and updated by the chainChanged listener. tacit-chain checks it only when it draws the Deploy button. Each deploy then awaits an eth_call and an eth_estimateGas on public RPCs and calls eth_sendTransaction with no chainId field and no fresh eth_chainId. token-pools re-reads the chain after a switch, then awaits stateOf() before it sends.",
    impact: "CreateX has the same address on many chains. A wallet that changes network during those awaits, or one that does not emit chainChanged, sends a deploy that can succeed on the wrong chain. The deployer pays gas there, and the simulation that passed ran on the intended chain only.",
    fix: 'Call the requireChain helper from H1 as the last await before eth_sendTransaction, and pass the chainId the kit expects. Disable the button while it runs (see L8).',
    code: "await requireChain(W.prov, k.chainId); // last await before sending\nconst hash = await ask('eth_sendTransaction', [{ from: W.account, to: k.factory, data, gas }]);",
  },
  {
    id: 'l1',
    severity: 'low',
    area: 'Key management',
    title: 'An empty position list is reported as a failed chain walk',
    locations: [{ path: 'dapp/confidential-pool-ux.js', line: 3480, note: 'early return has no nextKeyNonce' }],
    now: 'When there are no CdpPositionInserted events, recoverCdpPositions returns `{ positions: [], positionEvents: 0 }` with no nextKeyNonce.',
    impact: "nextKeyNonce then sees no on-chain value and, in a fresh browser, throws 'the chain walk failed' although the walk worked. The first position on a new deployment, or after an indexer reset, cannot be opened.",
    fix: 'Return `nextKeyNonce: 0` (and `skipped: []`) from the empty case.',
  },
  {
    id: 'l2',
    severity: 'low',
    area: 'Amount input',
    title: 'The bridge recovery amount is parsed as a float',
    locations: [
      { path: 'dapp/confidential-pool-tab.js', line: 217, note: 'Number(amountStr)' },
      { path: 'dapp/confidential-pool-tab.js', line: 222, note: 'BigInt(Math.round(amountTac * 1e8))' },
    ],
    now: "The TAC amount box goes through Number() and then × 1e8. Number accepts '0x10', '1e3' and ' 5 ', and doubles stop being exact above about 90 million TAC at 8 decimals.",
    impact: 'Recovery needs the exact amount the bridge carried. A typo-like input is accepted as a different amount and the recovery fails with an unrelated error.',
    fix: "Parse the decimal string straight to base units with a strict pattern (/^\\d+(\\.\\d{1,8})?$/), as vault/mine.js already does with parseUnits.",
  },
  {
    id: 'l3',
    severity: 'low',
    area: 'Privacy',
    title: 'The deposit padding that hides the swap size uses Math.random',
    locations: [
      { path: 'dapp/swap/later.js', line: 223, note: 'depositFor(rand = Math.random)' },
      { path: 'dapp/swap/later.js', line: 231, note: 'swapFor' },
      { path: 'dapp/swap/card.js', line: 1375, note: 'LATER.rand = Math.random()' },
    ],
    now: 'The extra share added to a deposit, meant to keep the deposit from revealing the swap amount, is drawn with Math.random.',
    impact: "Math.random is not a cryptographic generator; its state can be recovered from a few outputs. The padding is weaker than intended, though it is still rounded to two significant figures.",
    fix: 'Draw it from crypto.getRandomValues.',
    code: 'const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;',
  },
  {
    id: 'l4',
    severity: 'low',
    area: 'Ethereum transactions',
    title: 'evm-wallet.js exports a send with no chain check',
    locations: [{ path: 'dapp/evm-wallet.js', line: 262, note: 'fundTx' }],
    now: 'fundTx sends eth_sendTransaction, value included, without reading the chain. Nothing in the dapp calls it today, but it is part of the returned wallet API.',
    impact: 'The next feature that picks it up inherits the wrong-network bug in H1.',
    fix: 'Add the same requireChain guard, or remove the export until it is used.',
  },
  {
    id: 'l5',
    severity: 'low',
    area: 'Privacy',
    title: 'Pending pool spends are stored in plain localStorage',
    locations: [{ path: 'dapp/sats/secret.js', line: 290, note: 'pendingMark' }],
    now: 'pendingMark writes nullifiers, txids, change and output amounts and the asset to localStorage in clear JSON.',
    impact: 'Anyone with the device, a browser extension that reads site storage, or any injected markup bug gets a linked record of private pool activity.',
    fix: 'Encrypt it with a key derived from the wallet, as confidential-otc-tab.js:22 already does with AES-GCM, or keep it in sessionStorage.',
  },
  {
    id: 'l6',
    severity: 'low',
    area: 'Documentation drift',
    title: "_headers says production ignores it, but production serves its headers",
    locations: [
      { path: 'dapp/_headers', line: 3, note: 'NOT LIVE ON THE CURRENT HOST' },
      { path: 'dapp/sw.js', line: 9, note: "'~1.8 MB' bundle; tacit.js is now 2.97 MB" },
    ],
    now: "The comment says Render ignores this file and the headers must be copied by hand. On 2026-11-12 a HEAD request to https://tacit.finance/ returned frame-ancestors 'self', X-Frame-Options: SAMEORIGIN and HSTS from Cloudflare.",
    impact: 'No exposure today. The stale comment invites the next editor to change the file and expect nothing to happen, or to change the dashboard and leave the file wrong.',
    fix: 'Rewrite the comment to name the host that serves these headers, and add a CI step that compares `curl -sI https://tacit.finance/` against the file.',
  },
  {
    id: 'l7',
    severity: 'low',
    area: 'Modules and caching',
    title: "Unused farm modules import a bare './tacit.js'",
    locations: [
      { path: 'dapp/tacit.js', line: 61869, note: 'initializer runs only when !globalThis.__TACIT_NO_INIT__' },
      { path: 'dapp/tacit.js', line: 61872, note: "import('./amm-farm-ui.js')" },
      { path: 'dapp/tacit-session.js', line: 11, note: '__TACIT_NO_INIT__ = true before import(url)' },
      { path: 'dapp/amm-farm-ui.js', line: 12, note: "import { wallet } from './tacit.js'" },
      { path: 'dapp/amm-farm-actions.js', line: 23, note: "} from './tacit.js'" },
      { path: 'dapp/confidential-btc-call-actions.js', line: 13, note: 'same bare import' },
      { path: 'dapp/sw.js', line: 72, note: "'/tacit.js' is cache-first" },
    ],
    now: "amm-farm-ui.js, amm-farm-actions.js and confidential-btc-call-actions.js import './tacit.js' with no ?cb= token. The only path to them is tacit.js's own initializer (61869 to 61872). The current index.html loads Tacit through makeTacitSession, which sets __TACIT_NO_INIT__ = true first, so that initializer does not run. The live farm tab uses farm-ops.js, which receives the module as a parameter.",
    impact: 'No visitor impact at this commit. If anything imports these modules again, the browser keys ES modules by full URL and evaluates a second, signed-out copy of the 2.97 MB bundle. sw.js would also serve that bare /tacit.js cache-first from whichever build the visitor cached first.',
    fix: 'Delete the unused modules, or make them take the Tacit module as a parameter like farm-ops.js does. In sw.js, serve the bare /tacit.js network-first.',
  },
  {
    id: 'l8',
    severity: 'low',
    area: 'Admin pages',
    title: 'Admin Deploy buttons stay enabled while a deploy is running',
    locations: [
      { path: 'dapp/admin/proof-market/index.html', note: "disabled: !ready || state === 'open'" },
      { path: 'dapp/admin/gas-relay/index.html', note: "disabled: !ready || state === 'open'" },
      { path: 'dapp/admin/tacit-chain/index.html', note: 'disabled: !ready; deploy(i) only resets S[i].log' },
    ],
    now: 'deploy() sets no busy flag. Status updates redraw the button, and it comes back enabled during the simulation, the gas estimate and the wallet prompt.',
    impact: 'A second click starts a second deploy and a second wallet prompt, and resets the status log. If the deployer signs both, the second transaction reverts on the occupied address and still costs gas.',
    fix: 'Set a busy flag when deploy() starts, include it in disabled, and clear it in a finally block.',
  },
  {
    id: 'l9',
    severity: 'low',
    area: 'Admin pages',
    title: "An RPC failure is shown as 'not deployed'",
    locations: [
      { path: 'dapp/admin/gas-relay/index.html', note: "refresh(): hasCode(KIT.expected).catch(() => false)" },
      { path: 'dapp/admin/proof-market/index.html', note: 'refresh(): same catch' },
    ],
    now: "refresh() turns any error from hasCode into false, and draw() then prints 'not deployed'.",
    impact: 'When every RPC in the kit fails, the page says the contract is missing and offers Deploy. That invites a deploy that is not needed and hides the real problem.',
    fix: "Keep a third state, 'unknown'. Show the RPC error and keep Deploy disabled until a read succeeds.",
  },
  {
    id: 'l10',
    severity: 'low',
    area: 'Admin pages',
    title: 'The deploy pages show an init-code hash they never check',
    locations: [
      { path: 'dapp/admin/tacit-chain/index.html', note: "row('Init code hash', step.initHash)" },
      { path: 'dapp/admin/gas-relay/index.html', note: "row('Init code hash', k.initHash)" },
      { path: 'dapp/admin/proof-market/index.html', note: "row('Init code hash', k.initHash)" },
    ],
    now: "The pages display initHash from kit.json but never hash initCode. tacit-chain and gas-relay deploy through CREATE3, whose address depends only on the deployer and the salt, so the address check passes for any init code. tacit-chain's intro says the transaction is sent only if it creates exactly the contract at exactly the address shown.",
    impact: 'A kit.json whose initCode drifted from the reviewed build would deploy that code at the expected address, and the page would report success.',
    fix: "Compute keccak256(initCode) in the page and refuse to deploy when it differs from initHash. After the deploy, compare the hash of eth_getCode with the expected runtime code hash.",
  },
  {
    id: 'l11',
    severity: 'low',
    area: 'Admin pages',
    title: 'token-pools loops over a count taken straight from RPC data',
    locations: [{ path: 'dapp/admin/token-pools/index.html', note: 'madeBy(): const base = at(0), n = at(base); for (let i = 0; i < n; i++)' }],
    now: 'madeBy reads the number of created addresses from the eth_call return data and loops that many times with no upper limit or length check.',
    impact: 'A faulty or hostile RPC in the fallback list can return a huge count and freeze the admin tab.',
    fix: 'Check that base + 32 × (n + 1) fits inside the return data, and cap n at the number of contracts the kit expects.',
  },
];

export const improvements: { title: string; body: string }[] = [
  {
    title: 'One send helper for every transaction',
    body: 'Sixteen files call eth_sendTransaction directly, each with its own chain check or none. trade/wallet.js:100 already has the right shape (switch, read again, refuse, and confirm the account did not change). Export it and route every send through it; H1, M2, M5 and L4 then close together.',
  },
  {
    title: 'Ban innerHTML with non-literal strings',
    body: 'There are about 950 innerHTML assignments. Most interpolate escaped values. Some, like the bridge status line at tacit.js:40343, are safe only because a branch before them keeps error text away. Guards like that are easy to lose: set status text with textContent, and add a lint rule (no-unsanitized/property) or a tagged `html` template that escapes its values, so a raw error string can never reach one of these sinks.',
  },
  {
    title: 'Split tacit.js and load modules through an import map',
    body: 'tacit.js is one 62,000-line, 2.97 MB module. Splitting it by tab, with an import map that pins every module to its ?cb= URL, shortens first load and makes duplicate instances like L7 impossible.',
  },
  {
    title: 'Parse every amount as a decimal string',
    body: "Use one parseUnits(text, decimals) that rejects anything but digits and one dot, and use it wherever a person types an amount. Float math is fine for display and wrong for anything that reaches a proof or a transaction.",
  },
  {
    title: 'Test the failure states',
    body: 'Add unit tests for a reverted receipt (M1), a switch that does not switch (M2), and a chain walk that throws with a non-zero local count (M3). Each is a few lines with a stub provider, and each failed here without anyone noticing.',
  },
];
