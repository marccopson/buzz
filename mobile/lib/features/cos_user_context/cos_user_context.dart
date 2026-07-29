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
  final String channelId;
  final String assigneePubkey;
  final List<String> modules;
  final int createdAt;

  const CosUserContext({
    required this.eventId,
    required this.channelId,
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
  String? expectedChannelId,
}) {
  if (!_hasValidSignature(event)) {
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
  final channelId = _exactTag(event, 'h');
  if (expectedChannelId != null && channelId != expectedChannelId) {
    throw const FormatException('COS user context belongs to another channel');
  }
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
    channelId: channelId,
    assigneePubkey: assignee,
    modules: List.unmodifiable(modules),
    createdAt: event.createdAt,
  );
}

CosUserContext? selectLatestCosUserContext(
  Iterable<NostrEvent> events, {
  required String assigneePubkey,
  required String trustedBridgePubkey,
  String? expectedChannelId,
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
        expectedChannelId: expectedChannelId,
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

List<String> cosUserContextChannelCandidates(
  Iterable<NostrEvent> events, {
  required String assigneePubkey,
  required String trustedBridgePubkey,
}) {
  final channels = <String>{};
  for (final event in events) {
    if (event.pubkey.toLowerCase() != trustedBridgePubkey.toLowerCase()) {
      continue;
    }
    try {
      channels.add(
        parseCosUserContext(event, expectedAssignee: assigneePubkey).channelId,
      );
    } on FormatException {
      // Only structurally valid bridge projections may nominate a channel.
    }
  }
  return channels.toList()..sort();
}

/// Returns the one current private COS identity channel in this relay
/// workspace. Ambiguous, stale or malformed membership fails closed.
String? resolveAuthoritativeCosUserContextChannel({
  required Iterable<String> candidateChannelIds,
  required Iterable<NostrEvent> metadataEvents,
  required Iterable<NostrEvent> membershipEvents,
  required String assigneePubkey,
  required String trustedBridgePubkey,
}) {
  final metadata = _latestByCoordinate(metadataEvents, 39000);
  final memberships = _latestByCoordinate(membershipEvents, 39002);
  final valid = candidateChannelIds.toSet().where((channelId) {
    final channelMetadata = metadata[channelId];
    final channelMembership = memberships[channelId];
    return channelMetadata != null &&
        _isPrivateMetadata(channelMetadata) &&
        channelMembership != null &&
        _hasExactFollowUpMembership(
          channelMembership,
          assigneePubkey,
          trustedBridgePubkey,
        );
  }).toList();
  return valid.length == 1 ? valid.single : null;
}

Map<String, NostrEvent> _latestByCoordinate(
  Iterable<NostrEvent> events,
  int expectedKind,
) {
  final latest = <String, NostrEvent>{};
  for (final event in events) {
    if (event.kind != expectedKind || !_hasValidSignature(event)) continue;
    String coordinate;
    try {
      coordinate = _exactTag(event, 'd');
    } on FormatException {
      continue;
    }
    final current = latest[coordinate];
    if (current == null ||
        event.createdAt > current.createdAt ||
        (event.createdAt == current.createdAt &&
            event.id.compareTo(current.id) < 0)) {
      latest[coordinate] = event;
    }
  }
  return latest;
}

bool _isPrivateMetadata(NostrEvent event) => event.tags.any(
  (tag) =>
      tag.isNotEmpty &&
      (tag[0] == 'private' ||
          (tag.length > 1 && tag[0] == 'visibility' && tag[1] == 'private')),
);

bool _hasExactFollowUpMembership(
  NostrEvent event,
  String assigneePubkey,
  String trustedBridgePubkey,
) {
  final roles = <String, String>{};
  for (final tag in event.tags) {
    if (tag.length < 2 || tag[0] != 'p') continue;
    final pubkey = tag[1].toLowerCase();
    if (roles.containsKey(pubkey)) return false;
    roles[pubkey] = tag.length > 3 && tag[3].isNotEmpty ? tag[3] : 'member';
  }
  final assignee = assigneePubkey.toLowerCase();
  final bridge = trustedBridgePubkey.toLowerCase();
  return assignee != bridge &&
      roles.length == 2 &&
      roles[bridge] == 'owner' &&
      roles[assignee] == 'member';
}

bool _hasValidSignature(NostrEvent event) {
  try {
    nostr.Event(
      event.id,
      event.pubkey,
      event.createdAt,
      event.kind,
      event.tags.map((tag) => [...tag]).toList(),
      event.content,
      event.sig,
      verify: true,
    );
    return true;
  } on Object {
    return false;
  }
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
