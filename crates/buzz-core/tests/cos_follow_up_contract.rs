use buzz_core::cos_follow_up::{
    build_command_event, build_item_event, build_item_remove_event, build_receipt_event,
    build_user_context_event, parse_event, Action, CommandContent, FollowUpEvent, ItemContent,
    ItemState, Outcome, ReceiptContent, UserContextContent, SCHEMA, USER_CONTEXT_SCHEMA,
};
use buzz_core::kind::{
    is_parameterized_replaceable, KIND_COS_FOLLOW_UP_COMMAND, KIND_COS_FOLLOW_UP_ITEM,
    KIND_COS_FOLLOW_UP_RECEIPT, KIND_COS_USER_CONTEXT,
};
use nostr::{EventBuilder, Keys, Kind, Tag};
use uuid::Uuid;

fn item_content() -> ItemContent {
    serde_json::from_value(serde_json::json!({
        "schema": SCHEMA,
        "id": "item-42",
        "jira_key": "COS-683",
        "title": "Confirm the rollout",
        "question_evidence": {
            "question": "Is the wording accurate?",
            "evidence": "Transcript line 19"
        },
        "state": "ready-to-check",
        "assigned_person": {"id": 7, "name": "Marc"},
        "named_confirmer": {"id": 7, "name": "Marc"},
        "version": 3,
        "permitted_actions": ["confirm", "reject"],
        "timestamps": {
            "created_at": "2026-07-27T08:00:00Z",
            "updated_at": "2026-07-27T08:10:00Z",
            "published_at": "2026-07-27T08:11:00Z",
            "last_activity_at": "2026-07-27T08:10:00Z",
            "answered_at": null,
            "ready_to_check_at": "2026-07-27T08:10:00Z",
            "confirmed_at": null,
            "rejected_at": null
        },
        "deep_links": {
            "meeting_follow_up": "https://workspace.example/ops/meeting-follow-up?item_id=item-42",
            "jira": "https://jira.example/browse/COS-683",
            "sources": [
                {"label": "Meeting transcript", "url": "https://example.test/transcript#L19"}
            ]
        }
    }))
    .unwrap()
}

#[test]
fn kinds_are_registered_in_the_required_ranges() {
    assert_eq!(KIND_COS_FOLLOW_UP_ITEM, 37010);
    assert_eq!(KIND_COS_USER_CONTEXT, 37012);
    assert_eq!(KIND_COS_FOLLOW_UP_COMMAND, 47010);
    assert_eq!(KIND_COS_FOLLOW_UP_RECEIPT, 47011);
    assert!(is_parameterized_replaceable(KIND_COS_FOLLOW_UP_ITEM));
    assert!(is_parameterized_replaceable(KIND_COS_USER_CONTEXT));
    assert!(!is_parameterized_replaceable(KIND_COS_FOLLOW_UP_COMMAND));
    assert!(!is_parameterized_replaceable(KIND_COS_FOLLOW_UP_RECEIPT));
}

#[test]
fn user_context_builder_and_parser_pin_private_identity_and_modules() {
    let channel = Uuid::new_v4();
    let assignee = Keys::generate().public_key();
    let content: UserContextContent = serde_json::from_value(serde_json::json!({
        "schema": USER_CONTEXT_SCHEMA,
        "tenant_slug": "mac-surfacing",
        "user": {
            "id": 7,
            "name": "Matthew Ward",
            "role": "finance_admin",
            "role_label": "Finance"
        },
        "modules": ["today", "my_actions", "messages", "assistant"],
        "assistant": {
            "key": "mac-assistant",
            "label": "MAC Assistant",
            "execution": "brain-vps",
            "memory_scope": "private-channel"
        },
        "generated_at": "2026-07-28T19:00:00Z"
    }))
    .unwrap();
    let event = build_user_context_event(channel, assignee, &content)
        .unwrap()
        .sign_with_keys(&Keys::generate())
        .unwrap();
    let d_tag = event
        .tags
        .iter()
        .find(|tag| tag.as_slice().first().map(String::as_str) == Some("d"))
        .expect("user context must carry a replacement coordinate");
    let expected_coordinate = format!("context:{}", assignee.to_hex());
    assert_eq!(
        d_tag.as_slice().get(1).map(String::as_str),
        Some(expected_coordinate.as_str())
    );

    match parse_event(&event).unwrap() {
        FollowUpEvent::UserContext(parsed) => {
            assert_eq!(parsed.channel_id, channel);
            assert_eq!(parsed.assignee, assignee);
            assert_eq!(parsed.content.user.role, "finance_admin");
            assert!(!parsed.content.modules.contains(&"agents".to_string()));
        }
        other => panic!("expected user context, got {other:?}"),
    }
}

