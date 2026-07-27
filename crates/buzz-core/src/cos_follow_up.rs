//! Signed COS meeting follow-up event contract.
//!
//! The bridge remains authoritative: item snapshots and receipts are
//! bridge-authored, while a person signs commands. Every event is scoped to a
//! private NIP-29 channel with an `h` tag. Clients render optimistic pending
//! state but only advance after a receipt and a refreshed item snapshot.

use std::collections::HashSet;

use nostr::{Event, EventBuilder, Kind, PublicKey, Tag};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::kind::{
    KIND_COS_FOLLOW_UP_COMMAND, KIND_COS_FOLLOW_UP_ITEM, KIND_COS_FOLLOW_UP_RECEIPT,
};

/// Content schema shared by item, command and receipt events.
pub const SCHEMA: &str = "mac-workspace/cos-follow-up/v1";

/// COS follow-up item state. These machine values are deliberately independent
/// of the friendlier labels rendered by clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItemState {
    /// The assignee needs to answer the question.
    #[serde(rename = "needs-answer")]
    NeedsAnswer,
    /// The named confirmer needs to check the proposed answer.
    #[serde(rename = "ready-to-check")]
    ReadyToCheck,
    /// The named confirmer accepted the item.
    #[serde(rename = "confirmed")]
    Confirmed,
}

/// An action advertised by the authoritative item projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Answer the outstanding question.
    Answer,
    /// Confirm the proposed answer.
    Confirm,
    /// Reject the proposed answer.
    Reject,
    /// Delivery-side transition that offers the answer for checking.
    ReadyToCheck,
    /// Admin-side replacement of the named confirmer.
    ReassignConfirmer,
}

impl Action {
    /// Canonical action tag value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Answer => "answer",
            Self::Confirm => "confirm",
            Self::Reject => "reject",
            Self::ReadyToCheck => "ready_to_check",
            Self::ReassignConfirmer => "reassign_confirmer",
        }
    }

    fn parse(value: &str) -> Result<Self, ContractError> {
        match value {
            "answer" => Ok(Self::Answer),
            "confirm" => Ok(Self::Confirm),
            "reject" => Ok(Self::Reject),
            "ready_to_check" => Ok(Self::ReadyToCheck),
            "reassign_confirmer" => Ok(Self::ReassignConfirmer),
            _ => Err(ContractError::Invalid(format!(
                "unsupported follow-up action {value:?}"
            ))),
        }
    }
}

/// Receipt result returned by the bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// The command was applied.
    Accepted,
    /// The command was valid but refused.
    Rejected,
    /// The submitted version was stale.
    Conflict,
    /// The bridge could not complete the command.
    Failed,
}

impl Outcome {
    /// Canonical outcome tag value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Conflict => "conflict",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self, ContractError> {
        match value {
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            "conflict" => Ok(Self::Conflict),
            "failed" => Ok(Self::Failed),
            _ => Err(ContractError::Invalid(format!(
                "unsupported follow-up outcome {value:?}"
            ))),
        }
    }
}

/// Person projection carried by an item snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Person {
    /// Stable COS person identifier. COS currently emits numeric ids; accepting
    /// a scalar also leaves room for opaque ids without lossy coercion.
    pub id: serde_json::Value,
    /// Human-readable name.
    pub name: String,
}

/// Question and supporting evidence shown to the person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestionEvidence {
    /// The direct question or prompt.
    pub question: String,
    /// Supporting evidence, when available.
    pub evidence: Option<String>,
}

/// Authoritative lifecycle timestamps emitted by COS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemTimestamps {
    /// Item creation timestamp.
    pub created_at: Option<String>,
    /// Last update timestamp.
    pub updated_at: Option<String>,
    /// Last bridge publication timestamp.
    pub published_at: Option<String>,
    /// Last business activity timestamp.
    pub last_activity_at: Option<String>,
    /// Answer timestamp.
    pub answered_at: Option<String>,
    /// Ready-for-check timestamp.
    pub ready_to_check_at: Option<String>,
    /// Confirmation timestamp.
    pub confirmed_at: Option<String>,
    /// Rejection timestamp.
    pub rejected_at: Option<String>,
}

