import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';
import '../cos_user_context/cos_user_context_provider.dart';
import 'cos_follow_up.dart';
import 'cos_follow_up_authority.dart';
import 'cos_follow_up_notification_service.dart';
import 'cos_follow_up_state.dart';

export 'cos_follow_up_state.dart';

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

class _PendingCosFollowUpNotification {
  final String itemId;
  final String eventId;
  final String state;
  final String title;
  final String body;

  const _PendingCosFollowUpNotification({
    required this.itemId,
    required this.eventId,
    required this.state,
    required this.title,
    required this.body,
  });

  factory _PendingCosFollowUpNotification.fromItem(CosFollowUpItem item) =>
      _PendingCosFollowUpNotification(
        itemId: item.id,
        eventId: item.eventId,
        state: item.state.wireValue,
        title: cosFollowUpStateLabel(item.state),
        body: item.title,
      );

  factory _PendingCosFollowUpNotification.fromJson(
    String itemId,
    Map<String, dynamic> json,
  ) => _PendingCosFollowUpNotification(
    itemId: itemId,
    eventId: json['event_id'] as String,
    state: json['state'] as String,
    title: json['title'] as String,
    body: json['body'] as String,
  );

  Map<String, String> toJson() => {
    'event_id': eventId,
    'state': state,
    'title': title,
    'body': body,
  };
}

class CosFollowUpNotifier extends Notifier<CosFollowUpViewState> {
  static const _subscriptionRecoveryDelays = [
    Duration(milliseconds: 250),
    Duration(milliseconds: 500),
    Duration(seconds: 1),
    Duration(seconds: 2),
    Duration(seconds: 4),
  ];

  void Function()? _unsubscribeItems;
  final _unsubscribeRemovals = <String, void Function()>{};
  final _removalSubscriptionsInFlight = <String, Future<void>>{};
  String _pubkey = '';
  String _relayScope = '';
  String _trustedBridgePubkey = '';
  final _seen = <String, SeenCosFollowUp>{};
  final _pendingNotifications = <String, _PendingCosFollowUpNotification>{};
  final _deliveryInFlight = <String>{};
  final _attempts = <String, _ActionAttempt>{};
  final _observedRemovals = <(String, String, String)>{};
  int _notificationGeneration = 0;
  int _subscriptionGeneration = 0;
  int? _closedSubscriptionGeneration;
  Timer? _subscriptionRecoveryTimer;
  int _subscriptionRecoveryAttempt = 0;
  bool _subscriptionRecoveryInFlight = false;
  bool _authorised = false;
  bool _disposed = false;

  @override
  CosFollowUpViewState build() {
    _disposed = false;
    final contextResult = ref.watch(cosUserContextProvider);
    final workspaceContext = currentCosUserContext(contextResult);
    final pubkey = ref.watch(myPubkeyProvider)?.trim().toLowerCase() ?? '';
    final relayScope = ref.watch(relayConfigProvider).baseUrl;
    final authority = ref.watch(cosFollowUpBridgePubkeyProvider);
    final trustedBridgePubkey = authority.value?.trim().toLowerCase() ?? '';
    ref.onDispose(_dispose);
    if (workspaceContext?.hasModule('my_actions') != true) {
      return _disableAccess(loading: contextResult.isLoading);
    }
    if (pubkey.isEmpty) {
      return _disableAccess(loading: false);
    }
    if (authority.isLoading) {
      _authorised = false;
      _disposeSubscriptions();
      return const CosFollowUpViewState(items: [], loading: true);
    }
    if (trustedBridgePubkey.isEmpty) {
      _authorised = false;
      _pubkey = pubkey;
      _relayScope = relayScope;
      _trustedBridgePubkey = '';
      _disposeSubscriptions();
      return const CosFollowUpViewState(items: [], loading: false);
    }
    _authorised = true;
    if (_pubkey != pubkey ||
        _relayScope != relayScope ||
        _trustedBridgePubkey != trustedBridgePubkey) {
      _pubkey = pubkey;
      _relayScope = relayScope;
      _trustedBridgePubkey = trustedBridgePubkey;
      _notificationGeneration++;
      _seen
        ..clear()
        ..addAll(_loadSeen());
      _pendingNotifications
        ..clear()
        ..addAll(_loadPendingNotifications());
      _deliveryInFlight.clear();
      _observedRemovals.clear();
      Future.microtask(refresh);
    }
    return const CosFollowUpViewState();
  }

