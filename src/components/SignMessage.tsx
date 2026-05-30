/**
 * Message signing — one action, Wallet-driven routing.
 *
 * A Safe App calls sdk.txs.signMessage / signTypedMessage; the WALLET decides
 * whether that becomes an off-chain EIP-1271 SafeMessage (tx-service) or an
 * on-chain SignMessageLib transaction. The decision is three ANDed gates
 * (safe-wallet-monorepo, useCustomAppCommunicator.tsx):
 *
 *   signOffChain = isOffchainEIP1271Supported(safe)   // (1) capability
 *               && !onChainSigning                     // (2) Settings → Safe Apps → signing method
 *               && offChainSigning                     // (3) per-app setting (default true)
 *
 * What a Safe App can and can't do about each gate:
 *   (1) READ  — we derive it from the Safe version + fallback handler.
 *   (2) NONE  — the global "Always use on-chain signatures" toggle lives in the
 *               Wallet's store and is never exposed over the bridge. We can't
 *               read or change it; it's the user's call.
 *   (3) FORCE — we pin it to true via `safe_setSettings` so gate (2) is the
 *               sole remaining decider, making the on-screen explanation exact.
 *
 * Because we can't read gate (2), we don't pretend to choose the path. We
 * explain the rule, point at the setting, and report which path the Wallet
 * actually took once the response comes back.
 */

import {
  type EIP712TypedData,
  isObjectEIP712TypedData,
  Methods,
  RPC_CALLS,
} from "@safe-global/safe-apps-sdk";
import { useMemo, useRef, useState } from "react";
import type { SafeAppContext } from "../hooks/useSafeAppsSdk";
import { isOffchainSigningSupported } from "../lib/offchain";
import {
  computeSafeMessageHash,
  generateSafeMessageMessage,
  getExampleTypedData,
} from "../lib/safeMessage";
import {
  encodeSignMessageCall,
  getSignMessageLibAddress,
} from "../lib/signMessageLib";
import { Copyable } from "./Copyable";

type Mode = "text" | "typed";
type Result =
  | { kind: "offchain"; messageHash: string }
  | { kind: "onchain"; safeTxHash: string };

/**
 * Pins the per-app `offChainSigning` setting to true (gate 3) so the Wallet's
 * signing-method toggle becomes the sole decider. SDK 9.1.0 has no public
 * wrapper, but the Wallet handles `safe_setSettings` as an `rpcCall` and
 * `sdk.communicator` is a public runtime property. Best-effort — older Wallets
 * may not implement it, so errors are swallowed.
 *
 * @param sdk - The Safe Apps SDK instance.
 * @returns Resolves once the setting message has been sent (or on failure).
 */
async function forceOffChainSigning(sdk: SafeAppContext["sdk"]): Promise<void> {
  try {
    const communicator = (
      sdk as unknown as {
        communicator: {
          send: (method: string, params: unknown) => Promise<unknown>;
        };
      }
    ).communicator;
    await communicator.send(Methods.rpcCall, {
      call: RPC_CALLS.safe_setSettings,
      params: [{ offChainSigning: true }],
    });
  } catch {
    /* ignore */
  }
}

/**
 * The app's single screen: a message input (plain text / EIP-712 typed data), a
 * live hash preview, and one "Sign message" action whose off-chain vs on-chain
 * outcome is decided by the Wallet (see the file header and CLAUDE.md).
 *
 * @param props.ctx - The Safe app context (SDK + connected Safe) from {@link useSafeAppsSdk}.
 * @returns The sign-message card.
 */
