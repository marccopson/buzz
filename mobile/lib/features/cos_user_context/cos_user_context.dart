import 'dart:convert';

import 'package:nostr/nostr.dart' as nostr;

import '../../shared/relay/nostr_models.dart';

const cosUserContextSchema = 'mac-workspace/cos-user-context/v1';
const cosWorkspaceModules = {
  'today',
  'my_actions',
  'messages',
  'assistant',
  'running_order',
  'agents',
};

class CosUserContext {
  final String eventId;
  final String assigneePubkey;
  final List<String> modules;
  final int createdAt;

  const CosUserContext({
    required this.eventId,
    required this.assigneePubkey,
    required this.modules,
    required this.createdAt,
  });

  bool hasModule(String module) => modules.contains(module);
  bool get canUseControlRoom =>
      hasModule('agents') && hasModule('running_order');
}

CosUserContext parseCosUserContext(
  NostrEvent event, {
  required String expectedAssignee,
}) {
  try {
    nostr.Event(
      event.id,
      event.pubkey,
      event.createdAt,
      event.kind,
      event.tags,
      event.content,
      event.sig,
      verify: true,
    );
  } on Object {
    throw const FormatException('COS user-context signature is invalid');
  }
  if (event.kind != EventKind.cosUserContext) {
    throw const FormatException('Expected a COS user-context event');
  }
  final assignee = _exactTag(event, 'p').toLowerCase();
  if (assignee != expectedAssignee.toLowerCase()) {
    throw const FormatException('COS user context belongs to another identity');
  }
  if (_exactTag(event, 'd') != 'context:$assignee') {
    throw const FormatException('COS user-context coordinate is invalid');
  }
  _exactTag(event, 'h');
  final decoded = jsonDecode(event.content);
  if (decoded is! Map || decoded['schema'] != cosUserContextSchema) {
    throw const FormatException('Unsupported COS user-context schema');
  }
  final rawModules = decoded['modules'];
  if (rawModules is! List ||
      rawModules.any(
        (module) => module is! String || !cosWorkspaceModules.contains(module),
      )) {
    throw const FormatException('Unsupported Workspace module');
  }
  final modules = rawModules.cast<String>();
  if (modules.toSet().length != modules.length ||
      !modules.contains('today') ||
      !modules.contains('my_actions') ||
      !modules.contains('messages')) {
    throw const FormatException('COS user-context modules are invalid');
  }
  return CosUserContext(
    eventId: event.id,
    assigneePubkey: assignee,
    modules: List.unmodifiable(modules),
    createdAt: event.createdAt,
  );
}

CosUserContext? selectLatestCosUserContext(
  Iterable<NostrEvent> events, {
  required String assigneePubkey,
  required String trustedBridgePubkey,
}) {
  CosUserContext? latest;
  for (final event in events) {
    if (event.pubkey.toLowerCase() != trustedBridgePubkey.toLowerCase()) {
      continue;
    }
    try {
      final candidate = parseCosUserContext(
        event,
        expectedAssignee: assigneePubkey,
      );
      if (latest == null ||
          candidate.createdAt > latest.createdAt ||
          (candidate.createdAt == latest.createdAt &&
              candidate.eventId.compareTo(latest.eventId) < 0)) {
        latest = candidate;
      }
    } on FormatException {
      // Ignore malformed, incorrectly scoped or untrusted projections.
    }
  }
  return latest;
}

String _exactTag(NostrEvent event, String name) {
  final values = [
    for (final tag in event.tags)
      if (tag.length > 1 && tag[0] == name) tag[1],
  ];
  if (values.length != 1 || values.single.isEmpty) {
    throw FormatException(
      'COS user context must contain exactly one $name tag',
    );
  }
  return values.single;
}
