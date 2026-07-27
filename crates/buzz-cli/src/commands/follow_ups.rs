//! Typed COS meeting follow-up CLI surface.
//!
//! Estate bridge code uses these commands instead of constructing raw Nostr
//! events, keeping signing, NIP-98 authentication and contract validation in
//! the existing Buzz client.

use std::collections::{HashMap, HashSet};

use buzz_core::cos_follow_up::{
    build_command_event, build_item_event, build_item_remove_event, build_receipt_event,
    parse_event, Action, CommandContent, FollowUpEvent, ItemContent, Outcome, ReceiptContent,
    SCHEMA,
};
use buzz_core::kind::{
    KIND_COS_FOLLOW_UP_COMMAND, KIND_COS_FOLLOW_UP_ITEM, KIND_COS_FOLLOW_UP_RECEIPT,
};
use nostr::{Event, PublicKey};
use serde_json::{json, Value};

use crate::client::BuzzClient;
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, validate_hex64};
use crate::{FollowUpActionArg, FollowUpOutcomeArg, FollowUpsCmd, OutputFormat};

const CLI_SCHEMA: &str = "mac-workspace/cos-follow-up-cli/v1";
const COMMAND_QUERY_LIMIT: usize = 500;
const REPLAY_QUERY_LIMIT: usize = 500;

fn contract_error(error: impl std::fmt::Display) -> CliError {
    CliError::Usage(error.to_string())
}

fn parse_action(action: FollowUpActionArg) -> Action {
    match action {
        FollowUpActionArg::Answer => Action::Answer,
        FollowUpActionArg::Confirm => Action::Confirm,
        FollowUpActionArg::Reject => Action::Reject,
        FollowUpActionArg::ReadyToCheck => Action::ReadyToCheck,
        FollowUpActionArg::ReassignConfirmer => Action::ReassignConfirmer,
    }
}

fn parse_outcome(outcome: FollowUpOutcomeArg) -> Outcome {
    match outcome {
        FollowUpOutcomeArg::Accepted => Outcome::Accepted,
        FollowUpOutcomeArg::Rejected => Outcome::Rejected,
        FollowUpOutcomeArg::Conflict => Outcome::Conflict,
        FollowUpOutcomeArg::Failed => Outcome::Failed,
    }
}

fn stable_write_output(
    event: &Event,
    kind: u32,
    item_id: &str,
    version: u64,
    replayed: bool,
) -> Value {
    json!({
        "schema": CLI_SCHEMA,
        "accepted": true,
        "event_id": event.id.to_hex(),
        "kind": kind,
        "item_id": item_id,
        "version": version,
        "replayed": replayed,
    })
}

fn parse_cursor(raw: &str) -> Result<(u64, String), CliError> {
    let (created_at, id) = raw.split_once(':').ok_or_else(|| {
        CliError::Usage("--cursor must be `<created_at>:<64hex-event-id>`".into())
    })?;
    let created_at = created_at
        .parse::<u64>()
        .map_err(|_| CliError::Usage("--cursor created_at must be unix seconds".into()))?;
    validate_hex64(id)?;
    if id != id.to_ascii_lowercase() {
        return Err(CliError::Usage(
            "--cursor event id must be lowercase hex".into(),
        ));
    }
    Ok((created_at, id.to_string()))
}

fn tag_key(tag: &Value) -> Option<&str> {
    tag.as_array()?.first()?.as_str()
}

fn contract_tags(tags: &Value) -> Value {
    let allowed = ["h", "item", "action", "expected-version", "e"];
    Value::Array(
        tags.as_array()
            .into_iter()
            .flatten()
            .filter(|tag| tag_key(tag).is_some_and(|name| allowed.contains(&name)))
            .cloned()
            .collect(),
    )
}

fn command_output(event: &Value, format: &OutputFormat) -> Result<Value, CliError> {
    let parsed_event: Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("invalid relay command event: {error}")))?;
    if !matches!(
        parse_event(&parsed_event).map_err(contract_error)?,
        FollowUpEvent::Command(_)
    ) {
        return Err(CliError::Other(
            "relay returned a non-command follow-up event".into(),
        ));
    }
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .ok_or_else(|| CliError::Other("follow-up command content is not JSON".into()))?;
    let tags = event.get("tags").cloned().unwrap_or_else(|| json!([]));
    Ok(json!({
        "id": parsed_event.id.to_hex(),
        "author_pubkey": parsed_event.pubkey.to_hex(),
        "created_at": parsed_event.created_at.as_secs(),
        "kind": KIND_COS_FOLLOW_UP_COMMAND,
        "tags": match format {
            OutputFormat::Json => tags,
            OutputFormat::Compact => contract_tags(&tags),
        },
        "content": content,
    }))
}