/// Links back to the authoritative systems.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeepLinks {
    /// Absolute HTTPS Contractor OS follow-up detail URL.
    pub meeting_follow_up: String,
    /// Jira issue URL, when the item has a Jira key.
    pub jira: Option<String>,
    /// Imported source evidence links.
    #[serde(default)]
    pub sources: Vec<SourceLink>,
}

/// One imported source-evidence link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceLink {
    /// Short human-readable source label.
    pub label: String,
    /// Absolute source URL.
    pub url: String,
}

/// Content of kind 37010.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ItemContent {
    /// Schema discriminator.
    pub schema: String,
    /// Stable follow-up item id; also the event `d` tag.
    pub id: String,
    /// Related Jira key, when present.
    pub jira_key: Option<String>,
    /// Short item title.
    pub title: String,
    /// Prompt and evidence.
    pub question_evidence: QuestionEvidence,
    /// Authoritative machine state.
    pub state: ItemState,
    /// Person expected to answer.
    pub assigned_person: Person,
    /// Person expected to confirm, when named.
    pub named_confirmer: Option<Person>,
    /// Optimistic-concurrency version.
    pub version: u64,
    /// Actions permitted for the event's `p` assignee.
    pub permitted_actions: Vec<Action>,
    /// Authoritative lifecycle timestamps.
    pub timestamps: ItemTimestamps,
    /// Links to COS and Jira.
    pub deep_links: DeepLinks,
}

/// Content of kind 47010.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandContent {
    /// Schema discriminator.
    pub schema: String,
    /// Answer text for `answer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    /// Optional human comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Optional machine/human reason, chiefly for rejection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Replacement confirmer id for `reassign_confirmer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_confirmer_id: Option<serde_json::Value>,
}

/// Content of kind 47011.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptContent {
    /// Schema discriminator.
    pub schema: String,
    /// Optional human-readable detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Optional stable machine error/result code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Whether a failed command can be safely retried.
    #[serde(default)]
    pub retryable: bool,
}

/// Parsed kind 37010 event.
#[derive(Debug, Clone, PartialEq)]
pub struct ItemEvent {
    /// NIP-29 channel id.
    pub channel_id: Uuid,
    /// Stable item id.
    pub item_id: String,
    /// Assigned person's Nostr pubkey.
    pub assignee: PublicKey,
    /// Parsed item content.
    pub content: ItemContent,
}

/// Parsed kind 47010 event.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandEvent {
    /// NIP-29 channel id.
    pub channel_id: Uuid,
    /// Stable item id.
    pub item_id: String,
    /// Requested action.
    pub action: Action,
    /// Version the person saw.
    pub expected_version: u64,
    /// Exact item event the person acted on.
    pub current_item_event_id: String,
    /// Parsed command content.
    pub content: CommandContent,
}

/// Parsed kind 47011 event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptEvent {
    /// NIP-29 channel id.
    pub channel_id: Uuid,
    /// Command event id.
    pub command_event_id: String,
    /// Stable item id.
    pub item_id: String,
    /// Bridge outcome.
    pub outcome: Outcome,
    /// Authoritative version after bridge processing.
    pub authoritative_version: u64,
    /// Parsed receipt content.
    pub content: ReceiptContent,
}

/// Parsed scoped kind 5 item removal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRemoveEvent {
    /// NIP-29 channel id.
    pub channel_id: Uuid,
    /// Stable item id being removed from the queue.
    pub item_id: String,
    /// Exact current item event being tombstoned.
    pub current_item_event_id: String,
}

/// A parsed COS follow-up event.
#[derive(Debug, Clone, PartialEq)]
pub enum FollowUpEvent {
    /// Kind 37010.
    Item(Box<ItemEvent>),
    /// Kind 47010.
    Command(CommandEvent),
    /// Kind 47011.
    Receipt(ReceiptEvent),
    /// Scoped kind 5 tombstone.
    Remove(ItemRemoveEvent),
}

/// Contract validation failure.
#[derive(Debug, Error)]
pub enum ContractError {
    /// JSON content could not be decoded.
    #[error("invalid follow-up JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// An envelope or content invariant was violated.
    #[error("{0}")]
    Invalid(String),
}

