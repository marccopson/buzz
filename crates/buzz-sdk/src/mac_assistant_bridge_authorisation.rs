//! Offline owner authorisation for the MAC Workspace bridge.
//!
//! The bridge can issue this short-lived request without relay access.  An
//! owner then reviews it in Desktop and produces only a NIP-OA attestation;
//! private keys never leave Desktop and no arbitrary agent key is accepted.

use nostr::{Event, JsonUtil, Keys, PublicKey};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{nip_oa, SdkError};

/// Schema for bridge-authored recovery requests.
pub const REQUEST_SCHEMA: &str = "mac-workspace/bridge-owner-authorisation-request/v1";
/// Schema for a Desktop-produced bridge authorisation.
pub const RESULT_SCHEMA: &str = "mac-workspace/bridge-owner-authorisation/v1";
/// Custom kind used for an offline bridge recovery request event.
pub const REQUEST_KIND: u16 = 37_014;
/// Maximum lifetime accepted for an offline recovery request.
pub const MAX_LIFETIME_SECONDS: u64 = 600;
/// The tailnet relay to which this recovery flow is bound.
pub const RELAY_URL: &str = "wss://forge-do.tailfe35cd.ts.net";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Public, bridge-signed request for a scoped owner authorisation.
pub struct BridgeAuthorisationRequest {
    /// Contract schema.
    pub schema: String,
    /// One-time request identifier.
    pub request_id: String,
    /// 256-bit replay-resistant challenge.
    pub challenge: String,
    /// Unix issue time.
    pub issued_at: u64,
    /// Unix expiry time.
    pub expires_at: u64,
    /// Bound relay URL.
    pub relay_url: String,
    /// Public key of the bridge to authorise.
    pub bridge_pubkey: String,
    /// Fixed least-privilege bridge purpose.
    pub purpose: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Desktop-produced NIP-OA authorisation for the requested bridge.
pub struct BridgeAuthorisation {
    /// Contract schema.
    pub schema: String,
    /// The exact bridge-signed request being approved.
    pub request: BridgeAuthorisationRequest,
    /// Event identifier of the verified request.
    pub request_event_id: String,
    /// Public identity which approved the bridge.
    pub owner_pubkey: String,
    /// The verified NIP-OA credential for the bridge.
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

fn parse_pubkey(value: &str, label: &str) -> Result<PublicKey, SdkError> {
    if !is_lower_hex(value, 64) {
        return Err(invalid(format!(
            "{label} must be 64 lower-case hexadecimal characters"
        )));
    }
    PublicKey::from_hex(value).map_err(|error| invalid(format!("{label} is invalid: {error}")))
}

/// Validate the request's fixed purpose, relay target and short lifetime.
pub fn validate_request(request: &BridgeAuthorisationRequest, now: u64) -> Result<(), SdkError> {
    if request.schema != REQUEST_SCHEMA
        || request.relay_url != RELAY_URL
        || request.purpose != "cos-follow-up-bridge"
    {
        return Err(invalid("unsupported bridge authorisation request"));
    }
    let parsed =
        Uuid::parse_str(&request.request_id).map_err(|_| invalid("request_id must be a UUID"))?;
    if parsed.to_string() != request.request_id {
        return Err(invalid("request_id must be a canonical lower-case UUID"));
    }
    if !is_lower_hex(&request.challenge, 64) {
        return Err(invalid("challenge must be 256-bit lower-case hexadecimal"));
    }
    parse_pubkey(&request.bridge_pubkey, "bridge_pubkey")?;
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
            "bridge authorisation request is stale or outside the accepted lifetime",
        ));
    }
    Ok(())
}

