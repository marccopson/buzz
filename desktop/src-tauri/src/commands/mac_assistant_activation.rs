//! Jake-only MAC Assistant owner attestation.
//!
//! This command is intentionally separate from managed-agent creation and
//! snapshot import. It signs an offline bundle with the guarded, in-memory
//! current Desktop identity and never creates or stores an agent key.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::app_state::AppState;

#[tauri::command]
pub fn attest_mac_assistant_activation(
    request_json: String,
    projected_identity_pubkey: String,
    channel_id: String,
    user_name: String,
    assistant_key: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let keys = state.signing_keys()?;
    let identity_pubkey = keys.public_key().to_hex();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock precedes the Unix epoch".to_string())?
        .as_secs();
    let context = buzz_sdk_pkg::mac_assistant_activation::DesktopJakeContext {
        identity_pubkey,
        projected_identity_pubkey,
        channel_id,
        user_name,
        assistant_key,
    };
    buzz_sdk_pkg::mac_assistant_activation::attest_request(&request_json, &keys, &context, now)
        .map_err(|error| format!("MAC Assistant activation rejected: {error}"))
}

#[cfg(test)]
mod tests {
    use nostr::Keys;
    use uuid::Uuid;

    use super::*;
    use buzz_sdk_pkg::mac_assistant_activation::{
        ActivationRequest, DesktopJakeContext, ASSISTANT_KEY, ASSISTANT_NAME, JAKE_SCOPE,
        JAKE_USER_KEY, JAKE_USER_NAME, JIRA_KEY, REQUEST_SCHEMA, WORKSPACE_ORIGIN,
    };

    const NOW: u64 = 1_900_000_000;

    fn request(jake: &Keys, assistant: &Keys) -> ActivationRequest {
        ActivationRequest {
            schema: REQUEST_SCHEMA.into(),
            request_id: Uuid::new_v4().to_string(),
            challenge: "12".repeat(32),
            issued_at: NOW - 1,
            expires_at: NOW + 300,
            workspace_origin: WORKSPACE_ORIGIN.into(),
            scope: JAKE_SCOPE.into(),
            user_key: JAKE_USER_KEY.into(),
            user_name: JAKE_USER_NAME.into(),
            jira_key: JIRA_KEY.into(),
            assistant_key: ASSISTANT_KEY.into(),
            assistant_name: ASSISTANT_NAME.into(),
            assistant_pubkey: assistant.public_key().to_hex(),
            identity_pubkey: jake.public_key().to_hex(),
            channel_id: Uuid::new_v4().to_string(),
        }
    }

    #[test]
    fn desktop_context_signs_without_accepting_private_key_input() {
        let jake = Keys::generate();
        let assistant = Keys::generate();
        let request = request(&jake, &assistant);
        let context = DesktopJakeContext {
            identity_pubkey: request.identity_pubkey.clone(),
            projected_identity_pubkey: request.identity_pubkey.clone(),
            channel_id: request.channel_id.clone(),
            user_name: request.user_name.clone(),
            assistant_key: request.assistant_key.clone(),
        };
        let request_json = serde_json::to_string(&request).unwrap();
        let attestation = buzz_sdk_pkg::mac_assistant_activation::attest_request(
            &request_json,
            &jake,
            &context,
            NOW,
        )
        .unwrap();
        buzz_sdk_pkg::mac_assistant_activation::verify_attestation(
            &request_json,
            &attestation,
            NOW,
        )
        .unwrap();
        assert!(!attestation.contains("nsec"));
    }
}
