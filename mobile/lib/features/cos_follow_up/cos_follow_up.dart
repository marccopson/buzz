import 'dart:convert';

import '../../shared/relay/relay.dart';

const cosFollowUpSchema = 'mac-workspace/cos-follow-up/v1';

enum CosFollowUpState {
  needsAnswer('needs-answer'),
  readyToCheck('ready-to-check'),
  confirmed('confirmed');

  final String wireValue;
  const CosFollowUpState(this.wireValue);

  static CosFollowUpState parse(Object? value) => values.firstWhere(
    (state) => state.wireValue == value,
    orElse: () => throw const FormatException('Unsupported follow-up state'),
  );
}

enum CosFollowUpHumanAction {
  answer('answer'),
  confirm('confirm'),
  reject('reject');

  final String wireValue;
  const CosFollowUpHumanAction(this.wireValue);
}

const _allActions = {
  'answer',
  'confirm',
  'reject',
  'ready_to_check',
  'reassign_confirmer',
};

Map<String, dynamic> _object(Object? value, String label) {
  if (value is! Map<String, dynamic>) {
    throw FormatException('$label must be an object');
  }
  return value;
}

String _string(Object? value, String label) {
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('$label must be a non-empty string');
  }
  return value;
}

String? _nullableString(Object? value) =>
    value is String && value.isNotEmpty ? value : null;

String _safeAbsoluteUrl(Object? value, String label) {
  final raw = _string(value, label);
  final uri = Uri.tryParse(raw);
  final localHttp =
      uri?.scheme == 'http' &&
      const {'localhost', '127.0.0.1', '::1'}.contains(uri?.host);
  if (uri == null ||
      !uri.hasScheme ||
      !uri.hasAuthority ||
      (uri.scheme != 'https' && !localHttp)) {
    throw FormatException('$label must be an absolute HTTPS URL');
  }
  return uri.toString();
}

String? _nullableSafeAbsoluteUrl(Object? value, String label) =>
    value == null || value == '' ? null : _safeAbsoluteUrl(value, label);

int _integer(Object? value, String label) {
  if (value is! int || value < 0) {
    throw FormatException('$label must be a non-negative integer');
  }
  return value;
}

String _oneTag(NostrEvent event, String name) {
  final values = [
    for (final tag in event.tags)
      if (tag.length >= 2 && tag.first == name) tag[1],
  ];
  if (values.length != 1) {
    throw FormatException('Follow-up event needs exactly one $name tag');
  }
  return values.single;
}

Map<String, dynamic> _content(NostrEvent event) {
  final decoded = _object(jsonDecode(event.content), 'content');
  if (decoded['schema'] != cosFollowUpSchema) {
    throw const FormatException('Unsupported follow-up schema');
  }
  return decoded;
}

class CosFollowUpPerson {
  final Object id;
  final String name;

  const CosFollowUpPerson({required this.id, required this.name});

  factory CosFollowUpPerson.fromJson(Object? value, String label) {
    final json = _object(value, label);
    final id = json['id'];
    if (id is! String && id is! num && id is! bool) {
      throw FormatException('$label.id must be a JSON scalar');
    }
    return CosFollowUpPerson(
      id: id!,
      name: _string(json['name'], '$label.name'),
    );
  }
}

class CosFollowUpSource {
  final String label;
  final String url;

  const CosFollowUpSource({required this.label, required this.url});

  factory CosFollowUpSource.fromJson(Object? value, int index) {
    final json = _object(value, 'sources[$index]');
    return CosFollowUpSource(
      label: _string(json['label'], 'sources[$index].label'),
      url: _safeAbsoluteUrl(json['url'], 'sources[$index].url'),
    );
  }
}

class CosFollowUpDeepLinks {
  final String meetingFollowUp;
  final String? jira;
  final List<CosFollowUpSource> sources;

  const CosFollowUpDeepLinks({
    required this.meetingFollowUp,
    required this.jira,
    required this.sources,
  });
}

class CosFollowUpItem {
  final String eventId;
  final String authorPubkey;
  final String channelId;
  final String assigneePubkey;
  final String id;
  final String? jiraKey;
  final String title;
  final String question;
  final String? evidence;
  final CosFollowUpState state;
  final CosFollowUpPerson assignedPerson;
  final CosFollowUpPerson? namedConfirmer;
  final int version;
  final List<String> permittedActions;
  final Map<String, String?> timestamps;
  final CosFollowUpDeepLinks deepLinks;
  final int createdAt;

