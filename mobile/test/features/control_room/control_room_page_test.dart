import 'dart:convert';

import 'package:buzz/features/control_room/agent_health_provider.dart';
import 'package:buzz/features/control_room/control_room_page.dart';
import 'package:buzz/features/cos_user_context/cos_user_context.dart';
import 'package:buzz/features/cos_user_context/cos_user_context_provider.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../helpers/widget_helpers.dart';

Map<String, dynamic> healthPayload({
  String sourceStatus = 'fresh',
  DateTime? observedAt,
  int maxAgeSeconds = 93600,
}) {
  final observedAtText = (observedAt ?? DateTime.now().toUtc())
      .toIso8601String();
  final dimensions = {
    for (final name in [
      'alive',
      'connected',
      'authenticated',
      'capable',
      'working',
      'fresh',
      'safe',
      'recoverable',
    ])
      name: {
        'state': name == 'working' ? 'unknown' : 'pass',
        'evidence': [name],
      },
  };
  return {
    'schemaVersion': 'mac-agent-health/v1',
    'generatedAt': '2026-07-29T06:00:00Z',
    'authority': {
      'id': 'brain-vps-health-check',
      'role': 'authoritative-estate-observer',
    },
    'operationalStatus': 'green',
    'assuranceStatus': 'partial',
    'assuranceGaps': ['current-run evidence', 'recovery evidence'],
    'source': {
      'status': sourceStatus,
      'maxAgeSeconds': maxAgeSeconds,
      'estate': {
        'path': '/root/MAC-Local/reports/infra-check-latest.md',
        'observedAt': observedAtText,
        'ageSeconds': 10,
        'sha256': 'a' * 64,
      },
      'agents': {
        'path': '/root/MAC-Local/reports/mac-workspace-hermes-latest.md',
        'observedAt': observedAtText,
        'ageSeconds': 10,
        'sha256': 'b' * 64,
      },
    },
    'nodes': [
      {
        'id': 'brain',
        'name': 'Brain',
        'status': 'green',
        'detail': 'Baseline checks OK',
      },
    ],
    'agents': [
      {
        'id': 'sammi',
        'name': 'Sammi',
        'operationalStatus': 'green',
        'assuranceStatus': 'partial',
        'dimensions': dimensions,
      },
    ],
    'components': <Object>[],
    'issues': <Object>[],
  };
}

void main() {
  const authorisedContext = CosUserContext(
    eventId: 'context',
    channelId: 'channel',
    assigneePubkey: 'user',
    modules: ['today', 'my_actions', 'messages', 'agents', 'running_order'],
    createdAt: 1,
  );

  testWidgets('shows operational state and assurance gaps separately', (
    tester,
  ) async {
    final client = http_testing.MockClient((request) async {
      expect(
        request.url.toString(),
        'https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1',
      );
      return http.Response(jsonEncode(healthPayload()), 200);
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Control Room'), findsOneWidget);
    expect(find.text('Healthy'), findsWidgets);
    expect(find.text('partial'), findsOneWidget);
    expect(find.text('2 known gap(s)'), findsOneWidget);
    expect(find.text('Sammi', skipOffstage: false), findsOneWidget);
    expect(find.text('working · Unknown'), findsOneWidget);
    expect(find.text('alive · Pass'), findsOneWidget);
  });

  testWidgets('labels stale evidence and every value as last known', (
    tester,
  ) async {
    final client = http_testing.MockClient(
      (_) async =>
          http.Response(jsonEncode(healthPayload(sourceStatus: 'stale')), 200),
    );
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Evidence stale'), findsWidgets);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('control-room-health-brain')),
      200,
    );
    expect(find.text('Last known: Healthy'), findsWidgets);
    expect(
      find.text(
        'Values below are last-known evidence and are not current health.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('preserves last-known values after a failed refresh', (
    tester,
  ) async {
    var requests = 0;
    final client = http_testing.MockClient((_) async {
      requests += 1;
      if (requests == 1) {
        return http.Response(jsonEncode(healthPayload()), 200);
      }
      return http.Response('unavailable', 503);
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sammi'), findsOneWidget);

    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();

    expect(find.text('Last known — refresh failed'), findsWidgets);
    expect(find.text('Sammi', skipOffstage: false), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('control-room-health-brain')),
      200,
    );
    expect(find.text('Last known: Healthy'), findsWidgets);
  });

  testWidgets('fails closed when displayed evidence reaches its deadline', (
    tester,
  ) async {
    final observedAt = DateTime.now().toUtc().subtract(
      const Duration(seconds: 59),
    );
    final client = http_testing.MockClient(
      (_) async => http.Response(
        jsonEncode(healthPayload(observedAt: observedAt, maxAgeSeconds: 60)),
        200,
      ),
    );
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Healthy'), findsWidgets);

    await tester.pump(const Duration(seconds: 2));
    await tester.pump();

    expect(find.text('Evidence stale'), findsWidgets);
  });

  testWidgets('polls authoritative health every minute', (tester) async {
    var requests = 0;
    final client = http_testing.MockClient((_) async {
      requests += 1;
      return http.Response(jsonEncode(healthPayload()), 200);
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();
    expect(requests, 1);

    await tester.pump(const Duration(minutes: 1));
    await tester.pumpAndSettle();

    expect(requests, 2);
  });

  testWidgets('fails closed before fetching when role access is absent', (
    tester,
  ) async {
    var requests = 0;
    final client = http_testing.MockClient((_) async {
      requests += 1;
      return http.Response('{}', 200);
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(const AsyncData(null)),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Access not available'), findsOneWidget);
    expect(requests, 0);
  });
}

class _TestRelayConfigNotifier extends RelayConfigNotifier {
  final String baseUrl;

  _TestRelayConfigNotifier(this.baseUrl);

  @override
  RelayConfig build() => RelayConfig(baseUrl: baseUrl);
}
