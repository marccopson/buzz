import 'dart:async';
import 'dart:convert';

import 'package:buzz/features/cos_follow_up/cos_follow_up.dart';
import 'package:buzz/features/cos_follow_up/cos_follow_up_authority.dart';
import 'package:buzz/features/cos_follow_up/cos_follow_up_notification_service.dart';
import 'package:buzz/features/cos_follow_up/cos_follow_up_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const seenKey = 'buzz.cos-follow-up.seen.v1:http://relay.test:assignee';
  const pendingKey =
      'buzz.cos-follow-up.pending-notifications.v1:'
      'http://relay.test:assignee';

  test(
    'acknowledges only shown delivery and dedupes same-state refresh',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final session = _FakeRelaySession();
      final sink = _ControlledNotificationSink();
      final container = _container(prefs: prefs, session: session, sink: sink);
      addTearDown(container.dispose);

      container.read(cosFollowUpProvider);
      await _waitUntil(() => session.itemListener != null);
      session.itemListener!(_itemEvent());
      await _waitUntil(() => sink.calls == 1);
      await Future<void>.delayed(Duration.zero);

      expect(_storedItems(prefs, seenKey), isNot(contains('item-1')));
      expect(
        (jsonDecode(prefs.getString(pendingKey)!) as Map<String, dynamic>),
        contains('item-1'),
      );

      session.itemListener!(_itemEvent(eventId: 'event-2', version: 2));
      await Future<void>.delayed(Duration.zero);
      expect(sink.calls, 1);

      sink.completion.complete(CosFollowUpNotificationDelivery.shown);
      await _waitUntil(() => _storedItems(prefs, seenKey).contains('item-1'));
      expect(prefs.getString(pendingKey), isNull);

      session.itemListener!(_itemEvent(eventId: 'event-3', version: 3));
      await Future<void>.delayed(Duration.zero);
      expect(sink.calls, 1);
    },
  );

  test(
    'denied delivery stays pending and retries after permission grant',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final session = _FakeRelaySession();
      final sink = _SequenceNotificationSink([
        CosFollowUpNotificationDelivery.denied,
        CosFollowUpNotificationDelivery.shown,
      ]);
      final container = _container(prefs: prefs, session: session, sink: sink);
      addTearDown(container.dispose);

      final notifier = container.read(cosFollowUpProvider.notifier);
      await _waitUntil(() => session.itemListener != null);
      session.itemListener!(_itemEvent());
      await _waitUntil(() => sink.calls == 1);

      expect(_storedItems(prefs, seenKey), isNot(contains('item-1')));
      expect(prefs.getString(pendingKey), isNotNull);

      await notifier.retryPendingNotifications();
      await _waitUntil(() => sink.calls == 2);
      await _waitUntil(() => _storedItems(prefs, seenKey).contains('item-1'));

      expect(prefs.getString(pendingKey), isNull);
    },
  );

  test(
    'restart recovers a denied notification before history catches up',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final firstSession = _FakeRelaySession();
      final deniedSink = _SequenceNotificationSink([
        CosFollowUpNotificationDelivery.denied,
      ]);
      final firstContainer = _container(
        prefs: prefs,
        session: firstSession,
        sink: deniedSink,
      );

      firstContainer.read(cosFollowUpProvider);
      await _waitUntil(() => firstSession.itemListener != null);
      firstSession.itemListener!(_itemEvent());
      await _waitUntil(() => deniedSink.calls == 1);
      expect(prefs.getString(pendingKey), isNotNull);
      expect(_storedItems(prefs, seenKey), isNot(contains('item-1')));
      firstContainer.dispose();

      final restartSession = _FakeRelaySession();
      final grantedSink = _SequenceNotificationSink([
        CosFollowUpNotificationDelivery.shown,
      ]);
      final restartContainer = _container(
        prefs: prefs,
        session: restartSession,
        sink: grantedSink,
      );
      addTearDown(restartContainer.dispose);

      restartContainer.read(cosFollowUpProvider);
      await _waitUntil(() => grantedSink.calls == 1);
      await _waitUntil(() => _storedItems(prefs, seenKey).contains('item-1'));

      expect(prefs.getString(pendingKey), isNull);
    },
  );

  test(
    'stale tombstone preserves notification state for current event replay',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final session = _FakeRelaySession();
      final sink = _SequenceNotificationSink([
        CosFollowUpNotificationDelivery.shown,
        CosFollowUpNotificationDelivery.shown,
      ]);
      final container = _container(prefs: prefs, session: session, sink: sink);
      addTearDown(container.dispose);

      container.read(cosFollowUpProvider);
      await _waitUntil(() => session.itemListener != null);
      final current = _itemEvent(eventId: 'event-current', version: 2);
      session.itemListener!(current);
      await _waitUntil(() => sink.calls == 1);
      await _waitUntil(() => _storedItems(prefs, seenKey).contains('item-1'));
      await _waitUntil(() => session.removalListener != null);

      session.removalListener!(_removalEvent(targetEventId: 'event-stale'));
      session.itemListener!(current);
      await _flushAsync();

      expect(
        container.read(cosFollowUpProvider).items.single.eventId,
        'event-current',
      );
      expect(_storedItems(prefs, seenKey), contains('item-1'));
      expect(prefs.getString(pendingKey), isNull);
      expect(sink.calls, 1);
    },
  );

  test(
    'delayed lower version neither regresses nor mutates notification state',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final session = _FakeRelaySession();
      final sink = _SequenceNotificationSink([
        CosFollowUpNotificationDelivery.shown,
        CosFollowUpNotificationDelivery.shown,
      ]);
      final container = _container(prefs: prefs, session: session, sink: sink);
      addTearDown(container.dispose);

      container.read(cosFollowUpProvider);
      await _waitUntil(() => session.itemListener != null);
      session.itemListener!(
        _itemEvent(eventId: 'event-current', state: 'needs-answer', version: 2),
      );
      await _waitUntil(() => sink.calls == 1);
      await _waitUntil(() => _storedItems(prefs, seenKey).contains('item-1'));

      session.itemListener!(
        _itemEvent(eventId: 'event-stale', state: 'ready-to-check', version: 1),
      );
      await _flushAsync();

      final retained = container.read(cosFollowUpProvider).items.single;
      expect(retained.eventId, 'event-current');
      expect(retained.state, CosFollowUpState.needsAnswer);
      expect(_storedItems(prefs, seenKey), contains('item-1'));
      expect(prefs.getString(pendingKey), isNull);
      expect(sink.calls, 1);
    },
  );

  test(
    'tombstone between item snapshot and removal subscription is not missed',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final session = _FakeRelaySession(
        itemHistory: [_itemEvent()],
        emitRemovalDuringItemHistory: true,
      );
      final container = _container(
        prefs: prefs,
        session: session,
        sink: _SequenceNotificationSink([]),
      );
      addTearDown(container.dispose);

      container.read(cosFollowUpProvider);
      await _waitUntil(() => !container.read(cosFollowUpProvider).loading);
      await _flushAsync();

      expect(
        container.read(cosFollowUpProvider).items,
        isEmpty,
        reason:
            'the trusted tombstone must win even when the item query returns a stale snapshot',
      );
      expect(session.removalListener, isNotNull);
    },
  );
}