fn tag_values(event: &Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.len() >= 2 && parts[0] == name).then(|| parts[1].clone())
        })
        .collect()
}

fn exactly_one_tag(event: &Event, name: &str) -> Result<String, ContractError> {
    let values = tag_values(event, name);
    if values.len() != 1 {
        return Err(ContractError::Invalid(format!(
            "follow-up event must contain exactly one {name} tag"
        )));
    }
    Ok(values[0].clone())
}

fn parse_channel(event: &Event) -> Result<Uuid, ContractError> {
    exactly_one_tag(event, "h")?
        .parse()
        .map_err(|_| ContractError::Invalid("follow-up h tag must be a channel UUID".into()))
}

fn validate_schema(schema: &str) -> Result<(), ContractError> {
    if schema != SCHEMA {
        return Err(ContractError::Invalid(format!(
            "unsupported follow-up schema {schema:?}"
        )));
    }
    Ok(())
}

fn valid_scalar(value: &serde_json::Value) -> bool {
    value.is_string() || value.is_number() || value.is_boolean()
}

fn validate_safe_link(value: &str, label: &str) -> Result<(), ContractError> {
    let parsed = url::Url::parse(value)
        .map_err(|_| ContractError::Invalid(format!("{label} must be an absolute URL")))?;
    let local_http = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "https" && !local_http {
        return Err(ContractError::Invalid(format!("{label} must use HTTPS")));
    }
    Ok(())
}

/// Validate item content independently of a signed event envelope.
pub fn validate_item_content(content: &ItemContent) -> Result<(), ContractError> {
    validate_schema(&content.schema)?;
    if content.id.trim().is_empty() {
        return Err(ContractError::Invalid(
            "follow-up item id cannot be empty".into(),
        ));
    }
    if content.title.trim().is_empty() {
        return Err(ContractError::Invalid(
            "follow-up item title cannot be empty".into(),
        ));
    }
    if content.question_evidence.question.trim().is_empty() {
        return Err(ContractError::Invalid(
            "follow-up question cannot be empty".into(),
        ));
    }
    if !valid_scalar(&content.assigned_person.id)
        || content.assigned_person.name.trim().is_empty()
        || content
            .named_confirmer
            .as_ref()
            .is_some_and(|person| !valid_scalar(&person.id) || person.name.trim().is_empty())
    {
        return Err(ContractError::Invalid(
            "follow-up person must have a scalar id and non-empty name".into(),
        ));
    }
    validate_safe_link(
        &content.deep_links.meeting_follow_up,
        "follow-up meeting link",
    )?;
    if let Some(jira) = &content.deep_links.jira {
        validate_safe_link(jira, "follow-up Jira link")?;
    }
    for source in &content.deep_links.sources {
        if source.label.trim().is_empty() {
            return Err(ContractError::Invalid(
                "follow-up source label cannot be empty".into(),
            ));
        }
        validate_safe_link(&source.url, "follow-up source link")?;
    }
    let mut actions = HashSet::new();
    if content
        .permitted_actions
        .iter()
        .any(|action| !actions.insert(*action))
    {
        return Err(ContractError::Invalid(
            "follow-up permitted_actions contains duplicates".into(),
        ));
    }
    Ok(())
}

fn validate_command_content(action: Action, content: &CommandContent) -> Result<(), ContractError> {
    validate_schema(&content.schema)?;
    if action == Action::Answer
        && content
            .answer
            .as_deref()
            .is_none_or(|answer| answer.trim().is_empty())
    {
        return Err(ContractError::Invalid(
            "answer command requires non-empty answer content".into(),
        ));
    }
    if action == Action::ReassignConfirmer
        && content
            .new_confirmer_id
            .as_ref()
            .is_none_or(|value| !valid_scalar(value))
    {
        return Err(ContractError::Invalid(
            "reassign_confirmer command requires scalar new_confirmer_id".into(),
        ));
    }
    Ok(())
}

fn validate_receipt_content(content: &ReceiptContent) -> Result<(), ContractError> {
    validate_schema(&content.schema)?;
    if content
        .code
        .as_ref()
        .is_some_and(|code| code.trim().is_empty())
    {
        return Err(ContractError::Invalid(
            "receipt code cannot be blank".into(),
        ));
    }
    if content
        .code
        .as_ref()
        .is_some_and(|code| code.len() > 128 || !code.is_ascii())
    {
        return Err(ContractError::Invalid(
            "receipt code must be at most 128 ASCII characters".into(),
        ));
    }
    Ok(())
}