  const CosFollowUpItem({
    required this.eventId,
    required this.authorPubkey,
    required this.channelId,
    required this.assigneePubkey,
    required this.id,
    required this.jiraKey,
    required this.title,
    required this.question,
    required this.evidence,
    required this.state,
    required this.assignedPerson,
    required this.namedConfirmer,
    required this.version,
    required this.permittedActions,
    required this.timestamps,
    required this.deepLinks,
    required this.createdAt,
  });

  factory CosFollowUpItem.fromEvent(
    NostrEvent event, {
    String? expectedAssignee,
  }) {
    if (event.kind != EventKind.cosFollowUpItem) {
      throw const FormatException('Expected a follow-up item');
    }
    final channelId = _oneTag(event, 'h');
    final itemId = _oneTag(event, 'd');
    final assignee = _oneTag(event, 'p').toLowerCase();
    if (expectedAssignee != null &&
        assignee != expectedAssignee.toLowerCase()) {
      throw const FormatException('Item assigned to a different identity');
    }
    final json = _content(event);
    if (json['id'] != itemId) {
      throw const FormatException('Content id does not match d tag');
    }
    final prompt = _object(json['question_evidence'], 'question_evidence');
    final timestampJson = _object(json['timestamps'], 'timestamps');
    final linkJson = _object(json['deep_links'], 'deep_links');
    final rawActions = json['permitted_actions'];
    if (rawActions is! List) {
      throw const FormatException('permitted_actions must be an array');
    }
    final actions = rawActions.map((value) {
      if (value is! String || !_allActions.contains(value)) {
        throw const FormatException('Unsupported follow-up action');
      }
      return value;
    }).toList();
    if (actions.toSet().length != actions.length) {
      throw const FormatException('Duplicate follow-up action');
    }
    final rawSources = linkJson['sources'] ?? const [];
    if (rawSources is! List) {
      throw const FormatException('sources must be an array');
    }
    return CosFollowUpItem(
      eventId: event.id,
      authorPubkey: event.pubkey,
      channelId: channelId,
      assigneePubkey: assignee,
      id: itemId,
      jiraKey: _nullableString(json['jira_key']),
      title: _string(json['title'], 'title'),
      question: _string(prompt['question'], 'question_evidence.question'),
      evidence: _nullableString(prompt['evidence']),
      state: CosFollowUpState.parse(json['state']),
      assignedPerson: CosFollowUpPerson.fromJson(
        json['assigned_person'],
        'assigned_person',
      ),
      namedConfirmer: json['named_confirmer'] == null
          ? null
          : CosFollowUpPerson.fromJson(
              json['named_confirmer'],
              'named_confirmer',
            ),
      version: _integer(json['version'], 'version'),
      permittedActions: actions,
      timestamps: {
        for (final entry in timestampJson.entries)
          entry.key: _nullableString(entry.value),
      },
      deepLinks: CosFollowUpDeepLinks(
        meetingFollowUp: _safeAbsoluteUrl(
          linkJson['meeting_follow_up'],
          'deep_links.meeting_follow_up',
        ),
        jira: _nullableSafeAbsoluteUrl(linkJson['jira'], 'deep_links.jira'),
        sources: [
          for (var index = 0; index < rawSources.length; index++)
            CosFollowUpSource.fromJson(rawSources[index], index),
        ],
      ),
      createdAt: event.createdAt,
    );
  }

  bool isActionPermitted(CosFollowUpHumanAction action) {
    if (!permittedActions.contains(action.wireValue)) return false;
    if (action == CosFollowUpHumanAction.answer) {
      return state == CosFollowUpState.needsAnswer;
    }
    return state == CosFollowUpState.readyToCheck;
  }
}