Set<String> _storedItems(SharedPreferences prefs, String key) {
  final raw = prefs.getString(key);
  if (raw == null) return {};
  return (jsonDecode(raw) as Map<String, dynamic>).keys.toSet();
}

ProviderContainer _container({
  required SharedPreferences prefs,
  required _FakeRelaySession session,
  required CosFollowUpNotificationSink sink,
}) => ProviderContainer(
  overrides: [
    savedPrefsProvider.overrideWithValue(prefs),
    relayConfigProvider.overrideWith(_FakeRelayConfig.new),
    relaySessionProvider.overrideWith(() => session),
    myPubkeyProvider.overrideWithValue('assignee'),
    cosFollowUpBridgePubkeyProvider.overrideWithValue(
      const AsyncData('bridge'),
    ),
    cosFollowUpNotificationSinkProvider.overrideWithValue(sink),
  ],
);

Future<void> _waitUntil(bool Function() predicate) async {
  for (var attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Future<void>.delayed(Duration.zero);
  }
  fail('Condition was not reached');
}

Future<void> _flushAsync() async {
  for (var attempt = 0; attempt < 20; attempt++) {
    await Future<void>.delayed(Duration.zero);
  }
}

NostrEvent _itemEvent({
  String eventId = 'event-1',
  String state = 'needs-answer',
  int version = 1,
}) => NostrEvent(
  id: eventId,
  pubkey: 'bridge',
  createdAt: version,
  kind: EventKind.cosFollowUpItem,
  tags: const [
    ['h', '11111111-1111-1111-1111-111111111111'],
    ['d', 'item-1'],
    ['p', 'assignee'],
  ],
  content: jsonEncode({
    'schema': cosFollowUpSchema,
    'id': 'item-1',
    'jira_key': 'COS-683',
    'title': 'Confirm the evidence',
    'question_evidence': {
      'question': 'Is this right?',
      'evidence': 'Meeting line 14',
    },
    'state': state,
    'assigned_person': {'id': 7, 'name': 'Marc'},
    'named_confirmer': null,
    'version': version,
    'permitted_actions': state == 'needs-answer'
        ? ['answer']
        : ['confirm', 'reject'],
    'timestamps': {
      'created_at': '2026-07-28T06:00:00Z',
      'updated_at': '2026-07-28T06:01:00Z',
      'published_at': '2026-07-28T06:01:00Z',
      'last_activity_at': '2026-07-28T06:01:00Z',
      'answered_at': null,
      'ready_to_check_at': null,
      'confirmed_at': null,
      'rejected_at': null,
    },
    'deep_links': {
      'meeting_follow_up': 'https://cos.example/follow-up/1',
      'jira': null,
      'sources': [],
    },
  }),
  sig: '',
);

