import { useSafeAppsSdk } from "./hooks/useSafeAppsSdk";
import { SignMessage } from "./components/SignMessage";

/**
 * Top-level shell: runs the Safe Apps SDK handshake and renders the connecting
 * / standalone / connected states. When connected, shows the Safe info card and
 * the {@link SignMessage} feature.
 *
 * @returns The application root.
 */
export function App() {
  const ctx = useSafeAppsSdk();

  return (
    <main>
      <h1 className="app-title">
        <img
          src="/icon.svg"
          alt=""
          className="app-logo"
          width={32}
          height={32}
        />
        Safe Message Signer
      </h1>
      <p className="subtitle">
        Sign an arbitrary message with your Safe so that contracts and dApps can
        verify it via EIP-1271. Enter plain text or EIP-712 typed data; the Safe
        Wallet then either records a <strong>SafeMessage off-chain</strong>{" "}
        (collected by the transaction service) or commits it{" "}
        <strong>on-chain</strong> through <code>SignMessageLib</code> - your
        Wallet's signing-method setting decides which.
      </p>

      {ctx.isLoading && (
        <div className="callout">Connecting to Safe Wallet…</div>
      )}

      {ctx.isStandalone && !ctx.safe && (
        <div className="callout">
          <strong>Standalone mode.</strong> This app is meant to run as a Safe
          App inside the Safe Wallet UI. Open <code>app.safe.global</code>, go
          to the Apps panel, add this dev URL as a custom app, then load it from
          there.
        </div>
      )}

      {ctx.safe && <SignMessage ctx={ctx} />}
    </main>
  );
}
