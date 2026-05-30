/**
 * Thin wrapper around @safe-global/safe-apps-sdk that exposes the SDK + the
 * connected Safe context (address, chainId, threshold, owners, version) once
 * the SDK has finished bootstrapping inside the Safe Wallet iframe.
 *
 * When this app is loaded outside the Safe Wallet (e.g. plain localhost), the
 * SDK won't connect and `safe` will stay undefined. We surface that as
 * `isStandalone` so the UI can show an "open this app inside Safe Wallet"
 * notice instead of a confusing blank state.
 */

import { useEffect, useMemo, useState } from 'react'
import SafeAppsSDK, { type SafeInfoExtended } from '@safe-global/safe-apps-sdk'

export type SafeAppContext = {
  sdk: SafeAppsSDK
  // SafeInfoExtended adds version + fallbackHandler, which we need to detect
  // whether off-chain EIP-1271 signing is even possible for this Safe.
  safe: SafeInfoExtended | undefined
  isStandalone: boolean
  isLoading: boolean
}

/**
 * React hook that initialises the Safe Apps SDK and performs the handshake with
 * the parent Safe{Wallet}. Resolves the connected Safe info, or flags
 * standalone mode if no parent Wallet responds within a short timeout.
 *
 * @returns The SDK instance plus `safe` (undefined until connected),
 *   `isStandalone`, and `isLoading`.
 */
export function useSafeAppsSdk(): SafeAppContext {
  const sdk = useMemo(
    () =>
      new SafeAppsSDK({
        // Default communication targets work for the official Safe Wallet UIs
        // (app.safe.global, staging, etc.). Override here if pointing at a
        // local dev deployment of the Wallet.
        allowedDomains: undefined,
        debug: false,
      }),
    [],
  )

  const [safe, setSafe] = useState<SafeInfoExtended | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Race the SDK handshake against a short timeout so we can distinguish
    // "loaded inside Safe Wallet" from "loaded standalone" without hanging.
    const handshake = sdk.safe
      .getInfo()
      .then((info) => {
        if (cancelled) return
        setSafe(info)
        setIsLoading(false)
      })
      .catch((err) => {
        // The SDK throws if no parent Safe Wallet is detected
        console.warn('[safe-message-signer] Safe Apps SDK handshake failed:', err)
      })

    const timeout = setTimeout(() => {
      if (cancelled) return
      if (!safe) {
        setIsStandalone(true)
        setIsLoading(false)
      }
    }, 2500)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      void handshake
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk])

  return { sdk, safe, isStandalone, isLoading }
}
