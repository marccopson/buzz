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
