//! Local-only MAC Assistant activation verification.

use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};

use crate::client::BuzzClient;
use crate::error::CliError;
use crate::MacAssistantCmd;

const MAX_REQUEST_BYTES: u64 = 32 * 1024;
const MAX_ATTESTATION_BYTES: u64 = 128 * 1024;

fn read_bounded(path: &Path, maximum: u64, label: &str) -> Result<String, CliError> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| CliError::Usage(format!("{label} is unavailable")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > maximum {
        return Err(CliError::Usage(format!(
            "{label} is not a safe regular file"
        )));
    }
    let file =
        File::open(path).map_err(|_| CliError::Usage(format!("{label} cannot be opened")))?;
    let mut bytes = Vec::new();
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CliError::Usage(format!("{label} cannot be read")))?;
    if bytes.len() as u64 > maximum {
        return Err(CliError::Usage(format!("{label} is too large")));
    }
    String::from_utf8(bytes).map_err(|_| CliError::Usage(format!("{label} is not UTF-8")))
}

#[derive(Serialize)]
struct VerificationOutput {
    valid: bool,
    request_id: String,
    identity_pubkey: String,
    assistant_pubkey: String,
    channel_id: String,
    event_id: String,
    attested_at: u64,
    nip_oa_auth_tag: [String; 4],
}

/// Verify one offline Jake-only request/attestation pair without relay access.
pub fn cmd_verify_activation(
    request_path: &Path,
    attestation_path: &Path,
    now: Option<u64>,
) -> Result<(), CliError> {
    let request = read_bounded(request_path, MAX_REQUEST_BYTES, "activation request")?;
    let attestation = read_bounded(
        attestation_path,
        MAX_ATTESTATION_BYTES,
        "activation attestation",
    )?;
    let now = match now {
        Some(value) => value,
        None => SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CliError::Other("system clock precedes the Unix epoch".into()))?
            .as_secs(),
    };
    let verified =
        buzz_sdk::mac_assistant_activation::verify_attestation(&request, &attestation, now)
            .map_err(|error| CliError::Auth(format!("activation attestation rejected: {error}")))?;
    let output = VerificationOutput {
        valid: true,
        request_id: verified.request.request_id,
        identity_pubkey: verified.request.identity_pubkey,
        assistant_pubkey: verified.request.assistant_pubkey,
        channel_id: verified.request.channel_id,
        event_id: verified.event_id,
        attested_at: verified.attested_at,
        nip_oa_auth_tag: verified.nip_oa_auth_tag,
    };
    serde_json::to_writer(std::io::stdout().lock(), &output)
        .map_err(|error| CliError::Other(format!("verification output failed: {error}")))?;
    std::io::stdout()
        .lock()
        .write_all(b"\n")
        .map_err(|error| CliError::Other(format!("verification output failed: {error}")))?;
    Ok(())
}

fn unix_now(now: Option<u64>) -> Result<u64, CliError> {
    match now {
        Some(value) => Ok(value),
        None => SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CliError::Other("system clock precedes the Unix epoch".into()))
            .map(|value| value.as_secs()),
    }
}

async fn request_publish(
    client: &BuzzClient,
    input: &Path,
    now: Option<u64>,
) -> Result<(), CliError> {
    let raw = read_bounded(input, MAX_REQUEST_BYTES, "enrolment request")?;
    let request = serde_json::from_str(&raw)
        .map_err(|error| CliError::Usage(format!("invalid enrolment request: {error}")))?;
    let event = buzz_sdk::mac_assistant_enrolment::build_request_event(
        &request,
        client.keys(),
        unix_now(now)?,
    )
    .map_err(|error| CliError::Usage(error.to_string()))?;
    client.submit_event(event.clone()).await?;
    println!(
        "{}",
        json!({
            "schema": "mac-workspace/mac-assistant-enrolment-cli/v1",
            "accepted": true,
            "request_id": request.request_id,
            "event_id": event.id.to_hex(),
            "expires_at": request.expires_at,
        })
    );
    Ok(())
}

async fn attestation_collect(
    client: &BuzzClient,
    request_id: &str,
    identity: &str,
    channel: &str,
    now: Option<u64>,
) -> Result<(), CliError> {
    let now = unix_now(now)?;
    let bridge = client.keys().public_key().to_hex();
    let request_filter = json!({
        "kinds": [buzz_core::kind::KIND_MAC_ASSISTANT_ENROLMENT_REQUEST],
        "authors": [bridge],
        "#d": [request_id],
        "#h": [channel],
        "#p": [identity],
        "limit": 10,
    });
    let requests: Vec<Value> = serde_json::from_str(&client.query(&request_filter).await?)
        .map_err(|error| CliError::Other(format!("invalid request query response: {error}")))?;
    if requests.len() != 1 {
        return Err(CliError::Auth(
            "expected exactly one current bridge-authored enrolment request".into(),
        ));
    }
    let request_event: nostr::Event = serde_json::from_value(requests[0].clone())
        .map_err(|error| CliError::Other(format!("invalid request event: {error}")))?;
    let attestation_filter = json!({
        "kinds": [buzz_core::kind::KIND_MAC_ASSISTANT_ENROLMENT_ATTESTATION],
        "authors": [identity],
        "#h": [channel],
        "#p": [bridge],
        "#e": [request_event.id.to_hex()],
        "#request": [request_id],
        "limit": 10,
    });
    let attestations: Vec<Value> = serde_json::from_str(&client.query(&attestation_filter).await?)
        .map_err(|error| CliError::Other(format!("invalid attestation query response: {error}")))?;
    let mut verified = attestations
        .into_iter()
        .filter_map(|value| serde_json::from_value::<nostr::Event>(value).ok())
        .filter_map(|event| {
            buzz_sdk::mac_assistant_enrolment::verify_attestation_event(
                &request_event,
                &event,
                &bridge,
                now,
            )
            .ok()
            .map(|payload| (event, payload))
        })
        .collect::<Vec<_>>();
    verified.sort_by_key(|(event, _)| (event.created_at, event.id));
    verified.dedup_by_key(|(event, _)| event.id);
    if verified.len() != 1 {
        return Err(CliError::Auth(
            "expected exactly one valid, unreplayed Desktop approval".into(),
        ));
    }
    let (event, payload) = verified.remove(0);
    println!(
        "{}",
        json!({
            "schema": "mac-workspace/mac-assistant-enrolment-receipt/v1",
            "request": payload.request,
            "request_event_id": request_event.id.to_hex(),
            "attestation_event_id": event.id.to_hex(),
            "attested_at": payload.attested_at,
            "bridge_pubkey": bridge,
            "nip_oa_auth_tag": payload.nip_oa_auth_tag,
        })
    );
    Ok(())
}

pub async fn dispatch(command: MacAssistantCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        MacAssistantCmd::RequestPublish { input, now } => {
            request_publish(client, &input, now).await
        }
        MacAssistantCmd::AttestationCollect {
            request_id,
            identity,
            channel,
            now,
        } => attestation_collect(client, &request_id, &identity, &channel, now).await,
        MacAssistantCmd::VerifyActivation { .. } => {
            unreachable!("offline activation verification is handled before authentication")
        }
    }
}