List<CosFollowUpItem> projectLatestCosFollowUpItems(
  Iterable<NostrEvent> events,
  String assignee, {
  required String trustedBridgePubkey,
}) {
  final trustedAuthor = trustedBridgePubkey.toLowerCase();
  final latest = <String, CosFollowUpItem>{};
  for (final event in events) {
    if (event.pubkey.toLowerCase() != trustedAuthor) continue;
    try {
      final item = CosFollowUpItem.fromEvent(event, expectedAssignee: assignee);
      final current = latest[item.id];
      if (current == null ||
          item.version > current.version ||
          (item.version == current.version &&
              (item.createdAt > current.createdAt ||
                  (item.createdAt == current.createdAt &&
                      item.eventId.compareTo(current.eventId) < 0)))) {
        latest[item.id] = item;
      }
    } on FormatException {
      continue;
    }
  }
  final result = latest.values.toList()
    ..sort(
      (a, b) => b.createdAt.compareTo(a.createdAt) != 0
          ? b.createdAt.compareTo(a.createdAt)
          : a.id.compareTo(b.id),
    );
  return result;
}

class CosFollowUpCommand {
  final int kind;
  final String content;
  final List<List<String>> tags;

  const CosFollowUpCommand({
    required this.kind,
    required this.content,
    required this.tags,
  });
}

CosFollowUpCommand buildCosFollowUpCommand({
  required CosFollowUpItem item,
  required CosFollowUpHumanAction action,
  String? answer,
  String? comment,
}) {
  if (!item.isActionPermitted(action)) {
    throw StateError('Action not permitted for the current item state');
  }
  if (action == CosFollowUpHumanAction.answer &&
      (answer == null || answer.trim().isEmpty)) {
    throw ArgumentError('Please enter an answer');
  }
  return CosFollowUpCommand(
    kind: EventKind.cosFollowUpCommand,
    tags: [
      ['h', item.channelId],
      ['item', item.id],
      ['action', action.wireValue],
      ['expected-version', '${item.version}'],
      ['e', item.eventId],
    ],
    content: jsonEncode({
      'schema': cosFollowUpSchema,
      if (answer?.trim().isNotEmpty ?? false) 'answer': answer!.trim(),
      if (comment?.trim().isNotEmpty ?? false) 'comment': comment!.trim(),
    }),
  );
}

class CosFollowUpReceipt {
  final String eventId;
  final String channelId;
  final String commandEventId;
  final String itemId;
  final String outcome;
  final int authoritativeVersion;
  final String? message;
  final String? code;
  final bool retryable;

  const CosFollowUpReceipt({
    required this.eventId,
    required this.channelId,
    required this.commandEventId,
    required this.itemId,
    required this.outcome,
    required this.authoritativeVersion,
    required this.message,
    required this.code,
    required this.retryable,
  });

  factory CosFollowUpReceipt.fromEvent(NostrEvent event) {
    if (event.kind != EventKind.cosFollowUpReceipt) {
      throw const FormatException('Expected a follow-up receipt');
    }
    final outcome = _oneTag(event, 'outcome');
    if (!const {
      'accepted',
      'rejected',
      'conflict',
      'failed',
    }.contains(outcome)) {
      throw const FormatException('Unsupported receipt outcome');
    }
    final json = _content(event);
    final retryable = json['retryable'] == true;
    if (retryable && outcome != 'failed') {
      throw const FormatException('Only failed receipts can be retryable');
    }
    final version = int.tryParse(_oneTag(event, 'version'));
    if (version == null || version < 0) {
      throw const FormatException('Invalid receipt version');
    }
    return CosFollowUpReceipt(
      eventId: event.id,
      channelId: _oneTag(event, 'h'),
      commandEventId: _oneTag(event, 'e'),
      itemId: _oneTag(event, 'item'),
      outcome: outcome,
      authoritativeVersion: version,
      message: _nullableString(json['message']),
      code: _nullableString(json['code']),
      retryable: retryable,
    );
  }
}

class SeenCosFollowUp {
  final String eventId;
  final String state;

  const SeenCosFollowUp({required this.eventId, required this.state});
}

bool isNewlyActionableTransition(
  SeenCosFollowUp? previous,
  CosFollowUpItem next,
) {
  if (next.state == CosFollowUpState.confirmed) return false;
  if (previous?.eventId == next.eventId) return false;
  return previous?.state != next.state.wireValue;
}

String cosFollowUpStateLabel(CosFollowUpState state) => switch (state) {
  CosFollowUpState.needsAnswer => 'We need you',
  CosFollowUpState.readyToCheck => 'Does this look right?',
  CosFollowUpState.confirmed => 'Confirmed',
};
