//! Local-only MAC Assistant activation verification.

use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::error::CliError;

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
