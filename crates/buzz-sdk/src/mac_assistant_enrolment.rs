//! Typed private-channel MAC Assistant enrolment.
//!
//! Only public keys and signed evidence cross the relay. Assistant private
//! keys are deliberately absent from every type in this contract.

use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{nip_oa, SdkError};

/// Request content schema.
pub const REQUEST_SCHEMA: &str = "mac-workspace/mac-assistant-enrolment-request/v1";
/// Attestation content schema.
pub const ATTESTATION_SCHEMA: &str = "mac-workspace/mac-assistant-enrolment-attestation/v1";
/// Bridge-authored request event kind.
pub const REQUEST_KIND: u16 = 37_013;
/// Desktop-authored attestation event kind.
pub const ATTESTATION_KIND: u16 = 47_012;
/// Longest permitted request lifetime.
pub const MAX_LIFETIME_SECONDS: u64 = 600;
/// Display name fixed by the contract.
pub const ASSISTANT_NAME: &str = "MAC Assistant";

/// Public, short-lived request for one isolated assistant instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolmentRequest {
    /// Contract schema.
    pub schema: String,
    /// Unique request identifier.
    pub request_id: String,
    /// One-time random challenge.
    pub challenge: String,
    /// Issue time in Unix seconds.
    pub issued_at: u64,
    /// Expiry time in Unix seconds.
    pub expires_at: u64,
    /// Canonical operational user slug.
    pub user_key: String,
    /// Authoritative COS user identifier.
    pub user_id: String,
    /// Authoritative COS display name.
    pub user_name: String,
    /// Signed Workspace identity expected to approve.
    pub identity_pubkey: String,
    /// Exact private COS channel.
    pub channel_id: String,
    /// Unique per-user service and profile name.
    pub assistant_instance: String,
    /// User-facing assistant name.
    pub assistant_name: String,
    /// Public key of this user's isolated assistant.
    pub assistant_pubkey: String,
}

/// Signed Desktop approval content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolmentAttestation {
    /// Contract schema.
    pub schema: String,
    /// Exact approved request.
    pub request: EnrolmentRequest,
    /// Signed request event identifier.
    pub request_event_id: String,
    /// Trusted bridge public key.
    pub bridge_pubkey: String,
    /// Approval time in Unix seconds.
    pub attested_at: u64,
    /// NIP-OA binding from the user to the isolated assistant key.
    pub nip_oa_auth_tag: [String; 4],
}

/// COS context against which Desktop validates a request before rendering it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEnrolmentContext {
    /// Current in-memory signing identity.
    pub identity_pubkey: String,
    /// Identity projected by the COS bridge.
    pub projected_identity_pubkey: String,
    /// Authoritative private channel.
    pub channel_id: String,
    /// Authoritative COS user identifier.
    pub user_id: String,
    /// Authoritative COS display name.
    pub user_name: String,
}