  CosFollowUpViewState _disableAccess({required bool loading}) {
    if (_authorised ||
        _pubkey.isNotEmpty ||
        _trustedBridgePubkey.isNotEmpty ||
        _pendingNotifications.isNotEmpty ||
        _deliveryInFlight.isNotEmpty) {
      _notificationGeneration++;
    }
    _authorised = false;
    _pubkey = '';
    _trustedBridgePubkey = '';
    _seen.clear();
    _pendingNotifications.clear();
    _deliveryInFlight.clear();
    _observedRemovals.clear();
    _disposeSubscriptions();
    return CosFollowUpViewState(items: const [], loading: loading);
  }

  String get _seenKey =>
      'buzz.cos-follow-up.seen.v1:$_relayScope:${_pubkey.toLowerCase()}';

  String get _pendingNotificationKey =>
      'buzz.cos-follow-up.pending-notifications.v1:'
      '$_relayScope:${_pubkey.toLowerCase()}';

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

  Map<String, _PendingCosFollowUpNotification> _loadPendingNotifications() {
    try {
      final raw = ref
          .read(savedPrefsProvider)
          .getString(_pendingNotificationKey);
      final decoded = raw == null ? null : jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return {};
      return {
        for (final entry in decoded.entries)
          if (entry.value is Map<String, dynamic>)
            entry.key: _PendingCosFollowUpNotification.fromJson(
              entry.key,
              entry.value as Map<String, dynamic>,
            ),
      };
    } catch (_) {
      return {};
    }
  }

  Future<void> _savePendingNotifications() async {
    final prefs = ref.read(savedPrefsProvider);
    if (_pendingNotifications.isEmpty) {
      await prefs.remove(_pendingNotificationKey);
      return;
    }
    await prefs.setString(
      _pendingNotificationKey,
      jsonEncode({
        for (final entry in _pendingNotifications.entries)
          entry.key: entry.value.toJson(),
      }),
    );
  }

  Future<void> _saveNotificationState() async {
    await _saveSeen();
    await _savePendingNotifications();
  }

  Future<void> refresh() async {
    if (_disposed || !_authorised) return;
    _cancelSubscriptionRecovery();
    _subscriptionRecoveryAttempt = 0;
    try {
      await _refreshAndReconcile();
    } catch (error) {
      state = state.copyWith(loading: false, loadError: '$error');
    }
  }

  Future<void> _refreshAndReconcile() async {
    if (_disposed ||
        !_authorised ||
        _pubkey.isEmpty ||
        _trustedBridgePubkey.isEmpty) {
      return;
    }
    state = state.copyWith(loading: state.items.isEmpty, clearLoadError: true);
    _disposeSubscriptions(cancelRecovery: false);
    final generation = _subscriptionGeneration;
    try {
      await _subscribeItems(generation);
      _ensureSubscriptionGenerationHealthy(generation);
      var events = await _fetchItemHistory();
      _ensureSubscriptionGenerationHealthy(generation);
      var items = _projectItems(events);
      while (true) {
        final missingChannels = items
            .map((item) => item.channelId)
            .where((channelId) => !_unsubscribeRemovals.containsKey(channelId))
            .toSet();
        if (missingChannels.isEmpty) break;
        await Future.wait(missingChannels.map(_subscribeRemovalChannel));
        _ensureSubscriptionGenerationHealthy(generation);
        // A tombstone can land between the snapshot and its channel
        // subscription. Re-read only after every deletion fence is live.
        events = await _fetchItemHistory();
        _ensureSubscriptionGenerationHealthy(generation);
        items = _projectItems(events);
      }
      for (final removal in _observedRemovals) {
        _seen.remove(removal.$2);
        _pendingNotifications.remove(removal.$2);
      }
      for (final item in items) {
        final pending = _pendingNotifications[item.id];
        if (item.state != CosFollowUpState.confirmed && pending != null) {
          _pendingNotifications[item.id] =
              _PendingCosFollowUpNotification.fromItem(item);
          continue;
        }
        _pendingNotifications.remove(item.id);
        _seen[item.id] = SeenCosFollowUp(
          eventId: item.eventId,
          state: item.state.wireValue,
        );
      }
      await _saveNotificationState();
      _ensureSubscriptionGenerationHealthy(generation);
      state = state.copyWith(
        items: items,
        loading: false,
        clearLoadError: true,
      );
      unawaited(retryPendingNotifications());
    } catch (_) {
      if (generation == _subscriptionGeneration) {
        _disposeSubscriptions(cancelRecovery: false);
      }
      rethrow;
    }
  }

