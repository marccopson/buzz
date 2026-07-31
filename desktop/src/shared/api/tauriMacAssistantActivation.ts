import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type JakeAssistantAttestationContext = {
  projectedIdentityPubkey: string;
  channelId: string;
  userName: string;
  assistantKey: "mac-assistant";
};

/**
 * Ask the dedicated native command to sign one short-lived activation request
 * with Desktop's guarded current identity. This is not managed-agent creation.
 */
export async function attestMacAssistantActivation(
  requestJson: string,
  context: JakeAssistantAttestationContext,
): Promise<string> {
  return tauriInvoke<string>("attest_mac_assistant_activation", {
    requestJson,
    ...context,
  });
}

export async function attestMacAssistantEnrolment(
  requestEventJson: string,
  context: {
    bridgePubkey: string;
    projectedIdentityPubkey: string;
    channelId: string;
    userId: string;
    userName: string;
  },
): Promise<string> {
  return tauriInvoke<string>("attest_mac_assistant_enrolment", {
    requestEventJson,
    ...context,
  });
}

/**
 * Sign one bridge-authored recovery request. The native command validates the
 * bridge signature, purpose, relay and short expiry before using Desktop's
 * in-memory identity.
 */
export async function attestMacAssistantBridgeAuthorisation(
  requestEventJson: string,
): Promise<string> {
  return tauriInvoke<string>("attest_mac_assistant_bridge_authorisation", {
    requestEventJson,
  });
}