fn invalid(message: impl Into<String>) -> SdkError {
    SdkError::InvalidInput(message.into())
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn validate_uuid(value: &str, label: &str) -> Result<(), SdkError> {
    let parsed = Uuid::parse_str(value).map_err(|_| invalid(format!("{label} must be a UUID")))?;
    if parsed.to_string() != value {
        return Err(invalid(format!(
            "{label} must be a canonical lower-case UUID"
        )));
    }
    Ok(())
}

fn parse_pubkey(value: &str, label: &str) -> Result<PublicKey, SdkError> {
    if !lower_hex(value, 64) {
        return Err(invalid(format!(
            "{label} must be 64 lower-case hexadecimal characters"
        )));
    }
    PublicKey::from_hex(value).map_err(|error| invalid(format!("{label} is invalid: {error}")))
}

fn validate_slug(value: &str, label: &str) -> Result<(), SdkError> {
    if value.is_empty()
        || value.len() > 63
        || value.starts_with('-')
        || value.ends_with('-')
        || value
            .bytes()
            .any(|b| !(b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
    {
        return Err(invalid(format!(
            "{label} must be a canonical lower-case slug"
        )));
    }
    Ok(())
}

/// Validate all request fields and its current lifetime.
pub fn validate_request(request: &EnrolmentRequest, now: u64) -> Result<(), SdkError> {
    if request.schema != REQUEST_SCHEMA || request.assistant_name != ASSISTANT_NAME {
        return Err(invalid("unsupported MAC Assistant enrolment request"));
    }
    validate_uuid(&request.request_id, "request_id")?;
    validate_uuid(&request.channel_id, "channel_id")?;
    validate_slug(&request.user_key, "user_key")?;
    validate_slug(&request.assistant_instance, "assistant_instance")?;
    if request.assistant_instance != format!("mac-assistant-{}", request.user_key) {
        return Err(invalid(
            "assistant_instance must be isolated to the requested user",
        ));
    }
    if request.user_name.trim() != request.user_name || request.user_name.is_empty() {
        return Err(invalid("user_name must be a non-empty canonical value"));
    }
    if request.user_id.trim() != request.user_id || request.user_id.is_empty() {
        return Err(invalid("user_id must be a non-empty canonical value"));
    }
    if !lower_hex(&request.challenge, 64) {
        return Err(invalid("challenge must be 256-bit lower-case hexadecimal"));
    }
    parse_pubkey(&request.identity_pubkey, "identity_pubkey")?;
    parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?;
    if request.identity_pubkey == request.assistant_pubkey {
        return Err(invalid("assistant and user identities must differ"));
    }
    let lifetime = request
        .expires_at
        .checked_sub(request.issued_at)
        .ok_or_else(|| invalid("request expiry precedes issue time"))?;
    if lifetime == 0
        || lifetime > MAX_LIFETIME_SECONDS
        || now < request.issued_at
        || now >= request.expires_at
    {
        return Err(invalid(
            "enrolment request is stale or outside the accepted lifetime",
        ));
    }
    Ok(())
}

fn request_tags(request: &EnrolmentRequest) -> Vec<Vec<String>> {
    vec![
        vec!["d".into(), request.request_id.clone()],
        vec!["h".into(), request.channel_id.clone()],
        vec!["p".into(), request.identity_pubkey.clone()],
        vec!["challenge".into(), request.challenge.clone()],
        vec!["expiration".into(), request.expires_at.to_string()],
        vec!["instance".into(), request.assistant_instance.clone()],
    ]
}

fn attestation_tags(
    request: &EnrolmentRequest,
    bridge_pubkey: &str,
    request_event_id: &str,
) -> Vec<Vec<String>> {
    vec![
        vec!["h".into(), request.channel_id.clone()],
        vec!["p".into(), bridge_pubkey.into()],
        vec!["e".into(), request_event_id.into()],
        vec!["request".into(), request.request_id.clone()],
        vec!["challenge".into(), request.challenge.clone()],
        vec!["expiration".into(), request.expires_at.to_string()],
        vec!["instance".into(), request.assistant_instance.clone()],
    ]
}

/// Build and sign a bridge-authored request event.
pub fn build_request_event(
    request: &EnrolmentRequest,
    bridge: &Keys,
    now: u64,
) -> Result<Event, SdkError> {
    validate_request(request, now)?;
    let tags = request_tags(request)
        .into_iter()
        .map(|tag| {
            Tag::parse(tag).map_err(|error| invalid(format!("invalid request tag: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    EventBuilder::new(
        Kind::Custom(REQUEST_KIND),
        serde_json::to_string(request).map_err(|error| invalid(error.to_string()))?,
    )
    .tags(tags)
    .custom_created_at(Timestamp::from(request.issued_at))
    .sign_with_keys(bridge)
    .map_err(|error| invalid(format!("request signing failed: {error}")))
}

/// Verify and parse a bridge-authored request event.
pub fn parse_request_event(
    event: &Event,
    bridge_pubkey: &str,
    now: u64,
) -> Result<EnrolmentRequest, SdkError> {
    event
        .verify()
        .map_err(|error| invalid(format!("request signature verification failed: {error}")))?;
    parse_pubkey(bridge_pubkey, "bridge_pubkey")?;
    if event.kind != Kind::Custom(REQUEST_KIND) || event.pubkey.to_hex() != bridge_pubkey {
        return Err(invalid("request is not bridge-authored"));
    }
    let request: EnrolmentRequest = serde_json::from_str(&event.content)
        .map_err(|error| invalid(format!("invalid enrolment request: {error}")))?;
    validate_request(&request, now)?;
    let tags = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    if event.created_at.as_secs() != request.issued_at || tags != request_tags(&request) {
        return Err(invalid("request event does not exactly bind its payload"));
    }
    Ok(request)
}

/// Approve one request with Desktop's guarded signing identity.
pub fn attest_request_event(
    request_event: &Event,
    bridge_pubkey: &str,
    keys: &Keys,
    context: &DesktopEnrolmentContext,
    now: u64,
) -> Result<Event, SdkError> {
    let request = parse_request_event(request_event, bridge_pubkey, now)?;
    let signer = keys.public_key().to_hex();
    if signer != request.identity_pubkey
        || signer != context.identity_pubkey
        || signer != context.projected_identity_pubkey
        || request.channel_id != context.channel_id
        || request.user_id != context.user_id
        || request.user_name != context.user_name
    {
        return Err(invalid(
            "request is foreign to the signed Desktop identity or COS context",
        ));
    }
    let assistant = parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?;
    let conditions = format!("created_at<{}", request.expires_at);
    let auth_json = nip_oa::compute_auth_tag(keys, &assistant, &conditions)?;
    let payload = EnrolmentAttestation {
        schema: ATTESTATION_SCHEMA.into(),
        request: request.clone(),
        request_event_id: request_event.id.to_hex(),
        bridge_pubkey: bridge_pubkey.into(),
        attested_at: now,
        nip_oa_auth_tag: serde_json::from_str(&auth_json)
            .map_err(|error| invalid(format!("invalid NIP-OA tag: {error}")))?,
    };
    let request_event_id = request_event.id.to_hex();
    let tags = attestation_tags(&request, bridge_pubkey, &request_event_id)
        .into_iter()
        .map(|tag| Tag::parse(tag).map_err(|error| invalid(error.to_string())))
        .collect::<Result<Vec<_>, _>>()?;
    EventBuilder::new(
        Kind::Custom(ATTESTATION_KIND),
        serde_json::to_string(&payload).map_err(|error| invalid(error.to_string()))?,
    )
    .tags(tags)
    .custom_created_at(Timestamp::from(now))
    .sign_with_keys(keys)
    .map_err(|error| invalid(format!("attestation signing failed: {error}")))
}

/// Verify the complete request and Desktop approval pair.
pub fn verify_attestation_event(
    request_event: &Event,
    attestation_event: &Event,
    bridge_pubkey: &str,
    now: u64,
) -> Result<EnrolmentAttestation, SdkError> {
    let request = parse_request_event(request_event, bridge_pubkey, now)?;
    attestation_event.verify().map_err(|error| {
        invalid(format!(
            "attestation signature verification failed: {error}"
        ))
    })?;
    if attestation_event.kind != Kind::Custom(ATTESTATION_KIND)
        || attestation_event.pubkey.to_hex() != request.identity_pubkey
        || attestation_event.created_at.as_secs() < request.issued_at
        || attestation_event.created_at.as_secs() >= request.expires_at
        || attestation_event.created_at.as_secs() > now
    {
        return Err(invalid(
            "attestation author or timestamp does not match the request",
        ));
    }
    let payload: EnrolmentAttestation = serde_json::from_str(&attestation_event.content)
        .map_err(|error| invalid(format!("invalid enrolment attestation: {error}")))?;
    if payload.schema != ATTESTATION_SCHEMA
        || payload.request != request
        || payload.request_event_id != request_event.id.to_hex()
        || payload.bridge_pubkey != bridge_pubkey
        || payload.attested_at != attestation_event.created_at.as_secs()
    {
        return Err(invalid(
            "attestation payload does not exactly bind the request",
        ));
    }
    let actual_tags = attestation_event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    if actual_tags != attestation_tags(&request, bridge_pubkey, &request_event.id.to_hex()) {
        return Err(invalid(
            "attestation event does not exactly bind its payload",
        ));
    }
    let auth_json = serde_json::to_string(&payload.nip_oa_auth_tag)
        .map_err(|error| invalid(error.to_string()))?;
    let owner = nip_oa::verify_auth_tag(
        &auth_json,
        &parse_pubkey(&request.assistant_pubkey, "assistant_pubkey")?,
    )?;
    if owner.to_hex() != request.identity_pubkey
        || payload.nip_oa_auth_tag[2] != format!("created_at<{}", request.expires_at)
    {
        return Err(invalid("NIP-OA approval does not bind the user and expiry"));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_900_000_100;

    fn request(user: &Keys, assistant: &Keys, user_key: &str) -> EnrolmentRequest {
        EnrolmentRequest {
            schema: REQUEST_SCHEMA.into(),
            request_id: Uuid::new_v4().to_string(),
            challenge: "ab".repeat(32),
            issued_at: NOW - 10,
            expires_at: NOW + 300,
            user_key: user_key.into(),
            user_id: "42".into(),
            user_name: "Test User".into(),
            identity_pubkey: user.public_key().to_hex(),
            channel_id: Uuid::new_v4().to_string(),
            assistant_instance: format!("mac-assistant-{user_key}"),
            assistant_name: ASSISTANT_NAME.into(),
            assistant_pubkey: assistant.public_key().to_hex(),
        }
    }

    #[test]
    fn round_trip_rejects_foreign_replay() {
        let bridge = Keys::generate();
        let user = Keys::generate();
        let assistant = Keys::generate();
        let enrolment = request(&user, &assistant, "test-user");
        let event = build_request_event(&enrolment, &bridge, NOW).unwrap();
        let context = DesktopEnrolmentContext {
            identity_pubkey: enrolment.identity_pubkey.clone(),
            projected_identity_pubkey: enrolment.identity_pubkey.clone(),
            channel_id: enrolment.channel_id.clone(),
            user_id: enrolment.user_id.clone(),
            user_name: enrolment.user_name.clone(),
        };
        let attestation =
            attest_request_event(&event, &bridge.public_key().to_hex(), &user, &context, NOW)
                .unwrap();
        verify_attestation_event(&event, &attestation, &bridge.public_key().to_hex(), NOW).unwrap();
        let foreign =
            build_request_event(&request(&user, &assistant, "other-user"), &bridge, NOW).unwrap();
        assert!(verify_attestation_event(
            &foreign,
            &attestation,
            &bridge.public_key().to_hex(),
            NOW
        )
        .is_err());
    }

    #[test]
    fn rejects_stale_and_shared_instance() {
        let user = Keys::generate();
        let assistant = Keys::generate();
        let mut value = request(&user, &assistant, "test-user");
        value.expires_at = NOW;
        assert!(validate_request(&value, NOW).is_err());
        value = request(&user, &assistant, "test-user");
        value.assistant_instance = "mac-assistant".into();
        assert!(validate_request(&value, NOW).is_err());
    }
}