  Future<List<NostrEvent>> _fetchItemHistory() => ref
      .read(relaySessionProvider.notifier)
      .fetchHistory(
        NostrFilter(
          kinds: const [EventKind.cosFollowUpItem],
          authors: [_trustedBridgePubkey],
          tags: {
            '#p': [_pubkey],
          },
          limit: 500,
        ),
      );

  List<CosFollowUpItem> _projectItems(List<NostrEvent> events) =>
      projectLatestCosFollowUpItems(
        events,
        _pubkey,
        trustedBridgePubkey: _trustedBridgePubkey,
      ).where((item) => !_wasObservedRemoved(item)).toList();

  Future<void> _subscribeItems(int generation) async {
    final session = ref.read(relaySessionProvider.notifier);
    final unsubscribe = await session.subscribeAfterEose(
      NostrFilter(
        kinds: const [EventKind.cosFollowUpItem],
        authors: [_trustedBridgePubkey],
        tags: {
          '#p': [_pubkey],
        },
        limit: 0,
      ),
      _handleLiveItem,
      onClosed: (message) =>
          _handleSubscriptionClosed(generation, 'item', message),
    );
    if (generation != _subscriptionGeneration) {
      unsubscribe();
      return;
    }
    _unsubscribeItems = unsubscribe;
  }

  Future<void> _subscribeRemovalChannel(String channelId) async {
    if (_unsubscribeRemovals.containsKey(channelId)) return;
    final existing = _removalSubscriptionsInFlight[channelId];
    if (existing != null) return existing;

    final generation = _subscriptionGeneration;
    final work = _startRemovalSubscription(channelId, generation);
    _removalSubscriptionsInFlight[channelId] = work;
    try {
      await work;
    } finally {
      if (identical(_removalSubscriptionsInFlight[channelId], work)) {
        _removalSubscriptionsInFlight.remove(channelId);
      }
    }
  }

  Future<void> _startRemovalSubscription(
    String channelId,
    int generation,
  ) async {
    final unsubscribe = await ref
        .read(relaySessionProvider.notifier)
        .subscribeAfterEose(
          NostrFilter(
            kinds: const [EventKind.deletion],
            authors: [_trustedBridgePubkey],
            tags: {
              '#h': [channelId],
            },
            limit: 0,
          ),
          _handleRemoval,
          onClosed: (message) =>
              _handleSubscriptionClosed(generation, 'tombstone', message),
        );
    if (generation != _subscriptionGeneration) {
      unsubscribe();
      return;
    }
    _unsubscribeRemovals[channelId] = unsubscribe;
  }

  void _disposeSubscriptions({bool cancelRecovery = true}) {
    if (cancelRecovery) {
      _cancelSubscriptionRecovery();
      _subscriptionRecoveryAttempt = 0;
    }
    _subscriptionGeneration++;
    _closedSubscriptionGeneration = null;
    _unsubscribeItems?.call();
    _unsubscribeItems = null;
    for (final unsubscribe in _unsubscribeRemovals.values) {
      unsubscribe();
    }
    _unsubscribeRemovals.clear();
    _removalSubscriptionsInFlight.clear();
  }

  void _handleSubscriptionClosed(int generation, String stream, String _) {
    if (_disposed ||
        !_authorised ||
        generation != _subscriptionGeneration ||
        _pubkey.isEmpty ||
        _trustedBridgePubkey.isEmpty) {
      return;
    }
    _closedSubscriptionGeneration = generation;
    state = state.copyWith(
      loading: false,
      loadError:
          'Live updates interrupted on the $stream stream; reconnecting.',
    );
    _scheduleSubscriptionRecovery();
  }

  void _ensureSubscriptionGenerationHealthy(int generation) {
    if (generation != _subscriptionGeneration) {
      throw StateError('Follow-up subscription refresh was superseded.');
    }
    if (_closedSubscriptionGeneration == generation) {
      throw StateError('Relay closed a follow-up live subscription.');
    }
  }