NostrEvent _removalEvent({required String targetEventId}) => NostrEvent(
  id: 'removal-event',
  pubkey: 'bridge',
  createdAt: 3,
  kind: EventKind.deletion,
  tags: [
    ['h', '11111111-1111-1111-1111-111111111111'],
    ['item', 'item-1'],
    ['e', targetEventId],
  ],
  content: '',
  sig: '',
);

class _ControlledNotificationSink implements CosFollowUpNotificationSink {
  final completion = Completer<CosFollowUpNotificationDelivery>();
  int calls = 0;

  @override
  Future<CosFollowUpNotificationDelivery> show({
    required String id,
    required String title,
    required String body,
  }) {
    calls++;
    return completion.future;
  }
}

class _SequenceNotificationSink implements CosFollowUpNotificationSink {
  final List<CosFollowUpNotificationDelivery> _outcomes;
  int calls = 0;

  _SequenceNotificationSink(this._outcomes);

  @override
  Future<CosFollowUpNotificationDelivery> show({
    required String id,
    required String title,
    required String body,
  }) async {
    calls++;
    return _outcomes.removeAt(0);
  }
}

class _FakeRelayConfig extends RelayConfigNotifier {
  @override
  RelayConfig build() => const RelayConfig(baseUrl: 'http://relay.test');
}

class _FakeRelaySession extends RelaySessionNotifier {
  final List<NostrEvent> itemHistory;
  final bool emitRemovalDuringItemHistory;
  final _liveItemHistory = <NostrEvent>[];
  final _removedEventIds = <String>{};
  bool _emittedRemovalDuringHistory = false;
  void Function(NostrEvent)? itemListener;
  void Function(NostrEvent)? removalListener;

  _FakeRelaySession({
    this.itemHistory = const [],
    this.emitRemovalDuringItemHistory = false,
  });

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (!filter.kinds.contains(EventKind.cosFollowUpItem)) return const [];
    if (emitRemovalDuringItemHistory && !_emittedRemovalDuringHistory) {
      _emittedRemovalDuringHistory = true;
      _removedEventIds.add('event-1');
      scheduleMicrotask(
        () => removalListener?.call(_removalEvent(targetEventId: 'event-1')),
      );
      return [...itemHistory, ..._liveItemHistory];
    }
    return [
      ...itemHistory,
      ..._liveItemHistory,
    ].where((event) => !_removedEventIds.contains(event.id)).toList();
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async {
    if (filter.kinds.contains(EventKind.cosFollowUpItem)) {
      itemListener = (event) {
        _liveItemHistory.add(event);
        onEvent(event);
      };
    }
    if (filter.kinds.contains(EventKind.deletion)) {
      removalListener = (event) {
        final target = event.tags
            .where((tag) => tag.length == 2 && tag[0] == 'e')
            .map((tag) => tag[1])
            .firstOrNull;
        if (target != null) _removedEventIds.add(target);
        onEvent(event);
      };
    }
    return () {};
  }

  @override
  Future<void Function()> subscribeAfterEose(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) => subscribe(filter, onEvent, onClosed: onClosed);
}