fn forward_command_page(
    mut events: Vec<Value>,
    cursor: Option<(u64, &str)>,
    limit: usize,
) -> Vec<Value> {
    events.retain(|event| {
        let Some((cursor_created_at, cursor_id)) = cursor else {
            return true;
        };
        let Some(created_at) = event.get("created_at").and_then(Value::as_u64) else {
            return false;
        };
        let Some(id) = event.get("id").and_then(Value::as_str) else {
            return false;
        };
        created_at > cursor_created_at || (created_at == cursor_created_at && id > cursor_id)
    });
    events.sort_by(|left, right| {
        left.get("created_at")
            .and_then(Value::as_u64)
            .cmp(&right.get("created_at").and_then(Value::as_u64))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    events.truncate(limit);
    events
}

async fn cmd_commands(
    client: &BuzzClient,
    channel: &str,
    since: Option<u64>,
    cursor: Option<&str>,
    limit: u32,
    format: &OutputFormat,
) -> Result<(), CliError> {
    let channel = parse_uuid(channel)?;
    if !(1..=500).contains(&limit) {
        return Err(CliError::Usage("--limit must be between 1 and 500".into()));
    }
    let parsed_cursor = cursor.map(parse_cursor).transpose()?;
    let effective_since = match (since, parsed_cursor.as_ref()) {
        (Some(since), Some((cursor_created_at, _))) => Some(since.max(*cursor_created_at)),
        (Some(since), None) => Some(since),
        (None, Some((cursor_created_at, _))) => Some(*cursor_created_at),
        (None, None) => None,
    };
    let mut filter = json!({
        "kinds": [KIND_COS_FOLLOW_UP_COMMAND],
        "#h": [channel.to_string()],
        "limit": COMMAND_QUERY_LIMIT,
    });
    if let Some(since) = effective_since {
        filter["since"] = json!(since);
    }
    let raw = client.query(&filter).await?;
    let raw_events: Vec<Value> = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("invalid relay query response: {error}")))?;
    if raw_events.len() >= COMMAND_QUERY_LIMIT {
        return Err(CliError::Other(format!(
            "follow-up command query reached the {COMMAND_QUERY_LIMIT}-event safety limit; refusing to advance the checkpoint"
        )));
    }
    let events = raw_events
        .iter()
        .map(|event| command_output(event, format))
        .collect::<Result<Vec<_>, _>>()?;
    let events = forward_command_page(
        events,
        parsed_cursor
            .as_ref()
            .map(|(created_at, id)| (*created_at, id.as_str())),
        limit as usize,
    );
    let next_cursor = events
        .last()
        .and_then(|last| {
            Some(format!(
                "{}:{}",
                last.get("created_at")?.as_u64()?,
                last.get("id")?.as_str()?
            ))
        })
        .or_else(|| cursor.map(str::to_string));
    println!(
        "{}",
        json!({
            "schema": CLI_SCHEMA,
            "events": events,
            "next_cursor": next_cursor,
        })
    );
    Ok(())
}

fn metadata_is_private(event: &Value) -> bool {
    event
        .get("tags")
        .and_then(Value::as_array)
        .is_some_and(|tags| {
            tags.iter().any(|tag| {
                let Some(parts) = tag.as_array() else {
                    return false;
                };
                matches!(
                    (
                        parts.first().and_then(Value::as_str),
                        parts.get(1).and_then(Value::as_str)
                    ),
                    (Some("private"), _) | (Some("visibility"), Some("private"))
                )
            })
        })
}