  void _scheduleSubscriptionRecovery() {
    if (_disposed ||
        !_authorised ||
        _subscriptionRecoveryTimer != null ||
        _subscriptionRecoveryInFlight ||
        _pubkey.isEmpty ||
        _trustedBridgePubkey.isEmpty) {
      return;
    }
    if (_subscriptionRecoveryAttempt >= _subscriptionRecoveryDelays.length) {
      state = state.copyWith(
        loading: false,
        loadError:
            'Live updates remain unavailable after bounded retries. '
            'Pull to refresh and try again.',
      );
      return;
    }
    final delay = _subscriptionRecoveryDelays[_subscriptionRecoveryAttempt];
    _subscriptionRecoveryAttempt++;
    _subscriptionRecoveryTimer = Timer(delay, () {
      _subscriptionRecoveryTimer = null;
      unawaited(_recoverSubscriptions());
    });
  }

  Future<void> _recoverSubscriptions() async {
    if (_disposed ||
        !_authorised ||
        _pubkey.isEmpty ||
        _trustedBridgePubkey.isEmpty) {
      return;
    }
    _subscriptionRecoveryInFlight = true;
    Object? failure;
    try {
      await _refreshAndReconcile();
      _subscriptionRecoveryAttempt = 0;
    } catch (error) {
      failure = error;
      state = state.copyWith(
        loading: false,
        loadError:
            'Live updates interrupted; recovery attempt '
            '$_subscriptionRecoveryAttempt failed.',
      );
    } finally {
      _subscriptionRecoveryInFlight = false;
    }
    if (failure != null) _scheduleSubscriptionRecovery();
  }

  void _cancelSubscriptionRecovery() {
    _subscriptionRecoveryTimer?.cancel();
    _subscriptionRecoveryTimer = null;
  }

  void _dispose() {
    _disposed = true;
    _authorised = false;
    _notificationGeneration++;
    _disposeSubscriptions();
  }

  void _handleLiveItem(NostrEvent event) {
    if (!_authorised) return;
    if (event.pubkey.toLowerCase() != _trustedBridgePubkey) return;
    CosFollowUpItem item;
    try {
      item = CosFollowUpItem.fromEvent(event, expectedAssignee: _pubkey);
    } on FormatException {
      return;
    }
    if (!_unsubscribeRemovals.containsKey(item.channelId)) {
      unawaited(_handleLiveItemAfterRemovalFence(item));
      return;
    }
    _applyLiveItem(event, item);
  }

  Future<void> _handleLiveItemAfterRemovalFence(CosFollowUpItem item) async {
    if (!_authorised) return;
    final generation = _subscriptionGeneration;
    await _subscribeRemovalChannel(item.channelId);
    if (!_authorised || generation != _subscriptionGeneration) return;

    // The item may have been deleted while its channel subscription was being
    // established. Reconcile against durable relay history before projecting
    // or notifying.
    final events = await _fetchItemHistory();
    if (!_authorised || generation != _subscriptionGeneration) return;
    final retained = _projectItems(
      events,
    ).where((candidate) => candidate.id == item.id).firstOrNull;
    if (retained == null) return;
    final retainedEvent = events
        .where((candidate) => candidate.id == retained.eventId)
        .firstOrNull;
    if (retainedEvent == null) return;
    _applyLiveItem(retainedEvent, retained);
  }