export function SignMessage({ ctx }: { ctx: SafeAppContext }) {
  const { sdk, safe } = ctx;
  const [mode, setMode] = useState<Mode>("text");
  const [message, setMessage] = useState("");
  const [typedJson, setTypedJson] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Each sign attempt gets a sequence number. If the user gives up waiting
  // (the Wallet's on-chain message flow doesn't send a rejection on cancel —
  // its modal is opened without an onClose handler — so the SDK promise can
  // hang forever), we bump the seq and ignore any late resolution.
  const signSeq = useRef(0);

  const typed = useMemo(() => {
    if (mode !== "typed" || !typedJson.trim()) {
      return {
        data: null as EIP712TypedData | null,
        parseError: null as string | null,
      };
    }
    try {
      const parsed = JSON.parse(typedJson);
      if (!isObjectEIP712TypedData(parsed)) {
        return {
          data: null,
          parseError:
            "Not a valid EIP-712 object (needs domain, types, message).",
        };
      }
      return { data: parsed, parseError: null };
    } catch (e) {
      return {
        data: null,
        parseError: e instanceof Error ? e.message : "Invalid JSON.",
      };
    }
  }, [mode, typedJson]);

  const payload: string | EIP712TypedData | null =
    mode === "text" ? message || null : typed.data;

  const signMessageLibAddress = useMemo(
    () => (safe ? getSignMessageLibAddress(safe.chainId, safe.version) : null),
    [safe],
  );

  // Gate (1): is off-chain even possible for this Safe? If not, signing is
  // always on-chain regardless of the Settings toggle.
  const offChainSupported = useMemo(
    () =>
      safe
        ? isOffchainSigningSupported(safe.version, safe.fallbackHandler)
        : false,
    [safe],
  );

  const preview = useMemo(() => {
    if (!safe || !payload) return null;
    try {
      const safeAddr = safe.safeAddress as `0x${string}`;
      const innerHash = generateSafeMessageMessage(payload);
      return {
        innerHash,
        safeMessageHash: computeSafeMessageHash(
          safe.chainId,
          safeAddr,
          payload,
        ),
        calldata: encodeSignMessageCall(innerHash),
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [payload, safe]);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const loadExample = () => {
    if (!safe) return;
    setTypedJson(
      JSON.stringify(
        getExampleTypedData(
          safe.chainId,
          safe.safeAddress as `0x${string}`,
          message || "Hello Safe",
        ),
        null,
        2,
      ),
    );
    reset();
  };

  const onSign = async () => {
    reset();
    if (!safe || !payload) return;
    const seq = ++signSeq.current;
    setSubmitting(true);
    try {
      // Pin gate (3) so the Settings toggle (gate 2) is the only decider.
      await forceOffChainSigning(sdk);

      const response =
        mode === "text"
          ? await sdk.txs.signMessage(message)
          : await sdk.txs.signTypedMessage(typed.data as EIP712TypedData);

      // Ignore a resolution for an attempt the user already gave up on.
      if (signSeq.current !== seq) return;

      if ("messageHash" in response) {
        setResult({ kind: "offchain", messageHash: response.messageHash });
      } else {
        setResult({ kind: "onchain", safeTxHash: response.safeTxHash });
      }
    } catch (e) {
      if (signSeq.current !== seq) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (signSeq.current === seq) setSubmitting(false);
    }
  };

  // Recover the UI when the Wallet never sends a response (e.g. cancelling the
  // on-chain message modal). Bumping the seq orphans the in-flight promise.
  const stopWaiting = () => {
    signSeq.current++;
    setSubmitting(false);
  };

  const canSubmit = !!safe && !submitting && !!payload;

  return (
    <div className="card">
      <h2>Sign a message</h2>
      <p className="subtitle">
        One message, one SafeMessage hash. Your Safe Wallet decides whether to
        sign it <strong>off-chain</strong> (an EIP-1271 SafeMessage via the
        tx-service) or <strong>on-chain</strong> (a <code>SignMessageLib</code>{" "}
        transaction). Either way, <code>isValidSignature(messageHash, …)</code>{" "}
        ends up returning the EIP-1271 magic value.
      </p>

      <div className="callout">
        <strong>
          Off-chain or on-chain is controlled by your Wallet settings
        </strong>
        , not this app:{" "}
        <em>
          Settings → Safe Apps → Signing method → “Always use on-chain
          signatures.”
        </em>{" "}
        When it's off (default), messages are signed <strong>off-chain</strong>{" "}
        (an EIP-1271 SafeMessage stored in the tx-service); when on, they're
        signed <strong>on-chain</strong> via SignMessageLib (a transaction). A
        Safe App can't read or override that toggle — change it there if you
        want a specific path.
        {safe && !offChainSupported && (
          <>
            {" "}
            <br />
            <br />
            <strong>Note for this Safe:</strong> off-chain signing isn't
            supported (version <code>{safe.version ?? "unknown"}</code>,
            fallback handler <code>{safe.fallbackHandler ?? "none"}</code>), so
            messages will be signed{" "}
            <strong>
              on-chain via SignMessageLib regardless of the setting
            </strong>
            .
          </>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`tab ${mode === "text" ? "active" : ""}`}
          onClick={() => {
            setMode("text");
            reset();
          }}
        >
          Plain text (EIP-191)
        </button>
        <button
          type="button"
          className={`tab ${mode === "typed" ? "active" : ""}`}
          onClick={() => {
            setMode("typed");
            reset();
          }}
        >
          Typed data (EIP-712)
        </button>
      </div>

      {mode === "text" ? (
        <div className="field">
          <label htmlFor="msg">Message</label>
          <textarea
            id="msg"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              reset();
            }}
            placeholder=""
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="typed">
            EIP-712 typed data (JSON: domain, types, primaryType, message)
          </label>
          <textarea
            id="typed"
            value={typedJson}
            spellCheck={false}
            style={{ minHeight: 220 }}
            onChange={(e) => {
              setTypedJson(e.target.value);
              reset();
            }}
            placeholder='{ "domain": { ... }, "types": { ... }, "primaryType": "...", "message": { ... } }'
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={loadExample}
              disabled={!safe}
            >
              Load example
            </button>
          </div>
          {typed.parseError && (
            <div className="callout error" style={{ marginTop: 8 }}>
              {typed.parseError}
            </div>
          )}
        </div>
      )}

      {preview && (
        <dl className="kv" style={{ margin: "8px 0 16px" }}>
          <dt>Message hash</dt>
          <dd>
            <Copyable value={preview.innerHash} title="Copy message hash" />
          </dd>
          <dt>SafeMessage hash</dt>
          <dd>
            <Copyable
              value={preview.safeMessageHash}
              title="Copy SafeMessage hash"
            />
          </dd>
        </dl>
      )}

      {preview && signMessageLibAddress && (
        <details style={{ marginBottom: 16 }}>
          <summary
            style={{ cursor: "pointer", fontSize: 12, color: "#636669" }}
          >
            On-chain transaction details (if signed on-chain)
          </summary>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Target</dt>
            <dd>
              <Copyable
                value={signMessageLibAddress}
                title="Copy SignMessageLib address"
              />{" "}
              (SignMessageLib)
            </dd>
            <dt>Calldata</dt>
            <dd>
              <Copyable value={preview.calldata} title="Copy calldata" />
            </dd>
          </dl>
        </details>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={onSign}
          disabled={!canSubmit}
        >
          {submitting ? "Awaiting Safe Wallet…" : "Sign message"}
        </button>
        {submitting && (
          <button type="button" className="secondary" onClick={stopWaiting}>
            Cancel
          </button>
        )}
      </div>

      {submitting && (
        <p className="subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
          Confirm or reject in the Safe Wallet dialog. If you cancelled and this
          stays stuck, press <strong>Cancel</strong> — the Wallet's on-chain
          message dialog doesn't notify the app when dismissed.
        </p>
      )}

      {result?.kind === "offchain" && safe && (
        <div className="callout success" style={{ marginTop: 16 }}>
          <strong>Signed off-chain (EIP-1271 SafeMessage).</strong>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>SafeMessage hash</dt>
            <dd>
              <Copyable
                value={result.messageHash}
                title="Copy SafeMessage hash"
              />
            </dd>
            <dt>Messages tab</dt>
            <dd>
              <a
                href={`https://app.safe.global/transactions/messages?safe=${safe.safeAddress}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Safe Wallet
              </a>
            </dd>
          </dl>
        </div>
      )}

      {result?.kind === "onchain" && safe && (
        <div className="callout success" style={{ marginTop: 16 }}>
          <strong>Signed on-chain (SignMessageLib transaction).</strong> Your
          Wallet's signing method is set to on-chain (or off-chain isn't
          supported for this Safe), so it proposed a SignMessageLib
          delegatecall. Continue in the queue to collect signatures and execute;
          afterwards the SafeMessage hash is valid on-chain (replay protection
          from the Safe nonce).
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>safeTxHash</dt>
            <dd>
              <Copyable value={result.safeTxHash} title="Copy safeTxHash" />
            </dd>
            <dt>Queue</dt>
            <dd>
              <a
                href={`https://app.safe.global/transactions/queue?safe=${safe.safeAddress}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Safe Wallet
              </a>
            </dd>
          </dl>
        </div>
      )}

      {error && (
        <div className="callout error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
    </div>
  );
}