fn member_roles(event: Option<&Value>) -> HashMap<String, String> {
    let mut roles = HashMap::new();
    for tag in event
        .and_then(|event| event.get("tags"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(parts) = tag.as_array() else {
            continue;
        };
        if parts.first().and_then(Value::as_str) != Some("p") {
            continue;
        }
        let Some(pubkey) = parts.get(1).and_then(Value::as_str) else {
            continue;
        };
        let role = parts
            .get(3)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or("member");
        roles.insert(pubkey.to_ascii_lowercase(), role.to_string());
    }
    roles
}

fn validate_follow_up_channel_roles(
    roles: &HashMap<String, String>,
    bridge: &str,
    assignee: &str,
) -> Result<bool, CliError> {
    if bridge == assignee {
        return Err(CliError::Usage(
            "follow-up assignee must be distinct from the bridge owner".into(),
        ));
    }
    if roles.get(bridge).map(String::as_str) != Some("owner") {
        return Err(CliError::Auth(
            "follow-up channel exists but current bridge signer is not its owner".into(),
        ));
    }
    let allowed: HashSet<&str> = [bridge, assignee].into_iter().collect();
    let unexpected: Vec<&str> = roles
        .keys()
        .map(String::as_str)
        .filter(|pubkey| !allowed.contains(pubkey))
        .collect();
    if !unexpected.is_empty() {
        return Err(CliError::Auth(format!(
            "follow-up channel contains unexpected members: {}",
            unexpected.join(",")
        )));
    }
    if let Some(role) = roles.get(assignee) {
        if role != "member" {
            return Err(CliError::Auth(format!(
                "follow-up assignee has unexpected channel role {role:?}"
            )));
        }
        Ok(false)
    } else {
        Ok(true)
    }
}

fn replayable_item(
    events: Vec<Event>,
    owner: PublicKey,
    channel_id: uuid::Uuid,
    assignee: PublicKey,
    content: &ItemContent,
) -> Option<Event> {
    let latest = events
        .into_iter()
        .filter(|event| {
            event.pubkey == owner
                && matches!(
                    parse_event(event),
                    Ok(FollowUpEvent::Item(item))
                        if item.channel_id == channel_id
                            && item.assignee == assignee
                            && item.item_id == content.id
                )
        })
        .max_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        })?;
    matches!(
        parse_event(&latest),
        Ok(FollowUpEvent::Item(item)) if item.content == *content
    )
    .then_some(latest)
}