  void _applyLiveItem(NostrEvent event, CosFollowUpItem item) {
    if (!_authorised) return;
    CosFollowUpItem? retained;
    final projectedItems = projectLatestCosFollowUpItems(
      [for (final current in state.items) _eventProjection(current), event],
      _pubkey,
      trustedBridgePubkey: _trustedBridgePubkey,
    ).where((projected) => !_wasObservedRemoved(projected)).toList();
    for (final projected in projectedItems) {
      if (projected.id == item.id) {
        retained = projected;
        break;
      }
    }
    state = state.copyWith(items: projectedItems);
    if (retained == null || retained.eventId != item.eventId) return;

    final prior = _seen[retained.id];
    final pending = _pendingNotifications[retained.id];
    if (retained.state == CosFollowUpState.confirmed) {
      _pendingNotifications.remove(retained.id);
      _seen[retained.id] = SeenCosFollowUp(
        eventId: retained.eventId,
        state: retained.state.wireValue,
      );
      unawaited(_saveNotificationState());
    } else if (pending != null) {
      _pendingNotifications[retained.id] =
          _PendingCosFollowUpNotification.fromItem(retained);
      unawaited(_savePendingNotifications());
      if (pending.state != retained.state.wireValue) {
        _queuePendingDelivery(retained.id);
      }
    } else if (isNewlyActionableTransition(prior, retained)) {
      _pendingNotifications[retained.id] =
          _PendingCosFollowUpNotification.fromItem(retained);
      unawaited(_persistAndQueuePendingDelivery(retained.id));
    } else {
      _seen[retained.id] = SeenCosFollowUp(
        eventId: retained.eventId,
        state: retained.state.wireValue,
      );
      unawaited(_saveSeen());
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
    if (!_authorised ||
        event.kind != EventKind.deletion ||
        event.pubkey.toLowerCase() != _trustedBridgePubkey) {
      return;
    }
    final channel = _exactTag(event, 'h');
    final itemId = _exactTag(event, 'item');
    final target = _exactTag(event, 'e');
    if (channel == null || itemId == null || target == null) return;
    _observedRemovals.add((channel, itemId, target));
    final removedCurrentProjection = state.items.any(
      (item) =>
          item.channelId == channel &&
          item.id == itemId &&
          item.eventId == target,
    );
    if (!removedCurrentProjection) return;
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
    _pendingNotifications.remove(itemId);
    unawaited(_saveNotificationState());
  }

  bool _wasObservedRemoved(CosFollowUpItem item) =>
      _observedRemovals.contains((item.channelId, item.id, item.eventId));

  Future<void> _persistAndQueuePendingDelivery(String itemId) async {
    if (!_authorised) return;
    final generation = _notificationGeneration;
    await _savePendingNotifications();
    if (_authorised && generation == _notificationGeneration) {
      _queuePendingDelivery(itemId);
    }
  }

  /// Re-attempts notifications retained after permission denial or app exit.
  ///
  /// The app calls this when it resumes, so granting notification permission
  /// in Android settings replays the queued actionable state immediately.
  Future<void> retryPendingNotifications() async {
    if (!_authorised) return;
    for (final itemId in _pendingNotifications.keys.toList()) {
      _queuePendingDelivery(itemId);
    }
  }

  void _queuePendingDelivery(String itemId) {
    if (!_authorised) return;
    final generation = _notificationGeneration;
    final token = '$generation:$itemId';
    if (!_deliveryInFlight.add(token)) return;
    unawaited(_deliverPending(itemId, generation, token));
  }

  Future<void> _deliverPending(
    String itemId,
    int generation,
    String token,
  ) async {
    try {
      while (_authorised && generation == _notificationGeneration) {
        final pending = _pendingNotifications[itemId];
        if (pending == null) return;
        CosFollowUpNotificationDelivery outcome;
        try {
          outcome = await ref
              .read(cosFollowUpNotificationSinkProvider)
              .show(
                id: pending.eventId,
                title: pending.title,
                body: pending.body,
              );
        } catch (_) {
          return;
        }
        if (!_authorised || generation != _notificationGeneration) return;
        final current = _pendingNotifications[itemId];
        if (outcome == CosFollowUpNotificationDelivery.denied) return;
        if (current == null) return;

        final deliveredCurrentState = current.state == pending.state;
        _seen[itemId] = SeenCosFollowUp(
          eventId: deliveredCurrentState ? current.eventId : pending.eventId,
          state: pending.state,
        );
        if (deliveredCurrentState) {
          _pendingNotifications.remove(itemId);
        }
        await _saveNotificationState();
        if (deliveredCurrentState) return;
      }
    } finally {
      _deliveryInFlight.remove(token);
    }
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
    if (!_authorised) return;
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
    if (!_authorised) return;
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
            authors: [_trustedBridgePubkey],
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
      if (event.pubkey.toLowerCase() != _trustedBridgePubkey) continue;
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
            authors: [_trustedBridgePubkey],
            tags: {
              '#p': [_pubkey],
            },
            limit: 500,
          ),
        );
    final items = projectLatestCosFollowUpItems(
      events,
      _pubkey,
      trustedBridgePubkey: _trustedBridgePubkey,
    );
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
