import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';
import 'cos_follow_up.dart';
import 'cos_follow_up_notification_service.dart';

class CosFollowUpActionError {
  final String message;
  final bool retryable;
  final String? code;

  const CosFollowUpActionError({
    required this.message,
    required this.retryable,
    this.code,
  });
}

class CosFollowUpViewState {
  final List<CosFollowUpItem> items;
  final bool loading;
  final String? loadError;
  final Set<String> pendingItemIds;
  final Map<String, CosFollowUpActionError> actionErrors;

  const CosFollowUpViewState({
    this.items = const [],
    this.loading = true,
    this.loadError,
    this.pendingItemIds = const {},
    this.actionErrors = const {},
  });

  CosFollowUpViewState copyWith({
    List<CosFollowUpItem>? items,
    bool? loading,
    String? loadError,
    bool clearLoadError = false,
    Set<String>? pendingItemIds,
    Map<String, CosFollowUpActionError>? actionErrors,
  }) => CosFollowUpViewState(
    items: items ?? this.items,
    loading: loading ?? this.loading,
    loadError: clearLoadError ? null : loadError ?? this.loadError,
    pendingItemIds: pendingItemIds ?? this.pendingItemIds,
    actionErrors: actionErrors ?? this.actionErrors,
  );
}

class _ActionAttempt {
  final NostrEvent event;
  final CosFollowUpItem item;
  final CosFollowUpHumanAction action;
  final String? answer;
  final String? comment;

  const _ActionAttempt({
    required this.event,
    required this.item,
    required this.action,
    this.answer,
    this.comment,
  });
}

class CosFollowUpNotifier extends Notifier<CosFollowUpViewState> {
  void Function()? _unsubscribeItems;
  void Function()? _unsubscribeRemovals;
  String _pubkey = '';
  String _relayScope = '';
  final _seen = <String, SeenCosFollowUp>{};
  final _attempts = <String, _ActionAttempt>{};

  @override
  CosFollowUpViewState build() {
    final pubkey = ref.watch(myPubkeyProvider)?.trim().toLowerCase() ?? '';
    final relayScope = ref.watch(relayConfigProvider).baseUrl;
    ref.onDispose(_disposeSubscriptions);
    if (pubkey.isEmpty) {
      _pubkey = '';
      return const CosFollowUpViewState(items: [], loading: false);
    }
    if (_pubkey != pubkey || _relayScope != relayScope) {
      _pubkey = pubkey;
      _relayScope = relayScope;
      _seen
        ..clear()
        ..addAll(_loadSeen());
      Future.microtask(refresh);
    }
    return const CosFollowUpViewState();
  }

  String get _seenKey =>
      'buzz.cos-follow-up.seen.v1:$_relayScope:${_pubkey.toLowerCase()}';

  Map<String, SeenCosFollowUp> _loadSeen() {
    try {
      final raw = ref.read(savedPrefsProvider).getString(_seenKey);
      final decoded = raw == null ? null : jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return {};
      return {
        for (final entry in decoded.entries)
          if (entry.value is Map<String, dynamic>)
            entry.key: SeenCosFollowUp(
              eventId:
                  (entry.value as Map<String, dynamic>)['event_id'] as String,
              state: (entry.value as Map<String, dynamic>)['state'] as String,
            ),
      };
    } catch (_) {
      return {};
    }
  }

  Future<void> _saveSeen() => ref
      .read(savedPrefsProvider)
      .setString(
        _seenKey,
        jsonEncode({
          for (final entry in _seen.entries)
            entry.key: {
              'event_id': entry.value.eventId,
              'state': entry.value.state,
            },
        }),
      );

  Future<void> refresh() async {
    if (_pubkey.isEmpty) return;
    state = state.copyWith(loading: state.items.isEmpty, clearLoadError: true);
    try {
      final events = await ref
          .read(relaySessionProvider.notifier)
          .fetchHistory(
            NostrFilter(
              kinds: const [EventKind.cosFollowUpItem],
              tags: {
                '#p': [_pubkey],
              },
              limit: 500,
            ),
          );
      final items = projectLatestCosFollowUpItems(events, _pubkey);
      for (final item in items) {
        _seen[item.id] = SeenCosFollowUp(
          eventId: item.eventId,
          state: item.state.wireValue,
        );
      }
      await _saveSeen();
      state = state.copyWith(
        items: items,
        loading: false,
        clearLoadError: true,
      );
      await _subscribe(items.map((item) => item.channelId).toSet());
    } catch (error) {
      state = state.copyWith(loading: false, loadError: '$error');
    }
  }