/// Return whether an advertised action is valid for the current machine state.
///
/// Admin/delivery actions are deliberately accepted based on the authoritative
/// `permitted_actions` list; desktop/mobile only expose the three human actions.
pub fn action_is_permitted(item: &ItemContent, action: Action) -> bool {
    if !item.permitted_actions.contains(&action) {
        return false;
    }
    match action {
        Action::Answer => item.state == ItemState::NeedsAnswer,
        Action::Confirm | Action::Reject => item.state == ItemState::ReadyToCheck,
        Action::ReadyToCheck | Action::ReassignConfirmer => item.state != ItemState::Confirmed,
    }
}

/// Build an unsigned bridge-authored item snapshot.
pub fn build_item_event(
    channel_id: Uuid,
    assignee: PublicKey,
    content: &ItemContent,
) -> Result<EventBuilder, ContractError> {
    validate_item_content(content)?;
    let channel = channel_id.to_string();
    let assignee = assignee.to_hex();
    let body = serde_json::to_string(content)?;
    let tags = [
        Tag::parse(["h", channel.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["d", content.id.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["p", assignee.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
    ];
    Ok(EventBuilder::new(Kind::Custom(KIND_COS_FOLLOW_UP_ITEM as u16), body).tags(tags))
}

/// Build an unsigned user action command.
pub fn build_command_event(
    channel_id: Uuid,
    item_id: &str,
    action: Action,
    expected_version: u64,
    current_item_event_id: &str,
    content: &CommandContent,
) -> Result<EventBuilder, ContractError> {
    if item_id.trim().is_empty() {
        return Err(ContractError::Invalid(
            "command item id cannot be empty".into(),
        ));
    }
    validate_hex_id(current_item_event_id, "command e tag")?;
    validate_command_content(action, content)?;
    let channel = channel_id.to_string();
    let expected_version = expected_version.to_string();
    let body = serde_json::to_string(content)?;
    let tags = [
        Tag::parse(["h", channel.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["item", item_id]).map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["action", action.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["expected-version", expected_version.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["e", current_item_event_id])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
    ];
    Ok(EventBuilder::new(Kind::Custom(KIND_COS_FOLLOW_UP_COMMAND as u16), body).tags(tags))
}

/// Build an unsigned bridge receipt.
pub fn build_receipt_event(
    channel_id: Uuid,
    command_event_id: &str,
    item_id: &str,
    outcome: Outcome,
    authoritative_version: u64,
    content: &ReceiptContent,
) -> Result<EventBuilder, ContractError> {
    validate_hex_id(command_event_id, "receipt e tag")?;
    if item_id.trim().is_empty() {
        return Err(ContractError::Invalid(
            "receipt item id cannot be empty".into(),
        ));
    }
    validate_receipt_content(content)?;
    if content.retryable && outcome != Outcome::Failed {
        return Err(ContractError::Invalid(
            "retryable receipt must use failed outcome".into(),
        ));
    }
    let channel = channel_id.to_string();
    let version = authoritative_version.to_string();
    let body = serde_json::to_string(content)?;
    let tags = [
        Tag::parse(["h", channel.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["e", command_event_id])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["item", item_id]).map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["outcome", outcome.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["version", version.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
    ];
    Ok(EventBuilder::new(Kind::Custom(KIND_COS_FOLLOW_UP_RECEIPT as u16), body).tags(tags))
}

/// Build an unsigned scoped NIP-09 tombstone for an item that left the queue.
pub fn build_item_remove_event(
    channel_id: Uuid,
    item_id: &str,
    current_item_event_id: &str,
) -> Result<EventBuilder, ContractError> {
    if item_id.trim().is_empty() {
        return Err(ContractError::Invalid(
            "item removal item id cannot be empty".into(),
        ));
    }
    validate_hex_id(current_item_event_id, "item removal e tag")?;
    let channel = channel_id.to_string();
    let tags = [
        Tag::parse(["h", channel.as_str()])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["item", item_id]).map_err(|error| ContractError::Invalid(error.to_string()))?,
        Tag::parse(["e", current_item_event_id])
            .map_err(|error| ContractError::Invalid(error.to_string()))?,
    ];
    Ok(EventBuilder::new(Kind::Custom(5), "").tags(tags))
}

fn validate_hex_id(value: &str, label: &str) -> Result<(), ContractError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ContractError::Invalid(format!(
            "{label} must be lowercase 64-hex"
        )));
    }
    Ok(())
}

/// Parse and validate a signed follow-up event.
pub fn parse_event(event: &Event) -> Result<FollowUpEvent, ContractError> {
    event
        .verify()
        .map_err(|error| ContractError::Invalid(format!("invalid event signature: {error}")))?;
    let channel_id = parse_channel(event)?;
    match event.kind.as_u16() as u32 {
        KIND_COS_FOLLOW_UP_ITEM => {
            let item_id = exactly_one_tag(event, "d")?;
            let assignee_hex = exactly_one_tag(event, "p")?;
            validate_hex_id(&assignee_hex, "item p tag")?;
            let assignee = PublicKey::from_hex(&assignee_hex)
                .map_err(|_| ContractError::Invalid("item p tag is not a pubkey".into()))?;
            let content: ItemContent = serde_json::from_str(&event.content)?;
            validate_item_content(&content)?;
            if content.id != item_id {
                return Err(ContractError::Invalid(format!(
                    "item content id {:?} does not match d tag {:?}",
                    content.id, item_id
                )));
            }
            Ok(FollowUpEvent::Item(Box::new(ItemEvent {
                channel_id,
                item_id,
                assignee,
                content,
            })))
        }
        KIND_COS_FOLLOW_UP_COMMAND => {
            let item_id = exactly_one_tag(event, "item")?;
            let action = Action::parse(&exactly_one_tag(event, "action")?)?;
            let expected_version = exactly_one_tag(event, "expected-version")?
                .parse()
                .map_err(|_| {
                    ContractError::Invalid("expected-version tag must be a base-10 u64".into())
                })?;
            let current_item_event_id = exactly_one_tag(event, "e")?;
            validate_hex_id(&current_item_event_id, "command e tag")?;
            let content: CommandContent = serde_json::from_str(&event.content)?;
            validate_command_content(action, &content)?;
            Ok(FollowUpEvent::Command(CommandEvent {
                channel_id,
                item_id,
                action,
                expected_version,
                current_item_event_id,
                content,
            }))
        }
        KIND_COS_FOLLOW_UP_RECEIPT => {
            let command_event_id = exactly_one_tag(event, "e")?;
            validate_hex_id(&command_event_id, "receipt e tag")?;
            let item_id = exactly_one_tag(event, "item")?;
            let outcome = Outcome::parse(&exactly_one_tag(event, "outcome")?)?;
            let authoritative_version = exactly_one_tag(event, "version")?
                .parse()
                .map_err(|_| ContractError::Invalid("version tag must be a base-10 u64".into()))?;
            let content: ReceiptContent = serde_json::from_str(&event.content)?;
            validate_receipt_content(&content)?;
            if content.retryable && outcome != Outcome::Failed {
                return Err(ContractError::Invalid(
                    "retryable receipt must use failed outcome".into(),
                ));
            }
            Ok(FollowUpEvent::Receipt(ReceiptEvent {
                channel_id,
                command_event_id,
                item_id,
                outcome,
                authoritative_version,
                content,
            }))
        }
        5 if !tag_values(event, "item").is_empty() => {
            let item_id = exactly_one_tag(event, "item")?;
            if item_id.trim().is_empty() {
                return Err(ContractError::Invalid(
                    "item removal item id cannot be empty".into(),
                ));
            }
            let current_item_event_id = exactly_one_tag(event, "e")?;
            validate_hex_id(&current_item_event_id, "item removal e tag")?;
            Ok(FollowUpEvent::Remove(ItemRemoveEvent {
                channel_id,
                item_id,
                current_item_event_id,
            }))
        }
        kind => Err(ContractError::Invalid(format!(
            "event kind {kind} is not a COS follow-up kind"
        ))),
    }
}