fn replayable_item_removal(
    events: Vec<Event>,
    owner: PublicKey,
    channel_id: uuid::Uuid,
    item_id: &str,
    target_event_id: &str,
) -> Option<Event> {
    events.into_iter().find(|event| {
        if event.pubkey != owner {
            return false;
        }
        matches!(
            parse_event(event),
            Ok(FollowUpEvent::Remove(removal))
                if removal.channel_id == channel_id
                    && removal.item_id == item_id
                    && removal.current_item_event_id == target_event_id
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn replayable_receipt(
    events: Vec<Event>,
    owner: PublicKey,
    channel_id: uuid::Uuid,
    command_event_id: &str,
    item_id: &str,
    outcome: Outcome,
    version: u64,
    content: &ReceiptContent,
) -> Option<Event> {
    events.into_iter().find(|event| {
        if event.pubkey != owner {
            return false;
        }
        matches!(
            parse_event(event),
            Ok(FollowUpEvent::Receipt(receipt))
                if receipt.channel_id == channel_id
                    && receipt.command_event_id == command_event_id
                    && receipt.item_id == item_id
                    && receipt.outcome == outcome
                    && receipt.authoritative_version == version
                    && receipt.content == *content
        )
    })
}

fn receipt_replay_filter(
    owner: PublicKey,
    channel_id: uuid::Uuid,
    command_event_id: &str,
) -> Value {
    // NIP-01 relay filters can only address single-letter tags. Match the
    // standard h/e tags here and validate every custom tag plus content
    // locally in replayable_receipt.
    json!({
        "kinds": [KIND_COS_FOLLOW_UP_RECEIPT],
        "authors": [owner.to_hex()],
        "#h": [channel_id.to_string()],
        "#e": [command_event_id],
        "limit": REPLAY_QUERY_LIMIT,
    })
}

fn decode_replay_candidates(raw: &str, label: &str) -> Result<Vec<Event>, CliError> {
    serde_json::from_str(raw)
        .map_err(|error| CliError::Other(format!("invalid {label} query response: {error}")))
}

fn decode_bounded_replay_candidates(raw: &str, label: &str) -> Result<Vec<Event>, CliError> {
    let events = decode_replay_candidates(raw, label)?;
    if events.len() >= REPLAY_QUERY_LIMIT {
        return Err(CliError::Other(format!(
            "{label} query reached the {REPLAY_QUERY_LIMIT}-event safety limit; refusing to publish a potentially duplicate event"
        )));
    }
    Ok(events)
}

fn channel_verify_output(channel_id: uuid::Uuid, assignee: &str, member_present: bool) -> Value {
    json!({
        "schema": CLI_SCHEMA,
        "channel_id": channel_id,
        "assignee": assignee,
        "owner_verified": true,
        "member_present": member_present,
        "status": "ready",
    })
}

fn contract_info_output() -> Value {
    json!({
        "schema": SCHEMA,
        "contract_version": 1,
        "cli_schema": CLI_SCHEMA,
        "status": "ready",
    })
}

/// Print the local, non-mutating follow-up contract descriptor.
pub fn print_contract_info() {
    println!("{}", contract_info_output());
}

async fn cmd_channel_ensure(
    client: &BuzzClient,
    channel: &str,
    assignee: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    validate_hex64(assignee)?;
    let assignee = assignee.to_ascii_lowercase();
    let bridge = client.keys().public_key().to_hex();

    let metadata_raw = client
        .query(&json!({
            "kinds": [39000],
            "#d": [channel_id.to_string()],
            "limit": 1,
        }))
        .await?;
    let metadata: Vec<Value> = serde_json::from_str(&metadata_raw)
        .map_err(|error| CliError::Other(format!("invalid channel metadata response: {error}")))?;

    let created = metadata.is_empty();
    if let Some(existing) = metadata.first() {
        if !metadata_is_private(existing) {
            return Err(CliError::Usage(format!(
                "channel {channel_id} exists but is not private"
            )));
        }
    } else {
        let name = format!("cos-follow-up-{}", &channel_id.to_string()[..8]);
        let builder = buzz_sdk::build_create_channel(
            channel_id,
            &name,
            Some(buzz_sdk::Visibility::Private),
            Some(buzz_sdk::ChannelKind::Stream),
            Some("Private Contractor OS follow-up actions"),
            None,
        )
        .map_err(contract_error)?;
        let event = client.sign_event(builder)?;
        client.submit_event(event).await?;
    }

    let mut roles = if created {
        HashMap::from([(bridge.clone(), "owner".to_string())])
    } else {
        let members_raw = client
            .query(&json!({
                "kinds": [39002],
                "#d": [channel_id.to_string()],
                "limit": 1,
            }))
            .await?;
        let members: Vec<Value> = serde_json::from_str(&members_raw).map_err(|error| {
            CliError::Other(format!("invalid channel membership response: {error}"))
        })?;
        member_roles(members.first())
    };

    let member_added = validate_follow_up_channel_roles(&roles, &bridge, &assignee)?;
    if member_added {
        let builder =
            buzz_sdk::build_add_member(channel_id, &assignee, Some(buzz_sdk::MemberRole::Member))
                .map_err(contract_error)?;
        let event = client.sign_event(builder)?;
        client.submit_event(event).await?;
        roles.insert(assignee.clone(), "member".into());
    }

    println!(
        "{}",
        json!({
            "schema": CLI_SCHEMA,
            "channel_id": channel_id,
            "assignee": assignee,
            "visibility": "private",
            "created": created,
            "member_added": member_added,
            "status": "ready",
        })
    );
    Ok(())
}

async fn cmd_channel_verify(
    client: &BuzzClient,
    channel: &str,
    assignee: &str,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    validate_hex64(assignee)?;
    let assignee = assignee.to_ascii_lowercase();
    let bridge = client.keys().public_key().to_hex();

    let metadata_raw = client
        .query(&json!({
            "kinds": [39000],
            "#d": [channel_id.to_string()],
            "limit": 1,
        }))
        .await?;
    let metadata: Vec<Value> = serde_json::from_str(&metadata_raw)
        .map_err(|error| CliError::Other(format!("invalid channel metadata response: {error}")))?;
    let existing = metadata
        .first()
        .ok_or_else(|| CliError::Other(format!("follow-up channel {channel_id} does not exist")))?;
    if !metadata_is_private(existing) {
        return Err(CliError::Usage(format!(
            "channel {channel_id} exists but is not private"
        )));
    }

    let members_raw = client
        .query(&json!({
            "kinds": [39002],
            "#d": [channel_id.to_string()],
            "limit": 1,
        }))
        .await?;
    let members: Vec<Value> = serde_json::from_str(&members_raw).map_err(|error| {
        CliError::Other(format!("invalid channel membership response: {error}"))
    })?;
    let roles = member_roles(members.first());
    let member_missing = validate_follow_up_channel_roles(&roles, &bridge, &assignee)?;

    println!(
        "{}",
        channel_verify_output(channel_id, &assignee, !member_missing)
    );
    Ok(())
}

async fn cmd_item_upsert(
    client: &BuzzClient,
    channel: &str,
    assignee: &str,
    content: &str,
) -> Result<(), CliError> {
    let channel = parse_uuid(channel)?;
    validate_hex64(assignee)?;
    let assignee = PublicKey::from_hex(assignee)
        .map_err(|error| CliError::Usage(format!("invalid assignee pubkey: {error}")))?;
    let raw = read_or_stdin(content)?;
    let content: ItemContent = serde_json::from_str(&raw)
        .map_err(|error| CliError::Usage(format!("invalid item JSON: {error}")))?;
    let builder = build_item_event(channel, assignee, &content).map_err(contract_error)?;
    let owner = client.keys().public_key();
    let existing_raw = client
        .query(&json!({
            "kinds": [KIND_COS_FOLLOW_UP_ITEM],
            "authors": [owner.to_hex()],
            "#h": [channel.to_string()],
            "#d": [content.id],
            "#p": [assignee.to_hex()],
            "limit": 20,
        }))
        .await?;
    if let Some(existing) = replayable_item(
        decode_replay_candidates(&existing_raw, "follow-up item")?,
        owner,
        channel,
        assignee,
        &content,
    ) {
        println!(
            "{}",
            stable_write_output(
                &existing,
                KIND_COS_FOLLOW_UP_ITEM,
                &content.id,
                content.version,
                true,
            )
        );
        return Ok(());
    }
    let event = client.sign_event(builder)?;
    client.submit_event(event.clone()).await?;
    println!(
        "{}",
        stable_write_output(
            &event,
            KIND_COS_FOLLOW_UP_ITEM,
            &content.id,
            content.version,
            false,
        )
    );
    Ok(())
}

async fn cmd_item_remove(
    client: &BuzzClient,
    channel: &str,
    item: &str,
    target_event: &str,
) -> Result<(), CliError> {
    let channel = parse_uuid(channel)?;
    validate_hex64(target_event)?;
    let builder = build_item_remove_event(channel, item, target_event).map_err(contract_error)?;
    let owner = client.keys().public_key();
    let existing_raw = client
        .query(&json!({
            "kinds": [5],
            "authors": [owner.to_hex()],
            "#h": [channel.to_string()],
            "#e": [target_event],
            "limit": 20,
        }))
        .await?;
    if let Some(existing) = replayable_item_removal(
        decode_replay_candidates(&existing_raw, "follow-up item removal")?,
        owner,
        channel,
        item,
        target_event,
    ) {
        println!(
            "{}",
            json!({
                "schema": CLI_SCHEMA,
                "accepted": true,
                "event_id": existing.id.to_hex(),
                "kind": 5,
                "item_id": item,
                "version": Value::Null,
                "target_event_id": target_event,
                "replayed": true,
            })
        );
        return Ok(());
    }
    let event = client.sign_event(builder)?;
    client.submit_event(event.clone()).await?;
    println!(
        "{}",
        json!({
            "schema": CLI_SCHEMA,
            "accepted": true,
            "event_id": event.id.to_hex(),
            "kind": 5,
            "item_id": item,
            "version": Value::Null,
            "target_event_id": target_event,
            "replayed": false,
        })
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn cmd_receipt(
    client: &BuzzClient,
    channel: &str,
    command: &str,
    item: &str,
    outcome: FollowUpOutcomeArg,
    version: u64,
    message: Option<String>,
    code: Option<String>,
    retryable: bool,
) -> Result<(), CliError> {
    let channel = parse_uuid(channel)?;
    validate_hex64(command)?;
    let outcome = parse_outcome(outcome);
    let content = ReceiptContent {
        schema: SCHEMA.into(),
        message,
        code,
        retryable,
    };
    let builder = build_receipt_event(channel, command, item, outcome, version, &content)
        .map_err(contract_error)?;
    let owner = client.keys().public_key();
    let existing_raw = client
        .query(&receipt_replay_filter(owner, channel, command))
        .await?;
    if let Some(existing) = replayable_receipt(
        decode_bounded_replay_candidates(&existing_raw, "follow-up receipt")?,
        owner,
        channel,
        command,
        item,
        outcome,
        version,
        &content,
    ) {
        println!(
            "{}",
            stable_write_output(&existing, KIND_COS_FOLLOW_UP_RECEIPT, item, version, true,)
        );
        return Ok(());
    }
    let event = client.sign_event(builder)?;
    client.submit_event(event.clone()).await?;
    println!(
        "{}",
        stable_write_output(&event, KIND_COS_FOLLOW_UP_RECEIPT, item, version, false,)
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn cmd_command(
    client: &BuzzClient,
    channel: &str,
    item: &str,
    action: FollowUpActionArg,
    expected_version: u64,
    current_item_event: &str,
    answer: Option<String>,
    comment: Option<String>,
    reason: Option<String>,
    new_confirmer_id: Option<String>,
) -> Result<(), CliError> {
    let channel = parse_uuid(channel)?;
    validate_hex64(current_item_event)?;
    let new_confirmer_id = new_confirmer_id
        .map(|raw| {
            serde_json::from_str::<Value>(&raw).map_err(|error| {
                CliError::Usage(format!("--new-confirmer-id must be a JSON scalar: {error}"))
            })
        })
        .transpose()?;
    let content = CommandContent {
        schema: SCHEMA.into(),
        answer,
        comment,
        reason,
        new_confirmer_id,
    };
    let action = parse_action(action);
    let builder = build_command_event(
        channel,
        item,
        action,
        expected_version,
        current_item_event,
        &content,
    )
    .map_err(contract_error)?;
    let event = client.sign_event(builder)?;
    client.submit_event(event.clone()).await?;
    println!(
        "{}",
        stable_write_output(
            &event,
            KIND_COS_FOLLOW_UP_COMMAND,
            item,
            expected_version,
            false,
        )
    );
    Ok(())
}

/// Dispatch one typed follow-up command.
pub async fn dispatch(
    command: FollowUpsCmd,
    client: &BuzzClient,
    format: &OutputFormat,
) -> Result<(), CliError> {
    match command {
        FollowUpsCmd::ContractInfo => {
            print_contract_info();
            Ok(())
        }
        FollowUpsCmd::ChannelEnsure { channel, assignee } => {
            cmd_channel_ensure(client, &channel, &assignee).await
        }
        FollowUpsCmd::ChannelVerify { channel, assignee } => {
            cmd_channel_verify(client, &channel, &assignee).await
        }
        FollowUpsCmd::Commands {
            channel,
            since,
            cursor,
            limit,
        } => cmd_commands(client, &channel, since, cursor.as_deref(), limit, format).await,
        FollowUpsCmd::ItemUpsert {
            channel,
            assignee,
            content,
        } => cmd_item_upsert(client, &channel, &assignee, &content).await,
        FollowUpsCmd::ItemRemove {
            channel,
            item,
            event,
        } => cmd_item_remove(client, &channel, &item, &event).await,
        FollowUpsCmd::Receipt {
            channel,
            command,
            item,
            outcome,
            version,
            message,
            code,
            retryable,
        } => {
            cmd_receipt(
                client, &channel, &command, &item, outcome, version, message, code, retryable,
            )
            .await
        }
        FollowUpsCmd::Command {
            channel,
            item,
            action,
            expected_version,
            current_item_event,
            answer,
            comment,
            reason,
            new_confirmer_id,
        } => {
            cmd_command(
                client,
                &channel,
                &item,
                action,
                expected_version,
                &current_item_event,
                answer,
                comment,
                reason,
                new_confirmer_id,
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::cos_follow_up::{
        DeepLinks, ItemState, ItemTimestamps, Person, QuestionEvidence,
    };
    use nostr::{Keys, Timestamp};

    fn item_content(version: u64) -> ItemContent {
        ItemContent {
            schema: SCHEMA.into(),
            id: "follow-up-17".into(),
            jira_key: Some("COS-683".into()),
            title: "Confirm the handover".into(),
            question_evidence: QuestionEvidence {
                question: "Is the evidence complete?".into(),
                evidence: Some("Meeting transcript line 14".into()),
            },
            state: ItemState::NeedsAnswer,
            assigned_person: Person {
                id: json!(17),
                name: "Marc".into(),
            },
            named_confirmer: None,
            version,
            permitted_actions: vec![Action::Answer],
            timestamps: ItemTimestamps {
                created_at: None,
                updated_at: None,
                published_at: None,
                last_activity_at: None,
                answered_at: None,
                ready_to_check_at: None,
                confirmed_at: None,
                rejected_at: None,
            },
            deep_links: DeepLinks {
                meeting_follow_up: "https://cos.example/follow-ups/17".into(),
                jira: Some("https://jira.example/browse/COS-683".into()),
                sources: vec![],
            },
        }
    }

    #[test]
    fn composite_cursor_is_strict_and_lowercase() {
        let id = "a".repeat(64);
        assert_eq!(parse_cursor(&format!("123:{id}")).unwrap(), (123, id));
        assert!(parse_cursor("123:nope").is_err());
        assert!(parse_cursor(&format!("123:{}", "A".repeat(64))).is_err());
    }

    #[test]
    fn forward_cursor_returns_newer_commands_oldest_first_and_excludes_older() {
        let old_id = "1".repeat(64);
        let cursor_id = "5".repeat(64);
        let same_second_after = "6".repeat(64);
        let later_id = "2".repeat(64);
        let events = vec![
            json!({"id": later_id, "created_at": 101}),
            json!({"id": old_id, "created_at": 99}),
            json!({"id": same_second_after, "created_at": 100}),
            json!({"id": cursor_id, "created_at": 100}),
        ];

        let page = forward_command_page(events, Some((100, &cursor_id)), 10);

        assert_eq!(
            page.iter()
                .map(|event| event["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![same_second_after.as_str(), later_id.as_str()]
        );
    }

    #[test]
    fn member_projection_preserves_roles() {
        let event = json!({
            "tags": [
                ["d", "channel"],
                ["p", "a".repeat(64), "", "owner"],
                ["p", "b".repeat(64), "", "member"]
            ]
        });
        let roles = member_roles(Some(&event));
        assert_eq!(
            roles.get(&"a".repeat(64)).map(String::as_str),
            Some("owner")
        );
        assert_eq!(
            roles.get(&"b".repeat(64)).map(String::as_str),
            Some("member")
        );
    }

    #[test]
    fn channel_roles_require_distinct_owner_and_plain_member_only() {
        let bridge = "a".repeat(64);
        let assignee = "b".repeat(64);
        let ready = HashMap::from([
            (bridge.clone(), "owner".to_string()),
            (assignee.clone(), "member".to_string()),
        ]);
        assert!(!validate_follow_up_channel_roles(&ready, &bridge, &assignee).unwrap());

        let missing = HashMap::from([(bridge.clone(), "owner".to_string())]);
        assert!(validate_follow_up_channel_roles(&missing, &bridge, &assignee).unwrap());

        let wrong_role = HashMap::from([
            (bridge.clone(), "owner".to_string()),
            (assignee.clone(), "admin".to_string()),
        ]);
        assert!(validate_follow_up_channel_roles(&wrong_role, &bridge, &assignee).is_err());
        assert!(validate_follow_up_channel_roles(&ready, &bridge, &bridge).is_err());
    }

    #[test]
    fn channel_verify_output_is_stable_for_present_and_absent_member() {
        let channel = uuid::Uuid::new_v4();
        let assignee = "b".repeat(64);
        assert_eq!(
            channel_verify_output(channel, &assignee, true),
            json!({
                "schema": "mac-workspace/cos-follow-up-cli/v1",
                "channel_id": channel,
                "assignee": assignee,
                "owner_verified": true,
                "member_present": true,
                "status": "ready",
            })
        );
        assert_eq!(
            channel_verify_output(channel, &"b".repeat(64), false)["member_present"],
            false
        );
    }

    #[test]
    fn private_metadata_accepts_nip29_or_ingest_shape() {
        assert!(metadata_is_private(&json!({"tags": [["private"]]})));
        assert!(metadata_is_private(
            &json!({"tags": [["visibility", "private"]]})
        ));
        assert!(!metadata_is_private(&json!({"tags": [["public"]]})));
    }

    #[test]
    fn item_upsert_retry_reuses_identical_owner_event_only() {
        let owner_keys = Keys::generate();
        let other_keys = Keys::generate();
        let assignee = Keys::generate().public_key();
        let channel = uuid::Uuid::new_v4();
        let content = item_content(7);
        let identical = build_item_event(channel, assignee, &content)
            .unwrap()
            .custom_created_at(Timestamp::from(101))
            .sign_with_keys(&owner_keys)
            .unwrap();
        let wrong_version = build_item_event(channel, assignee, &item_content(8))
            .unwrap()
            .custom_created_at(Timestamp::from(100))
            .sign_with_keys(&owner_keys)
            .unwrap();
        let foreign = build_item_event(channel, assignee, &content)
            .unwrap()
            .custom_created_at(Timestamp::from(102))
            .sign_with_keys(&other_keys)
            .unwrap();

        let replayed = replayable_item(
            vec![wrong_version, foreign, identical.clone()],
            owner_keys.public_key(),
            channel,
            assignee,
            &content,
        )
        .expect("an identical owner event should be replayed");

        assert_eq!(replayed.id, identical.id);

        let newer_different = build_item_event(channel, assignee, &item_content(8))
            .unwrap()
            .custom_created_at(Timestamp::from(102))
            .sign_with_keys(&owner_keys)
            .unwrap();
        assert!(
            replayable_item(
                vec![identical, newer_different],
                owner_keys.public_key(),
                channel,
                assignee,
                &content,
            )
            .is_none(),
            "an older equivalent event must not mask a newer projection"
        );
    }

    #[test]
    fn item_remove_retry_reuses_exact_owner_tombstone_only() {
        let owner_keys = Keys::generate();
        let other_keys = Keys::generate();
        let channel = uuid::Uuid::new_v4();
        let target = "a".repeat(64);
        let identical = build_item_remove_event(channel, "follow-up-17", &target)
            .unwrap()
            .sign_with_keys(&owner_keys)
            .unwrap();
        let foreign = build_item_remove_event(channel, "follow-up-17", &target)
            .unwrap()
            .sign_with_keys(&other_keys)
            .unwrap();
        let wrong_target = build_item_remove_event(channel, "follow-up-17", &"b".repeat(64))
            .unwrap()
            .sign_with_keys(&owner_keys)
            .unwrap();

        let replayed = replayable_item_removal(
            vec![wrong_target, foreign, identical.clone()],
            owner_keys.public_key(),
            channel,
            "follow-up-17",
            &target,
        )
        .expect("an exact owner tombstone should be replayed");

        assert_eq!(replayed.id, identical.id);
    }

    #[test]
    fn receipt_after_publish_crash_reuses_only_semantically_identical_owner_receipt() {
        let owner_keys = Keys::generate();
        let other_keys = Keys::generate();
        let channel = uuid::Uuid::new_v4();
        let command_id = "c".repeat(64);
        let content = ReceiptContent {
            schema: SCHEMA.into(),
            message: Some("Applied".into()),
            code: Some("accepted".into()),
            retryable: false,
        };
        let identical = build_receipt_event(
            channel,
            &command_id,
            "follow-up-17",
            Outcome::Accepted,
            8,
            &content,
        )
        .unwrap()
        .sign_with_keys(&owner_keys)
        .unwrap();
        let wrong_outcome = build_receipt_event(
            channel,
            &command_id,
            "follow-up-17",
            Outcome::Rejected,
            8,
            &content,
        )
        .unwrap()
        .sign_with_keys(&owner_keys)
        .unwrap();
        let foreign = build_receipt_event(
            channel,
            &command_id,
            "follow-up-17",
            Outcome::Accepted,
            8,
            &content,
        )
        .unwrap()
        .sign_with_keys(&other_keys)
        .unwrap();

        let replayed = replayable_receipt(
            vec![wrong_outcome, foreign, identical.clone()],
            owner_keys.public_key(),
            channel,
            &command_id,
            "follow-up-17",
            Outcome::Accepted,
            8,
            &content,
        )
        .expect("an identical owner receipt should be replayed");

        assert_eq!(replayed.id, identical.id);
    }

    #[test]
    fn receipt_replay_filter_uses_only_nip_01_queryable_tags() {
        let owner = Keys::generate().public_key();
        let channel = uuid::Uuid::new_v4();
        let command_id = "c".repeat(64);

        assert_eq!(
            receipt_replay_filter(owner, channel, &command_id),
            json!({
                "kinds": [KIND_COS_FOLLOW_UP_RECEIPT],
                "authors": [owner.to_hex()],
                "#h": [channel.to_string()],
                "#e": [command_id],
                "limit": REPLAY_QUERY_LIMIT,
            })
        );
    }

    #[test]
    fn contract_info_output_is_stable_and_contains_no_invented_revision() {
        assert_eq!(
            contract_info_output(),
            json!({
                "schema": "mac-workspace/cos-follow-up/v1",
                "contract_version": 1,
                "cli_schema": "mac-workspace/cos-follow-up-cli/v1",
                "status": "ready",
            })
        );
    }
}