  Future<void> _subscribe(Set<String> channelIds) async {
    _disposeSubscriptions();
    final session = ref.read(relaySessionProvider.notifier);
    _unsubscribeItems = await session.subscribe(
      NostrFilter(
        kinds: const [EventKind.cosFollowUpItem],
        tags: {
          '#p': [_pubkey],
        },
        limit: 0,
      ),
      _handleLiveItem,
    );
    if (channelIds.isNotEmpty) {
      _unsubscribeRemovals = await session.subscribe(
        NostrFilter(
          kinds: const [EventKind.deletion],
          tags: {'#h': channelIds.toList()},
          limit: 0,
        ),
        _handleRemoval,
      );
    }
  }

  void _disposeSubscriptions() {
    _unsubscribeItems?.call();
    _unsubscribeItems = null;
    _unsubscribeRemovals?.call();
    _unsubscribeRemovals = null;
  }

  void _handleLiveItem(NostrEvent event) {
    CosFollowUpItem item;
    try {
      item = CosFollowUpItem.fromEvent(event, expectedAssignee: _pubkey);
    } on FormatException {
      return;
    }
    final prior = _seen[item.id];
    final existingChannels = state.items
        .map((value) => value.channelId)
        .toSet();
    state = state.copyWith(
      items: projectLatestCosFollowUpItems([
        for (final current in state.items) _eventProjection(current),
        event,
      ], _pubkey),
    );
    _seen[item.id] = SeenCosFollowUp(
      eventId: item.eventId,
      state: item.state.wireValue,
    );
    unawaited(_saveSeen());
    if (isNewlyActionableTransition(prior, item)) {
      unawaited(
        ref
            .read(cosFollowUpNotificationSinkProvider)
            .show(
              id: item.eventId,
              title: cosFollowUpStateLabel(item.state),
              body: item.title,
            )
            .catchError((_) {}),
      );
    }
    if (!existingChannels.contains(item.channelId)) {
      unawaited(_subscribe({...existingChannels, item.channelId}));
    }
  }

  // The projection already passed strict parsing. Rebuild a minimal event only
  // to reuse the deterministic newest-version reducer with a live event.
  NostrEvent _eventProjection(CosFollowUpItem item) => NostrEvent(
    id: item.eventId,
    pubkey: item.authorPubkey,
    createdAt: item.createdAt,
    kind: EventKind.cosFollowUpItem,
    tags: [
      ['h', item.channelId],
      ['d', item.id],
      ['p', item.assigneePubkey],
    ],
    content: jsonEncode({
      'schema': cosFollowUpSchema,
      'id': item.id,
      'jira_key': item.jiraKey,
      'title': item.title,
      'question_evidence': {
        'question': item.question,
        'evidence': item.evidence,
      },
      'state': item.state.wireValue,
      'assigned_person': {
        'id': item.assignedPerson.id,
        'name': item.assignedPerson.name,
      },
      'named_confirmer': item.namedConfirmer == null
          ? null
          : {'id': item.namedConfirmer!.id, 'name': item.namedConfirmer!.name},
      'version': item.version,
      'permitted_actions': item.permittedActions,
      'timestamps': item.timestamps,
      'deep_links': {
        'meeting_follow_up': item.deepLinks.meetingFollowUp,
        'jira': item.deepLinks.jira,
        'sources': [
          for (final source in item.deepLinks.sources)
            {'label': source.label, 'url': source.url},
        ],
      },
    }),
    sig: '',
  );

  void _handleRemoval(NostrEvent event) {
    if (event.kind != EventKind.deletion) return;
    final channel = _exactTag(event, 'h');
    final itemId = _exactTag(event, 'item');
    final target = _exactTag(event, 'e');
    if (channel == null || itemId == null || target == null) return;
    state = state.copyWith(
      items: state.items
          .where(
            (item) =>
                item.channelId != channel ||
                item.id != itemId ||
                item.eventId != target,
          )
          .toList(),
    );
    _seen.remove(itemId);
    unawaited(_saveSeen());
  }

  String? _exactTag(NostrEvent event, String name) {
    final values = [
      for (final tag in event.tags)
        if (tag.length >= 2 && tag.first == name) tag[1],
    ];
    return values.length == 1 ? values.single : null;
  }

  Future<void> submitAction({
    required CosFollowUpItem item,
    required CosFollowUpHumanAction action,
    String? answer,
    String? comment,
  }) async {
    final pending = {...state.pendingItemIds, item.id};
    final errors = {...state.actionErrors}..remove(item.id);
    state = state.copyWith(pendingItemIds: pending, actionErrors: errors);
    NostrEvent? signed;
    try {
      final command = buildCosFollowUpCommand(
        item: item,
        action: action,
        answer: answer,
        comment: comment,
      );
      final config = ref.read(relayConfigProvider);
      await SignedEventRelay(
        session: ref.read(relaySessionProvider.notifier),
        nsec: config.nsec,
      ).submit(
        kind: command.kind,
        content: command.content,
        tags: command.tags,
        onSigned: (event) => signed = event,
      );
      final event = signed!;
      _attempts[item.id] = _ActionAttempt(
        event: event,
        item: item,
        action: action,
        answer: answer,
        comment: comment,
      );
      await _waitForReceipt(_attempts[item.id]!);
    } catch (error) {
      _recordActionError(item.id, error);
    } finally {
      state = state.copyWith(
        pendingItemIds: {...state.pendingItemIds}..remove(item.id),
      );
    }
  }

