//! Offline Jake-only MAC Assistant activation attestations.
//!
//! The request and attestation are short-lived files moved between brain-vps
//! and MAC Workspace Desktop. They are deliberately not relay events. Desktop
//! signs both the NIP-OA agent binding and a Nostr event whose content binds the
//! complete request, including its one-time challenge.

use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, PublicKey, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{nip_oa, SdkError};

/// Request schema accepted by the Jake-only Desktop command.
pub const REQUEST_SCHEMA: &str = "mac-workspace/mac-assistant-activation-request/v1";
/// Signed payload schema embedded in the attestation event.
pub const PAYLOAD_SCHEMA: &str = "mac-workspace/mac-assistant-owner-attestation/v1";
/// Outer attestation bundle schema.
pub const ATTESTATION_SCHEMA: &str = "mac-workspace/mac-assistant-attestation/v1";
/// Offline-only Nostr event kind used for the owner signature.
pub const ATTESTATION_EVENT_KIND: u16 = 27_212;
/// Tailnet HTTPS origin to which this activation route is bound.
pub const WORKSPACE_ORIGIN: &str = "https://forge-do.tailfe35cd.ts.net";
/// Maximum accepted request lifetime.
pub const MAX_REQUEST_LIFETIME_SECONDS: u64 = 600;
/// Exact activation scope supported by this release.
pub const JAKE_SCOPE: &str = "jake-only";
/// Exact authoritative COS user key supported by this release.
pub const JAKE_USER_KEY: &str = "jake-wherton";
/// Exact authoritative COS user name supported by this release.
pub const JAKE_USER_NAME: &str = "Jake Wherton";
/// Exact Jira evidence boundary for the activation.
pub const JIRA_KEY: &str = "COS-709";
/// Exact centrally provided assistant key.
pub const ASSISTANT_KEY: &str = "mac-assistant";
/// Exact centrally provided assistant name.
pub const ASSISTANT_NAME: &str = "MAC Assistant";

/// Versioned, short-lived activation request prepared on brain-vps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationRequest {
    /// Contract schema.
    pub schema: String,
    /// UUID identifying this single activation attempt.
    pub request_id: String,
    /// 256-bit random, lowercase hexadecimal one-time challenge.
    pub challenge: String,
    /// Unix timestamp at which brain-vps prepared the request.
    pub issued_at: u64,
    /// Unix timestamp after which Desktop and estate verification reject it.
    pub expires_at: u64,
    /// Tailnet HTTPS origin for the Workspace authority.
    pub workspace_origin: String,
    /// Exact Jake-only scope.
    pub scope: String,
    /// Exact authoritative Jake user key.
    pub user_key: String,
    /// Exact authoritative Jake display name.
    pub user_name: String,
    /// Jira evidence boundary.
    pub jira_key: String,
    /// Centrally provided assistant key.
    pub assistant_key: String,
    /// Centrally provided assistant name.
    pub assistant_name: String,
    /// Public key derived from the brain-vps-only assistant private key.
    pub assistant_pubkey: String,
    /// Jake's authoritative signed MAC Workspace identity.
    pub identity_pubkey: String,
    /// Jake's one authoritative private COS channel.
    pub channel_id: String,
}

/// Authoritative context already verified by the Desktop COS projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopJakeContext {
    /// Current signed-in Desktop identity.
    pub identity_pubkey: String,
    /// Identity named by the authoritative COS user-context projection.
    pub projected_identity_pubkey: String,
    /// Private channel resolved from relay-signed metadata and membership.
    pub channel_id: String,
    /// Authoritative COS user name.
    pub user_name: String,
    /// Centrally provided assistant key.
    pub assistant_key: String,
}

/// Exact content signed by Jake's current Desktop identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerAttestationPayload {
    /// Payload schema.
    pub schema: String,
    /// Complete request, binding every request field to the event signature.
    pub request: ActivationRequest,
    /// Event creation time.
    pub attested_at: u64,
    /// Existing NIP-OA tag authorising the assistant public key.
    pub nip_oa_auth_tag: [String; 4],
}