#[test]
fn user_context_rejects_privileged_or_unknown_modules() {
    let assignee = Keys::generate().public_key();
    let content: UserContextContent = serde_json::from_value(serde_json::json!({
        "schema": USER_CONTEXT_SCHEMA,
        "tenant_slug": "mac-surfacing",
        "user": {
            "id": 7,
            "name": "Stephen Evans",
            "role": "unknown",
            "role_label": "Access pending"
        },
        "modules": ["today", "my_actions", "messages", "secrets"],
        "assistant": null,
        "generated_at": "2026-07-28T19:00:00Z"
    }))
    .unwrap();

    let error = build_user_context_event(Uuid::new_v4(), assignee, &content)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("modules are invalid"),
        "unexpected error: {error}"
    );
}

#[test]
fn user_context_rejects_a_noncanonical_tenant_slug() {
    let assignee = Keys::generate().public_key();
    let content: UserContextContent = serde_json::from_value(serde_json::json!({
        "schema": USER_CONTEXT_SCHEMA,
        "tenant_slug": "mac--surfacing",
        "user": {
            "id": 7,
            "name": "Jake Wherton",
            "role": "managing_director",
            "role_label": "Managing Director"
        },
        "modules": ["today", "messages"],
        "assistant": null,
        "generated_at": "2026-07-29T10:00:00Z"
    }))
    .unwrap();

    let error = build_user_context_event(Uuid::new_v4(), assignee, &content)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("identity is invalid"),
        "unexpected error: {error}"
    );
}

#[test]
fn user_context_allows_a_least_privilege_module_revocation() {
    let assignee = Keys::generate().public_key();
    let content: UserContextContent = serde_json::from_value(serde_json::json!({
        "schema": USER_CONTEXT_SCHEMA,
        "tenant_slug": "mac-surfacing",
        "user": {
            "id": 7,
            "name": "Jake Wherton",
            "role": "managing_director",
            "role_label": "Managing Director"
        },
        "modules": ["today", "messages"],
        "assistant": null,
        "generated_at": "2026-07-29T10:00:00Z"
    }))
    .unwrap();

    let event = build_user_context_event(Uuid::new_v4(), assignee, &content)
        .unwrap()
        .sign_with_keys(&Keys::generate())
        .unwrap();
    match parse_event(&event).unwrap() {
        FollowUpEvent::UserContext(parsed) => {
            assert!(!parsed.content.modules.contains(&"my_actions".to_string()));
        }
        other => panic!("expected user context, got {other:?}"),
    }
}

#[test]
fn item_builder_and_parser_pin_channel_coordinate_and_assignee() {
    let channel = Uuid::new_v4();
    let assignee = Keys::generate().public_key();
    let event = build_item_event(channel, assignee, &item_content()).unwrap();
    let signed = event.sign_with_keys(&Keys::generate()).unwrap();

    match parse_event(&signed).unwrap() {
        FollowUpEvent::Item(parsed) => {
            assert_eq!(parsed.channel_id, channel);
            assert_eq!(parsed.item_id, "item-42");
            assert_eq!(parsed.assignee, assignee);
            assert_eq!(parsed.content.state, ItemState::ReadyToCheck);
            assert_eq!(
                parsed.content.permitted_actions,
                vec![Action::Confirm, Action::Reject]
            );
        }
        other => panic!("expected item, got {other:?}"),
    }
}