  Future<void> retryAction(String itemId) async {
    final attempt = _attempts[itemId];
    if (attempt == null) return;
    state = state.copyWith(
      pendingItemIds: {...state.pendingItemIds, itemId},
      actionErrors: {...state.actionErrors}..remove(itemId),
    );
    try {
      final existing = await _fetchReceipt(attempt);
      if (existing?.outcome == 'accepted') {
        if (await _applyAccepted(attempt, existing!)) return;
      } else if (existing != null &&
          !(existing.outcome == 'failed' && existing.retryable)) {
        throw CosFollowUpActionException(
          existing.message ?? 'The action could not be applied',
          retryable: false,
          code: existing.code,
        );
      }
      await ref.read(relaySessionProvider.notifier).publish(attempt.event);
      await _waitForReceipt(attempt, ignoredReceiptId: existing?.eventId);
    } catch (error) {
      _recordActionError(itemId, error);
    } finally {
      state = state.copyWith(
        pendingItemIds: {...state.pendingItemIds}..remove(itemId),
      );
    }
  }

  Future<CosFollowUpReceipt?> _fetchReceipt(
    _ActionAttempt attempt, {
    String? ignoredReceiptId,
  }) async {
    final events = await ref
        .read(relaySessionProvider.notifier)
        .fetchHistory(
          NostrFilter(
            kinds: const [EventKind.cosFollowUpReceipt],
            tags: {
              '#h': [attempt.item.channelId],
              '#e': [attempt.event.id],
            },
            limit: 20,
          ),
        );
    events.sort(
      (a, b) => b.createdAt.compareTo(a.createdAt) != 0
          ? b.createdAt.compareTo(a.createdAt)
          : a.id.compareTo(b.id),
    );
    for (final event in events) {
      if (event.id == ignoredReceiptId) continue;
      try {
        final receipt = CosFollowUpReceipt.fromEvent(event);
        if (receipt.commandEventId == attempt.event.id) return receipt;
      } on FormatException {
        continue;
      }
    }
    return null;
  }

  Future<void> _waitForReceipt(
    _ActionAttempt attempt, {
    String? ignoredReceiptId,
  }) async {
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (DateTime.now().isBefore(deadline)) {
      final receipt = await _fetchReceipt(
        attempt,
        ignoredReceiptId: ignoredReceiptId,
      );
      if (receipt != null) {
        if (receipt.outcome != 'accepted') {
          throw CosFollowUpActionException(
            receipt.message ?? 'The action could not be applied',
            retryable: receipt.outcome == 'failed' && receipt.retryable,
            code: receipt.code,
          );
        }
        if (await _applyAccepted(attempt, receipt)) return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 750));
    }
    throw const CosFollowUpActionException(
      'The action was sent but confirmation has not arrived. Try again.',
      retryable: true,
      code: 'receipt_timeout',
    );
  }

  Future<bool> _applyAccepted(
    _ActionAttempt attempt,
    CosFollowUpReceipt receipt,
  ) async {
    final events = await ref
        .read(relaySessionProvider.notifier)
        .fetchHistory(
          NostrFilter(
            kinds: const [EventKind.cosFollowUpItem],
            tags: {
              '#p': [_pubkey],
            },
            limit: 500,
          ),
        );
    final items = projectLatestCosFollowUpItems(events, _pubkey);
    final current = items
        .where((item) => item.id == attempt.item.id)
        .firstOrNull;
    if (current != null && current.version >= receipt.authoritativeVersion) {
      state = state.copyWith(items: items);
      return true;
    }
    if (current == null &&
        (attempt.action == CosFollowUpHumanAction.answer ||
            attempt.action == CosFollowUpHumanAction.reject)) {
      state = state.copyWith(
        items: state.items.where((item) => item.id != attempt.item.id).toList(),
      );
      return true;
    }
    return false;
  }

  void _recordActionError(String itemId, Object error) {
    final typed = error is CosFollowUpActionException
        ? error
        : CosFollowUpActionException('$error', retryable: false);
    state = state.copyWith(
      actionErrors: {
        ...state.actionErrors,
        itemId: CosFollowUpActionError(
          message: typed.message,
          retryable: typed.retryable,
          code: typed.code,
        ),
      },
    );
  }
}

class CosFollowUpActionException implements Exception {
  final String message;
  final bool retryable;
  final String? code;

  const CosFollowUpActionException(
    this.message, {
    required this.retryable,
    this.code,
  });

  @override
  String toString() => message;
}

final cosFollowUpProvider =
    NotifierProvider<CosFollowUpNotifier, CosFollowUpViewState>(
      CosFollowUpNotifier.new,
    );
