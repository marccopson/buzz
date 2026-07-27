import 'dart:convert';

import 'package:buzz/features/cos_follow_up/cos_follow_up.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  NostrEvent itemEvent({
    String eventId = 'event-1',
    String itemId = 'item-1',
    String state = 'needs-answer',
    int version = 3,
    List<String> actions = const ['answer'],
  }) => NostrEvent(
    id: eventId,
    pubkey: 'bridge',
    createdAt: version,
    kind: EventKind.cosFollowUpItem,
    tags: [
      ['h', '11111111-1111-1111-1111-111111111111'],
      ['d', itemId],
      ['p', 'assignee'],
    ],
    content: jsonEncode({
      'schema': cosFollowUpSchema,
      'id': itemId,
      'jira_key': 'COS-683',
      'title': 'Confirm the evidence',
      'question_evidence': {
        'question': 'Is this right?',
        'evidence': 'Meeting line 14',
      },
      'state': state,
      'assigned_person': {'id': 7, 'name': 'Marc'},
      'named_confirmer': {'id': '8', 'name': 'Jake'},
      'version': version,
      'permitted_actions': actions,
      'timestamps': {
        'created_at': '2026-07-27T10:00:00Z',
        'updated_at': '2026-07-27T10:01:00Z',
        'published_at': '2026-07-27T10:01:00Z',
        'last_activity_at': '2026-07-27T10:01:00Z',
        'answered_at': null,
        'ready_to_check_at': null,
        'confirmed_at': null,
        'rejected_at': null,
      },
      'deep_links': {
        'meeting_follow_up': 'https://cos.example/follow-up/1',
        'jira': 'https://jira.example/COS-683',
        'sources': [
          {'label': 'Transcript', 'url': 'https://source.example/line-14'},
        ],
      },
    }),
    sig: '',
  );

  test('parses the exact projection and source evidence links', () {
    final item = CosFollowUpItem.fromEvent(
      itemEvent(),
      expectedAssignee: 'ASSIGNEE',
    );

    expect(item.id, 'item-1');
    expect(item.state, CosFollowUpState.needsAnswer);
    expect(item.version, 3);
    expect(item.assignedPerson.name, 'Marc');
    expect(item.namedConfirmer?.name, 'Jake');
    expect(item.deepLinks.sources.single.label, 'Transcript');
    expect(item.isActionPermitted(CosFollowUpHumanAction.answer), isTrue);
    expect(item.isActionPermitted(CosFollowUpHumanAction.confirm), isFalse);
  });

  test('projects only the newest authoritative version', () {
    final events = [
      itemEvent(eventId: 'older', version: 3),
      itemEvent(
        eventId: 'newer',
        state: 'ready-to-check',
        version: 4,
        actions: const ['confirm', 'reject'],
      ),
    ];

    final result = projectLatestCosFollowUpItems(events, 'assignee');

    expect(result, hasLength(1));
    expect(result.single.eventId, 'newer');
    expect(result.single.state, CosFollowUpState.readyToCheck);
  });

  test('command pins the expected version and current item event', () {
    final item = CosFollowUpItem.fromEvent(
      itemEvent(),
      expectedAssignee: 'assignee',
    );

    final command = buildCosFollowUpCommand(
      item: item,
      action: CosFollowUpHumanAction.answer,
      answer: ' Yes ',
    );

    expect(command.kind, EventKind.cosFollowUpCommand);
    expect(
      command.tags,
      containsAll([
        ['h', item.channelId],
        ['item', item.id],
        ['action', 'answer'],
        ['expected-version', '3'],
        ['e', 'event-1'],
      ]),
    );
    expect(jsonDecode(command.content), {
      'schema': cosFollowUpSchema,
      'answer': 'Yes',
    });
  });

  test('duplicate delivery and same-state refresh do not notify', () {
    final item = CosFollowUpItem.fromEvent(
      itemEvent(),
      expectedAssignee: 'assignee',
    );
    expect(isNewlyActionableTransition(null, item), isTrue);
    expect(
      isNewlyActionableTransition(
        const SeenCosFollowUp(eventId: 'event-1', state: 'needs-answer'),
        item,
      ),
      isFalse,
    );
    expect(
      isNewlyActionableTransition(
        const SeenCosFollowUp(eventId: 'old-event', state: 'needs-answer'),
        item,
      ),
      isFalse,
    );
  });

  test('only failed receipts may be retryable', () {
    NostrEvent receipt(String outcome, bool retryable) => NostrEvent(
      id: 'receipt',
      pubkey: 'bridge',
      createdAt: 1,
      kind: EventKind.cosFollowUpReceipt,
      tags: [
        ['h', '11111111-1111-1111-1111-111111111111'],
        ['e', 'command'],
        ['item', 'item-1'],
        ['outcome', outcome],
        ['version', '4'],
      ],
      content: jsonEncode({
        'schema': cosFollowUpSchema,
        'retryable': retryable,
      }),
      sig: '',
    );

    expect(
      CosFollowUpReceipt.fromEvent(receipt('failed', true)).retryable,
      isTrue,
    );
    expect(
      () => CosFollowUpReceipt.fromEvent(receipt('rejected', true)),
      throwsFormatException,
    );
  });

  test('rejects unsafe projected deep links', () {
    final event = itemEvent();
    final content = jsonDecode(event.content) as Map<String, dynamic>;
    content['deep_links'] = {
      'meeting_follow_up': 'javascript:alert(1)',
      'jira': null,
      'sources': const [],
    };
    final unsafe = NostrEvent(
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.createdAt,
      kind: event.kind,
      tags: event.tags,
      content: jsonEncode(content),
      sig: event.sig,
    );

    expect(
      () => CosFollowUpItem.fromEvent(unsafe, expectedAssignee: 'assignee'),
      throwsFormatException,
    );
  });
}