/// Strict outer attestation bundle.
#[derive(Debug, Clone, Serialize)]
pub struct ActivationAttestation {
    /// Bundle schema.
    pub schema: String,
    /// Jake-signed offline Nostr event.
    pub event: Event,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictActivationAttestation {
    schema: String,
    event: StrictEvent,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictEvent {
    id: String,
    pubkey: String,
    created_at: u64,
    kind: u16,
    tags: Vec<Vec<String>>,
    content: String,
    sig: String,
}

/// Public values returned after complete cryptographic verification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VerifiedActivationAttestation {
    /// Verified request.
    pub request: ActivationRequest,
    /// Verified event identifier.
    pub event_id: String,
    /// Verified event creation time.
    pub attested_at: u64,
    /// Verified NIP-OA tag ready for the protected assistant environment.
    pub nip_oa_auth_tag: [String; 4],
}

fn invalid(message: impl Into<String>) -> SdkError {
    SdkError::InvalidInput(message.into())
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn canonical_uuid(value: &str, label: &str) -> Result<(), SdkError> {
    let parsed = Uuid::parse_str(value).map_err(|_| invalid(format!("{label} must be a UUID")))?;
    if parsed.to_string() != value {
        return Err(invalid(format!(
            "{label} must be a canonical lower-case UUID"
        )));
    }
    Ok(())
}

fn parse_pubkey(value: &str, label: &str) -> Result<PublicKey, SdkError> {
    if !is_lower_hex(value, 64) {
        return Err(invalid(format!(
            "{label} must be 64 lower-case hexadecimal characters"
        )));
    }
    PublicKey::from_hex(value).map_err(|error| invalid(format!("{label} is invalid: {error}")))
}

/// Validate the exact Jake-only request and its freshness.
pub fn validate_request(request: &ActivationRequest, now: u64) -> Result<(), SdkError> {
    if request.schema != REQUEST_SCHEMA
        || request.workspace_origin != WORKSPACE_ORIGIN
        || request.scope != JAKE_SCOPE
        || request.user_key != JAKE_USER_KEY
        || request.user_name != JAKE_USER_NAME
        || request.jira_key != JIRA_KEY
        || request.assistant_key != ASSISTANT_KEY
        || request.assistant_name != ASSISTANT_NAME
    {
        return Err(invalid(
            "activation request is outside the Jake-only MAC Assistant boundary",
        ));
    }
    canonical_uuid(&request.request_id, "request_id")?;
    if !is_lower_hex(&request.challenge, 64) {
        return Err(invalid(
            "challenge must be 64 lower-case hexadecimal characters",
        ));
    }
    parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?;
    parse_pubkey(&request.identity_pubkey, "identity_pubkey")?;
    canonical_uuid(&request.channel_id, "channel_id")?;
    if request.assistant_pubkey == request.identity_pubkey {
        return Err(invalid("assistant and Jake identity pubkeys must differ"));
    }
    let lifetime = request
        .expires_at
        .checked_sub(request.issued_at)
        .ok_or_else(|| invalid("request expiry precedes issue time"))?;
    if lifetime == 0 || lifetime > MAX_REQUEST_LIFETIME_SECONDS {
        return Err(invalid("request lifetime is outside the accepted bound"));
    }
    if now < request.issued_at || now >= request.expires_at {
        return Err(invalid("activation request is not currently valid"));
    }
    Ok(())
}

fn parse_request(request_json: &str, now: u64) -> Result<ActivationRequest, SdkError> {
    if request_json.len() > 32 * 1024 {
        return Err(invalid("activation request exceeds 32 KiB"));
    }
    let request: ActivationRequest = serde_json::from_str(request_json)
        .map_err(|error| invalid(format!("invalid activation request: {error}")))?;
    validate_request(&request, now)?;
    Ok(request)
}

fn validate_desktop_context(
    request: &ActivationRequest,
    keys: &Keys,
    context: &DesktopJakeContext,
) -> Result<(), SdkError> {
    let signer = keys.public_key().to_hex();
    if signer != context.identity_pubkey
        || signer != context.projected_identity_pubkey
        || signer != request.identity_pubkey
        || context.channel_id != request.channel_id
        || context.user_name != JAKE_USER_NAME
        || context.user_name != request.user_name
        || context.assistant_key != ASSISTANT_KEY
        || context.assistant_key != request.assistant_key
    {
        return Err(invalid(
            "signed-in Desktop identity does not match the authoritative Jake context",
        ));
    }
    Ok(())
}

fn expected_tags(request: &ActivationRequest) -> Vec<Vec<String>> {
    vec![
        vec!["d".into(), request.request_id.clone()],
        vec!["h".into(), request.channel_id.clone()],
        vec!["p".into(), request.assistant_pubkey.clone()],
        vec!["challenge".into(), request.challenge.clone()],
        vec!["expiration".into(), request.expires_at.to_string()],
    ]
}

/// Attest one prepared request with Desktop's in-memory current signing keys.
///
/// No private key is accepted in the request, context, environment, or return
/// value. Callers must obtain `keys` from Desktop's guarded `AppState`.
pub fn attest_request(
    request_json: &str,
    keys: &Keys,
    context: &DesktopJakeContext,
    now: u64,
) -> Result<String, SdkError> {
    let request = parse_request(request_json, now)?;
    validate_desktop_context(&request, keys, context)?;
    let assistant_pubkey = parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?;
    let conditions = format!("created_at<{}", request.expires_at);
    let auth_tag_json = nip_oa::compute_auth_tag(keys, &assistant_pubkey, &conditions)?;
    let nip_oa_auth_tag: [String; 4] = serde_json::from_str(&auth_tag_json)
        .map_err(|error| invalid(format!("NIP-OA tag encoding failed: {error}")))?;
    let payload = OwnerAttestationPayload {
        schema: PAYLOAD_SCHEMA.into(),
        request: request.clone(),
        attested_at: now,
        nip_oa_auth_tag,
    };
    let content = serde_json::to_string(&payload)
        .map_err(|error| invalid(format!("attestation payload encoding failed: {error}")))?;
    let tags = expected_tags(&request)
        .into_iter()
        .map(|tag| Tag::parse(tag).map_err(|error| invalid(format!("invalid tag: {error}"))))
        .collect::<Result<Vec<_>, _>>()?;
    let event = EventBuilder::new(Kind::Custom(ATTESTATION_EVENT_KIND), content)
        .tags(tags)
        .custom_created_at(Timestamp::from(now))
        .sign_with_keys(keys)
        .map_err(|error| invalid(format!("owner attestation signing failed: {error}")))?;
    serde_json::to_string(&ActivationAttestation {
        schema: ATTESTATION_SCHEMA.into(),
        event,
    })
    .map_err(|error| invalid(format!("attestation bundle encoding failed: {error}")))
}

fn strict_event_json(event: &StrictEvent) -> Result<String, SdkError> {
    serde_json::to_string(event)
        .map_err(|error| invalid(format!("attestation event encoding failed: {error}")))
}

/// Verify a Desktop attestation against the exact prepared request.
pub fn verify_attestation(
    request_json: &str,
    attestation_json: &str,
    now: u64,
) -> Result<VerifiedActivationAttestation, SdkError> {
    let request = parse_request(request_json, now)?;
    if attestation_json.len() > 128 * 1024 {
        return Err(invalid("activation attestation exceeds 128 KiB"));
    }
    let strict: StrictActivationAttestation = serde_json::from_str(attestation_json)
        .map_err(|error| invalid(format!("invalid activation attestation: {error}")))?;
    if strict.schema != ATTESTATION_SCHEMA {
        return Err(invalid("unsupported activation attestation schema"));
    }
    let raw_event = strict_event_json(&strict.event)?;
    let event = Event::from_json(raw_event)
        .map_err(|error| invalid(format!("invalid attestation event: {error}")))?;
    event
        .verify()
        .map_err(|error| invalid(format!("attestation event verification failed: {error}")))?;
    if event.kind != Kind::Custom(ATTESTATION_EVENT_KIND) {
        return Err(invalid("unexpected attestation event kind"));
    }
    if event.created_at.as_secs() < request.issued_at
        || event.created_at.as_secs() >= request.expires_at
        || event.created_at.as_secs() > now
    {
        return Err(invalid(
            "attestation event timestamp is outside the request",
        ));
    }
    if event.pubkey.to_hex() != request.identity_pubkey {
        return Err(invalid(
            "attestation signer is not Jake's requested identity",
        ));
    }
    let actual_tags = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    if actual_tags != expected_tags(&request) {
        return Err(invalid(
            "attestation event tags do not exactly bind the request",
        ));
    }
    let payload: OwnerAttestationPayload = serde_json::from_str(&event.content)
        .map_err(|error| invalid(format!("invalid owner attestation payload: {error}")))?;
    if payload.schema != PAYLOAD_SCHEMA
        || payload.request != request
        || payload.attested_at != event.created_at.as_secs()
    {
        return Err(invalid(
            "owner attestation payload does not exactly match the request",
        ));
    }
    if payload.nip_oa_auth_tag[0] != "auth" {
        return Err(invalid("malformed NIP-OA auth tag"));
    }
    let expected_conditions = format!("created_at<{}", request.expires_at);
    if payload.nip_oa_auth_tag[2] != expected_conditions {
        return Err(invalid("NIP-OA conditions do not match request expiry"));
    }
    let auth_tag_json = serde_json::to_string(&payload.nip_oa_auth_tag)
        .map_err(|error| invalid(format!("NIP-OA tag encoding failed: {error}")))?;
    let assistant_pubkey = parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?;
    let owner = nip_oa::verify_auth_tag(&auth_tag_json, &assistant_pubkey)?;
    if owner.to_hex() != request.identity_pubkey {
        return Err(invalid("NIP-OA owner is not Jake's requested identity"));
    }
    Ok(VerifiedActivationAttestation {
        request,
        event_id: event.id.to_hex(),
        attested_at: event.created_at.as_secs(),
        nip_oa_auth_tag: payload.nip_oa_auth_tag,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const NOW: u64 = 1_900_000_100;

    fn request(owner: &Keys, assistant: &Keys) -> ActivationRequest {
        ActivationRequest {
            schema: REQUEST_SCHEMA.into(),
            request_id: Uuid::new_v4().to_string(),
            challenge: "ab".repeat(32),
            issued_at: NOW - 10,
            expires_at: NOW + 300,
            workspace_origin: WORKSPACE_ORIGIN.into(),
            scope: JAKE_SCOPE.into(),
            user_key: JAKE_USER_KEY.into(),
            user_name: JAKE_USER_NAME.into(),
            jira_key: JIRA_KEY.into(),
            assistant_key: ASSISTANT_KEY.into(),
            assistant_name: ASSISTANT_NAME.into(),
            assistant_pubkey: assistant.public_key().to_hex(),
            identity_pubkey: owner.public_key().to_hex(),
            channel_id: Uuid::new_v4().to_string(),
        }
    }

    fn context(request: &ActivationRequest) -> DesktopJakeContext {
        DesktopJakeContext {
            identity_pubkey: request.identity_pubkey.clone(),
            projected_identity_pubkey: request.identity_pubkey.clone(),
            channel_id: request.channel_id.clone(),
            user_name: request.user_name.clone(),
            assistant_key: request.assistant_key.clone(),
        }
    }

    fn signed() -> (ActivationRequest, String) {
        let owner = Keys::generate();
        let assistant = Keys::generate();
        let request = request(&owner, &assistant);
        let request_json = serde_json::to_string(&request).unwrap();
        let attestation = attest_request(&request_json, &owner, &context(&request), NOW).unwrap();
        (request, attestation)
    }

    #[test]
    fn valid_jake_flow_round_trips() {
        let (request, attestation) = signed();
        let verified =
            verify_attestation(&serde_json::to_string(&request).unwrap(), &attestation, NOW)
                .unwrap();
        assert_eq!(verified.request, request);
        assert_eq!(verified.nip_oa_auth_tag[1], request.identity_pubkey);
    }

    #[test]
    fn rejects_wrong_or_marc_signer() {
        let jake = Keys::generate();
        let marc = Keys::generate();
        let assistant = Keys::generate();
        let request = request(&jake, &assistant);
        let error = attest_request(
            &serde_json::to_string(&request).unwrap(),
            &marc,
            &context(&request),
            NOW,
        )
        .unwrap_err();
        assert!(error.to_string().contains("signed-in Desktop identity"));
    }

    #[test]
    fn rejects_stephen_matthew_and_multi_person_shapes() {
        let owner = Keys::generate();
        let assistant = Keys::generate();
        for (key, name) in [
            ("stephen-evans", "Stephen Evans"),
            ("matthew-ward", "Matthew Ward"),
        ] {
            let mut request = request(&owner, &assistant);
            request.user_key = key.into();
            request.user_name = name.into();
            assert!(attest_request(
                &serde_json::to_string(&request).unwrap(),
                &owner,
                &context(&request),
                NOW
            )
            .is_err());
        }
        let base = request(&owner, &assistant);
        let mut value = serde_json::to_value(&base).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("identities".into(), serde_json::json!([{}, {}]));
        assert!(attest_request(&value.to_string(), &owner, &context(&base), NOW).is_err());
    }

    #[test]
    fn rejects_expired_request_and_unknown_fields() {
        let owner = Keys::generate();
        let assistant = Keys::generate();
        let mut expired = request(&owner, &assistant);
        expired.expires_at = NOW;
        assert!(attest_request(
            &serde_json::to_string(&expired).unwrap(),
            &owner,
            &context(&expired),
            NOW
        )
        .is_err());
        let base = request(&owner, &assistant);
        let mut value = serde_json::to_value(&base).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), Value::Bool(true));
        assert!(attest_request(&value.to_string(), &owner, &context(&base), NOW).is_err());
    }

    fn mutate_signed_payload(
        request: &ActivationRequest,
        attestation: &str,
        owner: &Keys,
        mutate: impl FnOnce(&mut OwnerAttestationPayload),
    ) -> String {
        let outer: serde_json::Value = serde_json::from_str(attestation).unwrap();
        let event: Event = serde_json::from_value(outer["event"].clone()).unwrap();
        let mut payload: OwnerAttestationPayload = serde_json::from_str(&event.content).unwrap();
        mutate(&mut payload);
        let tags = expected_tags(request)
            .into_iter()
            .map(|tag| Tag::parse(tag).unwrap())
            .collect::<Vec<_>>();
        let replacement = EventBuilder::new(
            Kind::Custom(ATTESTATION_EVENT_KIND),
            serde_json::to_string(&payload).unwrap(),
        )
        .tags(tags)
        .custom_created_at(Timestamp::from(payload.attested_at))
        .sign_with_keys(owner)
        .unwrap();
        serde_json::to_string(&ActivationAttestation {
            schema: ATTESTATION_SCHEMA.into(),
            event: replacement,
        })
        .unwrap()
    }

    #[test]
    fn rejects_altered_assistant_channel_challenge_and_malformed_nip_oa() {
        for field in ["assistant", "channel", "challenge", "nip_oa"] {
            let owner = Keys::generate();
            let assistant = Keys::generate();
            let request = request(&owner, &assistant);
            let request_json = serde_json::to_string(&request).unwrap();
            let attestation =
                attest_request(&request_json, &owner, &context(&request), NOW).unwrap();
            let altered =
                mutate_signed_payload(&request, &attestation, &owner, |payload| match field {
                    "assistant" => {
                        payload.request.assistant_pubkey = Keys::generate().public_key().to_hex();
                    }
                    "channel" => payload.request.channel_id = Uuid::new_v4().to_string(),
                    "challenge" => payload.request.challenge = "cd".repeat(32),
                    "nip_oa" => payload.nip_oa_auth_tag[3] = "00".repeat(64),
                    _ => unreachable!(),
                });
            assert!(
                verify_attestation(&request_json, &altered, NOW).is_err(),
                "{field} alteration must fail"
            );
        }
    }

    #[test]
    fn rejects_unknown_attestation_and_event_fields() {
        let (request, attestation) = signed();
        let request_json = serde_json::to_string(&request).unwrap();
        let mut outer: Value = serde_json::from_str(&attestation).unwrap();
        outer
            .as_object_mut()
            .unwrap()
            .insert("extra".into(), Value::Null);
        assert!(verify_attestation(&request_json, &outer.to_string(), NOW).is_err());

        let mut outer: Value = serde_json::from_str(&attestation).unwrap();
        outer["event"]
            .as_object_mut()
            .unwrap()
            .insert("extra".into(), Value::Null);
        assert!(verify_attestation(&request_json, &outer.to_string(), NOW).is_err());
    }
}