#[test]
fn command_and_receipt_round_trip() {
    let channel = Uuid::new_v4();
    let current_item_event_id = "1".repeat(64);
    let command = build_command_event(
        channel,
        "item-42",
        Action::Confirm,
        3,
        &current_item_event_id,
        &CommandContent {
            schema: SCHEMA.to_string(),
            answer: None,
            comment: Some("That is right".into()),
            reason: None,
            new_confirmer_id: None,
        },
    )
    .unwrap()
    .sign_with_keys(&Keys::generate())
    .unwrap();

    let parsed_command = match parse_event(&command).unwrap() {
        FollowUpEvent::Command(value) => value,
        other => panic!("expected command, got {other:?}"),
    };
    assert_eq!(parsed_command.action, Action::Confirm);
    assert_eq!(parsed_command.expected_version, 3);
    assert_eq!(parsed_command.current_item_event_id, current_item_event_id);

    let receipt = build_receipt_event(
        channel,
        &command.id.to_hex(),
        "item-42",
        Outcome::Accepted,
        4,
        &ReceiptContent {
            schema: SCHEMA.to_string(),
            message: Some("confirmed".into()),
            code: None,
            retryable: false,
        },
    )
    .unwrap()
    .sign_with_keys(&Keys::generate())
    .unwrap();

    match parse_event(&receipt).unwrap() {
        FollowUpEvent::Receipt(value) => {
            assert_eq!(value.command_event_id, command.id.to_hex());
            assert_eq!(value.item_id, "item-42");
            assert_eq!(value.outcome, Outcome::Accepted);
            assert_eq!(value.authoritative_version, 4);
        }
        other => panic!("expected receipt, got {other:?}"),
    }
}

#[test]
fn parser_rejects_schema_and_coordinate_mismatch() {
    let keys = Keys::generate();
    let assignee = Keys::generate().public_key();
    let event = EventBuilder::new(
        Kind::Custom(KIND_COS_FOLLOW_UP_ITEM as u16),
        serde_json::to_string(&item_content()).unwrap(),
    )
    .tags([
        Tag::parse(["h", &Uuid::new_v4().to_string()]).unwrap(),
        Tag::parse(["d", "different-item"]).unwrap(),
        Tag::parse(["p", &assignee.to_hex()]).unwrap(),
    ])
    .sign_with_keys(&keys)
    .unwrap();

    let error = parse_event(&event).unwrap_err().to_string();
    assert!(
        error.contains("does not match"),
        "unexpected error: {error}"
    );
}

#[test]
fn item_builder_rejects_unsafe_projected_links() {
    let mut content = item_content();
    content.deep_links.meeting_follow_up = "javascript:alert(1)".into();
    let error = build_item_event(Uuid::new_v4(), Keys::generate().public_key(), &content)
        .unwrap_err()
        .to_string();
    assert!(error.contains("HTTPS"), "unexpected error: {error}");
}

#[test]
fn item_removal_round_trips_scoped_item_and_event() {
    let channel = Uuid::new_v4();
    let target = "2".repeat(64);
    let event = build_item_remove_event(channel, "item-42", &target)
        .unwrap()
        .sign_with_keys(&Keys::generate())
        .unwrap();

    match parse_event(&event).unwrap() {
        FollowUpEvent::Remove(remove) => {
            assert_eq!(remove.channel_id, channel);
            assert_eq!(remove.item_id, "item-42");
            assert_eq!(remove.current_item_event_id, target);
        }
        other => panic!("expected removal, got {other:?}"),
    }
}