/// Parse a request which was signed offline by the bridge key itself.
pub fn parse_request_event(
    request_event_json: &str,
    now: u64,
) -> Result<(Event, BridgeAuthorisationRequest), SdkError> {
    if request_event_json.len() > 128 * 1024 {
        return Err(invalid("bridge authorisation request is too large"));
    }
    let event = Event::from_json(request_event_json)
        .map_err(|error| invalid(format!("invalid bridge authorisation request: {error}")))?;
    event
        .verify()
        .map_err(|error| invalid(format!("request signature verification failed: {error}")))?;
    if event.kind.as_u16() != REQUEST_KIND {
        return Err(invalid("request has an unexpected event kind"));
    }
    let request: BridgeAuthorisationRequest = serde_json::from_str(&event.content)
        .map_err(|error| invalid(format!("invalid bridge authorisation payload: {error}")))?;
    validate_request(&request, now)?;
    if event.pubkey.to_hex() != request.bridge_pubkey
        || event.created_at.as_secs() != request.issued_at
    {
        return Err(invalid(
            "request does not bind the bridge identity and issue time",
        ));
    }
    Ok((event, request))
}

/// Create the NIP-OA tag after Desktop has verified the signed offline request.
pub fn authorise_request(
    request_event_json: &str,
    owner_keys: &Keys,
    now: u64,
) -> Result<BridgeAuthorisation, SdkError> {
    let (event, request) = parse_request_event(request_event_json, now)?;
    let bridge = parse_pubkey(&request.bridge_pubkey, "bridge_pubkey")?;
    let auth_json = nip_oa::compute_auth_tag(
        owner_keys,
        &bridge,
        &format!("created_at<{}", request.expires_at),
    )?;
    let nip_oa_auth_tag: [String; 4] = serde_json::from_str(&auth_json)
        .map_err(|error| invalid(format!("NIP-OA tag encoding failed: {error}")))?;
    Ok(BridgeAuthorisation {
        schema: RESULT_SCHEMA.into(),
        request,
        request_event_id: event.id.to_hex(),
        owner_pubkey: owner_keys.public_key().to_hex(),
        nip_oa_auth_tag,
    })
}

#[cfg(test)]
mod tests {
    use nostr::{EventBuilder, JsonUtil, Kind, Timestamp};

    use super::*;

    const NOW: u64 = 1_900_000_000;

    fn request(bridge: &Keys) -> BridgeAuthorisationRequest {
        BridgeAuthorisationRequest {
            schema: REQUEST_SCHEMA.into(),
            request_id: Uuid::new_v4().to_string(),
            challenge: "12".repeat(32),
            issued_at: NOW - 1,
            expires_at: NOW + 300,
            relay_url: RELAY_URL.into(),
            bridge_pubkey: bridge.public_key().to_hex(),
            purpose: "cos-follow-up-bridge".into(),
        }
    }

    fn request_event(request: &BridgeAuthorisationRequest, bridge: &Keys) -> String {
        EventBuilder::new(
            Kind::Custom(REQUEST_KIND),
            serde_json::to_string(request).unwrap(),
        )
        .custom_created_at(Timestamp::from(request.issued_at))
        .sign_with_keys(bridge)
        .unwrap()
        .as_json()
    }

    #[test]
    fn accepts_only_a_short_lived_bridge_signed_request() {
        let bridge = Keys::generate();
        let owner = Keys::generate();
        let request = request(&bridge);
        let result = authorise_request(&request_event(&request, &bridge), &owner, NOW).unwrap();

        assert_eq!(result.request, request);
        assert_eq!(result.owner_pubkey, owner.public_key().to_hex());
        assert_eq!(result.nip_oa_auth_tag[0], "auth");
        assert_eq!(result.nip_oa_auth_tag[1], owner.public_key().to_hex());
        assert_eq!(
            result.nip_oa_auth_tag[2],
            format!("created_at<{}", NOW + 300)
        );
        nip_oa::verify_auth_tag(
            &serde_json::to_string(&result.nip_oa_auth_tag).unwrap(),
            &bridge.public_key(),
        )
        .unwrap();
    }

    #[test]
    fn rejects_request_claiming_another_bridge_key() {
        let bridge = Keys::generate();
        let different_bridge = Keys::generate();
        let owner = Keys::generate();
        let mut request = request(&different_bridge);
        request.issued_at = NOW - 1;
        request.expires_at = NOW + 300;
        let error = authorise_request(&request_event(&request, &bridge), &owner, NOW).unwrap_err();
        assert!(error
            .to_string()
            .contains("does not bind the bridge identity"));
    }
}
